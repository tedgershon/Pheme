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

Admins can use the role-preview toggle to *render the UI as if* they were `user`. **This is presentation-only:** the backend still reads the actual profile role for authorization. The tables below describe intended page, control and API authorization; the role-preview toggle must not bypass server-side checks.

---

## 3. Context-Dependent Role Overlays

These are not standalone roles. They combine with one of the roles in §2 to determine the cell.

| Overlay ID | Definition | Used in |
|---|---|---|
| `creator(M)` | `current_user.id == markets.creator_id` for market `M` | Resolution proposal, community-resolution start, dispute restrictions |
| `bettor(M)` | `current_user.id` appears in `bets.user_id` for market `M` | Dispute voting (excluded for fairness); filing is allowed |
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
| `/markets/create` | `redirect→/auth` | `redirect→/auth` | `render` | `render` | `render` | Anonymous/demo cannot create markets. **Implementation gap B-1** — see §8. |
| `/portfolio` | `redirect→/auth` | `redirect→/auth` | `render` | `render` | `render` | Shows current user's bets only. |
| `/profile` | `redirect→/auth` | `redirect→/auth` | `render` | `render` | `render` | Own profile only; no `/profile/[id]` route exists. |
| `/leaderboard` | `render` | `render` | `render` | `render` | `render` | Public ranking. |
| `/resolutions` | `render-readonly` | `render-readonly` | `render` | `render` | `render` | Voting controls require auth. |
| `/rewards` | `redirect→/auth` | `redirect→/auth` | `render` | `render` | `render` | Per-user badge progress. |
| `/auth` | `render` | `render` | `redirect→/` | `redirect→/` | `redirect→/` | Sign-in page; redirect already-signed-in users. |
| `/admin` | `redirect→/` | `redirect→/` | `redirect→/` | `render` | `render` | Admin landing. |
| `/admin/review` | `redirect→/` | `redirect→/` | `redirect→/` | `render` | `render` | Market review queue (`pending_review` status). |
| `/admin/admin-review` | `redirect→/` | `redirect→/` | `redirect→/` | `render` | `render` | Admin resolution queue (`admin_review` status). **Implementation gap B-4** — page does not yet exist; see §8. |
| `/admin/stats` | `redirect→/` | `redirect→/` | `redirect→/` | `render` | `render` | Cumulative stats. |
| `/admin/users` | `redirect→/` | `redirect→/` | `redirect→/` | `redirect→/` | `render` | Super admin only. |

### Page-matrix policy notes

- All redirects should be **server-side** (Next.js middleware or server-component check) rather than client-side `useEffect`. A client-side redirect ships the protected component code to the browser and shows a flash before redirecting.
- `/admin/*` should redirect to `/`, not return 403, so a curious non-admin doesn't learn admin URLs exist.

---

## 6. UI Control Matrix

Only mutating or context-conditional controls are listed. Read-only sections (probability charts, market info) follow page-matrix rules.

### 6a. Market detail page (`/markets/[id]`)

`M` = the market being viewed.

| Control | `anon` / `demo` | `user` (no overlay) | `user+creator(M)` | `user+bettor(M)` | `admin` | `super_admin` |
|---|---|---|---|---|---|---|
| Place Bet (binary YES/NO) | `hidden` (sign-in CTA) | `visible` if `M.status='open'` else `disabled` | `hidden` (creators can't bet on own markets) | `visible` if `M.status='open'` | same as `user` | same as `user` |
| Place Bet (multichoice) | `hidden` | `visible` if `M.status='open'` and option selected | `hidden` | `visible` | same as `user` | same as `user` |
| Propose Resolution (YES / NO) | `hidden` | `hidden` | `visible` if `M.status='closed'` | `hidden` | same creator restriction | same creator restriction |
| Start Community Resolution | `hidden` | `hidden` | `visible` if `M.status='closed'` | `hidden` | same creator restriction | same creator restriction |
| Submit Dispute | `hidden` | `visible` if `M.status='pending_resolution'` and `M.proposed_outcome` set | `hidden` | `visible` if proposal and dispute window active | `visible` if `M.status='pending_resolution'` and `M.proposed_outcome` set | `visible` if `M.status='pending_resolution'` and `M.proposed_outcome` set |
| Cast Dispute Vote (YES / NO) | `hidden` | `visible` if `M.status='disputed'` and not `dispute-voter(D)` | `hidden` | `hidden` (bettors excluded for fairness) | `visible` if `M.status='disputed'` and not `dispute-voter(D)` | `visible` if `M.status='disputed'` and not `dispute-voter(D)` |
| Cast Community Vote (YES / NO) | `hidden` | `visible` if community window active and not `community-voter(M)` | `hidden` | `visible` | `visible` | `visible` |
| Backroll Panel | `hidden` | `hidden` | `hidden` | `hidden` | `visible` if `M.status != 'resolved'` | `visible` |
| Admin Resolve banner (when `M.status='admin_review'`) | `hidden` | `hidden` | `hidden` | `hidden` | `visible` — informational link to `/admin/admin-review` | `visible` |

### 6b. Global navigation / shell

| Control | `anon` / `demo` | `user` | `admin` | `super_admin` |
|---|---|---|---|---|
| Sign In button | `visible` | `hidden` | `hidden` | `hidden` |
| Profile dropdown | `hidden` | `visible` | `visible` | `visible` |
| Notification bell | `hidden` | `visible` | `visible` | `visible` |
| "Admin" nav link | `hidden` | `hidden` | `visible` | `visible` |
| Role-preview toggle | `hidden` | `hidden` | `visible` | `visible` |

### 6c. Admin pages

| Control | `user` | `admin` | `super_admin` |
|---|---|---|---|
| `/admin` dashboard card "Review Markets" | n/a (page redirects) | `visible` | `visible` |
| `/admin` dashboard card "Admin Review" | n/a | `visible` (gap B-4: not yet rendered) | `visible` (gap B-4) |
| `/admin` dashboard card "Statistics" | n/a | `visible` | `visible` |
| `/admin` dashboard card "Manage Users" | n/a | `hidden` | `visible` |
| Approve Market button (`/admin/review`) | n/a (page redirects) | `visible` for `pending_review` markets | `visible` |
| Deny Market button (`/admin/review`) | n/a | `visible` for `pending_review` markets | `visible` |
| Resolve as YES / NO / AMBIGUOUS button (AMBIGUOUS requires SQL/API support in #31) (`/admin/admin-review`) | n/a | `visible` for `admin_review` markets (gap B-4: page not yet built) | `visible` (gap B-4) |
| Search Users input (`/admin/users`) | n/a | `hidden` (page redirects) | `visible` |
| Promote/Demote User (`/admin/users`) | n/a | `hidden` | `visible`, but `disabled` for self |

**Dashboard card count by role** (codifies the "3 cards for admin / 4 cards for super_admin" target shape):

- `admin` → `Review Markets` + `Admin Review` + `Statistics` = **3 cards**
- `super_admin` → those three + `Manage Users` = **4 cards**

The `Admin Review` card is the only delta from today's UI (which shows 2/3); see Gap B-4.

### 6d. Defense-in-depth requirement

Every permission-based hidden mutation must also be rejected by the API for that role/context. State-invalid actions may return 400/409 instead. UI hiding is not an authorization boundary. Matrix-driven API coverage is planned in [#12](https://github.com/tedgershon/Pheme/issues/12); it is not yet a CI guarantee.

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
| POST | `/{id}/dispute` | `401` | `200` if eligible else `403`/`409` | `403` (creator cannot dispute) | `200` if eligible else `403`/`409` | `200` if eligible else `403`/`409` |
| GET | `/{id}/dispute` | `200` / `404` | `200` / `404` | `200` / `404` | `200` / `404` | `200` / `404` |
| POST | `/{id}/dispute/vote` | `401` | `403` if `bettor(M)` or `dispute-voter(D)` else `200` | `403` (creators excluded) | `403` if `bettor(M)` or `dispute-voter(D)` else `200` | `403` if `bettor(M)` or `dispute-voter(D)` else `200` |
| GET | `/{id}/dispute/votes` | `200` | `200` | `200` | `200` | `200` |
| POST | `/admin/{id}/resolve` | `401` | `403` | `403` | `200` if `M.status='admin_review'` else `400` | `200` |

**Slated for relocation (Gap B-3):** `POST /api/markets/admin/{id}/resolve` is mounted on the markets router but is admin-only and currently has no frontend caller (`rg "markets/admin"` returns no matches outside specs). Issue #10 moves this route to **`POST /api/admin/markets/{id}/resolve`** (see §7e). The relocated endpoint is what the future `/admin/admin-review` page (Gap B-4) will call.

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
| POST | `/markets/{id}/resolve` | `401` / `403` | `200` if `M.status='admin_review'` else `400` | same |

**Note on `/markets/{id}/resolve`:** This is the relocated home of the route currently mounted at `POST /api/markets/admin/{id}/resolve` (see §7b). The relocation is tracked as Gap B-3.

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

| Gap | Work tracked in GitHub |
| --- | --- |
| B-1: server-side gating for market creation and protected pages | [#8](https://github.com/tedgershon/Pheme/issues/8) |
| B-2: owner-scoped proposed markets in portfolio and public-query privacy | [#9](https://github.com/tedgershon/Pheme/issues/9) |
| B-3: relocate the legacy admin resolution endpoint and use role dependencies | [#10](https://github.com/tedgershon/Pheme/issues/10) |
| B-4: admin resolution queue, dashboard entry and ambiguous refund support | [#31](https://github.com/tedgershon/Pheme/issues/31), blocked by #10 |
| Legacy admin-resolution error envelope and role dependency | [#10](https://github.com/tedgershon/Pheme/issues/10) |

The [mounted-route inventory](../backend/tests/test_authorization_inventory.py)
checks every application method/path against its required or optional auth
dependency (including the development-only Sentry endpoint). HTTP tests reject
anonymous callers on all protected routes and ordinary users on all admin
routes before data access. This is dependency coverage, not the full state and
role contract sweep planned in [#12](https://github.com/tedgershon/Pheme/issues/12).

The source audit retains these specific discrepancies for the linked work:

- **#9:** the public markets list accepts `status=pending_review`/`denied`, and
  market detail has no owner/status privacy gate. Portfolio and transactions
  themselves filter by the caller, but there is no owner-only proposed-market
  endpoint yet.
- **#10:** the legacy admin-resolution handler checks `is_admin`, while SQL
  checks the profile role. It still needs the shared role dependency and route
  relocation; the relocated route in section 7e is not mounted yet.
- **#12:** dispute-vote duplicates currently return 409 (the table above says
  403), dispute expiry returns 400, and dispute-vote listing can return 404 when
  no dispute exists. Community-resolution start is idempotent with 200 when
  already in community resolution. Preserve these observations when reconciling
  the full status/state contracts. Community-vote expiry is 409 after #6.

Public community-vote and badge reads now use optional authentication for
attribution. Badges expose earned badge records and definitions, not progress
statistics; progress and badge-check operations use the authenticated user's ID.

Admins retain normal user permissions with creator/bettor/voter restrictions,
plus explicit administrative capabilities. Role-preview controls never change
the server role. The creator overlay applies to admins who created a market;
admin status alone does not authorize creator actions on someone else's market.

The planned admin queue and relocated endpoint are target contracts, not
existing routes. AMBIGUOUS requires new outcome/refund handling; current
binary resolution accepts only YES/NO. Multichoice governance is tracked in
[#32](https://github.com/tedgershon/Pheme/issues/32).

The current schema exposes some profile fields publicly; do not infer that
all user identifiers are private from the owner-scoped portfolio policy.
Likewise, UI redirect destinations do not conceal the existence of route URLs.

## 9. Maintenance protocol

1. Add page, control and endpoint rows alongside new behavior.
2. Update role/context expectations and relevant tests together.
3. Keep future routes marked as planned until their implementation lands.
4. Track discrepancies and policy questions in GitHub Issues; link them here
   when they affect interpretation of the matrix.
5. API coverage is planned in [#11–13](https://github.com/tedgershon/Pheme/issues/12);
   browser coverage is planned in [#14–17](https://github.com/tedgershon/Pheme/issues/14).
   Do not describe these future checks as existing enforcement.

## 10. Related contracts

- [Product lifecycle](PROJECT_SPECS.md)
- [Data model and RLS boundaries](DATA_MODEL.md)
- [Error handling and diagnostics](OBSERVABILITY.md)
- [Home/browse layout work](https://github.com/tedgershon/Pheme/issues/19)
- [Input-validation work](https://github.com/tedgershon/Pheme/issues/20)

Dispute filing allows active and refunded bettors, enforces creator exclusion and requires a creator proposal with an active deadline. Multichoice betting enforces creator exclusion and close_at in SQL, including for admin creators.

Active/refunded bettors may submit explanations during the dispute window but remain excluded from dispute voting. Grouped admin review of submissions is tracked in [#49](https://github.com/tedgershon/Pheme/issues/49); it is not implemented by the eligibility fix.

Refunding and deleting a bet does not restore voting neutrality: dispute voting checks both current bets and historical bet-placement ledger entries. Refunded bettors may still file explanations.

Community rewards require a matching atomic settlement receipt; direct calls cannot change the 4% rate or replay credits. The settlement transaction checks the expired community window, three-vote quorum and majority.
