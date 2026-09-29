# Hunch

Hunch is a campus prediction market. Verified students forecast
campus-specific events using a free, non-cashable virtual currency, and
outcomes are settled by the community instead of an admin calling every
market by hand. When a market closes, its creator proposes the outcome, and
if nobody disputes it within the resolution window, it stands; a dispute
sends it to a community vote instead of one person's judgment, which is the
mechanism the whole trust model depends on, so nothing in the codebase
resolves a market through a direct edit outside that path. Odds update in
real time over WebSockets, backed by Redis pub/sub, so a market feels live
rather than like a static poll.

## Layout

```
/backend                  FastAPI service: markets, transactional betting engine, auth
  /supabase/migrations    SQL migrations, applied in order via the Supabase SQL editor
/frontend                 Next.js app
/features                 Active design docs for in-progress work
/project-specs            Product contract: AUTHZ_MATRIX, DATA_MODEL, MIGRATIONS, PROJECT_SPECS
/scripts                  One-off and maintenance scripts
/seeds                    Seed data for local development
```

## Local development

Backend: **http://127.0.0.1:8000** · Frontend: **http://localhost:3000** (run both, separate terminals).

**Backend** (`backend/`):

```
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Set `backend/.env` (see `backend/config.py` for the full `Settings` schema).
Apply SQL migrations in order via the Supabase SQL editor: `backend/supabase/migrations/`.

**Frontend** (`frontend/`):

```
cd frontend
pnpm install
pnpm dev
```

Copy `frontend/.env.local.example` to `frontend/.env.local`. `NEXT_PUBLIC_API_URL`
defaults to `http://localhost:8000`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, branch naming, and
how issues are tracked.