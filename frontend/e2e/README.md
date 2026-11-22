# Browser tests

Playwright tests against the disposable local Supabase stack. Setup, commands
and the fixtures (`signInAs`, `seedMarket`, `seedBet` and others) are described
in [frontend/README.md](../README.md#running-e2e-tests).

- `fixtures.ts`, `global-setup.ts`, `support/`: harness and fixtures.
- `smoke/`: one test per fixture.
- `page-gating/`: [AUTHZ_MATRIX.md](../../docs/AUTHZ_MATRIX.md) section 5.

## Page gating

`page-gating/matrix.ts` parses the section 5 table at run time. Each spec file
calls `describePage(route)` for its routes, which creates one `test.describe`
per route and one test per role (`anon`, `demo`, `user`, `admin`,
`super_admin`), checking exactly the cell in the document.

**Any new row in section 5 must come with a `describePage()` call in
`page-gating/`.** `coverage.spec.ts` fails when a row has no call or a call
names a route that has no row. Give the route a marker heading in `MARKERS`:
an `h1` only that page renders, not the shared shell.

What each role means here:

- `anon` is a cookie-less HTTP client. It follows redirects one hop at a time,
  so it sees the server's own status codes and `Location` headers.
- `demo` is a signed-out browser, which renders the SessionProvider guest
  shell. It is not a `signInAs` role. It makes the same requests as `anon`,
  but checks what the browser shows.
- `user`, `admin` and `super_admin` are the fixture accounts, signed in with
  `signInAs`.

What each cell checks:

- `render` / `render-readonly`: the page answers 200 with no redirect, its
  marker heading is visible, and the browser stays on the page. The
  read-only control checks belong to the section 6 suite (#16).
- `redirect→/auth` / `redirect→/`: **no flash**. The first response to the
  requested URL must already be a redirect; for `anon`, every redirect body
  must also lack the protected page's marker. The browser then shows the
  destination's marker and none of the protected page's. A client-side
  (`useEffect`) redirect fails, because the protected page answered 200 first.
- `404`: the response status is 404.
- `not-applicable`: skipped.

The old resolution-queue URL `/admin/admin-review` is tested with
`describePage("/admin/resolve", { visit: "/admin/admin-review" })`; it must gate
like `/admin/resolve` after its `next.config.ts` redirect.
`/auth/callback` has no section 5 row. `auth.spec.ts` checks that the proxy
lets both signed-out and signed-in visitors reach its route handler.

The matrix is the spec. If a page test fails, fix the code. Change a cell only
as a deliberate policy change, and update AUTHZ_MATRIX.md in the same PR.
