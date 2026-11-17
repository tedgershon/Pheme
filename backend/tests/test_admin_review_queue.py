"""HTTP contract for the admin-review queue; SQL settlement is tested separately."""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from dependencies import get_current_user, get_supabase_client, get_user_token

MARKET = {
    "id": "m-dispute", "title": "Disputed", "description": "d", "creator_id": "creator",
    "created_at": "2026-11-01T00:00:00+00:00", "close_at": "2026-11-02T00:00:00+00:00",
    "status": "admin_review", "resolution_criteria": "Official result", "category": "General",
    "yes_pool_total": 100, "no_pool_total": 50, "official_source": "Registrar",
    "yes_criteria": "Yes if", "no_criteria": "No if", "ambiguity_criteria": "Refund if",
    "proposed_outcome": "YES", "proposed_at": "2026-11-02T01:00:00+00:00",
    "dispute_deadline": "2026-11-03T01:00:00+00:00", "link": "https://example.edu/result",
    "market_type": "binary", "creator": {"andrew_id": "creator", "display_name": "Creator"},
}
COMMUNITY = {
    **MARKET, "id": "m-community", "title": "Tied community vote", "proposed_outcome": None,
    "dispute_deadline": None, "resolution_window_end": "2026-11-03T00:00:00+00:00",
    "market_type": "multichoice", "multichoice_type": "exclusive",
}


class Query:
    def __init__(self, database, table):
        self.database, self.table, self.filters = database, table, []

    def select(self, *_):
        return self

    def eq(self, key, value):
        self.filters.append((key, {value}))
        return self

    def in_(self, key, values):
        self.filters.append((key, set(values)))
        return self

    def order(self, *_args, **_kwargs):
        return self

    def execute(self):
        self.database.calls.append(self.table)
        rows = self.database.rows.get(self.table, [])
        return SimpleNamespace(data=[
            dict(row) for row in rows if all(row.get(k) in allowed for k, allowed in self.filters)
        ])


class Database:
    def __init__(self, rows):
        self.rows, self.calls = rows, []
        self.postgrest = SimpleNamespace(auth=lambda _token: None)

    def table(self, name):
        return Query(self, name)

    def rpc(self, *_):
        raise AssertionError("The queue listing must not settle or mutate markets")


@pytest.fixture
def queue_api(monkeypatch):
    import main
    import routers.admin

    normalized = []
    monkeypatch.setattr(routers.admin, "normalize_markets", lambda client: normalized.append(client))
    monkeypatch.setattr(routers.admin, "get_supabase_service_client", lambda: None)

    def build(rows, role="admin"):
        database = Database(rows)
        monkeypatch.setattr(main.app, "dependency_overrides", {
            get_current_user: lambda: {"id": "admin-id", "role": role},
            get_supabase_client: lambda: database,
            get_user_token: lambda: None,
        })
        return SimpleNamespace(client=TestClient(main.app), database=database, normalized=normalized)

    return build


@pytest.mark.parametrize("role", ["admin", "super_admin"])
def test_queue_returns_evidence_for_each_escalation_track(queue_api, role):
    api = queue_api({
        "markets": [MARKET, COMMUNITY, {**MARKET, "id": "m-open", "status": "open"}],
        "disputes": [{
            "id": "d1", "market_id": "m-dispute", "explanation": "Source says NO",
            "voting_deadline": "2026-11-05T00:00:00+00:00", "created_at": "2026-11-02T02:00:00+00:00",
            "disputer": {"andrew_id": "disputer", "display_name": "Disputer"},
        }],
        "resolution_votes": [
            {"market_id": "m-dispute", "selected_outcome": "YES"},
            {"market_id": "m-dispute", "selected_outcome": "NO"},
        ],
        "community_votes": [
            {"market_id": "m-community", "selected_outcome": "YES"},
            {"market_id": "m-community", "selected_outcome": "NO"},
        ],
        "bets": [
            {"market_id": "m-dispute", "user_id": "u1"}, {"market_id": "m-dispute", "user_id": "u1"},
            {"market_id": "m-dispute", "user_id": "u2"}, {"market_id": "m-community", "user_id": "u3"},
        ],
        "market_options": [{
            "id": "o1", "market_id": "m-community", "label": "A", "pool_total": 10,
            "sort_order": 0, "is_winner": None, "created_at": "2026-11-01T00:00:00+00:00",
        }],
    }, role=role)

    response = api.client.get("/api/admin/markets/admin-review")

    assert response.status_code == 200
    disputed, community = response.json()
    assert disputed["market"]["id"] == "m-dispute"
    assert disputed["market"]["ambiguity_criteria"] == "Refund if"
    assert disputed["market"]["proposed_outcome"] == "YES"
    assert disputed["creator"] == {"andrew_id": "creator", "display_name": "Creator"}
    assert disputed["escalation"] == "dispute"
    assert disputed["dispute"]["explanation"] == "Source says NO"
    assert disputed["dispute"]["disputer"]["andrew_id"] == "disputer"
    assert disputed["dispute_votes"] == {"yes": 1, "no": 1}
    assert disputed["bettor_count"] == 2
    assert community["escalation"] == "community"
    assert community["dispute"] is None
    assert community["community_votes"] == {"yes": 1, "no": 1}
    assert [o["label"] for o in community["market"]["options"]] == ["A"]
    assert len(api.normalized) == 1


def test_empty_queue_skips_evidence_queries(queue_api):
    api = queue_api({"markets": [{**MARKET, "status": "resolved"}]})
    response = api.client.get("/api/admin/markets/admin-review")
    assert response.status_code == 200
    assert response.json() == []
    assert api.database.calls == ["markets"]


def test_normalization_failure_still_lists_queue(queue_api, monkeypatch):
    import routers.admin

    def fail(_client):
        raise RuntimeError("transition failed")

    monkeypatch.setattr(routers.admin, "normalize_markets", fail)
    api = queue_api({"markets": [MARKET]})
    response = api.client.get("/api/admin/markets/admin-review")
    assert response.status_code == 200
    assert [item["market"]["id"] for item in response.json()] == ["m-dispute"]
