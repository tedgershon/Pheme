import asyncio
import importlib
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import observability
from dependencies import get_current_user, get_supabase_client, get_user_token
from observability import AppError, ErrorCode


@pytest.fixture
def sentry_events():
    """Exercise the real SDK without sending events to an external service."""
    events = []

    class MemoryTransport(observability.sentry_sdk.transport.Transport):
        def capture_envelope(self, envelope):
            event = envelope.get_event()
            if event is not None:
                events.append(event)

    client = observability.sentry_sdk.Client(
        dsn="https://public@example.invalid/1",
        transport=MemoryTransport,
        default_integrations=False,
        auto_enabling_integrations=False,
        before_send=observability._before_send,
    )
    with observability.sentry_sdk.isolation_scope() as scope:
        scope.set_client(client)
        try:
            yield events
        finally:
            observability.clear_user_context()
            client.close()


@pytest.fixture
def api(monkeypatch, sentry_events):
    # Import the real app, but keep SDK configuration and logging local to tests.
    monkeypatch.setattr(observability, "init_observability", lambda: None)
    main = importlib.import_module("main")
    monkeypatch.setattr(main.app.router, "routes", list(main.app.router.routes))
    monkeypatch.setattr(main.app, "dependency_overrides", {
        get_current_user: lambda: {"id": "test-user"},
        get_supabase_client: lambda: Mock(),
        get_user_token: lambda: None,
    })
    return main.app


@pytest.mark.parametrize("errors", [None, [], [{"field": "title", "message": "required"}]])
def test_app_error_keeps_public_details_separate_from_diagnostics(errors, sentry_events):
    error = AppError(
        422, ErrorCode.VALIDATION_FAILED, "Validation failed.",
        extras={"private": "diagnostic"}, errors=errors,
    )
    expected = {"code": "VALIDATION_FAILED", "message": "Validation failed."}
    if errors is not None:
        expected["errors"] = errors

    assert isinstance(error, HTTPException)
    assert error.status_code == 422
    assert error.detail == expected
    assert sentry_events == []  # No underlying exception means no Sentry event.


def test_app_error_http_smoke_captures_one_tagged_event(api, sentry_events):
    @api.get("/__test/app-error")
    def fail():
        observability.set_user_context("test-user")
        try:
            raise ValueError("private database diagnostic")
        except ValueError as exc:
            raise AppError(
                409, ErrorCode.BET_INSUFFICIENT_BALANCE, "Test",
                original=exc, extras={"market_id": "test-market", "side": "YES"},
            ) from exc

    with TestClient(api) as client:
        response = client.get("/__test/app-error", headers={"x-request-id": "test-request"})

    assert response.status_code == 409
    assert response.json() == {
        "detail": {"code": "BET_INSUFFICIENT_BALANCE", "message": "Test"},
    }
    assert response.headers["x-request-id"] == "test-request"
    assert len(sentry_events) == 1
    event = sentry_events[0]
    assert event["tags"]["error_code"] == "BET_INSUFFICIENT_BALANCE"
    assert event["extra"]["market_id"] == "test-market"
    assert event["extra"]["side"] == "YES"
    assert event["extra"]["request_id"] == "test-request"
    assert event["user"]["id"] == "test-user"
    assert event["exception"]["values"][-1]["value"] == "private database diagnostic"


def test_app_error_capture_does_not_leak_tags_or_extras(sentry_events):
    AppError(
        500, ErrorCode.INTERNAL_ERROR, "Internal server error.",
        original=ValueError("first"), extras={"market_id": "first-market"},
    )
    observability.report_and_safe_message(ValueError("second"), "Safe.")

    assert len(sentry_events) == 2
    assert "error_code" not in sentry_events[1].get("tags", {})
    assert "market_id" not in sentry_events[1].get("extra", {})


def test_market_validation_returns_field_envelope(api, sentry_events):
    with TestClient(api) as client:
        response = client.post("/api/markets", json={})

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "VALIDATION_FAILED"
    assert detail["message"] == "Validation failed."
    assert {error["field"] for error in detail["errors"]} == {
        "body.title", "body.description", "body.close_at",
        "body.resolution_criteria", "body.official_source",
    }
    assert all(error["type"] == "missing" for error in detail["errors"])
    assert all(set(error) == {"field", "message", "type"} for error in detail["errors"])
    assert sentry_events == []


def test_custom_validator_errors_do_not_serialize_input_or_exception_context(api):
    payload = {
        "title": "T" * 161,
        "description": "private submitted description",
        "close_at": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        "resolution_criteria": "Official announcement.",
        "official_source": "https://example.com",
    }
    with TestClient(api) as client:
        response = client.post("/api/markets", json=payload)

    assert response.status_code == 422
    assert response.json()["detail"]["errors"] == [{
        "field": "body.title",
        "message": "Value error, Title must be 160 characters or fewer",
        "type": "value_error",
    }]
    assert payload["title"] not in response.text
    assert payload["description"] not in response.text


def test_nested_validation_locations_include_numeric_indices(api):
    class Option(BaseModel):
        label: str

    class Payload(BaseModel):
        options: list[Option]

    @api.post("/__test/validation")
    def validate(body: Payload):
        return body

    with TestClient(api) as client:
        response = client.post("/__test/validation", json={"options": [{}]})

    assert response.status_code == 422
    assert response.json()["detail"]["errors"] == [{
        "field": "body.options.0.label", "message": "Field required", "type": "missing",
    }]


def test_unhandled_exception_returns_safe_envelope_and_reports_cause(api, sentry_events):
    @api.get("/__test/unhandled")
    def fail():
        raise ValueError("private SQL and stack details")

    with TestClient(api, raise_server_exceptions=False) as client:
        response = client.get("/__test/unhandled")

    assert response.status_code == 500
    assert response.json() == {
        "detail": {"code": "INTERNAL_ERROR", "message": "Internal server error."},
    }
    assert len(sentry_events) == 1
    assert sentry_events[0]["exception"]["values"][-1]["value"] == "private SQL and stack details"


def test_legacy_http_errors_keep_status_body_and_headers(api, sentry_events):
    @api.get("/__test/legacy")
    def unauthorized():
        raise HTTPException(401, "Sign in first.", headers={"WWW-Authenticate": "Bearer"})

    with TestClient(api) as client:
        response = client.get("/__test/legacy")

    assert response.status_code == 401
    assert response.json() == {"detail": "Sign in first."}
    assert response.headers["www-authenticate"] == "Bearer"
    assert sentry_events == []


@pytest.mark.parametrize("error", [
    HTTPException(403, "Forbidden"),
    AppError(403, ErrorCode.FORBIDDEN, "Forbidden"),
])
def test_fallback_handler_reraises_http_errors_without_recapture(api, sentry_events, error):
    handler = api.exception_handlers[Exception]
    with pytest.raises(HTTPException) as raised:
        asyncio.run(handler(None, error))

    assert raised.value is error
    assert sentry_events == []
