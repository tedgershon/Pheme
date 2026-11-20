"""Matrix-driven endpoint tests: one test per (method, path, role, context) cell.

Cells live in _matrix_cells.py and mirror docs/AUTHZ_MATRIX.md section 7. They run
against the dependency-overridden app with an in-memory database whose stored
functions emulate the current migrations' preconditions (_matrix_rpc.py). That
verifies routing, authentication, role and overlay gating, request validation and
the error envelope. It does not verify SQL: balances, pools, locking and RLS are
covered by scripts/db/test_migrations.py against a disposable Supabase.
"""

import ast
import copy
from collections import defaultdict
from pathlib import Path

import pytest
from _matrix_cells import MATRIX_CELLS, UNKNOWN_ID, World
from _matrix_rpc import RPC_HANDLERS
from _user_messages import (
    DYNAMIC_CODES,
    UNUSED_CODES,
    USER_FACING_MESSAGES,
    VARIANT_MESSAGES,
)
from conftest import ROLE_IDS

from observability import ErrorCode

BACKEND = Path(__file__).resolve().parents[1]


class _PathParams(dict):
    """Path parameters from a cell's setup; anything unseeded is a missing resource."""

    def __missing__(self, key):
        return UNKNOWN_ID


@pytest.fixture
def matrix_world(monkeypatch, fixture_database, seed_market, seed_bet, sentry_events):
    """Factory for a World bound to the acting role; restores shared state after.

    The server-role Supabase client is disabled so no cell can reach a real project,
    and Sentry events are captured in memory (sentry_events) instead of sent.
    """
    import routers.admin
    import routers.markets  # noqa: F401

    for target in ("dependencies", "routers.admin", "routers.markets"):
        monkeypatch.setattr(f"{target}.get_supabase_service_client", lambda: None)
    database = fixture_database
    database.rpc_handlers.update(RPC_HANDLERS)
    before = {name: list(rows) for name, rows in database.rows.items()}
    profiles = [(row, copy.deepcopy(row)) for row in database.rows["profiles"]]
    worlds = []

    def build(role):
        world = World(database, seed_market, seed_bet, role)
        worlds.append(world)
        return world

    yield build

    seeded = set().union(*(w.seeded_ids for w in worlds)) if worlds else set()
    for name, rows in database.rows.items():
        kept = {id(row) for row in before.get(name, [])}
        # Rows seeded through seed_market/seed_bet are removed by those fixtures.
        rows[:] = [row for row in rows if id(row) in kept or row.get("id") in seeded]
    for row, original in profiles:
        row.clear()
        row.update(original)
    database.rpc_handlers.clear()


def _cell_id(cell):
    outcome = f"{cell.expected_status} {cell.expected_code}" if cell.expected_code else str(cell.expected_status)
    suffix = f" [{cell.note}]" if cell.note else ""
    return f"{cell.method} {cell.path} as {cell.role} -> {outcome}{suffix}"


def _assert_message(cell, detail):
    code, message = cell.expected_code, detail.get("message")
    if code in USER_FACING_MESSAGES:
        assert message == USER_FACING_MESSAGES[code], f"{code}: unexpected wording {message!r}"
    elif code in VARIANT_MESSAGES:
        assert message in VARIANT_MESSAGES[code], f"{code}: unlisted wording {message!r}"
    else:
        assert code in DYNAMIC_CODES, f"{code} has no entry in _user_messages.py"


def _assert_sentry_events(cell, response, events, where):
    """Each event a failing cell captures carries its code, request ID and user."""
    if response.status_code < 400:
        return
    detail = response.json().get("detail")
    code = detail.get("code") if isinstance(detail, dict) else None
    for event in events:
        assert event.get("tags", {}).get("error_code") == code, f"untagged event: {where}"
        assert event["extra"]["request_id"] == response.headers["x-request-id"], where
        if cell.role in ROLE_IDS:
            assert event["user"]["id"] == ROLE_IDS[cell.role], where


@pytest.mark.parametrize("cell", MATRIX_CELLS, ids=_cell_id)
def test_endpoint_matches_matrix(cell, as_role, matrix_world, sentry_events):
    world = matrix_world(cell.role)
    context = (cell.setup(world) if cell.setup else None) or {}
    path = cell.path.format_map(_PathParams(context))
    body = cell.body(context) if callable(cell.body) else cell.body

    response = as_role(cell.role).request(cell.method, path, json=body, params=cell.params)

    where = f"{cell.method} {cell.path} as {cell.role}: {response.status_code} {response.text}"
    assert response.status_code == cell.expected_status, where
    if cell.expected_code:
        detail = response.json()["detail"]
        assert detail["code"] == cell.expected_code, where
        _assert_message(cell, detail)
    if cell.check:
        cell.check(response, context)
    _assert_sentry_events(cell, response, sentry_events, where)


# ── catalog and cell hygiene ─────────────────────────────────


def test_message_catalog_covers_every_error_code():
    catalogued = set(USER_FACING_MESSAGES) | set(VARIANT_MESSAGES) | set(DYNAMIC_CODES) | UNUSED_CODES
    assert catalogued == {code.value for code in ErrorCode}
    assert not set(USER_FACING_MESSAGES) & set(VARIANT_MESSAGES)


def test_message_catalog_matches_source_messages():
    """Every constant AppError message in the source is in the catalog (and the reverse)."""
    found = defaultdict(set)
    for path in [*BACKEND.glob("*.py"), *BACKEND.glob("routers/*.py"), *BACKEND.glob("services/*.py")]:
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            is_app_error = isinstance(node, ast.Call) and getattr(node.func, "id", None) == "AppError"
            if is_app_error and len(node.args) >= 3 and isinstance(node.args[2], ast.Constant):
                found[node.args[1].attr].add(node.args[2].value)
    expected = {
        **{code: {message} for code, message in USER_FACING_MESSAGES.items()},
        **{code: set(messages) for code, messages in VARIANT_MESSAGES.items()},
        **{code: set(messages) for code, messages in DYNAMIC_CODES.items()},
    }
    assert dict(found) == expected, "update tests/_user_messages.py to match the AppError messages"


def test_matrix_cell_ids_are_unique():
    ids = [_cell_id(cell) for cell in MATRIX_CELLS]
    assert len(ids) == len(set(ids)), "two cells share a (method, path, role, outcome); add a note to tell them apart"
