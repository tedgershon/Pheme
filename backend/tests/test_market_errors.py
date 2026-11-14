import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import observability
from dependencies import (
    get_current_user,
    get_current_user_optional,
    get_supabase_client,
    get_user_token,
)
from routers import markets


@pytest.fixture
def market_api(monkeypatch):
    supabase = Mock()
    query = supabase.table.return_value
    for method in ("select", "eq", "single", "update", "insert"):
        getattr(query, method).return_value = query
    query.execute.return_value = SimpleNamespace(data=None)
    normalize = Mock(return_value=None)
    monkeypatch.setattr(markets, "normalize_market_state", normalize)
    captured = Mock()
    monkeypatch.setattr(observability.sentry_sdk, "capture_exception", captured)
    app = FastAPI()
    app.include_router(markets.router)
    app.dependency_overrides = {
        get_current_user: lambda: {"id": "u1"},
        get_current_user_optional: lambda: None,
        get_supabase_client: lambda: supabase,
        get_user_token: lambda: None,
    }
    with TestClient(app) as client:
        yield SimpleNamespace(
            client=client, supabase=supabase, normalize=normalize, captured=captured,
        )


@pytest.mark.parametrize("method,path,body,code,message", [
    ("GET", "/m1", None, "MARKET_NOT_FOUND", "Market not found."),
    ("GET", "/m1/dispute", None, "DISPUTE_NOT_FOUND", "No dispute found for this market."),
    ("GET", "/m1/dispute/votes", None, "DISPUTE_NOT_FOUND", "No dispute found for this market."),
    ("POST", "/m1/dispute/vote", {"vote": "YES"}, "DISPUTE_NOT_FOUND", "No dispute found for this market."),
    ("POST", "/m1/community-resolution", None, "MARKET_NOT_FOUND", "Market not found."),
])
def test_missing_resources_have_specific_safe_errors(market_api, method, path, body, code, message):
    response = market_api.client.request(method, f"/api/markets{path}", json=body)
    assert response.status_code == 404
    assert response.json() == {"detail": {"code": code, "message": message}}
    market_api.captured.assert_not_called()
    market_api.supabase.rpc.assert_not_called()


@pytest.mark.parametrize("creator,status,expected,code,message", [
    ("u2", "closed", 403, "RESOLUTION_NOT_CREATOR", "Only the market creator can do this."),
    ("u1", "open", 400, "MARKET_NOT_CLOSED", "Community resolution can only be started for closed markets."),
    ("u1", "closed", 500, "INTERNAL_ERROR", "Failed to start community resolution."),
])
def test_community_resolution_errors_preserve_status(market_api, creator, status, expected, code, message):
    market_api.normalize.return_value = {"id": "m1", "creator_id": creator, "status": status}
    response = market_api.client.post("/api/markets/m1/community-resolution")
    assert response.status_code == expected
    assert response.json() == {"detail": {"code": code, "message": message}}
    market_api.captured.assert_not_called()
    if expected != 500:
        market_api.supabase.table.return_value.update.assert_not_called()
