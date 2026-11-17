"""HTTP contract for the admin resolution route; SQL settlement is tested separately."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

from dependencies import get_current_user, get_supabase_client, get_user_token


@pytest.fixture
def resolution_api(monkeypatch):
    import main

    database = Mock()
    database.rpc.return_value.execute.return_value = SimpleNamespace(
        data={"market_id": "m1", "status": "resolved", "outcome": "YES"}
    )
    actor = {"id": "admin-id", "role": "admin"}
    monkeypatch.setattr(main.app, "dependency_overrides", {
        get_current_user: lambda: actor,
        get_supabase_client: lambda: database,
        get_user_token: lambda: None,
    })
    with TestClient(main.app) as client:
        yield SimpleNamespace(client=client, database=database, actor=actor)


@pytest.mark.parametrize("role", ["admin", "super_admin"])
def test_admin_resolution_uses_transactional_rpc(resolution_api, role):
    api = resolution_api
    api.actor["role"] = role
    response = api.client.post("/api/admin/markets/m1/resolve", json={"outcome": "YES"})

    assert response.status_code == 200
    assert response.json() == {"market_id": "m1", "status": "resolved", "outcome": "YES"}
    api.database.rpc.assert_called_once_with("admin_resolve_market", {
        "p_market_id": "m1", "p_outcome": "YES", "p_admin_id": "admin-id",
    })
    api.database.table.assert_not_called()


def test_old_admin_resolution_path_is_gone(resolution_api):
    response = resolution_api.client.post("/api/markets/admin/m1/resolve", json={"outcome": "YES"})
    assert response.status_code == 404
    resolution_api.database.rpc.assert_not_called()


@pytest.mark.parametrize("message,status,code", [
    ("Market not found", 404, "MARKET_NOT_FOUND"),
    ("Market is not in admin_review status", 400, "MARKET_NOT_ADMIN_REVIEW"),
    ("Only admins can resolve markets in admin review", 403, "ADMIN_REQUIRED"),
    ("private database diagnostic", 500, "INTERNAL_ERROR"),
])
def test_admin_resolution_errors_use_safe_envelopes(resolution_api, message, status, code):
    api = resolution_api
    api.database.rpc.return_value.execute.side_effect = APIError({
        "code": "P0001", "message": message, "details": "private details", "hint": None,
    })
    response = api.client.post("/api/admin/markets/m1/resolve", json={"outcome": "NO"})

    assert response.status_code == status
    assert response.json()["detail"]["code"] == code
    assert "private" not in response.text


def test_admin_resolution_rejects_unsupported_outcome(resolution_api):
    response = resolution_api.client.post("/api/admin/markets/m1/resolve", json={"outcome": "AMBIGUOUS"})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "VALIDATION_FAILED"
    resolution_api.database.rpc.assert_not_called()
