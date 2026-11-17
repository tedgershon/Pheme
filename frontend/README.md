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

`pnpm format` runs Biome formatting. `pnpm test` runs Vitest; Playwright
setup is planned in [#14](https://github.com/tedgershon/Pheme/issues/14).

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
response and matcher utilities. They do not replace the browser suite planned
in #14–17 or a real OAuth smoke test.
