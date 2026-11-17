"""HTTP privacy contracts with a deliberately RLS-free query stub.

Real RLS checks run separately in supabase/tests/market_privacy.sql.
"""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from dependencies import get_supabase_client
from routers import admin, markets


class Query:
    def __init__(self, database, table):
        self.database, self.table = database, table
        self.predicates = []
        self.negated = False
        self.sort = None
        self.window = None
        self.one = False

    def select(self, *_args):
        return self

    def eq(self, field, value):
        self.predicates.append(lambda row: row.get(field) == value)
        return self

    @property
    def not_(self):
        self.negated = True
        return self

    def in_(self, field, values):
        negate = self.negated
        self.predicates.append(lambda row: (row.get(field) in values) != negate)
        self.negated = False
        return self

    def is_(self, field, _value):
        negate = self.negated
        self.predicates.append(lambda row: (row.get(field) is None) != negate)
        self.negated = False
        return self

    def order(self, field, desc=False):
        self.sort = (field, desc)
        return self

    def range(self, start, end):
        self.window = slice(start, end + 1)
        return self

    def limit(self, count):
        return self.range(0, count - 1)

    def single(self):
        self.one = True
        return self

    def execute(self):
        rows = [dict(row) for row in self.database.rows[self.table]
                if all(predicate(row) for predicate in self.predicates)]
        if self.sort:
            field, desc = self.sort
            rows.sort(key=lambda row: row.get(field) or "", reverse=desc)
        if self.window:
            rows = rows[self.window]
        if self.one and not rows:
            raise APIError({"code": "PGRST116", "message": "No visible row", "details": None, "hint": None})
        return SimpleNamespace(data=rows[0] if self.one else rows)


@pytest.fixture
def privacy_api(monkeypatch):
    import main

    profiles = [{"id": name, "role": role, "is_admin": role != "user"}
                for name, role in [("a", "user"), ("b", "user"), ("admin", "admin"), ("super", "super_admin")]]
    rows = []
    for profile in profiles:
        for index, status in enumerate(["pending_review", "denied", "open"]):
            rows.append({
                "id": f"{profile['id']}-{status}", "creator_id": profile["id"],
                "title": f"{profile['id']} private title", "description": "Private description",
                "resolution_criteria": "Private criteria", "official_source": "Private source",
                "review_notes": "Private review notes", "status": status,
                "created_at": f"2026-01-0{index + 1}T00:00:00+00:00",
                "close_at": "2099-01-01T00:00:00+00:00", "category": "General",
                "yes_pool_total": 0, "no_pool_total": 0, "market_type": "multichoice",
            })
    database = SimpleNamespace(rows={"markets": rows, "profiles": profiles, "market_options": [], "transactions": [], "bets": []})
    database.table = lambda name: Query(database, name)
    database.auth = SimpleNamespace(get_user=lambda token: SimpleNamespace(
        user=SimpleNamespace(id=token) if token in {p["id"] for p in profiles} else None))
    database.postgrest = SimpleNamespace(auth=Mock())
    normalize = Mock(side_effect=lambda _db, market_ids: [dict(row) for row in rows if row["id"] in market_ids])
    monkeypatch.setattr(markets, "normalize_markets", normalize)
    monkeypatch.setattr(markets, "get_supabase_service_client", lambda: None)
    monkeypatch.setattr(admin, "normalize_markets", normalize)
    monkeypatch.setattr(admin, "get_supabase_service_client", lambda: None)
    monkeypatch.setattr(main.app, "dependency_overrides", {get_supabase_client: lambda: database})
    with TestClient(main.app) as client:
        yield SimpleNamespace(client=client, database=database, normalize=normalize)


def headers(user):
    return {"Authorization": f"Bearer {user}"} if user else {}


@pytest.mark.parametrize("user", ["a", "b", "admin", "super"])
def test_portfolio_is_owner_only_newest_first_even_for_admin(privacy_api, user):
    response = privacy_api.client.get("/api/portfolio/proposed-markets?creator_id=b", headers=headers(user))
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [f"{user}-denied", f"{user}-pending_review"]
    assert all(row["creator_id"] == user for row in response.json())
    privacy_api.database.postgrest.auth.assert_any_call(user)


@pytest.mark.parametrize("user", [None, "invalid"])
def test_portfolio_requires_valid_auth(privacy_api, user):
    response = privacy_api.client.get("/api/portfolio/proposed-markets", headers=headers(user))
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "UNAUTHORIZED"


def test_empty_portfolio(privacy_api):
    privacy_api.database.rows["markets"].clear()
    response = privacy_api.client.get("/api/portfolio/proposed-markets", headers=headers("a"))
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.parametrize("status", ["pending_review", "denied"])
@pytest.mark.parametrize("user", [None, "invalid", "a", "b", "admin", "super"])
def test_explicit_private_list_filters_enforce_visibility(privacy_api, status, user):
    response = privacy_api.client.get(f"/api/markets?status={status}&category=General", headers=headers(user))
    assert response.status_code == 200
    owners = {row["creator_id"] for row in response.json()}
    expected = {"a", "b", "admin", "super"} if user in {"admin", "super"} else {user} if user in {"a", "b"} else set()
    assert owners == expected
    if user in {None, "invalid"}:
        privacy_api.normalize.assert_not_called()
    elif user in {"a", "b"}:
        assert all(market_id.startswith(f"{user}-") for call in privacy_api.normalize.call_args_list for market_id in call.kwargs["market_ids"])


def test_owner_scope_applies_before_pagination(privacy_api):
    response = privacy_api.client.get("/api/markets?status=denied&limit=1&offset=0", headers=headers("b"))
    assert [row["id"] for row in response.json()] == ["b-denied"]
    assert privacy_api.client.get("/api/markets?status=denied&limit=1&offset=1", headers=headers("b")).json() == []


@pytest.mark.parametrize("user", [None, "invalid", "a", "b", "admin", "super"])
def test_default_browse_excludes_private_markets_for_all_roles(privacy_api, user):
    response = privacy_api.client.get("/api/markets", headers=headers(user))
    assert response.status_code == 200
    assert len(response.json()) == 4
    assert {row["status"] for row in response.json()} == {"open"}


@pytest.mark.parametrize("status", ["pending_review", "denied", "open"])
@pytest.mark.parametrize("user", [None, "invalid", "a", "b", "admin", "super"])
def test_detail_visibility_and_safe_not_found(privacy_api, status, user):
    response = privacy_api.client.get(f"/api/markets/a-{status}", headers=headers(user))
    allowed = status == "open" or user in {"a", "admin", "super"}
    assert response.status_code == (200 if allowed else 404)
    if allowed:
        assert response.json()["id"] == f"a-{status}"
    else:
        assert response.json() == {"detail": {"code": "MARKET_NOT_FOUND", "message": "Market not found."}}
        privacy_api.normalize.assert_not_called()


def test_missing_or_rls_hidden_detail_has_same_404(privacy_api):
    response = privacy_api.client.get("/api/markets/missing", headers=headers("a"))
    assert response.status_code == 404
    assert response.json() == {"detail": {"code": "MARKET_NOT_FOUND", "message": "Market not found."}}


@pytest.mark.parametrize("user", ["admin", "super"])
def test_admin_review_queue_retains_cross_user_access_with_jwt(privacy_api, user):
    response = privacy_api.client.get("/api/admin/markets/review", headers=headers(user))
    assert response.status_code == 200
    assert len(response.json()["pending"]) == len(response.json()["denied"]) == 4
    privacy_api.database.postgrest.auth.assert_any_call(user)


@pytest.mark.parametrize("user", ["admin", "super"])
def test_admin_stats_include_private_markets_with_jwt(privacy_api, user):
    response = privacy_api.client.get("/api/admin/stats", headers=headers(user))
    assert response.status_code == 200
    assert response.json()["total_markets"] == 12
    assert response.json()["markets_by_status"] == {"pending_review": 4, "denied": 4, "open": 4}
    privacy_api.database.postgrest.auth.assert_any_call(user)
