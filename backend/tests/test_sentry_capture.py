"""Sentry events under the production SDK options (issue #2).

The ``sentry_events`` fixture enables the deployed integrations, scrubber and
hooks with an in-memory transport, so these tests cover duplicate captures,
tags, request/user context and privacy filtering as they behave when deployed.
"""

import importlib
import json
import sys
import uuid
from pathlib import Path
from typing import Annotated
from unittest.mock import Mock

import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import observability
from config import get_settings
from dependencies import get_current_user, get_supabase_client, get_user_token
from observability import AppError, ErrorCode

# Generated so that no secret appears literally in source context lines.
SECRETS = {name: f"{name}-{uuid.uuid4().hex}" for name in (
    "andrew_id", "email", "display_name", "token", "cookie", "query", "nested", "outgoing",
)}


def _sign_in():
    observability.set_user_context("test-user")
    return {"id": "test-user"}


@pytest.fixture
def api(monkeypatch, sentry_events):
    monkeypatch.setattr(observability, "init_observability", lambda: None)
    main = importlib.import_module("main")
    monkeypatch.setattr(main.app.router, "routes", list(main.app.router.routes))
    # Rebuild the middleware stack: one cached by an earlier test predates the
    # SDK's middleware patches, which in production apply before the app starts.
    monkeypatch.setattr(main.app, "middleware_stack", None)
    monkeypatch.setattr(main.app, "dependency_overrides", {
        get_current_user: _sign_in,
        get_supabase_client: lambda: Mock(),
        get_user_token: lambda: None,
    })
    return main.app


def _origin() -> str:
    return get_settings().cors_origins[0]


def test_5xx_app_error_with_cause_emits_one_tagged_event(api, sentry_events):
    @api.get("/__test/app-error-500")
    def fail(_user: Annotated[dict, Depends(get_current_user)]):
        try:
            raise ValueError("private database diagnostic")
        except ValueError as exc:
            raise AppError(500, ErrorCode.INTERNAL_ERROR, "Failed.", original=exc) from exc

    with TestClient(api) as client:
        response = client.get("/__test/app-error-500", headers={"x-request-id": "rid-500"})

    assert response.status_code == 500
    # The integrations also capture the AppError itself; that untagged
    # duplicate must be dropped.
    assert len(sentry_events) == 1
    event = sentry_events[0]
    assert event["exception"]["values"][-1]["value"] == "private database diagnostic"
    assert event["tags"]["error_code"] == "INTERNAL_ERROR"
    assert event["user"]["id"] == "test-user"
    assert event["extra"]["request_id"] == "rid-500"


def test_5xx_app_error_without_cause_is_tagged(api, sentry_events):
    @api.get("/__test/unavailable")
    def unavailable(_user: Annotated[dict, Depends(get_current_user)]):
        raise AppError(503, ErrorCode.INTERNAL_ERROR, "Service temporarily unavailable.")

    with TestClient(api) as client:
        response = client.get("/__test/unavailable", headers={"x-request-id": "rid-503"})

    assert response.status_code == 503
    assert len(sentry_events) == 1
    event = sentry_events[0]
    assert event["tags"]["error_code"] == "INTERNAL_ERROR"
    assert event["user"]["id"] == "test-user"
    assert event["extra"]["request_id"] == "rid-503"


def test_4xx_guard_errors_emit_no_event(api, sentry_events):
    @api.get("/__test/guard")
    def guard(_user: Annotated[dict, Depends(get_current_user)]):
        raise AppError(404, ErrorCode.MARKET_NOT_FOUND, "Market not found.")

    with TestClient(api) as client:
        assert client.get("/__test/guard").status_code == 404

    assert sentry_events == []


def test_unhandled_error_keeps_request_context_and_cors_headers(api, sentry_events):
    @api.get("/__test/unhandled")
    def fail(_user: Annotated[dict, Depends(get_current_user)]):
        raise RuntimeError("private stack details")

    origin = _origin()
    with TestClient(api, raise_server_exceptions=False) as client:
        response = client.get(
            "/__test/unhandled", headers={"x-request-id": "rid-unhandled", "Origin": origin},
        )

    assert response.status_code == 500
    assert response.json() == {
        "detail": {"code": "INTERNAL_ERROR", "message": "Internal server error."},
    }
    assert "private" not in response.text
    # Without these the browser sees a CORS failure instead of the envelope.
    assert response.headers["x-request-id"] == "rid-unhandled"
    assert response.headers["access-control-allow-origin"] == origin
    assert "x-request-id" in response.headers["access-control-expose-headers"]

    assert len(sentry_events) == 1
    event = sentry_events[0]
    assert event["exception"]["values"][-1]["value"] == "private stack details"
    assert event["tags"]["error_code"] == "INTERNAL_ERROR"
    assert event["user"]["id"] == "test-user"
    assert event["extra"]["request_id"] == "rid-unhandled"


def test_events_exclude_locals_and_scrub_account_identifiers(api, sentry_events):
    @api.post("/__test/privacy")
    def fail(_user: Annotated[dict, Depends(get_current_user)]):
        current_user = {
            "id": "test-user",
            "andrew_id": SECRETS["andrew_id"],
            "email": SECRETS["email"],
            "display_name": SECRETS["display_name"],
        }
        observability.sentry_sdk.add_breadcrumb(
            category="httplib", data={"url": "https://db.invalid/rest/v1/profiles", "http.query": SECRETS["outgoing"]},
        )
        try:
            raise ValueError(f"lookup failed for {current_user['id']}")
        except ValueError as exc:
            raise AppError(
                500, ErrorCode.INTERNAL_ERROR, "Failed.", original=exc,
                extras={"context": {"profile": current_user, "andrew_id": SECRETS["nested"]}},
            ) from exc

    with TestClient(api) as client:
        response = client.post(
            "/__test/privacy",
            params={"q": SECRETS["query"], "limit": "5"},
            json={"andrew_id": SECRETS["andrew_id"], "display_name": SECRETS["display_name"]},
            headers={"Authorization": f"Bearer {SECRETS['token']}", "Cookie": f"sb={SECRETS['cookie']}"},
        )

    assert response.status_code == 500
    assert len(sentry_events) == 1
    event = sentry_events[0]
    serialized = json.dumps(event)
    for name, secret in SECRETS.items():
        assert secret not in serialized, f"{name} leaked into the Sentry event"
    for frame in event["exception"]["values"][-1]["stacktrace"]["frames"]:
        assert "vars" not in frame
    assert event["extra"]["context"]["profile"]["id"] == "test-user"
    assert event["user"] == {"id": "test-user"}
    assert "limit=5" in event["request"]["query_string"]


@pytest.mark.parametrize("supplied,kept", [
    ("abc-123_x.y", True),
    ("0" * 128, True),
    ("0" * 129, False),
    ("forged\nlog line", False),
    ("", False),
    (None, False),
])
def test_request_id_accepts_only_log_safe_values(supplied, kept):
    try:
        rid = observability.begin_request(supplied)
        if kept:
            assert rid == supplied
        else:
            assert rid != supplied
            assert len(rid) == 32
            int(rid, 16)
    finally:
        observability.clear_user_context()


@pytest.mark.parametrize("configured,vercel_sha,expected", [
    ("v1.2.3", "abc123", "v1.2.3"),
    (None, "abc123", "abc123"),
    ("", "abc123", "abc123"),
    (None, None, None),
])
def test_release_prefers_setting_then_vercel_commit(monkeypatch, configured, vercel_sha, expected):
    if vercel_sha is None:
        monkeypatch.delenv("VERCEL_GIT_COMMIT_SHA", raising=False)
    else:
        monkeypatch.setenv("VERCEL_GIT_COMMIT_SHA", vercel_sha)

    assert observability.resolve_release(configured) == expected


# Captured-cause codes that no other test drives through its router mapping.
# With these, every ErrorCode raised with `original` is exercised under the
# production SDK options somewhere in the suite.
@pytest.mark.parametrize("path,body,message,status,code", [
    ("/api/markets/m1/dispute", {"explanation": "Please review."},
     "Disputer must be the signed-in user", 403, "FORBIDDEN"),
    ("/api/markets/m1/dispute", {"explanation": "Please review."},
     "Explanation must be 1 to 1000 characters", 422, "VALIDATION_FAILED"),
    ("/api/markets/m1/dispute", {"explanation": "Please review."},
     "Dispute not found", 404, "DISPUTE_NOT_FOUND"),
    ("/api/admin/markets/m1/review", {"action": "approve"},
     "Market is not pending review", 400, "MARKET_NOT_PENDING_REVIEW"),
    ("/api/admin/markets/m1/resolve", {"outcome": "YES"},
     "Only admins can resolve escalated markets", 403, "ADMIN_REQUIRED"),
])
def test_remaining_captured_codes_emit_tagged_events(
    api, sentry_events, monkeypatch, path, body, message, status, code,
):
    from postgrest.exceptions import APIError

    from dependencies import require_admin
    from routers import admin, markets

    future = "2999-01-01T00:00:00+00:00"
    monkeypatch.setattr(markets, "normalize_market_state", Mock())
    monkeypatch.setattr(admin, "get_supabase_service_client", lambda: None)
    monkeypatch.setattr(admin, "normalize_market_state", lambda *_: {
        "id": "m1", "status": "pending_review", "close_at": future,
    })
    supabase = Mock()
    supabase.rpc.return_value.execute.side_effect = APIError({
        "code": "P0001", "message": f"{message}: private diagnostic", "details": None, "hint": None,
    })
    api.dependency_overrides[get_supabase_client] = lambda: supabase
    api.dependency_overrides[require_admin] = _sign_in

    with TestClient(api) as client:
        response = client.post(path, json=body, headers={"x-request-id": f"rid-{code}"})

    assert response.status_code == status, response.text
    assert response.json()["detail"]["code"] == code
    assert "private" not in response.text
    assert len(sentry_events) == 1
    event = sentry_events[0]
    assert event["tags"]["error_code"] == code
    assert event["user"]["id"] == "test-user"
    assert event["extra"]["request_id"] == f"rid-{code}"
