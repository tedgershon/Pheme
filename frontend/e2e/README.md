# Browser tests

Playwright tests against the disposable local Supabase stack. Setup, commands
and the fixtures (`signInAs`, `seedMarket`, `seedBet` and others) are described
in [frontend/README.md](../README.md#running-e2e-tests).

- `fixtures.ts`, `global-setup.ts`, `support/`: harness and fixtures.
- `smoke/`: one test per fixture.
- `page-gating/`: [AUTHZ_MATRIX.md](../../docs/AUTHZ_MATRIX.md) section 5.
- `controls/`: AUTHZ_MATRIX.md section 6 (control visibility), plus the
  portfolio isolation check for gap B-2.

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

## Controls

`controls/` checks the section 6 tables: `market-detail.spec.ts` (6a),
`global-nav.spec.ts` (6b) and `admin-pages.spec.ts` (6c). Each row's tests sit
in `describeControl(section, rowName, ...)`, where `rowName` is the row's first
cell without backticks. **Add a 6a–6c row and its `describeControl()` call
together**: `coverage.spec.ts` fails when a row has no call, and a call whose
name is not a row fails on its own.

- `marketIn(state, setup)` (from `controls/market-states.ts`) builds a market in
  `open`, `closed`, `resolved`, `proposed`, `disputed`, `community` or
  `admin_review` state. Overlays come from real rows made through the API:
  `bettors`, `refunded` (bet, then an admin backroll), `disputer`,
  `disputeVoters` and `communityVoters`. Only closing, resolving and escalating
  are direct writes, since no user API does them.
- Every test first waits for text that only renders once the page knows the
  viewer and the market state (a creator note, a "You voted" note, a sign-in
  prompt). Only then does it assert `hidden`, so a half-loaded page cannot pass.
- `expectCell(cell, ...locators)`: `visible` means rendered and enabled,
  `disabled` means rendered with the `disabled` attribute, `hidden` means not
  rendered.
- Section 6d: hidden or disabled controls with a permission reason also call
  the API as that viewer and assert the rejection status.
- Clicks and typing can be lost before hydration. Tests that interact retry
  inside `expect(...).toPass()`, and never click anything that changes data.

`portfolio.spec.ts` seeds proposals by two accounts and checks that the user's
portfolio page and its APIs show only the user's own.
