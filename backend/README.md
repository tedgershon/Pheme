# Pheme backend

FastAPI handles authentication, market actions and queries. PostgreSQL RPCs
perform transactional bets, claims and settlement; the Python state machine
coordinates deadline-based transitions.

## Setup

Use Python 3.12. From this directory:

```sh
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

PowerShell equivalents for activation and copying:

```powershell
.\.venv\Scripts\Activate.ps1
Copy-Item .env.example .env
```

Configure `SUPABASE_URL` and `SUPABASE_KEY` in `.env`. The
`SUPABASE_SERVICE_ROLE_KEY` is backend-only and supports trusted operations
such as reminder notifications. Never put it in frontend public variables.
`config.py` defines all settings; `CORS_ORIGINS` is a JSON array and defaults
to `["http://localhost:3000"]`. Match it to the frontend origin.

Use [MIGRATIONS.md](../docs/MIGRATIONS.md) for the canonical bootstrap and
checked legacy upgrade procedure. Do not replay the archived SQL iterations.
Auth signups are restricted to `@andrew.cmu.edu` by the domain trigger.

```sh
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

`GET /` is the health check. Interactive API docs are at `/docs` in
development; `SENTRY_ENVIRONMENT=production` disables the docs, ReDoc and
OpenAPI HTTP routes.

## Checks and implementation references

```sh
pip install ruff==0.17.1 pytest==9.1.1
ruff check .
pytest
```

The shared `backend/tests/conftest.py` fixtures provide a session `app_client`,
`as_role("anon" | "user" | "admin" | "super_admin")`, and `seed_market` /
`seed_bet` factories for HTTP tests. The role fixture uses stable profile IDs
and per-request bearer headers; authentication still passes through the real
`get_current_user` dependency. The fixture's Supabase client is an in-memory
stub. Factory rows are removed after each test. `seed_bet` only creates an
overlay row; it does not verify balance or pool updates.

For SQL, RLS, ledger, and concurrency behavior, use the disposable Supabase
database suite from the repository root with Docker and `npm ci`:

```sh
python scripts/db/test_migrations.py
```

That harness resets only its own `pheme-issue36` project. Neither the HTTP
fixtures nor the database suite read application `.env` files, and neither
requires hosted project credentials. Install Python test dependencies with
`pip install -r backend/requirements-dev.txt`.

- [Authorization policy](../docs/AUTHZ_MATRIX.md)
- [Product lifecycle and architecture](../docs/PROJECT_SPECS.md)
- [Data model](../docs/DATA_MODEL.md)
- [Error envelopes, request IDs and Sentry](../docs/OBSERVABILITY.md)

Keep balance writes in SQL transactions and use the shared lifecycle service
rather than introducing a separate settlement path.
