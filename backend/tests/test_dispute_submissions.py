"""HTTP contract for grouped dispute submissions (#49).

SQL behavior (one case per market, windows, duplicates, concurrency, privacy grants)
is covered by supabase/tests/governance_dispute_submissions.sql; these tests cover
route wiring, response shapes and authorization dependencies only.
"""

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from dependencies import (
    get_current_user,
    get_current_user_optional,
    get_supabase_client,
    get_user_token,
)

SUBMISSION = {
    "id": "s1", "dispute_id": "d1", "market_id": "m1", "submitter_id": "u1",
    "explanation": "The source says otherwise.", "voting_deadline": "2026-11-20T00:00:00+00:00",
    "opened_case": False, "created_at": "2026-11-18T00:00:00+00:00",
}


@pytest.fixture
def api(monkeypatch):
    import main
    import routers.markets

    supabase = Mock()
    monkeypatch.setattr(routers.markets, "normalize_market_state", Mock())

    def build(user=None):
        monkeypatch.setattr(main.app, "dependency_overrides", {
            get_current_user: lambda: user or {"id": "u1", "role": "user"},
            get_current_user_optional: lambda: user,
            get_supabase_client: lambda: supabase,
            get_user_token: lambda: None,
        })
        return TestClient(main.app)

    return SimpleNamespace(build=build, supabase=supabase)


def test_filing_returns_the_submission_and_whether_it_opened_the_case(api):
    client = api.build()
    api.supabase.rpc.return_value.execute.return_value = SimpleNamespace(data=SUBMISSION)

    response = client.post("/api/markets/m1/dispute", json={"explanation": "  The source says otherwise.  "})

    assert response.status_code == 200
    assert response.json() == {**SUBMISSION, "voting_deadline": "2026-11-20T00:00:00Z", "created_at": "2026-11-18T00:00:00Z"}
    api.supabase.rpc.assert_called_once_with("file_dispute", {
        "p_market_id": "m1", "p_disputer_id": "u1", "p_explanation": "The source says otherwise.",
    })


@pytest.mark.parametrize("explanation", ["", "   ", "x" * 1001])
def test_invalid_explanations_never_reach_the_database(api, explanation):
    client = api.build()
    response = client.post("/api/markets/m1/dispute", json={"explanation": explanation})
    assert response.status_code == 422
    api.supabase.rpc.assert_not_called()


def test_public_listing_exposes_explanations_but_no_submitter(api):
    client = api.build(user=None)
    api.supabase.rpc.return_value.execute.return_value = SimpleNamespace(data={
        "total": 2, "has_submitted": False,
        "items": [
            {"id": "s1", "explanation": "First", "created_at": "2026-11-18T00:00:00+00:00", "is_mine": False},
            {"id": "s2", "explanation": "Second", "created_at": "2026-11-18T01:00:00+00:00", "is_mine": False,
             "submitter_id": "leak"},
        ],
    })

    response = client.get("/api/markets/m1/dispute/submissions?limit=2&offset=0")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert [item["explanation"] for item in body["items"]] == ["First", "Second"]
    assert all(set(item) == {"id", "explanation", "created_at", "is_mine"} for item in body["items"])
    api.supabase.rpc.assert_called_once_with(
        "list_dispute_submissions", {"p_market_id": "m1", "p_limit": 2, "p_offset": 0},
    )


@pytest.mark.parametrize("query", ["limit=0", "limit=101", "offset=-1"])
def test_public_listing_bounds_its_page(api, query):
    client = api.build(user=None)
    assert client.get(f"/api/markets/m1/dispute/submissions?{query}").status_code == 422
    api.supabase.rpc.assert_not_called()


def test_public_listing_failure_uses_the_safe_envelope(api):
    client = api.build(user=None)
    api.supabase.rpc.return_value.execute.side_effect = APIError({
        "code": "XX000", "message": "private detail", "details": "", "hint": "",
    })
    response = client.get("/api/markets/m1/dispute/submissions")
    assert response.status_code == 500
    assert response.json() == {"detail": {
        "code": "INTERNAL_ERROR", "message": "Failed to load dispute submissions.",
    }}


# ── Admin grouped queue ───────────────────────────────────────

def _market(market_id, status, **extra):
    return {
        "id": market_id, "title": market_id, "description": "d", "creator_id": "creator",
        "created_at": "2026-11-01T00:00:00+00:00", "close_at": "2026-11-02T00:00:00+00:00",
        "status": status, "resolution_criteria": "Official result", "category": "General",
        "yes_pool_total": 10, "no_pool_total": 5, "market_type": "binary",
        "creator": {"andrew_id": "creator", "display_name": "Creator"}, **extra,
    }


def _case(dispute_id, market_id, status, created_at, **extra):
    return {
        "id": dispute_id, "market_id": market_id, "voting_deadline": "2026-11-20T00:00:00+00:00",
        "created_at": created_at, "markets": _market(market_id, status, **extra),
    }


def _submission(sub_id, market_id, who, context):
    return {
        "id": sub_id, "market_id": market_id, "explanation": f"Concern {sub_id}",
        "created_at": "2026-11-18T00:00:00+00:00", "submitter_id": f"id-{who}",
        "andrew_id": who, "display_name": who.title(), "bettor_context": context,
    }


class Query:
    def __init__(self, database, table):
        self.database, self.table, self.filters = database, table, []
        self.window = None
        self.want_count = False

    def select(self, *_args, count=None):
        self.want_count = count == "exact"
        return self

    def eq(self, key, value):
        self.filters.append((key, {value}))
        return self

    def in_(self, key, values):
        self.filters.append((key, set(values)))
        return self

    def order(self, *_args, **_kwargs):
        return self

    def range(self, start, end):
        self.window = (start, end)
        return self

    @staticmethod
    def _value(row, key):
        for part in key.split("."):
            row = row.get(part) if isinstance(row, dict) else None
        return row

    def execute(self):
        self.database.calls.append(self.table)
        rows = [
            deepcopy(row) for row in self.database.rows.get(self.table, [])
            if all(self._value(row, key) in allowed for key, allowed in self.filters)
        ]
        total = len(rows)
        if self.window:
            rows = rows[self.window[0]:self.window[1] + 1]
            self.database.windows.append(self.window)
        return SimpleNamespace(data=rows, count=total if self.want_count else None)


class Database:
    def __init__(self, rows):
        self.rows, self.calls, self.windows, self.rpc_calls = rows, [], [], []
        self.postgrest = SimpleNamespace(auth=lambda _token: None)

    def table(self, name):
        return Query(self, name)

    def rpc(self, name, params):
        # The grouped queue may read submissions; it must never settle or write.
        assert name == "admin_dispute_submissions", f"Unexpected RPC {name}"
        self.rpc_calls.append(params)
        rows = [dict(r) for r in self.rows.get("submissions", []) if r["market_id"] in params["p_market_ids"]]
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=rows))


@pytest.fixture
def queue_api(monkeypatch):
    import main
    import routers.admin

    monkeypatch.setattr(routers.admin, "normalize_markets", lambda client: None)
    monkeypatch.setattr(routers.admin, "get_supabase_service_client", lambda: None)

    def build(rows, role="admin"):
        database = Database(rows)
        monkeypatch.setattr(main.app, "dependency_overrides", {
            get_current_user: lambda: {"id": "admin-id", "role": role},
            get_supabase_client: lambda: database,
            get_user_token: lambda: None,
        })
        return SimpleNamespace(client=TestClient(main.app), database=database)

    return build


ROWS = {
    "disputes": [
        _case("d1", "m1", "disputed", "2026-11-17T00:00:00+00:00"),
        _case("d2", "m2", "admin_review", "2026-11-17T01:00:00+00:00"),
        _case("d3", "m3", "resolved", "2026-11-17T02:00:00+00:00"),
    ],
    "submissions": [
        _submission("s1", "m1", "ada", "active"),
        _submission("s2", "m1", "grace", "refunded"),
        _submission("s3", "m2", "linus", "none"),
        _submission("s4", "m3", "ignored", "none"),
    ],
    "resolution_votes": [
        {"market_id": "m1", "selected_outcome": "YES"},
        {"market_id": "m1", "selected_outcome": "NO"},
        {"market_id": "m1", "selected_outcome": "NO"},
    ],
    "bets": [{"market_id": "m1", "user_id": "u1"}, {"market_id": "m1", "user_id": "u1"},
             {"market_id": "m1", "user_id": "u2"}],
}


@pytest.mark.parametrize("role", ["admin", "super_admin"])
def test_admin_queue_groups_every_submission_under_its_market(queue_api, role):
    api = queue_api(ROWS, role=role)

    response = api.client.get("/api/admin/markets/disputes")

    assert response.status_code == 200
    body = response.json()
    assert (body["total"], body["limit"], body["offset"]) == (2, 20, 0)  # resolved case excluded
    disputed, escalated = body["items"]
    assert disputed["market"]["id"] == "m1" and disputed["market"]["status"] == "disputed"
    assert disputed["creator"] == {"andrew_id": "creator", "display_name": "Creator"}
    assert disputed["submission_count"] == 2
    assert [(s["submitter"]["andrew_id"], s["bettor_context"]) for s in disputed["submissions"]] == [
        ("ada", "active"), ("grace", "refunded"),
    ]
    assert [s["explanation"] for s in disputed["submissions"]] == ["Concern s1", "Concern s2"]
    assert disputed["dispute_votes"] == {"yes": 1, "no": 2}
    assert disputed["bettor_count"] == 2
    assert disputed["voting_deadline"].startswith("2026-11-20")
    assert escalated["market"]["status"] == "admin_review" and escalated["submission_count"] == 1
    assert api.database.rpc_calls == [{"p_market_ids": ["m1", "m2"]}]


def test_admin_queue_filters_and_paginates(queue_api):
    api = queue_api(ROWS)

    only_review = api.client.get("/api/admin/markets/disputes?status=admin_review").json()
    assert [item["market"]["id"] for item in only_review["items"]] == ["m2"]

    second_page = api.client.get("/api/admin/markets/disputes?limit=1&offset=1").json()
    assert (second_page["total"], second_page["limit"], second_page["offset"]) == (2, 1, 1)
    assert [item["market"]["id"] for item in second_page["items"]] == ["m2"]
    assert (1, 1) in api.database.windows


@pytest.mark.parametrize("query", ["status=resolved", "limit=0", "limit=51", "offset=-1"])
def test_admin_queue_rejects_unsupported_filters(queue_api, query):
    api = queue_api(ROWS)
    assert api.client.get(f"/api/admin/markets/disputes?{query}").status_code == 422


def test_empty_admin_queue_skips_evidence_lookups(queue_api):
    api = queue_api({"disputes": []})
    response = api.client.get("/api/admin/markets/disputes")
    assert response.json() == {"items": [], "total": 0, "limit": 20, "offset": 0}
    assert api.database.calls == ["disputes"] and api.database.rpc_calls == []


@pytest.mark.parametrize("role,expected", [("user", 403)])
def test_admin_queue_requires_an_admin(queue_api, role, expected):
    api = queue_api(ROWS, role=role)
    response = api.client.get("/api/admin/markets/disputes")
    assert response.status_code == expected
    assert response.json()["detail"]["code"] == "ADMIN_REQUIRED"
    assert api.database.calls == []


def test_admin_queue_requires_authentication(monkeypatch):
    import main

    monkeypatch.setattr(main.app, "dependency_overrides", {})
    response = TestClient(main.app).get("/api/admin/markets/disputes")
    assert response.status_code == 401
