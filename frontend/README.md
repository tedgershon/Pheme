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
- `src/proxy.ts`: Supabase session-cookie refresh; it currently does not
  implement the full authorization matrix's page redirects.

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