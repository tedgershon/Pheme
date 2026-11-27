"""Opt-in OpenAPI and anonymous access checks against the in-process API."""

import os
from copy import deepcopy
from urllib.parse import unquote

import pytest
import schemathesis
from _matrix_cells import MATRIX_CELLS, UNKNOWN_ID
from _matrix_rpc import RPC_HANDLERS
from conftest import TestDatabase as FixtureDatabase
from hypothesis import assume, settings
from schemathesis.checks import (
    content_type_conformance,
    not_a_server_error,
    response_schema_conformance,
    status_code_conformance,
)
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from dependencies import get_supabase_client

pytestmark = pytest.mark.skipif(
    os.environ.get("SCHEMATHESIS") != "1", reason="schemathesis is opt-in via SCHEMATHESIS=1"
)

# Hand-maintained. Mirror successful anonymous cells in docs/AUTHZ_MATRIX.md
# section 7. The health check sits outside the matrix.
PUBLIC_ENDPOINTS = {
    ("GET", "/"),
    ("GET", "/api/leaderboard"),
    ("GET", "/api/leaderboard/weekly"),
    ("GET", "/api/markets"),
    ("GET", "/api/markets/hot"),
    ("GET", "/api/markets/resolutions"),
    ("GET", "/api/markets/top"),
    ("GET", "/api/markets/trending"),
    ("GET", "/api/markets/{market_id}"),
    ("GET", "/api/markets/{market_id}/bets"),
    ("GET", "/api/markets/{market_id}/community-votes"),
    ("GET", "/api/markets/{market_id}/dispute"),
    ("GET", "/api/markets/{market_id}/dispute/submissions"),
    ("GET", "/api/markets/{market_id}/dispute/votes"),
    ("GET", "/api/rewards/badges/{user_id}"),
}


@pytest.fixture
def isolated_app(monkeypatch, test_profiles, sentry_events):
    import main

    def fresh_database():
        db = FixtureDatabase(deepcopy(test_profiles))
        db.rpc_handlers.update(RPC_HANDLERS)
        return db

    def unexpected_client(*_args, **_kwargs):
        raise AssertionError("Schemathesis requests must use the in-memory Supabase fixture")

    monkeypatch.setattr("dependencies.create_client", unexpected_client)
    monkeypatch.setitem(main.app.dependency_overrides, get_supabase_client, fresh_database)
    for module in ("dependencies", "routers.admin", "routers.markets"):
        monkeypatch.setattr(f"{module}.get_supabase_service_client", lambda: None)

    # Serve the actual app's schema on a test-only route even when production
    # settings have disabled /openapi.json on main.app.
    async def openapi(_request):
        return JSONResponse(main.app.openapi())

    return Starlette(routes=[Route("/openapi.json", openapi), Mount("/", main.app)])


@pytest.fixture
def api_schema(isolated_app):
    config = schemathesis.Config.from_dict({"generation": {"mode": "positive"}})
    return schemathesis.openapi.from_asgi("/openapi.json", isolated_app, config=config)


schema = schemathesis.pytest.from_fixture("api_schema")


def assume_routable_path(case):
    # ASGI decodes path segments before routing. These values can select a
    # different route (or no route), so its response cannot test this operation.
    for raw_value in (case.path_parameters or {}).values():
        value = unquote(str(raw_value))
        assume(value not in {"", ".", ".."} and not any(char in value for char in "/\r\n"))


@schema.exclude(path="/api/__sentry-test").parametrize()
@settings(max_examples=20)
def test_api_does_not_crash(case):
    assume_routable_path(case)
    # Use a real fixture identity so protected cases can reach their handlers.
    role = "super_admin" if case.operation.path.startswith("/api/admin/") else "user"
    response = case.call(headers={"Authorization": f"Bearer fixture-{role}"})
    case.validate_response(
        response,
        checks=(
            not_a_server_error,
            status_code_conformance,
            content_type_conformance,
            response_schema_conformance,
        ),
    )


@schema.parametrize()
@settings(max_examples=20)
def test_unauth_endpoints_correctly_gated(case):
    assume_routable_path(case)
    if case.headers:
        case.headers.pop("Authorization", None)
    response = case.call()
    operation = (case.method, case.operation.path)
    if operation not in PUBLIC_ENDPOINTS:
        assert response.status_code in (401, 403, 404, 422), (
            f"Anonymous {case.method} {case.operation.path} returned {response.status_code}; "
            "possible unauth bypass"
        )


@pytest.mark.parametrize(
    "cell",
    [cell for cell in MATRIX_CELLS if cell.role == "anon" and cell.expected_status in (401, 403)],
    ids=lambda cell: f"{cell.method} {cell.path}",
)
def test_valid_unauth_requests_are_denied(api_schema, cell):
    # A generated request can miss the route or fail validation before auth.
    # Replay each protected operation with the matrix's known request shape.
    operation = api_schema[cell.path][cell.method]
    body = cell.body({}) if callable(cell.body) else cell.body
    request = operation.Case(
        path_parameters={param.name: UNKNOWN_ID for param in operation.path_parameters},
        query=cell.params,
        **({"body": body} if body is not None else {}),
    )
    response = request.call()
    assert response.status_code in (401, 403), (
        f"Anonymous {cell.method} {cell.path} returned {response.status_code}; "
        "expected 401/403 for a valid request"
    )


def test_public_allowlist_matches_matrix():
    assert PUBLIC_ENDPOINTS == {("GET", "/")} | {
        (cell.method, cell.path)
        for cell in MATRIX_CELLS
        if cell.role == "anon" and 200 <= cell.expected_status < 300
    }
