# Authorization Matrix

**Status:** Intended authorization policy, API dependencies and overlays audited against repository source on 2026-11-16.
**Implementation:** Not all cells are enforced yet. See the linked issues in section 8.
Future routes are explicitly marked; HTTP codes describe the target contract.

---

## 1. Purpose

This document is the **single source of truth** for "who is allowed to do what" across the entire Pheme application. Every gating decision — backend authorization dependency, frontend conditional render, automated test assertion — should ultimately resolve to a cell in this matrix.

### Why this exists

- **Without a written oracle, you cannot test.** Test code that asserts "non-admin gets 403" only proves the implementation is *self-consistent*, not that it matches intent. A spec gives the tests something external to compare to.
- **Without a written oracle, leaks happen by drift.** New routes inherit the gating their author remembered, not the gating that's policy. The matrix catches drift on PR review.
- **GitHub issues reference these sections.** Update related implementation and test issues when policy changes.

### Scope

- All frontend pages under `frontend/src/app/`
- Key UI controls (mutation triggers, navigation links, conditional sections)
- All FastAPI endpoints under `backend/routers/`
- Out of scope: Supabase RLS policies (defense-in-depth, tracked separately in `docs/DATA_MODEL.md`); marketing pages; static assets

---

## 2. Roles

A request authenticates a Supabase JWT, then reads the role from the matching database profile (or is anonymous). Each request resolves to exactly one role. **Context-dependent overlays** (e.g., "creator of *this* market") are listed separately in §3 and combine with a base role.

| Role ID | Detection | Notes |
|---|---|---|
| `anon` | No `Authorization: Bearer …` header, or token rejected by `supabase.auth.get_user`. Backend dependency: `get_current_user` raises 401; `get_current_user_optional` returns `None`. | Used for the public landing/markets list. Cannot mutate. |
| `demo` | Frontend-only sentinel: `user.id === "00000000-0000-0000-0000-000000000000"`. Created by `SessionProvider` when no Supabase session exists, so the UI can render the same shell for signed-out users. **No backend role exists for this.** Any actual API call from the demo client is `anon` from the backend's perspective. | Demo is a *frontend illusion*. The backend never sees a "demo user." |
| `user` | Valid JWT, `profiles.role = 'user'`. Backend: `get_current_user` returns the row. | Default role for any signed-up CMU user. |
| `admin` | Valid JWT, `profiles.role = 'admin'`. Backend: `require_admin` accepts. | Can review markets, run admin tools, backroll. |
| `super_admin` | Valid JWT, `profiles.role = 'super_admin'`. Backend: `require_super_admin` accepts; also passes `require_admin`. | Can manage user roles. |

Initial super-admin assignment is an explicit database-operator procedure,
described in [MIGRATIONS.md](MIGRATIONS.md#initial-super-admin). Migrations do
not promote a named account, and no public bootstrap API is provided.
Ordinary signup requires an Andrew email. A database operator can approve an
exact external email in `private.signup_email_exceptions`; clients and the
service role cannot write that list. Approved signups still receive only the
`user` role. Super-admin bootstrap requires a separately confirmed identity.

### Role-preview override (admin tooling)

An `admin` or `super_admin` can use the role-preview toggle in the account dropdown (§6b) to *render the UI as if* they were `user`. **It is presentation-only:** the backend, the proxy and the database still read the actual profile role for every decision, and the preview is never sent to the API. The tables below describe intended page, control and API authorization; the role-preview toggle does not bypass server-side checks.

- **Target.** `user` only. A super admin cannot preview as `admin`, and there is no signed-out preview; use a signed-out window for `anon`/`demo`.
- **Role, not identity.** Only the role changes. Context overlays (§3) still use the real account, so an admin previewing on a market they created or bet on still gets the creator or bettor restrictions.
- **In memory only.** The preview is client state with no storage, cookie, URL parameter or header. A full reload, sign-out or account change ends it.
- **Admin pages.** The proxy still admits the real role. While previewing, each admin page's client guard sends the browser to `/`; ending the preview restores access without a reload.

---

## 3. Context-Dependent Role Overlays

These are not standalone roles. They combine with one of the roles in §2 to determine the cell.

| Overlay ID | Definition | Used in |
|---|---|---|
| `creator(M)` | `current_user.id == markets.creator_id` for market `M` | Resolution proposal, community-resolution start, dispute restrictions |
| `bettor(M)` | `current_user.id` appears in `bets.user_id` for market `M` | Dispute voting (excluded for fairness); filing a concern is allowed |
| `submitter(D)` | `current_user.id` appears in `dispute_submissions.submitter_id` for dispute `D` | One concern per user per case |
| `community-voter(M)` | `current_user.id` appears in `community_votes.voter_id` for market `M` | Prevent double voting in community resolution |
| `dispute-voter(D)` | `current_user.id` appears in `resolution_votes.voter_id` for dispute `D` | Prevent double voting in dispute |
| `notification-owner(N)` | `notifications.user_id == current_user.id` | Mark-read, delete |
| `profile-owner(U)` | `current_user.id == U` | Profile update, daily claim |

**Notation in the tables below:** `user+creator(M)` means "a `user` who is also the creator of market `M`." Cells without an overlay apply to the bare role.

---

## 4. Cell Vocabulary

Different surfaces have different "allowed answers." Use these vocabularies, not free text.

### 4a. Pages

| Symbol | Meaning |
|---|---|
| `render` | Page fully renders for this role. |
| `render-readonly` | Page renders, but mutating UI controls are hidden/disabled per the UI-control matrix. |
| `redirect→/auth` | Server- or client-side redirect to sign-in. **Server-side required for protected pages** (no flash of protected content). |
| `redirect→/` | Redirect to home (e.g., admin role required, user role insufficient). |
| `404` | Page returns 404 (preferred over 403 for non-existent-from-your-perspective resources). |
| `not-applicable` | Cell does not apply (e.g., `auth` page for already-signed-in users). |

### 4b. UI Controls (buttons, links, conditional sections)

| Symbol | Meaning |
|---|---|
| `visible` | Control is rendered and clickable. |
| `disabled` | Control is rendered but visually disabled and refuses interaction. Use only when user must *see* the control to understand state (e.g., "Place Bet" disabled with tooltip "Market closed"). |
| `hidden` | Control is not rendered. Default for "you don't have permission" cases. |
| `defense-in-depth` | Both `hidden` *and* the corresponding API call would be rejected. **Required for all mutating controls** — UI hiding is a UX nicety, not a security boundary. |

### 4c. API Endpoints

| Symbol | Meaning |
|---|---|
| `200` / `201` | Success. |
| `204` | Success, no body. |
| `400` | Domain/action validation failure. |
| `422` | Request-schema validation failure (including field errors). |
| `401` | No or invalid auth credentials. |
| `403` | Authenticated but role insufficient, or context overlay forbids (e.g., `creator(M)` trying to bet on `M`). |
| `404` | Resource doesn't exist *or* exists but the role shouldn't know it does. Prefer `404` over `403` for resource-existence privacy. |
| `409` | Conflict (e.g., already voted, market closed). |
| `429` | Rate-limited (planned in issue #30). |
| `5xx-ok` | Genuine server error allowed (e.g., DB unreachable). Not "an exception leaked." |
| `5xx-bug` | Should never occur for this role; if observed, that's a bug to fix. |

---

## 5. Page Matrix

Routes from `frontend/src/app/`, plus explicitly planned pages. This is intended policy, not a claim that every redirect is implemented.

| Path | `anon` | `demo` | `user` | `admin` | `super_admin` | Notes |
|---|---|---|---|---|---|---|
| `/` | `render-readonly` | `render-readonly` | `render` | `render` | `render` | Currently reuses market browsing; curated home is planned in issues #18–19. Betting requires auth. |
| `/markets` | `render-readonly` | `render-readonly` | `render` | `render` | `render` | Full market browsing; keep separate from the planned curated home. |
| `/markets/[id]` | `render-readonly` | `render-readonly` | `render` | `render` | `render` | Detail page. Bet/resolve/dispute controls per UI matrix. |
| `/markets/create` | `redirect→/auth` | `redirect→/auth` | `render` | `render` | `render` | Anonymous/demo cannot create markets; the proxy redirects before rendering. |
| `/portfolio` | `redirect→/auth` | `redirect→/auth` | `render` | `render` | `render` | Shows current user's bets only. |
| `/profile` | `redirect→/auth` | `redirect→/auth` | `render` | `render` | `render` | Own profile only; no `/profile/[id]` route exists. |
| `/leaderboard` | `render` | `render` | `render` | `render` | `render` | Public ranking. |
| `/resolutions` | `render-readonly` | `render-readonly` | `render` | `render` | `render` | Voting controls require auth. |
| `/rewards` | `redirect→/auth` | `redirect→/auth` | `render` | `render` | `render` | Per-user badge progress. |
| `/auth` | `render` | `render` | `redirect→/` | `redirect→/` | `redirect→/` | Sign-in page; redirect already-signed-in users. |
| `/admin` | `redirect→/` | `redirect→/` | `redirect→/` | `render` | `render` | Admin landing. |
| `/admin/review` | `redirect→/` | `redirect→/` | `redirect→/` | `render` | `render` | "Approve New Markets": `pending_review` queue, plus the latest 50 approved markets (any later status, shown as a badge) and 50 denied. |
| `/admin/disputes` | `redirect→/` | `redirect→/` | `redirect→/` | `render` | `render` | "Monitor Disputes": view-only dispute cases (`disputed`, and `admin_review` with a case) and their submissions. |
| `/admin/resolve` | `redirect→/` | `redirect→/` | `redirect→/` | `render` | `render` | "Resolve Markets": the admin resolution queue (`admin_review` status) with evidence, loading, empty and error states. The old `/admin/admin-review` URL redirects here. |
| `/admin/stats` | `redirect→/` | `redirect→/` | `redirect→/` | `render` | `render` | "Platform Statistics": cumulative stats. |
| `/admin/users` | `redirect→/` | `redirect→/` | `redirect→/` | `redirect→/` | `render` | "Manage User Roles": super admin only. |

### Page-matrix policy notes

- All redirects should be **server-side** (Next.js middleware or server-component check) rather than client-side `useEffect`. A client-side redirect ships the protected component code to the browser and shows a flash before redirecting.
- `/admin/*` should redirect to `/`, not return 403, so a curious non-admin doesn't learn admin URLs exist.

Page gates are enforced in [`src/proxy.ts`](../frontend/src/proxy.ts) before
rendering: Supabase Auth `getUser()` validates identity, and admin routes read
`profiles.role` for that identity. `/admin/users` (including descendants) requires
`super_admin`; other admin routes accept `admin` or `super_admin`. Anonymous
member pages redirect to `/auth`; anonymous/unauthorized admin requests redirect
to `/`. Missing Supabase configuration is anonymous, and identity or role lookup
failures cannot grant protected access. Signed-in `/auth` requests redirect to
`/`; the OAuth callback remains accessible. Session-cookie updates are preserved
on redirects. Client-side visibility/preview controls supplement these checks;
API authorization remains independent.

[Proxy tests](../frontend/src/__tests__/proxy.test.ts) cover these redirects,
role restrictions, failure cases, cookie propagation and matcher coverage.
Browser tests in [`frontend/e2e/page-gating/`](../frontend/e2e/page-gating/)
check every cell of this table for all five roles, including that each redirect
is the server's first response ([#15](https://github.com/tedgershon/Pheme/issues/15)).
They read the table from this file, so a new row needs a `describePage()` call
there; a coverage test fails otherwise. Section 6 controls have the same kind
of browser coverage (§6d).

---

## 6. UI Control Matrix

Only mutating or context-conditional controls are listed. Read-only sections (probability charts, market info) follow page-matrix rules.

### 6a. Market detail page (`/markets/[id]`)

`M` = the market being viewed.

| Control | `anon` / `demo` | `user` (no overlay) | `user+creator(M)` | `user+bettor(M)` | `admin` | `super_admin` |
|---|---|---|---|---|---|---|
| Place Bet (binary YES/NO) | `hidden` (sign-in CTA) | `visible` if `M.status='open'`, else `hidden` (status note explains why betting stopped) | `hidden` (creators can't bet on own markets) | `visible` if `M.status='open'`, else `hidden` (status note) | same as `user` | same as `user` |
| Place Bet (multichoice) | `hidden` | options `visible` if `M.status='open'` (Confirm Bet once one is selected), else `hidden` (status note) | `hidden` | `visible` if `M.status='open'` | same as `user` | same as `user` |
| Propose Resolution (YES / NO) | `hidden` | `hidden` | `visible` if `M.status='closed'` | `hidden` | same creator restriction | same creator restriction |
| Start Community Resolution | `hidden` | `hidden` | `visible` if `M.status='closed'` | `hidden` | same creator restriction | same creator restriction |
| Submit Dispute / Concern | `hidden` (sign-in note) | `visible` if proposal and dispute window active, or `M.status='disputed'`, voting not ended and not `submitter(D)` | `hidden` (explanatory note instead) | same as `user` (active and refunded bettors may submit) | same as `user` | same as `user` |
| Cast Dispute Vote (YES / NO) | `hidden` (tally and sign-in note only) | `visible` if `M.status='disputed'`; `disabled` once `dispute-voter(D)` or voting ended | `disabled` (tally shown, with reason) | `disabled` with reason (active and refunded bettors excluded for fairness) | same as `user` | same as `user` |
| Cast Community Vote (YES / NO) | `hidden` (sign-in note) | `visible` if community window active and not `community-voter(M)` | `hidden` | `visible` | `visible` | `visible` |
| Backroll Panel | `hidden` | `hidden` | `hidden` | `hidden` | `visible` if `M.status != 'resolved'` | `visible` |
| Admin Resolve banner (when `M.status='admin_review'`) | `hidden` | `hidden` | `hidden` | `hidden` | `visible` — informational link to `/admin/resolve` (resolution happens only in the queue) | `visible` |

### 6b. Global navigation / shell

| Control | `anon` / `demo` | `user` | `admin` | `super_admin` |
|---|---|---|---|---|
| Sign In button | `visible` | `hidden` | `hidden` | `hidden` |
| Profile dropdown | `hidden` | `visible` | `visible` | `visible` |
| Notification bell | `hidden` | `visible` | `visible` | `visible` |
| "Admin Panel" menu link | `hidden` | `hidden` | `visible` (in the account dropdown) | `visible` |
| Role-preview toggle | `hidden` | `hidden` | `visible` | `visible` |

The role-preview toggle (§2) sits in the account dropdown next to "Admin
Panel". It renders from the real role, so it stays visible while previewing and
the admin can always end the preview. While a preview is active, a bar on every
page says the UI is shown as a regular user with permissions unchanged, and has
an "Exit preview" button. The other cells in this section and in §6a and §6c
follow the previewed role.

### 6c. Admin pages

| Control | `user` | `admin` | `super_admin` |
|---|---|---|---|
| `/admin` dashboard card "Approve New Markets" | n/a (page redirects) | `visible` | `visible` |
| `/admin` dashboard card "Monitor Disputes" | n/a | `visible` | `visible` |
| `/admin` dashboard card "Resolve Markets" | n/a | `visible` | `visible` |
| `/admin` dashboard card "Platform Statistics" | n/a | `visible` | `visible` |
| `/admin` dashboard card "Manage User Roles" | n/a | `hidden` | `visible` |
| Approve Market button (`/admin/review`) | n/a (page redirects) | `visible` for `pending_review` markets | `visible` |
| Deny Market button (`/admin/review`) | n/a | `visible` for `pending_review` markets | `visible` |
| Resolve as YES / NO / AMBIGUOUS buttons (`/admin/resolve`) | n/a | `visible` for `admin_review` markets; multichoice markets show only AMBIGUOUS; `hidden` on markets the admin created | same as `admin` |
| Search Users input (`/admin/users`) | n/a | `hidden` (page redirects) | `visible` |
| Promote/Demote User (`/admin/users`) | n/a | `hidden` | `visible` on `user` and `admin` rows; `hidden` on `super_admin` rows, including self (the API also refuses a self change) |

**Dashboard card count by role** (codifies the "4 cards for admin / 5 cards for super_admin" target shape, ordered the way a market moves):

- `admin` → `Approve New Markets` + `Monitor Disputes` + `Resolve Markets` + `Platform Statistics` = **4 cards**
- `super_admin` → those four + `Manage User Roles` = **5 cards**

The dashboard renders these counts.

### 6d. Defense-in-depth requirement

Every permission-based hidden mutation must also be rejected by the API for that role/context. State-invalid actions may return 400/409 instead. UI hiding is not an authorization boundary. Matrix-driven API coverage runs in CI: each cell of section 7 is a test (`backend/tests/_matrix_cells.py`), and a route without a cell fails `test_route_coverage.py`. Those tests check the HTTP layer; SQL enforcement is covered by the disposable-database suite.

Browser tests in [`frontend/e2e/controls/`](../frontend/e2e/controls/) check
the 6a, 6b and 6c rows per role, overlay (creator, active and refunded bettor,
submitter, voter) and market state, including admins acting as creators and
bettors ([#16](https://github.com/tedgershon/Pheme/issues/16)). Hidden controls
with a permission reason are paired with the API call they would make, which
must be rejected. Each row's tests sit in a `describeControl()` call named after
the row; a coverage test fails when a row has none. `role-preview.spec.ts`
checks that previewing hides the admin-only controls, keeps the identity
overlays, and leaves every API request unchanged.

---

## 7. API Endpoint Matrix

Listed by router. Path prefix shown above each table. `M` = path-param market.

### 7a. `auth.py` — `/api/auth`

| Method | Path | `anon` | `user` (incl. `profile-owner`) | `admin` | `super_admin` |
|---|---|---|---|---|---|
| GET | `/me` | `401` | `200` (own profile) | `200` | `200` |
| POST | `/profile` | `401` | `201` (creates own) | `201` | `201` |
| PATCH | `/profile` | `401` | `200` (updates own) | `200` | `200` |
| POST | `/claim-daily` | `401` | `200` / `409` if already claimed today | `200` / `409` | `200` / `409` |

**Note:** `PATCH /profile` updates the *caller's* profile only. There is no admin endpoint to edit other users' profile fields except `PUT /api/admin/users/{id}/role` for role changes.

### 7b. `markets.py` — `/api/markets`

| Method | Path | `anon` | `user` | `user+creator(M)` | `admin` | `super_admin` |
|---|---|---|---|---|---|---|
| GET | `` | `200` | `200` | `200` | `200` | `200` |
| GET | `/hot` | `200` | `200` | `200` | `200` | `200` |
| GET | `/trending` | `200` | `200` | `200` | `200` | `200` |
| GET | `/top` | `200` | `200` | `200` | `200` | `200` |
| GET | `/{id}` | `200` / `404` | `200` / `404` | `200` | `200` | `200` |
| POST | `` | `401` | `201` / `422` | `201` / `422` | `201` / `422` | `201` / `422` |
| POST | `/{id}/resolve` | `401` | `403` | `200` if `M.status='closed'` else `400` | `200` if creator and closed, otherwise `403` / `400` | same |
| POST | `/{id}/community-resolution` | `401` | `403` | `200` if `M.status='closed'` else `400` | `200` if creator and closed, otherwise `403` / `400` | same |
| POST | `/{id}/dispute` | `401` | `200` if eligible else `400`/`403`/`409` | `403` (creator cannot dispute) | `200` if eligible else `400`/`403`/`409` | `200` if eligible else `400`/`403`/`409` |
| GET | `/{id}/dispute` | `200` / `404` | `200` / `404` | `200` / `404` | `200` / `404` | `200` / `404` |
| GET | `/{id}/dispute/submissions` | `200` | `200` | `200` | `200` | `200` |
| GET | `/{id}/dispute/eligibility` | `401` | `200` | `200` | `200` | `200` |
| POST | `/{id}/dispute/vote` | `401` | `403` if `bettor(M)`; `409` if `dispute-voter(D)`; `404` if no dispute; else `200` | `403` (creators excluded) | same as `user` | same as `user` |
| GET | `/{id}/dispute/votes` | `200` / `404` if no dispute | `200` / `404` | `200` / `404` | `200` / `404` | `200` / `404` |

**Market visibility:** the default list excludes `pending_review` and `denied`
for every role. Explicit filters for either status return an empty list to
anonymous/invalid-token callers, only the creator's records to ordinary users,
and all matching records to admins and super-admins. Category and pagination
apply after the ownership restriction. Detail requests for those private states
return the same `404 MARKET_NOT_FOUND` as a missing ID unless the caller is the
creator or an admin. Approved market states remain publicly readable.

These rules also apply to direct Supabase reads through SELECT RLS. Option
labels inherit their parent market's visibility. The backend passes validated
user JWTs to these reads and keeps explicit API ownership checks even when its
configured key can bypass RLS. The browser resets cached queries on sign-out
or account changes, including private market details and admin review results.

### 7c. `bets.py` — `/api/markets`

| Method | Path | `anon` | `user` | `user+creator(M)` | `admin` | `super_admin` |
|---|---|---|---|---|---|---|
| POST | `/{id}/bets` | `401` | `201` if `M.status='open'` and balance OK; `409` otherwise | `403` (creators cannot bet) | same as `user` | same as `user` |
| POST | `/{id}/bets/option` | `401` | `201` if conditions OK; `409` / `400` otherwise | `403` | same as `user` | same as `user` |
| GET | `/{id}/bets` | `200` | `200` | `200` | `200` | `200` |

### 7d. `resolution.py` — `/api/markets`

| Method | Path | `anon` | `user` | `user+creator(M)` | `user+community-voter(M)` | `admin` | `super_admin` |
|---|---|---|---|---|---|---|---|
| GET | `/resolutions` | `200` | `200` | `200` | `200` | `200` | `200` |
| POST | `/{id}/community-vote` | `401` | `200` if window active | `403` (creator cannot vote on own) | `409` (already voted) | `200` if window active | `200` if window active |
| GET | `/{id}/community-votes` | `200` | `200` | `200` | `200` | `200` | `200` |

### 7e. `admin.py` — `/api/admin`

| Method | Path | `anon` / `user` | `admin` | `super_admin` |
|---|---|---|---|---|
| POST | `/markets/resolution-reminders/run` | `401` / `403` | `200` | `200` |
| GET | `/stats` | `401` / `403` | `200` | `200` |
| GET | `/users/search` | `401` / `403` | `403` | `200` |
| PUT | `/users/{id}/role` | `401` / `403` | `403` | `200`; `400` if target=self |
| POST | `/markets/{id}/backroll` | `401` / `403` | `200` if `M.status != 'resolved'` else `400` | same |
| GET | `/markets/review` | `401` / `403` | `200` | `200` |
| POST | `/markets/{id}/review` | `401` / `403` | `200` if `M.status='pending_review'` else `400` | same |
| GET | `/markets/admin-review` | `401` / `403` | `200` | `200` |
| GET | `/markets/disputes` | `401` / `403` | `200` | `200` |
| POST | `/markets/{id}/resolve` | `401` / `403` | `200` if `M.status='admin_review'`; `400` for other states or YES/NO on multichoice; `403` if `creator(M)` | same |

**Admin resolution queue:** `GET /markets/admin-review` first applies expired
dispute/community transitions, then lists `admin_review` markets oldest close
first. Each item carries the market (all criteria, source and link, creator
proposal and deadlines), creator and disputer Andrew IDs, the dispute
explanation, YES/NO tallies for dispute and community votes, and the number of
distinct bettors. It does not list individual voters.

**Dispute submissions (#49).** `POST /{id}/dispute` files one concern. The first
one (market `pending_resolution` with a proposal and an open dispute window)
opens the market's single dispute case: the market becomes `disputed` and the
48-hour voting deadline starts. While the market is `disputed` and that
deadline has not passed, any other non-creator can add one concern; it never
moves a deadline or creates a second case. Responses: `403
DISPUTE_CREATOR_RESTRICTED` (creator), `409 DISPUTE_ALREADY_FILED` (the caller
already submitted; submissions cannot be amended), `400
RESOLUTION_WINDOW_EXPIRED` (window closed), `400
MARKET_NOT_PENDING_RESOLUTION` (any other state, including `admin_review`),
`422 VALIDATION_FAILED` (explanation not 1 to 1,000 characters after
trimming), `403 FORBIDDEN` (JWT subject differs from the submitter).

*Visibility.* Explanations are public so neutral voters can weigh them:
`GET /{id}/dispute/submissions` returns `total`, the caller's `has_submitted`
and a page (`limit` 1-100, default 50) of `{id, explanation, created_at,
is_mine}` rows, oldest first. Submitters are anonymous to everyone but admins.
`disputes` stays publicly readable (it exposes the first filer's id, as before)
but is no longer writable by API roles. `dispute_submissions` has no table
grants for `anon`/`authenticated` and is reachable only through `list_dispute_submissions` (public, anonymised) and
`admin_dispute_submissions` (admins only).

*Caller eligibility.* `GET /{id}/dispute/eligibility` (signed in) returns the
caller's own `is_creator`, `is_bettor` (active or refunded, the same rule as
`cast_dispute_vote`), `vote` and `can_vote`, so the page can disable the vote
buttons with a reason instead of letting the server refuse a click. It reports
nothing about other users and ignores the deadline; `cast_dispute_vote` stays
the gate.

*Admin queue.* `GET /markets/disputes?status=disputed|admin_review&limit=1-50&offset=`
lists cases grouped by market, oldest case first, for markets still in voting
(`disputed`) and awaiting a decision (`admin_review`); `resolved` markets are
excluded. Each item has the market (criteria, source, proposal, deadlines),
creator, case deadlines, YES/NO tallies, bettor count, `submission_count` and
every submission with its submitter's Andrew ID and `bettor_context` (`none`,
`active` or `refunded`). It is read-only; settlement stays on
`POST /markets/{id}/resolve`, which only accepts `admin_review` markets. The
same submissions are embedded in each `GET /markets/admin-review` item.

**`POST /markets/{id}/resolve`:** accepts `YES`, `NO` or `AMBIGUOUS` (other
values are `422`). One SQL transaction checks the admin role, locks the market,
requires `admin_review`, rejects the market's creator, and settles: YES/NO pay
binary winners through the existing settlement; AMBIGUOUS refunds every stake
(binary or option). The response adds `refunded_total` and `refunded_users` for
AMBIGUOUS. Repeats or concurrent submissions after settlement return
`400 MARKET_ALREADY_RESOLVED` and credit nothing. Other codes:
`400 MARKET_NOT_ADMIN_REVIEW`, `400 MARKET_NOT_BINARY`,
`403 ADMIN_RESOLUTION_CREATOR_RESTRICTED`, `404 MARKET_NOT_FOUND`.

The API forwards the admin's JWT; the RPC rejects a JWT whose subject differs
from `p_admin_id`, and anonymous database clients cannot execute it. Direct
`finalize_resolution` calls cannot settle `admin_review` markets.

### 7f. `notifications.py` — `/api/notifications`

| Method | Path | `anon` | `user` (`notification-owner` only) | `user` (not owner) | `admin` | `super_admin` |
|---|---|---|---|---|---|---|
| GET | `` | `401` | `200` (own only) | n/a (server-filtered) | `200` (own only) | `200` (own only) |
| GET | `/unread-count` | `401` | `200` | n/a | `200` | `200` |
| POST | `/read` | `401` | `200` (marks own) | n/a | `200` | `200` |
| POST | `/{id}/read` | `401` | `200` | `404` | `200` if owner else `404` | same |
| DELETE | `/{id}` | `401` | `200` | `404` | `200` if owner else `404` | same |

Owner mark-read and delete preserve the existing `200 {"status":"ok"}`
contract. A repeated mark-read succeeds while the row exists; deleting it again
returns 404.

**Policy note:** for resources keyed to a single owner, prefer `404` over `403` so non-owners cannot probe for the existence of someone else's notification IDs.

### 7g. `portfolio.py` — `/api`

| Method | Path | `anon` | `user` | `admin` | `super_admin` |
|---|---|---|---|---|---|
| GET | `/portfolio/proposed-markets` | `401` | `200` (own only) | `200` (own) | `200` (own) |
| GET | `/portfolio` | `401` | `200` (own positions) | `200` (own) | `200` (own) |
| GET | `/transactions` | `401` | `200` (own) | `200` (own) | `200` (own) |

There is currently no admin endpoint to view another user's portfolio or transactions. If one is added, it should require `require_admin` and live under `/api/admin/users/{id}/portfolio`.

### 7h. `rewards.py` — `/api`

| Method | Path | `anon` | `user` | `admin` | `super_admin` |
|---|---|---|---|---|---|
| GET | `/rewards` | `401` | `200` | `200` | `200` |
| GET | `/rewards/badges/{user_id}` | `200` | `200` | `200` | `200` |
| POST | `/rewards/check` | `401` | `200` | `200` | `200` |

`/rewards/badges/{user_id}` is intentionally public so leaderboard can show other users' badges. Return only public badge data; do not include progress for other users.

### 7i. `leaderboard.py` — `/api`

| Method | Path | `anon` | `user` | `admin` | `super_admin` |
|---|---|---|---|---|---|
| GET | `/leaderboard` | `200` | `200` | `200` | `200` |
| GET | `/leaderboard/weekly` | `200` | `200` | `200` | `200` |

---

## 8. Known implementation gaps

Gap B-4 (admin resolution queue, dashboard entry and ambiguous refunds) was
closed by [#31](https://github.com/tedgershon/Pheme/issues/31).

The [mounted-route inventory](../backend/tests/test_authorization_inventory.py)
checks every application method/path against its required or optional auth
dependency (including the development-only Sentry endpoint). HTTP tests reject
anonymous callers on all protected routes and ordinary users on all admin
routes before data access.

The [endpoint matrix tests](../backend/tests/test_endpoint_matrix.py) run every
cell of section 7 (role, creator/bettor/voter/owner overlay, market state)
against the API and assert the status, stable error code and safe message; the
[route coverage test](../backend/tests/test_route_coverage.py) fails when a
mounted `/api` route has no cell. They emulate stored-function preconditions in
memory, so they verify routing, gating, validation and error mapping, not SQL.
Request-schema failures return `422 VALIDATION_FAILED`, and `/docs`, `/redoc`
and `/openapi.json` are `404` in production (`test_docs_lockdown.py`).

Observations reconciled by the #12 sweep, which the cells assert:

- A duplicate dispute vote is `409 DISPUTE_VOTE_DUPLICATE`, consistent with the
  `409` for a duplicate community vote; the `403` previously shown here was a
  documentation error. Dispute voting and vote listing for a market with no
  dispute return `404 DISPUTE_NOT_FOUND`.
- State is checked before the creator when proposing resolution: a non-creator
  on a market that is not `closed` gets `400 MARKET_NOT_CLOSED`, and
  `403 RESOLUTION_NOT_CREATOR` once it is `closed`. Starting community
  resolution checks the creator first.
- Community-resolution start is idempotent (`200`) when already in community
  resolution. Community-vote expiry is `409` after #6.
- Denying a market without notes is a domain `400 VALIDATION_FAILED`, not a
  schema `422`.
- Dispute-window and community-window expiry are not matrix cells: the API
  escalates expired markets before reaching the stored function, so those
  responses are covered by the error-mapping tests.

Public community-vote and badge reads now use optional authentication for
attribution. Badges expose earned badge records and definitions, not progress
statistics; progress and badge-check operations use the authenticated user's ID.

Admins retain normal user permissions with creator/bettor/voter restrictions,
plus explicit administrative capabilities. Role-preview controls never change
the server role. The creator overlay applies to admins who created a market;
admin status alone does not authorize creator actions on someone else's market.

An admin who created a market cannot resolve it in the queue; another admin
must. Option-based (non-refund) settlement of escalated multichoice markets is
tracked in [#32](https://github.com/tedgershon/Pheme/issues/32).

The current schema exposes some profile fields publicly; do not infer that
all user identifiers are private from the owner-scoped portfolio policy.
Likewise, UI redirect destinations do not conceal the existence of route URLs.

## 9. Maintenance protocol

1. Add page, control and endpoint rows alongside new behavior.
2. Update role/context expectations and relevant tests together.
3. Keep future routes marked as planned until their implementation lands.
4. Track discrepancies and policy questions in GitHub Issues; link them here
   when they affect interpretation of the matrix.
5. API coverage exists ([#11](https://github.com/tedgershon/Pheme/issues/11),
   [#12](https://github.com/tedgershon/Pheme/issues/12)): add the section 7 row
   and its cell in `backend/tests/_matrix_cells.py` together. Optional schema
   fuzzing ([#13](https://github.com/tedgershon/Pheme/issues/13)) and browser
   coverage of error messages ([#17](https://github.com/tedgershon/Pheme/issues/17))
   are planned; do not describe them as existing enforcement.
6. Page coverage exists ([#15](https://github.com/tedgershon/Pheme/issues/15)):
   the Playwright page-gating tests read section 5 directly. Add a row and its
   `describePage()` call in `frontend/e2e/page-gating/` together; the coverage
   test fails when either is missing. If a page test fails, fix the code; change
   a cell only as a deliberate policy change.
7. Control coverage exists ([#16](https://github.com/tedgershon/Pheme/issues/16)):
   add a 6a, 6b or 6c row and a `describeControl()` call with the same name in
   `frontend/e2e/controls/` together. The same rule applies: fix the code, or
   change the cell deliberately.

## 10. Related contracts

- [Product lifecycle](PROJECT_SPECS.md)
- [Data model and RLS boundaries](DATA_MODEL.md)
- [Error handling and diagnostics](OBSERVABILITY.md)
- [Home/browse layout work](https://github.com/tedgershon/Pheme/issues/19)
- [Input-validation work](https://github.com/tedgershon/Pheme/issues/20)

Dispute filing allows active and refunded bettors, enforces creator exclusion, binds the submitter to the caller's JWT and requires a creator proposal with an active deadline (or an open case, for additional submissions). Multichoice betting enforces creator exclusion and close_at in SQL, including for admin creators.

Active/refunded bettors may submit explanations but remain excluded from dispute voting; filing never grants a vote. Submissions are grouped under the market's case for admin review (#49).

Refunding and deleting a bet does not restore voting neutrality: dispute voting checks both current bets and historical bet-placement ledger entries. Refunded bettors may still file explanations.

Community rewards require a matching atomic settlement receipt; direct calls cannot change the 4% rate or replay credits. The settlement transaction checks the expired community window, three-vote quorum and majority.

## Changelog

- #76: the role-preview toggle is built (§2, §6b). The §6b row is no longer
  planned; its cells are unchanged. No page-gating or API cells changed.
- #16: section 6 is executable as the Playwright control suite with a
  row-coverage guard. Cells changed: binary and multichoice Place Bet on a
  market that is not open is `hidden` with a status note (was `disabled`, which
  the page never rendered); the "Admin" nav link row is the "Admin Panel" link
  in the account dropdown; the role-preview toggle is marked planned (it was
  never built); the Promote/Demote cell says super-admin rows, including self,
  have no button (was "`disabled` for self"); the AMBIGUOUS wording now says
  multichoice markets show only AMBIGUOUS. Fixed along the way: a dispute vote
  answered `500` after it was recorded, and a `user` creator could not start
  community resolution (`500`).
- #15: section 5 is executable as the Playwright page-gating suite with a
  row-coverage guard. No cells changed.
- #12: section 7 is executable as `MATRIX_CELLS` with a route-coverage guard.
  The duplicate dispute-vote cell is `409` (was `403`), and dispute votes
  without a dispute are documented as `404`.
- Admin pages renamed by purpose: "Approve New Markets" (`/admin/review`),
  "Monitor Disputes" (`/admin/disputes`), "Resolve Markets" (`/admin/resolve`,
  formerly `/admin/admin-review`, which redirects), "Platform Statistics" and
  "Manage User Roles". The Approved list now keeps markets after they close.
  Routes, guards and the `admin_review` status are unchanged.
- #49: multiple dispute submissions per market case, public anonymised
  `GET /{id}/dispute/submissions`, admin `GET /api/admin/markets/disputes`,
  `/admin/disputes` page, and a submitter-bound `file_dispute`.
- Gap B-4 fixed via #31: `/admin/admin-review` queue and dashboard card,
  `GET /api/admin/markets/admin-review`, AMBIGUOUS refunds, creator exclusion,
  JWT-bound admin settlement RPC and the `finalize_resolution` admin-review guard.
- Gap B-3 fixed via PR-13.9.
- Gap B-2 fixed via PR-13.8 (#9): owner-only proposed-market portfolio endpoint,
  private list/detail authorization, database SELECT policies for proposals and
  options, and browser cache reset on session identity changes.
