# Pheme frontend

Next.js App Router application with Supabase sessions, TanStack Query API data,
Zustand UI state and Biome formatting/linting.

## Setup

Use Node.js 20 and pnpm 9 to match CI. From this directory:

```sh
pnpm install
cp .env.local.example .env.local
pnpm dev
```

On PowerShell use `Copy-Item .env.local.example .env.local`.

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the
same Supabase project used by the backend. Set `NEXT_PUBLIC_API_URL` if the
API is not at `http://localhost:8000`. Never use a service-role key in a
`NEXT_PUBLIC_*` setting. Without Supabase configuration the UI uses the
guest shell; it does not provide a substitute authenticated backend.

Open `http://localhost:3000` with the backend running separately.
Configure the Supabase auth provider and allowed callback URL for
`/auth/callback` on the frontend origin.

## Code layout

- `src/app/`: routes and server/client page components.
- `src/components/`: reusable UI.
- `src/lib/api.ts`: API client and safe error parsing.
- `src/lib/SessionProvider.tsx`: session shell and guest sentinel.
- `src/lib/query/`: query keys, options, mutations and invalidators.
- `src/proxy.ts`: Supabase session-cookie refresh and server-side page gates.

The proxy verifies identity with Supabase Auth `getUser()` before rendering
protected pages. Anonymous visitors (including demo mode with missing Supabase
configuration) go to `/auth` from `/markets/create`, `/portfolio`, `/profile`
and `/rewards`, and to `/` from `/admin` and its descendants. Admin pages load
the verified user's role from `profiles`; `/admin/users` requires `super_admin`,
and other admin pages accept `admin` or `super_admin`. Unreadable roles deny
access. Signed-in visitors to `/auth` go to `/`; `/auth/callback` remains
accessible for OAuth. Refreshed/deleted session cookies survive redirects.

API authorization still applies independently. Role preview does not change
the database role or grant page access.

Use existing query keys/invalidators after mutations. The resolutions list
and notification unread count poll; Redis/WebSocket synchronization remains
a proposed extension.

## Checks

```sh
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

`pnpm format` runs Biome formatting. `pnpm test` runs Vitest unit tests.

## Running e2e tests

The Playwright suite in `e2e/` signs in real accounts and writes markets, bets
and balances, so it only runs against the disposable local Docker Supabase
stack and refuses any other Supabase URL. Its servers get the local stack's
URL and keys (and empty Sentry DSNs) through environment variables, which take
precedence over `.env.local` and `backend/.env`. You do not need to switch those
files away from the hosted project.

One-time setup, from the repository root: install the Supabase CLI and the
backend virtual environment as described in
[LOCAL_DEVELOPMENT.md](../docs/LOCAL_DEVELOPMENT.md), then run
`pnpm exec playwright install chromium` from this directory.

```sh
npx --no-install supabase start   # from the repository root, with Docker running
pnpm e2e                          # all browser tests
pnpm e2e e2e/smoke/               # one directory or file
pnpm e2e:ui                       # Playwright UI mode, to step through tests
pnpm e2e:debug                    # headed, with the inspector
```

`pnpm e2e` reads the local stack's keys from `supabase status`, then starts its
own backend on port 8100 and frontend on port 3100 with those keys. It reuses
servers that are already listening on those ports. Your usual dev servers on
3000/8000 can keep running against the hosted project. The frontend server
builds into `.next-e2e/` so it does not collide with `pnpm dev`. It uses
`../.venv` for Python; set `E2E_PYTHON` to use another interpreter. If a local
database predates recent migrations, apply them with
`npx --no-install supabase migration up --local`.

To test servers you started yourself, set `PLAYWRIGHT_BASE_URL` and
`E2E_API_URL`; both must use the local stack. CI does this with a production
build. Failed runs keep traces, screenshots and video in `test-results/` and
the HTML report in `playwright-report/` (`pnpm exec playwright show-report`).

Write tests with the fixtures from `e2e/fixtures.ts`. Import `test` and
`expect` from there:

- `signInAs(role)` adds a real Supabase session for `user`, `admin` or
  `super_admin` as the app's SSR cookies. It does not navigate.
- `signOut()` removes the session cookies and storage.
- `seedMarket(opts)` inserts a market (default: open, created by `admin`).
- `seedBet(market, { role, side, amount })` places a bet through the API, so
  balances, pools and the ledger change transactionally.
- `setBalance(role, amount)` and `getBalance(role)` write and read a fixture
  balance directly.

Global setup creates or repairs the three fixture accounts. They use the same
UUIDs as the backend API fixtures (`backend/tests/fixture_identities.json`).
After each test, the fixtures delete the markets it seeded and their dependent
rows, and restore the fixture balances. Tests run one at a time because they
share these accounts. `seedMarket`, `setBalance` and the role setup are direct
service-role writes for test setup only. Assert balance effects through
`seedBet` or the UI.

Render safe messages from `parseApiError(error, fallback)`; do not expose
raw backend response bodies. See [OBSERVABILITY.md](../docs/OBSERVABILITY.md)
for the error contract and Sentry configuration, and
[AUTHZ_MATRIX.md](../docs/AUTHZ_MATRIX.md) for page/control policy.

To smoke-test page gates with the frontend and backend running:

1. In a signed-out/private browser window, visit `/markets/create`, `/portfolio`,
   `/profile` and `/rewards`. Each should return HTTP 307 to `/auth` before any
   protected content renders. `/admin`, `/admin/review`, `/admin/stats` and
   `/admin/users` should return 307 to `/`. Use the Network panel with Preserve
   log enabled to inspect the initial response and `Location` header.
2. Sign in as a regular user. Member pages should render, `/auth` should redirect
   to `/`, and admin pages should redirect to `/`. Verify the market form still
   accepts input; avoid creating shared test data solely to test redirects.
3. With existing operator-approved accounts, confirm an admin can open the
   dashboard/review/stats pages but `/admin/users` redirects to `/`. A super admin
   can open `/admin/users`. Repeat using in-app links to check client navigation.
   Do not change hosted roles solely for this check.

Focused proxy tests use mocked Auth/profile responses and real Next.js request,
response and matcher utilities. They do not replace the browser coverage planned
in #15–17 or a real OAuth smoke test.
