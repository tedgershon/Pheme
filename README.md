# Pheme

Pheme is a prediction market for the CMU community. Users propose markets,
trade with free virtual banana currency, and settle outcomes through creator
proposals, community voting and disputes. The currency cannot be purchased,
sold or cashed out.

The application uses Next.js, FastAPI and Supabase (PostgreSQL, Auth and
Storage). Client data uses TanStack Query with mutation invalidation and
limited polling. Redis and WebSockets are a proposed
[extension](https://github.com/tedgershon/Pheme/issues/30).

## Repository layout

| Path | Purpose |
| --- | --- |
| [backend/](backend/README.md) | FastAPI endpoints, validation and lifecycle coordination |
| [frontend/](frontend/README.md) | Next.js pages, components, authentication and query cache |
| [docs/](docs/README.md) | Product behavior, authorization, data model and operations |
| `supabase/migrations/` | Canonical, versioned SQL schema and transactional functions |
| `backend/supabase/migrations/` | Archived SQL history; never replay as a chain |
| `scripts/` | Development and maintenance helpers |
| [seeds/](seeds/README.md) | Legacy fixture cleanup tooling |

## Local development

Start with [the local setup guide](docs/LOCAL_DEVELOPMENT.md) for the `pheme`
Docker stack, Windows ports, environment files, Google OAuth and initial admin.
Local Supabase does not require a hosted project or appear in the cloud dashboard.

Use Python 3.12, Node.js 20 and pnpm 9 to match CI. Run the backend and
frontend in separate terminals.

```sh
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

On PowerShell, activate with `.\.venv\Scripts\Activate.ps1` and copy the
environment template with `Copy-Item .env.example .env`. Configure Supabase
using [backend setup](backend/README.md), then run:

```sh
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

For the frontend:

```sh
cd frontend
pnpm install
cp .env.local.example .env.local
pnpm dev
```

On PowerShell use `Copy-Item .env.local.example .env.local`. Configure the
public Supabase URL/key in that file. The frontend is at
`http://localhost:3000`; the API defaults to `http://localhost:8000`.

Use [MIGRATIONS.md](docs/MIGRATIONS.md) for database bootstrap and upgrades.
Existing databases must pass legacy adoption before applying the canonical
chain; never reset an existing deployment to install these migrations.

## Development references

- [Documentation index](docs/README.md)
- [Contribution workflow and checks](CONTRIBUTING.md)
- [GitHub Issues](https://github.com/tedgershon/Pheme/issues) for planned work and acceptance criteria

Existing service identifiers may still use the legacy product name; keep
them aligned with their configured external resources.
