# Feature 14: API Contract Tests — Matrix-Driven pytest + Optional Schemathesis + Production Lockdown

**Status:** Design ratified
**Phase:** Hardening verification
**Depends on:** `features/extension/12-observability.md`, `features/extension/13-backend-hardening.md`
**Reads from:** `project-specs/AUTHZ_MATRIX.md` (every cell in §7 becomes a parameterized test case)
**Branch:** `feature/api-contract-tests` → multiple sub-PRs (see `issues/14.*.md`)
**Execution items:** `issues/14.1-test-infrastructure.md`, `issues/14.2-matrix-driven-endpoint-tests.md`, `issues/14.3-schemathesis-ci.md` (optional), `issues/14.4-docs-production-lockdown.md`

---

## Summary

Two complementary test layers:

1. **Matrix-driven pytest + httpx (the workhorse).** One parameterized test per `(endpoint, role)` cell in AUTHZ_MATRIX §7. Asserts the documented status code AND the new envelope-shape `code` from doc 13. Reads the matrix as data; if a row is missing in the matrix or the code, the test fails. **This is the contract test that runs on every PR.**
2. **Schemathesis (the optional safety net).** Loads the FastAPI app's OpenAPI schema (in-memory, no need for `/openapi.json` to be exposed in production) and generates property-based test cases per endpoint. Catches the failure modes pytest doesn't: forgotten endpoints, response-shape drift from `response_model`, validation bypass, accidental unauth access. Marked as a CI flag (`SCHEMATHESIS=1`) so it can be deferred without blocking PRs.

Plus one production-hygiene change: **disable `/docs`, `/redoc`, and `/openapi.json` in production** so the schema (which is genuinely useful for local dev and tests) doesn't double as a discovery surface for attackers.

---

## Why both layers

The matrix-driven pytest catches **intentional** issues (intent → code mismatch). It can't catch what's not in the matrix:

| Failure mode | Matrix pytest | Schemathesis |
|---|---|---|
| Matrix says 401, route returns 200 | ✓ | ✓ |
| Endpoint exists in code, missing from matrix → unauth bypass | ✗ | ✓ |
| Response shape drifted from `response_model` | ✗ | ✓ |
| Validation bypass (Pydantic accepts something it shouldn't) | ✗ | ✓ |
| 5xx on edge-case inputs (off-by-one, unicode, very long strings) | ✗ | ✓ |
| Code returns the wrong `ErrorCode` per matrix | ✓ (catalog assertion) | partial |

For an academic-team-of-three, the matrix-driven layer catches ~95% of intentional issues. Schemathesis is the regression net for "I added a new endpoint and forgot to update the matrix." Worth the day of setup; *not* worth blocking PRs on if the property-based generator hits a flaky edge case.

---

## Layer 1: Matrix-Driven pytest

### 1a. Test infrastructure

`backend/tests/` currently has only Pydantic unit tests (`test_market_schema_validation.py`, `test_market_state_machine.py`). This phase introduces **the first FastAPI `TestClient` integration tests**.

`backend/tests/conftest.py` (new) provides the shared fixtures:

- `app_client` — a FastAPI `TestClient` against `main.app`. Uses dependency-overrides to swap `get_supabase_client` for a test client and to mock auth (next bullet).
- `as_role(role)` — fixture factory that produces an `httpx.Client` (or wraps `app_client` headers) with `Authorization: Bearer <role-token>`. Resolves to a deterministic test-user UUID so assertions can pin against a known caller.
  - `as_role("anon")` → no `Authorization` header.
  - `as_role("user")`, `as_role("admin")`, `as_role("super_admin")` → each tied to a stable test profile created in a session-scoped fixture.
- `seed_market(status="open", creator_role="user", **fields)` — factory for inserting a deterministic market in any state needed by a test. Returns the row.
- `seed_bet(market, role, side, amount)` — factory for `(creator(M))`, `(bettor(M))` overlays.

These fixtures are **the test specification**. If a test needs an overlay the fixture doesn't support, add it to the fixture (don't reach into the DB directly from the test).

### 1b. Matrix → test parameter generation

The matrix tables in §7 are parsed (or hand-translated, depending on team preference) into a single Python data structure:

```python
# backend/tests/_matrix_cells.py — generated or hand-maintained mirror of AUTHZ_MATRIX §7
MATRIX_CELLS: list[MatrixCell] = [
    MatrixCell(
        method="GET",
        path="/api/auth/me",
        role="anon",
        expected_status=401,
        expected_code="UNAUTHORIZED",
    ),
    MatrixCell(
        method="GET",
        path="/api/auth/me",
        role="user",
        expected_status=200,
        expected_code=None,  # success cases have no code
    ),
    # ... one entry per (endpoint, role) cell in matrix §7
]
```

A single parameterized pytest function consumes this list:

```python
@pytest.mark.parametrize("cell", MATRIX_CELLS, ids=lambda c: f"{c.method} {c.path} as {c.role}")
def test_endpoint_matches_matrix(cell, as_role, seed_market):
    response = as_role(cell.role).request(cell.method, cell.path, json=cell.body or {})
    assert response.status_code == cell.expected_status, (
        f"{cell.method} {cell.path} as {cell.role}: "
        f"expected {cell.expected_status}, got {response.status_code}: {response.text}"
    )
    if cell.expected_code:
        body = response.json()
        assert body.get("detail", {}).get("code") == cell.expected_code
```

Every parameterization gives one test ID. CI shows you exactly which cell failed.

For cells that depend on state (`M.status='open'`), the cell carries a `setup` callable that uses `seed_market(...)`. For cells that depend on overlays (`creator(M)`), the cell specifies `creator_role` so the seed factory wires it correctly.

### 1c. Coverage commitment

`MATRIX_CELLS` must be the **exhaustive enumeration** of every cell in matrix §7. A separate test asserts this:

```python
def test_matrix_cells_cover_every_route():
    """Every @router. declaration in backend/routers must appear in MATRIX_CELLS."""
    declared_routes = collect_router_routes(app)  # walks app.routes
    cell_routes = {(c.method, c.path) for c in MATRIX_CELLS}
    missing = declared_routes - cell_routes
    assert not missing, f"Routes missing from MATRIX_CELLS: {sorted(missing)}"
```

If a new `@router.` is added without a corresponding `MatrixCell` entry, this test fails. It's the CI-level enforcement of the matrix's §9 maintenance protocol.

### 1d. Catalog assertion

For error responses, the test additionally checks the `message` against the doc 13 §4 catalog (when one exists). This catches frontend-vs-backend toast text drift:

```python
USER_FACING_MESSAGES: dict[str, str] = {
    "UNAUTHORIZED": "You need to sign in.",
    "BET_INSUFFICIENT_BALANCE": "Not enough bananas.",
    # ... mirror of doc 13 §4
}

# inside the parameterized test:
if cell.expected_code in USER_FACING_MESSAGES:
    assert body["detail"]["message"] == USER_FACING_MESSAGES[cell.expected_code]
```

Optional but recommended — without this, the message field is uncovered and can drift silently.

---

## Layer 2: Schemathesis (Optional)

### 2a. Loading the schema in-memory

```python
# backend/tests/test_schemathesis.py
import schemathesis
from main import app

schema = schemathesis.openapi.from_asgi("/openapi.json", app)

@schema.parametrize()
def test_api_does_not_crash(case):
    """For any input within the OpenAPI schema's constraints, no 5xx."""
    response = case.call_asgi()
    case.validate_response(response)  # status code in declared options + body matches response_model
```

**No need to expose `/openapi.json` in production** — schemathesis loads the spec directly from the FastAPI ASGI app object. The `from_asgi` integration runs requests in-process without going over the network.

### 2b. The unauth-fuzzing variant

The variant that catches "forgot to gate a new endpoint":

```python
@schema.parametrize()
def test_unauth_endpoints_return_401_or_403_or_2xx(case):
    """Every endpoint with no Authorization header must return 401/403 or be intentionally public."""
    case.headers.pop("Authorization", None)
    response = case.call_asgi()

    if response.status_code in (401, 403):
        return  # correctly gated

    if response.status_code in range(200, 300):
        # Must be in the explicit allow-list of public endpoints from matrix §7
        assert (case.method, case.path.template) in PUBLIC_ENDPOINTS, (
            f"Unauth request to {case.method} {case.path.template} succeeded — "
            f"not in PUBLIC_ENDPOINTS allow-list"
        )

    # Other status codes (404, 422) also acceptable — they prove the route doesn't blindly accept anonymous traffic
```

`PUBLIC_ENDPOINTS` is hand-maintained from matrix §7 cells where `anon` is `200`/`201`/`204`.

### 2c. Why optional

Schemathesis adds:

- ~30–60s to CI runtime (depending on iteration count).
- Occasional flakiness when generated payloads hit edge cases the team didn't intend to cover (defaults can be tuned, but it's a tax).
- A new dependency to maintain across upgrades.

For the value it adds (the regression-net cases in §"Why both layers"), it's worth it. But if team capacity is tight, it can be deferred. Run as a CI flag (`SCHEMATHESIS=1`) so it doesn't block daily PR work.

---

## Layer 3: Production Lockdown of `/docs`, `/redoc`, `/openapi.json`

FastAPI serves all three by default. They're useful for local dev and for schemathesis (which can grab them in-process anyway). But in production they double as a discovery surface — a curious browser visiting `/docs` sees every endpoint, every payload shape, every example.

`backend/main.py`:

```python
from config import get_settings

settings = get_settings()
is_production = settings.sentry_environment == "production"

app = FastAPI(
    title="Pheme API",
    version="0.1.0",
    docs_url=None if is_production else "/docs",
    redoc_url=None if is_production else "/redoc",
    openapi_url=None if is_production else "/openapi.json",
)
```

Result: in production, all three return 404. In development and test environments, they continue to serve normally — schemathesis loads the schema via `from_asgi` (in-memory, no HTTP), so its tests are unaffected.

---

## Files Affected

| Area | File | Status |
|---|---|---|
| Backend | `backend/tests/conftest.py` | NEW — fixtures (`app_client`, `as_role`, `seed_market`, `seed_bet`) |
| Backend | `backend/tests/_matrix_cells.py` | NEW — exhaustive `MATRIX_CELLS` list mirroring matrix §7 |
| Backend | `backend/tests/test_endpoint_matrix.py` | NEW — parameterized test consuming `MATRIX_CELLS` |
| Backend | `backend/tests/test_route_coverage.py` | NEW — asserts every `@router.` is in `MATRIX_CELLS` |
| Backend | `backend/tests/test_schemathesis.py` | NEW (optional) — property-based + unauth fuzzing |
| Backend | `backend/main.py` | MODIFY — conditionally disable `/docs`, `/redoc`, `/openapi.json` in production |
| Backend | `backend/requirements-dev.txt` (new file or extend `requirements.txt`) | MODIFY — add `httpx`, `pytest-asyncio`, `schemathesis` (optional) |
| Backend | `pyproject.toml` or `pytest.ini` | MODIFY — register the `schemathesis` marker if used |
| CI | GitHub Actions workflow (or equivalent) | MODIFY — run `pytest backend/tests` on every PR; gate `SCHEMATHESIS=1` job optionally |

---

## Execution

| Issue | Title | Depends on |
|---|---|---|
| `issues/14.1-test-infrastructure.md` | `conftest.py` fixtures + test profile setup. | doc 13 fully landed |
| `issues/14.2-matrix-driven-endpoint-tests.md` | `MATRIX_CELLS` enumeration + parameterized tests + coverage assertion. | 14.1 |
| `issues/14.3-schemathesis-ci.md` (optional) | Schemathesis test file + CI flag wiring. | 14.2 |
| `issues/14.4-docs-production-lockdown.md` | Disable `/docs`, `/redoc`, `/openapi.json` in production. | — (independent of test work) |

14.4 is independent and can ship at any time. 14.1 → 14.2 are sequential. 14.3 is optional and can be deferred.

---

## Cross-References

| Doc | Relationship |
|---|---|
| `project-specs/AUTHZ_MATRIX.md` | Drives 100% of `MATRIX_CELLS`. Every §7 cell becomes a test parameter. The matrix's §9 maintenance protocol is enforced by `test_route_coverage.py`. |
| `features/extension/12-observability.md` | The tests run with `SENTRY_DSN` unset (Sentry no-ops). Test environment uses `sentry_environment="development"` so the `/docs` lockdown doesn't kick in for local dev. |
| `features/extension/13-backend-hardening.md` | Provides the canonical envelope (`{"detail": {"code": ..., "message": ...}}`) and the `ErrorCode` enum that tests assert against. Catalog (§4) provides expected message strings. |
| `features/extension/15-playwright-ui-tests.md` | Same matrix; different layer (browser vs HTTP). Where doc 14 asserts the API contract, doc 15 asserts the UI honors it. |
| `features/extension/17-market-creation-validation.md` | Adds new `VALIDATION_FAILED` cases that this doc's parameterization picks up automatically (just add new `MATRIX_CELLS` rows for any new validation behavior). |
