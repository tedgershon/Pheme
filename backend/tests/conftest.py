"""Shared API fixtures. These stubs exercise HTTP/auth wiring, not SQL or RLS.

Database invariants are exercised by scripts/db/test_migrations.py against a
disposable Supabase instance. Never use these fixtures as evidence of SQL safety.
"""

import sys
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import observability
from dependencies import get_supabase_client

ROLE_IDS = {
    "user": "60000000-0000-0000-0000-000000000001",
    "admin": "60000000-0000-0000-0000-000000000002",
    "super_admin": "60000000-0000-0000-0000-000000000003",
}


class TestQuery:
    """Small table query stub for HTTP fixtures; deliberately no SQL semantics."""

    def __init__(self, database, name):
        self.database = database
        self.name = name
        self.filters = {}
        self.payload = None
        self.one = False

    def select(self, *_args):
        return self

    def eq(self, key, value):
        self.filters[key] = value
        return self

    def single(self):
        self.one = True
        return self

    def insert(self, payload):
        self.payload = dict(payload)
        return self

    def execute(self):
        rows = self.database.rows[self.name]
        if self.payload is not None:
            row = {"id": str(uuid4()), **self.payload}
            rows.append(row)
            return SimpleNamespace(data=[row])
        found = [row for row in rows if all(row.get(k) == v for k, v in self.filters.items())]
        return SimpleNamespace(data=found[0] if self.one and found else None if self.one else found)


class TestDatabase:
    def __init__(self, profiles):
        self.rows = {"profiles": list(profiles.values()), "markets": [], "bets": []}
        self.auth = SimpleNamespace(get_user=self.get_user)

    def get_user(self, token):
        role = token.removeprefix("fixture-")
        return SimpleNamespace(user=SimpleNamespace(id=ROLE_IDS[role])) if role in ROLE_IDS else SimpleNamespace(user=None)

    def table(self, name):
        return TestQuery(self, name)

    def rpc(self, name, _params):
        if name != "check_claim_eligibility":
            raise AssertionError(f"Unexpected RPC in HTTP fixture: {name}")
        return SimpleNamespace(execute=lambda: SimpleNamespace(data={"claimed_today": False, "eligible": True, "claim_amount": 1000, "above_cap": False}))


@pytest.fixture(scope="session")
def test_profiles():
    """Deterministic profile IDs and roles used by the HTTP fixture."""
    return {
        role: {
            "id": user_id,
            "email": f"test-{role.replace('_', '-')}@andrew.cmu.edu",
            "andrew_id": f"test-{role.replace('_', '-')}",
            "display_name": f"Test {role}",
            "banana_balance": 1000,
            "created_at": "2026-01-01T00:00:00+00:00",
            "role": role,
            "is_admin": role != "user",
        }
        for role, user_id in ROLE_IDS.items()
    }


@pytest.fixture(scope="session")
def fixture_database(test_profiles):
    return TestDatabase(test_profiles)


@pytest.fixture(scope="session")
def app_client(fixture_database):
    import main

    previous = main.app.dependency_overrides.copy()
    main.app.dependency_overrides[get_supabase_client] = lambda: fixture_database
    try:
        with TestClient(main.app) as client:
            yield client
    finally:
        main.app.dependency_overrides.clear()
        main.app.dependency_overrides.update(previous)


class RoleClient:
    def __init__(self, client, role):
        self.client = client
        self.headers = {} if role == "anon" else {"Authorization": f"Bearer fixture-{role}"}

    def request(self, method, url, **kwargs):
        headers = {**self.headers, **kwargs.pop("headers", {})}
        return self.client.request(method, url, headers=headers, **kwargs)

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)

    def patch(self, url, **kwargs):
        return self.request("PATCH", url, **kwargs)

    def put(self, url, **kwargs):
        return self.request("PUT", url, **kwargs)

    def delete(self, url, **kwargs):
        return self.request("DELETE", url, **kwargs)


@pytest.fixture
def as_role(app_client):
    def select(role):
        if role not in {"anon", *ROLE_IDS}:
            raise ValueError(f"Unknown fixture role: {role}")
        return RoleClient(app_client, role)

    return select


@pytest.fixture
def seed_market(fixture_database):
    created = []

    def seed(status="open", creator_role="user", **fields):
        if creator_role not in ROLE_IDS:
            raise ValueError(f"Unknown creator role: {creator_role}")
        row = {
            "title": "Fixture market",
            "description": "API fixture",
            "creator_id": ROLE_IDS[creator_role],
            "close_at": "2099-01-01T00:00:00+00:00",
            "status": status,
            "resolution_criteria": "Published result",
            "category": "General",
            "yes_pool_total": 0,
            "no_pool_total": 0,
            **fields,
        }
        result = fixture_database.table("markets").insert(row).execute().data[0]
        created.append(result)
        return result

    yield seed
    for row in created:
        fixture_database.rows["markets"].remove(row)


@pytest.fixture
def seed_bet(fixture_database):
    created = []

    def seed(market, role, side, amount=10):
        UUID(market["id"])
        if role not in ROLE_IDS:
            raise ValueError(f"Unknown bettor role: {role}")
        if side not in ("YES", "NO") or amount <= 0:
            raise ValueError("Fixture bet needs YES/NO and a positive amount")
        row = fixture_database.table("bets").insert({
            "market_id": market["id"], "user_id": ROLE_IDS[role],
            "side": side, "amount": amount,
        }).execute().data[0]
        created.append(row)
        return row

    yield seed
    for row in created:
        fixture_database.rows["bets"].remove(row)


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
