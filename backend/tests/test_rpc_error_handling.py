import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import observability
from dependencies import get_current_user, get_supabase_client, get_user_token
from routers import admin, auth, markets, resolution

RPC_CASES = {
    "backroll": (admin, "/api/admin/markets/m1/backroll", {"cutoff_date": "2026-01-01T00:00:00Z"}, "admin_backroll_market", "Backroll failed."),
    "approve": (admin, "/api/admin/markets/m1/review", {"action": "approve"}, "approve_market", "Failed to approve market."),
    "claim": (auth, "/api/auth/claim-daily", None, "claim_daily_bananas", "Failed to claim."),
    "propose": (markets, "/api/markets/m1/resolve", {"outcome": "YES"}, "propose_resolution", "Failed to propose resolution."),
    "dispute_vote": (markets, "/api/markets/m1/dispute/vote", {"vote": "YES"}, "cast_dispute_vote", "Failed to cast vote."),
    "admin_resolve": (markets, "/api/markets/admin/m1/resolve", {"outcome": "YES"}, "admin_resolve_market", "Failed to resolve market."),
    "community_vote": (resolution, "/api/markets/m1/community-vote", {"vote": "YES"}, "cast_community_vote", "Failed to cast vote."),
}


@pytest.fixture(params=RPC_CASES)
def rpc_endpoint(request, monkeypatch):
    module, path, body, rpc_name, safe_message = RPC_CASES[request.param]
    supabase = Mock()
    query = supabase.table.return_value
    for method in ("select", "eq", "single"):
        getattr(query, method).return_value = query
    query.execute.return_value = SimpleNamespace(data={"id": "d1", "creator_id": "u2"})
    market = {
        "id": "m1",
        "status": "pending_review" if module is admin else "pending_resolution",
        "proposed_outcome": None,
        "close_at": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
    }
    for router_module in (admin, markets, resolution):
        monkeypatch.setattr(router_module, "normalize_market_state", Mock(return_value=market))
    monkeypatch.setattr(admin, "get_supabase_service_client", lambda: None)
    monkeypatch.setattr(admin, "notify_market_approved", AsyncMock())
    captured = Mock()
    monkeypatch.setattr(observability.sentry_sdk, "capture_exception", captured)

    app = FastAPI()
    app.include_router(module.router)
    actor = {"id": "u1", "role": "admin", "is_admin": True}
    app.dependency_overrides[get_current_user] = lambda: actor
    app.dependency_overrides[get_supabase_client] = lambda: supabase
    app.dependency_overrides[get_user_token] = lambda: None
    with TestClient(app) as client:
        yield SimpleNamespace(
            app=app, client=client, path=path, body=body, rpc_name=rpc_name,
            safe_message=safe_message, supabase=supabase, captured=captured, actor=actor,
        )


@pytest.mark.parametrize("rpc_endpoint,code,message,expected", [
    ("backroll", "P0001", "Market not found", 404),
    ("backroll", "P0001", "Cannot backroll a resolved market", 400),
    ("approve", "P0001", "Market not found", 404),
    ("approve", "P0001", "Market is not pending review", 400),
    ("approve", "P0001", "Market close date has passed", 400),
    ("claim", "P0001", "Already claimed today", 409),
    ("claim", "P0001", "Balance is at or above the daily claim cap of 5000", 409),
    ("propose", "P0001", "Market not found", 404),
    ("propose", "P0001", "Only the market creator can propose a resolution", 403),
    ("propose", "P0001", "Market must be closed before proposing resolution", 400),
    ("dispute_vote", "P0001", "Market creator cannot vote on disputes", 403),
    ("dispute_vote", "P0001", "Users who placed bets cannot vote on disputes", 403),
    ("dispute_vote", "P0001", "Voting window has expired", 400),
    ("dispute_vote", "23505", "A database uniqueness constraint was violated", 409),
    ("admin_resolve", "P0001", "Market not found", 404),
    ("admin_resolve", "P0001", "Market is not in admin_review status", 400),
    ("community_vote", "P0001", "Market is not in the resolution period", 400),
    ("community_vote", "P0001", "Resolution voting window has expired", 400),
    ("community_vote", "23505", "A database uniqueness constraint was violated", 409),
    ("community_vote", "P0001", "Market creators cannot cast community votes on their own market", 403),
], indirect=["rpc_endpoint"])
def test_expected_database_errors_keep_client_status(rpc_endpoint, code, message, expected):
    case = rpc_endpoint
    case.supabase.rpc.return_value.execute.side_effect = APIError({
        "code": code, "message": message, "details": "private database detail", "hint": "private hint",
    })
    response = case.client.post(case.path, json=case.body)
    assert response.status_code == expected
    assert "private" not in response.text
    case.captured.assert_not_called()
    assert case.supabase.rpc.call_args_list[0].args[0] == case.rpc_name


@pytest.mark.parametrize("code,message", [
    ("P0001", "Unexpected database condition"),
    ("XX000", "creator expired not found already claimed resolved admin_review"),
])
def test_unknown_database_errors_are_reported_and_sanitized(rpc_endpoint, code, message):
    case = rpc_endpoint
    error = APIError({
        "code": code, "message": message,
        "details": "creator expired not found already claimed private table",
        "hint": "private hint",
    })
    case.supabase.rpc.return_value.execute.side_effect = error
    response = case.client.post(case.path, json=case.body)
    assert response.status_code == 500
    assert response.json() == {"detail": case.safe_message}
    case.captured.assert_called_once_with(error)


@pytest.mark.parametrize("exception_type", [ValueError, httpx.ConnectError])
def test_unexpected_errors_are_not_misclassified(rpc_endpoint, exception_type):
    case = rpc_endpoint
    error = exception_type("creator expired not found already claimed private diagnostic")
    case.supabase.rpc.return_value.execute.side_effect = error
    with pytest.raises(exception_type) as raised:
        case.client.post(case.path, json=case.body)
    assert raised.value is error
    case.captured.assert_not_called()
    with TestClient(case.app, raise_server_exceptions=False) as client:
        response = client.post(case.path, json=case.body)
    assert response.status_code == 500
    assert response.text == "Internal Server Error"


def test_mutations_still_require_authentication(rpc_endpoint):
    case = rpc_endpoint
    del case.app.dependency_overrides[get_current_user]
    response = case.client.post(case.path, json=case.body)
    assert response.status_code == 401
    case.supabase.rpc.assert_not_called()


@pytest.mark.parametrize("rpc_endpoint", ["backroll", "approve", "admin_resolve"], indirect=True)
def test_admin_operations_still_reject_regular_users(rpc_endpoint):
    case = rpc_endpoint
    case.actor.update(role="user", is_admin=False)
    response = case.client.post(case.path, json=case.body)
    assert response.status_code == 403
    case.supabase.rpc.assert_not_called()


def test_successful_rpc_responses_are_preserved(rpc_endpoint):
    case = rpc_endpoint
    data = {
        "id": "v1", "dispute_id": "d1", "market_id": "m1", "voter_id": "u1",
        "selected_outcome": "YES", "created_at": "2026-01-01T00:00:00Z",
        "status": "pending_resolution", "proposed_outcome": "YES", "outcome": "YES",
        "dispute_deadline": "2026-01-02T00:00:00Z", "new_balance": 1000,
        "claimed_amount": 1000, "claimed_at": "2026-01-01T00:00:00Z",
    }
    case.supabase.rpc.return_value.execute.return_value = SimpleNamespace(data=data)
    response = case.client.post(case.path, json=case.body)
    assert response.status_code == 200
    assert response.json()
    assert all(value == data[key] for key, value in response.json().items())
    assert case.supabase.rpc.call_args_list[0].args[0] == case.rpc_name
    case.captured.assert_not_called()
