# Browser tests

Playwright tests against the disposable local Supabase stack. Setup, commands
and the fixtures (`signInAs`, `seedMarket`, `seedBet` and others) are described
in [frontend/README.md](../README.md#running-e2e-tests).

- `fixtures.ts`, `global-setup.ts`, `support/`: harness and fixtures.
- `smoke/`: one test per fixture.
- `page-gating/`: [AUTHZ_MATRIX.md](../../docs/AUTHZ_MATRIX.md) section 5.
- `controls/`: AUTHZ_MATRIX.md section 6 (control visibility), plus the
  portfolio isolation check for gap B-2.
- `error-toasts/`: the message a user sees for each reachable `ErrorCode`.
- `hygiene/`: no session token, other account's Andrew ID or raw error text in
  the rendered page.

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
- `redirect→/sign-in` / `redirect→/`: **no flash**. The first response to the
  requested URL must already be a redirect; for `anon`, every redirect body
  must also lack the protected page's marker. The browser then shows the
  destination's marker and none of the protected page's. A client-side
  (`useEffect`) redirect fails, because the protected page answered 200 first.
- `404`: the response status is 404.
- `not-applicable`: skipped.

Removed URLs have no compatibility routes (#96). `sign-in.spec.ts` checks that
`/auth` and `/auth/callback` return 404, and `admin.spec.ts` that
`/admin/admin-review` is 404 for an admin and sends everyone else to `/` like
any `/admin` path.
`/sign-in/callback` has no section 5 row. `sign-in.spec.ts` checks that the proxy
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
`role-preview.spec.ts` covers what the admin role-preview toggle hides and
keeps (AUTHZ_MATRIX.md section 2): admin-only controls hide, identity overlays
stay, admin pages send the previewing browser to `/`, a reload or sign-out
ends the preview, and API requests carry no preview and keep the admin's own
session. The toggle flips state, so click it only when it is in the opposite
state.

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

## Error messages

The app has no toast component. A failed action shows its message inline, in an
element with `role="alert"` (`role="status"` for the success message on
`/admin/users`), and the text is the backend's own `detail.message`, read by
`parseApiError`. Give any new inline error message `role="alert"`, or its test
has nothing to select. The messages are not the wording proposed in the
retired design: each test asserts what the backend actually returns, which is
the contract the page shows. The one exception is the claim button, which words
`CLAIM_ALREADY_TODAY` itself ("Already claimed today!").

Every test in `error-toasts/` makes both assertions through
`expectSafeMessage()`: the text equals the expected message exactly, and it
matches none of `RAW_ERROR_MARKERS` (SQL, tracebacks, `HTTPException`, raw
bodies, email addresses).

Failures come from the real backend. `error-toasts/helpers.ts` documents the
three ways a test makes it reject an action the page offers:

- a stale page: change the database after the page loaded, then click;
- another caller: `changeRequest(page, match, { token })` sends the request
  with a different fixture account's token;
- a changed request: `changeRequest(page, match, { path | body })`.

`mockApi()` returns a canned response and is used only where the backend
cannot be made to produce the failure on demand: `BET_INVALID_AMOUNT` (the
request model refuses non-positive amounts first, so the database function's
check is unreachable) and `RESOLUTION_WINDOW_EXPIRED` (every route settles an
expired window before it calls the database function, so the code only occurs
in a race). Each of those tests says so, and the 5xx tests in `hygiene/` are
canned because they test how the page handles a failure, whatever its cause.

Use `actAndAwaitResponse()` to click: it retries until a request goes out
(clicks before hydration are lost) and never again afterwards, then returns the
response so a test can also assert the status.

`hygiene/no-leaks.spec.ts` checks pages for a JWT. `next dev` copies request
cookies, which include the session, into the page's inline debug data, so
those tests skip themselves on a dev server and run on production builds (CI).
To run them locally, build and start the frontend yourself and set
`PLAYWRIGHT_BASE_URL` and `E2E_API_URL`, as CI does.

`UNAUTHORIZED` is not a message on the page: the client refreshes the session
and retries once, then sends the user to `/sign-in` and back afterwards
(AUTHZ_MATRIX.md section 2). `error-toasts/auth-claims.spec.ts` covers both
outcomes with `changeRequest(page, match, { token, times })`, which rejects
only the first `times` matching requests when `times` is set.
