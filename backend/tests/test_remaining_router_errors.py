"""HTTP error contracts; database/RLS enforcement lives in the migration suite."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

import observability
from dependencies import get_current_user, get_supabase_client, get_user_token
from routers import notifications


@pytest.fixture
def api_database(monkeypatch, test_profiles, sentry_events):
    import main

    database = Mock()
    query = database.table.return_value
    for method in ("select", "eq", "single", "order", "range", "update", "delete", "limit", "in_", "upsert"):
        getattr(query, method).return_value = query
    query.execute.return_value = SimpleNamespace(data=[])
    database.auth.get_user.return_value = SimpleNamespace(user=SimpleNamespace(id=test_profiles["user"]["id"]))
    profile_query = Mock()
    for method in ("select", "eq", "single"):
        getattr(profile_query, method).return_value = profile_query
    profile_query.execute.return_value = SimpleNamespace(data=test_profiles["user"])
    database.table.side_effect = lambda name: profile_query if name == "profiles" else query
    monkeypatch.setattr(main.app, "dependency_overrides", {get_supabase_client: lambda: database})
    with TestClient(main.app, raise_server_exceptions=False) as client:
        yield SimpleNamespace(client=client, database=database, query=query, profile_query=profile_query)


@pytest.mark.parametrize("path", ["/api/markets/m1/community-votes", "/api/rewards/badges/someone-else"])
def test_public_reads_attribute_failures_without_requiring_auth(api_database, sentry_events, test_profiles, path):
    api = api_database
    error = RuntimeError("private database diagnostic")
    api.query.execute.side_effect = error
    response = api.client.get(path, headers={"Authorization": "Bearer fixture-user", "x-request-id": "public-read"})
    assert response.status_code == 500
    assert response.json()["detail"]["code"] == "INTERNAL_ERROR"
    assert "private" not in response.text
    assert len(sentry_events) == 1
    assert sentry_events[0]["user"]["id"] == test_profiles["user"]["id"]
    assert sentry_events[0]["extra"]["request_id"] == "public-read"

    # A subsequent anonymous failure must not inherit the previous caller.
    sentry_events.clear()
    api.client.get(path)
    assert len(sentry_events) == 1
    assert not sentry_events[0].get("user")
    api.query.execute.side_effect = None
    assert api.client.get(path).json() == []
    api.database.auth.get_user.return_value = SimpleNamespace(user=None)
    assert api.client.get(path, headers={"Authorization": "Bearer invalid"}).json() == []


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer invalid"}])
def test_required_auth_has_safe_envelope(api_database, headers):
    api_database.database.auth.get_user.return_value = SimpleNamespace(user=None)
    response = api_database.client.get("/api/auth/me", headers=headers)
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "UNAUTHORIZED"
    api_database.database.rpc.assert_not_called()


@pytest.mark.parametrize("singular_error", [False, True])
def test_missing_profile_is_incomplete_not_server_failure(api_database, singular_error):
    api = api_database
    if singular_error:
        api.profile_query.execute.side_effect = APIError({"code": "PGRST116", "message": "private diagnostic", "details": None, "hint": None})
    else:
        api.profile_query.execute.return_value = SimpleNamespace(data=None)
    response = api.client.get("/api/auth/me", headers={"Authorization": "Bearer fixture-user"})
    assert response.status_code == 400
    assert response.json() == {"detail": {"code": "AUTH_PROFILE_INCOMPLETE", "message": "User profile not found. Please complete onboarding."}}


@pytest.mark.parametrize("path", ["/api/portfolio", "/api/transactions", "/api/rewards", "/api/leaderboard"])
def test_read_only_router_failures_use_global_safe_envelope(api_database, path):
    api = api_database
    error = RuntimeError("private diagnostic")
    api.query.execute.side_effect = error
    api.database.rpc.return_value.execute.side_effect = error
    response = api.client.get(path, headers={"Authorization": "Bearer fixture-user"})
    assert response.status_code == 500
    assert response.json() == {"detail": {"code": "INTERNAL_ERROR", "message": "Internal server error."}}


def test_auth_configuration_error_is_safe(monkeypatch):
    import dependencies

    monkeypatch.setattr(dependencies, "_supabase_client", None)
    monkeypatch.setattr(dependencies, "get_settings", lambda: SimpleNamespace(supabase_url="", supabase_key=""))
    with pytest.raises(observability.AppError) as raised:
        dependencies.get_supabase_client()
    assert raised.value.status_code == 503
    assert raised.value.detail == {"code": "INTERNAL_ERROR", "message": "Service temporarily unavailable."}


class NotificationQuery:
    """Apply only explicit API filters, with no simulated RLS protection."""

    def __init__(self, rows):
        self.rows = rows
        self.filters = {}
        self.deleting = False

    def eq(self, field, value):
        self.filters[field] = value
        return self

    def update(self, _payload):
        return self

    def delete(self):
        self.deleting = True
        return self

    def execute(self):
        found = [row for row in self.rows if all(row[key] == value for key, value in self.filters.items())]
        for row in found:
            if self.deleting:
                self.rows.remove(row)
            else:
                row["is_read"] = True
        return SimpleNamespace(data=found)


@pytest.mark.parametrize("method,suffix", [("POST", "/read"), ("DELETE", "")])
@pytest.mark.parametrize("role", ["user", "admin", "super_admin"])
def test_notification_owner_and_missing_contract(method, suffix, role, sentry_events):
    row = {"id": "n1", "user_id": "owner", "is_read": False}
    rows = [row]
    database = Mock()
    database.table.side_effect = lambda _name: NotificationQuery(rows)
    actor = {"id": "other", "role": role}
    app = FastAPI()
    app.include_router(notifications.router)
    app.dependency_overrides = {
        get_current_user: lambda: actor,
        get_supabase_client: lambda: database,
        get_user_token: lambda: None,
    }
    with TestClient(app) as client:
        other = client.request(method, f"/api/notifications/n1{suffix}")
        missing = client.request(method, f"/api/notifications/missing{suffix}")
        assert other.status_code == missing.status_code == 404
        assert other.json() == missing.json() == {"detail": {"code": "NOTIFICATION_NOT_FOUND", "message": "Notification not found."}}
        assert rows == [row]
        assert row["is_read"] is False
        actor["id"] = "owner"
        owner = client.request(method, f"/api/notifications/n1{suffix}")
        assert owner.status_code == 200
        assert owner.json() == {"status": "ok"}
        if method == "POST":
            assert row["is_read"] is True
            assert client.post("/api/notifications/n1/read").status_code == 200
        else:
            assert rows == []
            assert client.delete("/api/notifications/n1").status_code == 404
    assert sentry_events == []


@pytest.mark.parametrize("method,payload,code", [
    ("POST", {"andrew_id": " ", "display_name": "Name"}, "VALIDATION_FAILED"),
    ("POST", {"andrew_id": "name", "display_name": " "}, "VALIDATION_FAILED"),
    ("PATCH", {"display_name": "X" * 33}, "VALIDATION_FAILED"),
    ("PATCH", {"display_name": "<script>"}, "VALIDATION_FAILED"),
    ("PATCH", {"equipped_badges": {"unknown": "b1"}}, "VALIDATION_FAILED"),
    ("PATCH", {"equipped_badges": {"oracle": " "}}, "VALIDATION_FAILED"),
    ("PATCH", {}, "VALIDATION_FAILED"),
])
def test_profile_validation_envelopes(api_database, method, payload, code):
    response = api_database.client.request(method, "/api/auth/profile", json=payload, headers={"Authorization": "Bearer fixture-user"})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == code
    api_database.profile_query.upsert.assert_not_called()
    api_database.profile_query.update.assert_not_called()


BET_ERRORS = [
    ("Insufficient balance", 409, "BET_INSUFFICIENT_BALANCE"),
    ("Market is not open for betting", 409, "MARKET_NOT_OPEN"),
    ("Market has closed", 409, "MARKET_CLOSE_DATE_PASSED"),
    ("Market creators cannot place bets on their own markets", 403, "BET_CREATOR_RESTRICTED"),
    ("Bet amount must be positive", 400, "BET_INVALID_AMOUNT"),
    ("Market not found", 404, "NOT_FOUND"),
]


@pytest.mark.parametrize("suffix,body", [("", {"side": "YES", "amount": 10}), ("/option", {"option_id": "o1", "amount": 10})])
@pytest.mark.parametrize("message,status,code", BET_ERRORS)
def test_bet_errors_capture_safe_codes(api_database, sentry_events, suffix, body, message, status, code):
    error = APIError({"code": "P0001", "message": message, "details": "private details", "hint": "private hint"})
    api_database.database.rpc.return_value.execute.side_effect = error
    response = api_database.client.post(f"/api/markets/m1/bets{suffix}", json=body, headers={"Authorization": "Bearer fixture-user"})
    assert response.status_code == status
    assert response.json()["detail"]["code"] == code
    assert "private" not in response.text
    assert len(sentry_events) == 1
    assert sentry_events[0]["tags"]["error_code"] == code
    assert sentry_events[0]["extra"]["market_id"] == "m1"


@pytest.mark.parametrize("message,code", [("Option not found", "BET_INVALID_OPTION"), ("Option does not belong to this market", "BET_INVALID_OPTION"), ("Market is not multichoice", "MARKET_NOT_MULTICHOICE")])
def test_option_bet_validation(api_database, message, code):
    api_database.database.rpc.return_value.execute.side_effect = APIError({"code": "P0001", "message": message, "details": None, "hint": None})
    response = api_database.client.post("/api/markets/m1/bets/option", json={"option_id": "o1", "amount": 10}, headers={"Authorization": "Bearer fixture-user"})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == code


@pytest.mark.parametrize("sql_code", ["XX000", "P0001"])
def test_unknown_bet_database_failures_are_internal(api_database, sentry_events, sql_code):
    message = "Insufficient balance Market has closed" if sql_code == "XX000" else "Unknown failure"
    api_database.database.rpc.return_value.execute.side_effect = APIError({"code": sql_code, "message": message, "details": "private", "hint": None})
    response = api_database.client.post("/api/markets/m1/bets", json={"side": "YES", "amount": 10}, headers={"Authorization": "Bearer fixture-user"})
    assert response.status_code == 500
    assert response.json() == {"detail": {"code": "INTERNAL_ERROR", "message": "Failed to place bet."}}
    assert len(sentry_events) == 1
