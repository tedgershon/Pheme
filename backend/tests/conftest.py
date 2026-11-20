"""Shared API fixtures. These stubs exercise HTTP/auth wiring, not SQL or RLS.

Database invariants are exercised by scripts/db/test_migrations.py against a
disposable Supabase instance. Never use these fixtures as evidence of SQL safety.
"""

import sys
from collections import defaultdict
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


TABLE_DEFAULTS = {"markets": {"yes_pool_total": 0, "no_pool_total": 0}}


class TestQuery:
    """In-memory table query for HTTP fixtures.

    Supports the filter/ordering/write calls the routers use, applied to plain
    rows. It deliberately has no SQL semantics: no constraints, joins, defaults
    beyond ``id``/``created_at``, triggers or RLS. Joined filters such as
    ``markets.status`` are ignored.
    """

    def __init__(self, database, name):
        self.database = database
        self.name = name
        self.predicates = []
        self.operation = "select"
        self.payload = None
        self.one = False
        self.window = None
        self.negate = False
        self.want_count = False

    @property
    def not_(self):
        self.negate = True
        return self

    def _where(self, test):
        if self.negate:
            self.negate, inner = False, test
            test = lambda row: not inner(row)
        self.predicates.append(test)
        return self

    def select(self, *_args, count=None, **_kwargs):
        self.want_count = count is not None
        return self

    def eq(self, key, value):
        if "." in key:
            return self
        return self._where(lambda row: row.get(key) == value)

    def neq(self, key, value):
        return self._where(lambda row: row.get(key) != value)

    def in_(self, key, values):
        if "." in key:
            return self
        values = list(values)
        return self._where(lambda row: row.get(key) in values)

    def gte(self, key, value):
        return self._where(lambda row: row.get(key) is not None and row[key] >= value)

    def is_(self, key, value):
        return self._where(lambda row: (row.get(key) is None) == (value == "null"))

    def ilike(self, key, pattern):
        needle = pattern.strip("%").lower()
        return self._where(lambda row: needle in str(row.get(key, "")).lower())

    def order(self, *_args, **_kwargs):
        return self

    def range(self, start, end):
        self.window = (start, end + 1)
        return self

    def limit(self, count):
        self.window = (0, count)
        return self

    def single(self):
        self.one = True
        return self

    maybe_single = single

    def insert(self, payload):
        self.operation, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.operation, self.payload = "update", dict(payload)
        return self

    def upsert(self, payload, **_kwargs):
        self.operation, self.payload = "upsert", dict(payload)
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def _store(self, payload):
        row = {
            "id": str(uuid4()),
            "created_at": "2026-01-01T00:00:00+00:00",
            **TABLE_DEFAULTS.get(self.name, {}),
            **payload,
        }
        self.database.rows[self.name].append(row)
        return row

    def execute(self):
        rows = self.database.rows[self.name]
        matching = [row for row in rows if all(test(row) for test in self.predicates)]
        if self.operation == "insert":
            batch = self.payload if isinstance(self.payload, list) else [self.payload]
            return SimpleNamespace(data=[self._store(dict(item)) for item in batch], count=None)
        if self.operation == "upsert":
            existing = next((row for row in rows if row.get("id") == self.payload.get("id")), None)
            if existing is None:
                return SimpleNamespace(data=[self._store(self.payload)], count=None)
            existing.update(self.payload)
            return SimpleNamespace(data=[existing], count=None)
        if self.operation == "update":
            for row in matching:
                row.update(self.payload)
            return SimpleNamespace(data=matching, count=None)
        if self.operation == "delete":
            for row in matching:
                rows.remove(row)
            return SimpleNamespace(data=matching, count=None)
        total = len(matching)
        if self.window:
            matching = matching[self.window[0]:self.window[1]]
        found = [dict(row) for row in matching]
        data = (found[0] if found else None) if self.one else found
        return SimpleNamespace(data=data, count=total if self.want_count else None)


class TestDatabase:
    def __init__(self, profiles):
        self.rows = defaultdict(list, {"profiles": list(profiles.values()), "markets": [], "bets": []})
        self.auth = SimpleNamespace(get_user=self.get_user)
        self.postgrest = SimpleNamespace(auth=lambda _token: None)
        # name -> callable(database, params); installed per test by suites that
        # emulate stored-function preconditions (see _matrix_rpc.py).
        self.rpc_handlers = {}

    def get_user(self, token):
        role = token.removeprefix("fixture-")
        return SimpleNamespace(user=SimpleNamespace(id=ROLE_IDS[role])) if role in ROLE_IDS else SimpleNamespace(user=None)

    def table(self, name):
        return TestQuery(self, name)

    def rpc(self, name, params):
        handler = self.rpc_handlers.get(name)
        if handler is None and name != "check_claim_eligibility":
            raise AssertionError(f"Unexpected RPC in HTTP fixture: {name}")
        if handler is None:
            def handler(_database, _params):
                return {"claimed_today": False, "eligible": True, "claim_amount": 1000, "above_cap": False}
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=handler(self, params)))


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
            "created_at": "2026-01-01T00:00:00+00:00",
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
    """Exercise the real SDK without sending events to an external service.

    Uses the production options (integrations, scrubber, hooks) so duplicate
    captures and scrubbing behave as deployed; only the transport differs.
    """
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
        **observability.sentry_options(environment="test", release="test", traces_sample_rate=0.0),
    )
    with observability.sentry_sdk.isolation_scope() as scope:
        scope.set_client(client)
        try:
            yield events
        finally:
            observability.clear_user_context()
            client.close()
