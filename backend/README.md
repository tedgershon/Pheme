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

Read [MIGRATIONS.md](../docs/MIGRATIONS.md) before setting up the database:
the SQL files are not a complete, verified, numerically ordered bootstrap.
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

- [Authorization policy](../docs/AUTHZ_MATRIX.md)
- [Product lifecycle and architecture](../docs/PROJECT_SPECS.md)
- [Data model](../docs/DATA_MODEL.md)
- [Error envelopes, request IDs and Sentry](../docs/OBSERVABILITY.md)

Keep balance writes in SQL transactions and use the shared lifecycle service
rather than introducing a separate settlement path.