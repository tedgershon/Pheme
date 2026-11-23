# Development application setup

Two supported database targets use the same migrations: local Docker for
disposable tests, or a hosted Supabase project for browser sign-in and manual
development. The current Pheme setup runs the frontend/API locally against the
hosted project; follow [the hosted setup guide](HOSTED_DEVELOPMENT.md) for that
path. The instructions below configure the disposable Docker target.

The Docker project is `pheme`. It is independent of the Supabase cloud dashboard;
no hosted project is required. Start Docker Desktop with Linux containers.
Use the repository's pinned Supabase CLI 2.84.5, Python 3.12+, Node 20+ and pnpm 9.

## Install and create the database

From the repository root in PowerShell:

```powershell
npm ci
npx --no-install supabase --version
npx --no-install supabase start
```

If npm reports that it blocked Supabase's postinstall, review and run that
package's installer to download and checksum-verify the pinned binary:

```powershell
Push-Location node_modules/supabase
node scripts/postinstall.js
Pop-Location
```

For a deliberately fresh **local** database (this deletes its users, profiles,
markets, wallets and other data):

```powershell
npx --no-install supabase db reset --local
npx --no-install supabase migration list --local
```

Use only the timestamped files in `supabase/migrations/`. All three versions
listed in [MIGRATIONS.md](MIGRATIONS.md) must be recorded. There are no seeded
users, markets, balances or privileged accounts. New signups receive the normal
1,000-coin grant and matching ledger entry through the database trigger.

Ports 45320–45329 avoid the default range reserved on the development Windows
machine. Studio is `http://127.0.0.1:45323`, the API is
`http://127.0.0.1:45321`, and the test inbox is `http://127.0.0.1:45324`.
Optional Studio log analytics is disabled; application Sentry can remain unset.

## Environment files and application servers

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
.venv/Scripts/python.exe scripts/configure_local_env.py
pnpm --dir frontend install --frozen-lockfile
```

The environment helper preserves unrelated settings and writes local keys to
ignored `backend/.env` and `frontend/.env.local`. It never prints credentials.
The frontend receives only the anon key. Run it again after recreating the stack.
Running this helper switches both applications back to Docker. Use
`scripts/configure_hosted_env.py --project-ref PROJECT_REF` for the hosted target.

In one terminal, from the repository root:

```powershell
cd backend
../.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

In a second terminal:

```powershell
cd frontend
pnpm dev --hostname localhost --port 3000
```

Use `http://localhost:3000` consistently for browser testing. Backend CORS defaults
to that origin. Stop the applications with Ctrl+C and Supabase with
`npx --no-install supabase stop` (preserves local data).

## Google sign-in

Create a Google Cloud OAuth **Web application** client. Configure its consent
screen for external users; if in testing mode, add each intended test account.
Use scopes `openid`, `email` and `profile`.

- Authorized JavaScript origin: `http://localhost:3000`
- Authorized redirect URI: `http://127.0.0.1:45321/auth/v1/callback`
- Supabase site URL: `http://localhost:3000`
- Supabase additional redirect: `http://localhost:3000/auth/callback`

The Google callback and the application's callback are different URLs.
See [Supabase's Google setup guide](https://supabase.com/docs/guides/auth/social-login/auth-google).

Copy `.env.example` at the repository root to `.env` if it does not already
exist. Fill `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and
`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` in that ignored file. Set
`enabled = true` under `[auth.external.google]` in `supabase/config.toml`,
then stop/start Supabase without resetting the database. Keep credentials out
of Git and chat. The committed configuration leaves Google disabled so the
base stack and CI can run without an OAuth client.

Visit `/auth` and sign in with the intended Andrew account. Verify the callback
returns to the app, refreshing retains the session, the account has one profile,
and its initial balance and ledger grant are both 1,000 Tartan Coins.

## Operator signup exception and initial super-admin

Ordinary signup requires `@andrew.cmu.edu`. An operator can approve one exact
external email before it signs in. This does not create a user or assign a role:

```powershell
Get-Content scripts/db/allow_signup_email.sql -Raw |
  docker exec -i supabase_db_pheme psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -v email=operator@example.com
```

Sign in through Google with that approved email. Verify `auth.users.email` and
`email_confirmed_at` in Studio, then obtain the UUID. Only after verifying the
intended account, run:

```powershell
Get-Content scripts/db/bootstrap_super_admin.sql -Raw |
  docker exec -i supabase_db_pheme psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -v user_id=CONFIRMED_USER_UUID
```

The script requires a confirmed CMU or operator-approved identity with a
profile, refuses to replace a different super-admin, and is safe to repeat for
the same account. Sign out/in or refresh the profile after promotion. Verify
the admin page and user management are accessible. Test the ordinary Andrew
account separately; it must retain the `user` role.

## Phase 1 verification

- API `/` returns success; `/api/markets` returns an empty list on a fresh database.
- Frontend loads and its requests reach the API without CORS errors.
- Google callback, profile creation and session persistence work for a real user.
- New profiles have one initial grant; no historic balances or markets are imported.
- The approved super-admin has admin access; the ordinary account does not.
- A disposable reset installs the same migrations without manual schema edits.

Keep browser verification pending until someone completes the real Google flow.
Database tests alone do not prove OAuth credentials or browser cookies work.
Hosted browser verification was completed on 2026-11-15; see the operator
record in [issue #42](https://github.com/tedgershon/Pheme/issues/42).
