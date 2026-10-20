# Authorization Matrix

**Status:** Ratified 2026-05-08 — four known implementation gaps tracked in §8 (B-4 added 2026-05-09)
**Type:** Living spec (not a one-shot plan)
**Owner:** Team
**Cited by:** `features/extension/12-observability.md`, `features/extension/13-backend-hardening.md`, `features/extension/14-api-contract-tests.md`, `features/extension/15-playwright-ui-tests.md`, `features/extension/16-home-vs-markets-split.md`, `features/extension/17-market-creation-validation.md`, `features/extension/18-dummy-data-removal.md`

---

## 1. Purpose

This document is the **single source of truth** for "who is allowed to do what" across the entire Pheme application. Every gating decision — backend authorization dependency, frontend conditional render, automated test assertion — should ultimately resolve to a cell in this matrix.

### Why this exists

- **Without a written oracle, you cannot test.** Test code that asserts "non-admin gets 403" only proves the implementation is *self-consistent*, not that it matches intent. A spec gives the tests something external to compare to.
- **Without a written oracle, leaks happen by drift.** New routes inherit the gating their author remembered, not the gating that's policy. The matrix catches drift on PR review.
- **Plan documents (12–15) reference cells in this file by ID.** Changing a cell here automatically scopes downstream test/refactor work.

### Scope

- All frontend pages under `frontend/src/app/`
- Key UI controls (mutation triggers, navigation links, conditional sections)
- All FastAPI endpoints under `backend/routers/`
- Out of scope: Supabase RLS policies (defense-in-depth, tracked separately in `project-specs/DATA_MODEL.md`); marketing pages; static assets

---

## 2. Roles

A "role" is determined entirely by the JWT presented to the backend (or its absence). Each request resolves to exactly one role. **Context-dependent overlays** (e.g., "creator of *this* market") are listed separately in §3 and combine with a base role.

| Role ID | Detection | Notes |
|---|---|---|
| `anon` | No `Authorization: Bearer …` header, or token rejected by `supabase.auth.get_user`. Backend dependency: `get_current_user` raises 401; `get_current_user_optional` returns `None`. | Used for the public landing/markets list. Cannot mutate. |
| `demo` | Frontend-only sentinel: `user.id === "00000000-0000-0000-0000-000000000000"`. Created by `SessionProvider` when no Supabase session exists, so the UI can render the same shell for signed-out users. **No backend role exists for this.** Any actual API call from the demo client is `anon` from the backend's perspective. | Demo is a *frontend illusion*. The backend never sees a "demo user." |
| `user` | Valid JWT, `profiles.role = 'user'`. Backend: `get_current_user` returns the row. | Default role for any signed-up CMU user. |
| `admin` | Valid JWT, `profiles.role = 'admin'`. Backend: `require_admin` accepts. | Can review markets, run admin tools, backroll. |
| `super_admin` | Valid JWT, `profiles.role = 'super_admin'`. Backend: `require_super_admin` accepts; also passes `require_admin`. | Can manage user roles. Currently seeded only for `tgershon`. |

### Role-preview override (admin tooling)

Admins can use the role-preview toggle (per `features/course/01-admin-system.md`) to *render the UI as if* they were `user`. **This is presentation-only:** the underlying JWT still has `role = 'admin'`, so any actual API call carries admin privileges. The matrix below describes *backend authorization*; the role-preview toggle is a separate concern documented in the hardening plan as "preview must not bypass server-side checks."

---

## 3. Context-Dependent Role Overlays

These are not standalone roles. They combine with one of the roles in §2 to determine the cell.

| Overlay ID | Definition | Used in |
|---|---|---|
| `creator(M)` | `current_user.id == markets.creator_id` for market `M` | Resolution proposal, community-resolution start, dispute restrictions |
| `bettor(M)` | `current_user.id` appears in `bets.user_id` for market `M` | Dispute filing, dispute voting (excluded for fairness) |
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
| `redirect→/auth` | Server- or client-side redirect to sign-in. **Server-side preferred** (no flash of protected content). |
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
| `400` | Validation failure on the request body. |
| `401` | No or invalid auth credentials. |
| `403` | Authenticated but role insufficient, or context overlay forbids (e.g., `creator(M)` trying to bet on `M`). |
| `404` | Resource doesn't exist *or* exists but the role shouldn't know it does. Prefer `404` over `403` for resource-existence privacy. |
| `409` | Conflict (e.g., already voted, market closed). |
| `429` | Rate-limited (post feature 11). |
| `5xx-ok` | Genuine server error allowed (e.g., DB unreachable). Not "an exception leaked." |
| `5xx-bug` | Should never occur for this role; if observed, that's a bug to fix. |

---

## 5. Page Matrix

Routes from `frontend/src/app/`. `?` cells require team ratification.

| Path | `anon` | `demo` | `user` | `admin` | `super_admin` | Notes |
|---|---|---|---|---|---|---|
| `/` | `render-readonly` | `render-readonly` | `render` | `render` | `render` | Markets dashboard; betting controls require auth. |
| `/markets` | `render-readonly` | `render-readonly` | `render` | `render` | `render` | If duplicates `/`, deprecate one. |
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
| Propose Resolution (YES / NO) | `hidden` | `hidden` | `visible` if `M.status='closed'` | `hidden` | `hidden` (admin uses admin-resolve) | `hidden` |
| Start Community Resolution | `hidden` | `hidden` | `visible` if `M.status='closed'` | `hidden` | `hidden` | `hidden` |
| Submit Dispute | `hidden` | `visible` if `M.status='pending_resolution'` and `M.proposed_outcome` set | `hidden` | `hidden` | `visible` if `M.status='pending_resolution'` and `M.proposed_outcome` set | `visible` if `M.status='pending_resolution'` and `M.proposed_outcome` set |
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
| Resolve as YES / NO / AMBIGUOUS button (`/admin/admin-review`) | n/a | `visible` for `admin_review` markets (gap B-4: page not yet built) | `visible` (gap B-4) |
| Search Users input (`/admin/users`) | n/a | `hidden` (page redirects) | `visible` |
| Promote/Demote User (`/admin/users`) | n/a | `hidden` | `visible`, but `disabled` for self |

**Dashboard card count by role** (codifies the "3 cards for admin / 4 cards for super_admin" target shape):

- `admin` → `Review Markets` + `Admin Review` + `Statistics` = **3 cards**
- `super_admin` → those three + `Manage Users` = **4 cards**

The `Admin Review` card is the only delta from today's UI (which shows 2/3); see Gap B-4.

### 6d. Defense-in-depth requirement

Every cell above marked `hidden` for a mutating control **must** have a corresponding API endpoint cell in §7 that returns 401/403 for the same role. The UI layer is for UX; the API layer is for security. `features/extension/14-api-contract-tests.md` enforces this pairing in CI.

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
| POST | `` | `401` | `201` | `201` | `201` | `201` |
| POST | `/{id}/resolve` | `401` | `403` | `200` if `M.status='closed'` else `400` | `403` (admin uses admin-resolve) | `403` |
| POST | `/{id}/community-resolution` | `401` | `403` | `200` if `M.status='closed'` else `400` | `403` | `403` |
| POST | `/{id}/dispute` | `401` | `200` if eligible else `403`/`409` | `403` (creator cannot dispute) | `200` if eligible else `403`/`409` | `200` if eligible else `403`/`409` |
| GET | `/{id}/dispute` | `200` / `404` | `200` / `404` | `200` / `404` | `200` / `404` | `200` / `404` |
| POST | `/{id}/dispute/vote` | `401` | `403` if `bettor(M)` or `dispute-voter(D)` else `200` | `403` (creators excluded) | `403` if `bettor(M)` or `dispute-voter(D)` else `200` | `403` if `bettor(M)` or `dispute-voter(D)` else `200` |
| GET | `/{id}/dispute/votes` | `200` | `200` | `200` | `200` | `200` |
| POST | `/admin/{id}/resolve` | `401` | `403` | `403` | `200` if `M.status='admin_review'` else `400` | `200` |

**Slated for relocation (Gap B-3):** `POST /api/markets/admin/{id}/resolve` is mounted on the markets router but is admin-only and currently has no frontend caller (`rg "markets/admin"` returns no matches outside specs). The hardening sweep moves this route to **`POST /api/admin/markets/{id}/resolve`** (see §7e). The relocated endpoint is what the future `/admin/admin-review` page (Gap B-4) will call.

### 7c. `bets.py` — `/api/markets`

| Method | Path | `anon` | `user` | `user+creator(M)` | `admin` | `super_admin` |
|---|---|---|---|---|---|---|
| POST | `/{id}/bets` | `401` | `201` if `M.status='open'` and balance OK; `409` otherwise | `403` (creators cannot bet) | same as `user` | same as `user` |
| POST | `/{id}/bets/option` | `401` | `201` if conditions OK; `409` / `400` otherwise | `403` | same as `user` | same as `user` |
| GET | `/{id}/bets` | `200` | `200` | `200` | `200` | `200` |

### 7d. `resolution.py` — `/api`

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
| DELETE | `/{id}` | `401` | `204` | `404` | `204` if owner else `404` | same |

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

## 8. Known Implementation Gaps

The matrix is the spec. This section tracks places where the **implementation today deviates from the spec** above. Each gap has an owner doc that will close it; once closed, the row is deleted.

> **Team policy** (ratified 2026-05-08): An `admin`'s authorization on a market is essentially the same as a `user`'s, with admin-only powers added on top (visible only via the admin dashboard, plus admin-resolve and backroll). The matrix above reflects this: any cell where `admin` differs from `user` is intentional (admin-resolve, backroll, admin pages, super-admin user management) and has been called out in the relevant note.

| Gap ID | Surface | Spec says | Implementation today | Fix tracked in |
|---|---|---|---|---|
| B-1 | `/markets/create` (page) for `anon` / `demo` | `redirect→/auth` (§5) | Page renders the create-market template regardless of auth status. A signed-out user could fill in the form (the API call would fail with 401, but the UX is wrong and leaks the form shape). | `features/extension/13-backend-hardening.md` (frontend gate) |
| B-2 | `/portfolio` (page) and/or `GET /api/portfolio` for any `user` | Spec: shows current user's bets/positions only (§5, §7g). | Page surfaces fields that belong to other users — specifically other users' proposed markets are visible. Could be a frontend filter miss, a backend response over-fetch, or a component pulling from the wrong query. **Investigate and fix.** | `features/extension/13-backend-hardening.md` |
| B-3 | `POST /api/markets/admin/{id}/resolve` (route mounting) | Should live under `/api/admin/...` (§7e) for consistency with the rest of admin routes. The relocated route is what the B-4 UI calls. | Mounted on the markets router; no frontend caller exists today. | `features/extension/13-backend-hardening.md` (route move, no frontend churn) |
| B-4 | `/admin/admin-review` page + `/admin` dashboard card "Admin Review" + UI to resolve `admin_review` markets | Page renders for `admin` / `super_admin` (§5); dashboard exposes an "Admin Review" card (§6c); per-market YES/NO/AMBIGUOUS buttons call relocated `POST /api/admin/markets/{id}/resolve` (§7e). Target shape: 3 cards for admin / 4 cards for super_admin (§6c). | None of the above exists. The state machine *can* place markets in `admin_review` (`market_state_machine.py` lines 257, 297) when community resolution fails, but no UI path resolves them — admins must drop into Supabase to fix. | **Future doc** (e.g., `features/19-admin-resolution-ui.md`); explicitly out of scope for the current 12–18 sweep. Team has indicated preference for this option (build the UI) over the alternative (remove `admin_review` state and auto-default to AMBIGUOUS). |

When a gap is fixed, add a row to the changelog and delete the row above. The matrix is the source of truth; this section is a transient TODO list.

**Re B-4 — option still on the table:** if the team later decides building the resolution UI is more cost than its frequency justifies, the alternative is to delete the `admin_review` terminal state from `market_state_machine.py` and have failed community resolution default to `AMBIGUOUS` (which refunds all bettors). This would also retire the `POST /api/admin/markets/{id}/resolve` endpoint and the §6c "Admin Review" card. Either path closes B-4; the matrix above assumes option 1 (build the UI) per current team direction.

### Resolved questions (historical)

The following spec questions were marked `?` in the initial draft and have all been ratified by the team on 2026-05-08:

- **Q1** (`/markets` vs `/`): Both routes exist with intentionally different layouts — see `features/extension/16-home-vs-markets-split.md`. Originally suggested "deprecate one"; team chose to specialize.
- **Q2** (`/markets/create` for unauth): redirect → `/auth`. Implementation lags spec — see Gap B-1.
- **Q3** (admin filing disputes): yes — admin permissions = user + admin extras. §6a / §7b updated.
- **Q4** (admin voting in resolutions): yes — same policy as Q3. §6a / §7b / §7d updated.
- **Q5** (refunded bettor voting): bettor exclusion stands post-backroll. §6a / §7b unchanged.
- **Q6** (move admin-resolve route): tracked as Gap B-3 above.
- **Q7** (404 vs 403 for owner-keyed resources): `404`. §7f finalized.
- **Q8** (`admin_review` resolution UI): team direction is to build it (§6c "Admin Review" card + `/admin/admin-review` page); tracked as Gap B-4 with the alternative-route option preserved.

---

## 9. Maintenance Protocol

The matrix is only useful if it stays current. Discipline:

1. **Adding a new API endpoint:** the PR must include a new row in the relevant table in §7. CI test (`features/extension/14-api-contract-tests.md`) fails if a route exists in code but not in the matrix.
2. **Adding a new page:** PR must include a row in §5.
3. **Adding a new mutating UI control:** PR must include a row in §6 *and* the corresponding API endpoint cell must already exist.
4. **Changing a role or permission:** PR must update the matrix and the relevant downstream tests in the same change set. Don't ship gating changes without updating the spec.
5. **Disagreement during review:** add the question to §8 with a `?` placeholder rather than guessing.

A pre-commit or CI lint that diffs `@router.` declarations in `backend/routers/` against the endpoint tables in §7 is recommended (spec'd in `features/extension/14-api-contract-tests.md`). Same for page routes in `frontend/src/app/`.

---

## 10. Cross-References

| Doc | Reads from this matrix to … |
|---|---|
| `features/extension/12-observability.md` | Decide which routes' error responses need PII-scrubbing context (e.g., admin routes log full traces, user routes scrub IDs). |
| `features/extension/13-backend-hardening.md` | Audit every `@router.` against the §7 tables and apply the correct `Depends(...)` dependency; fix `f"...: {e}"` leaks while in the file; **remediate gaps B-1, B-2, B-3 from §8**. |
| `features/extension/14-api-contract-tests.md` | Generate one parameterized pytest case per `(endpoint, role)` cell, asserting the documented status code. |
| `features/extension/15-playwright-ui-tests.md` | Generate browser tests from §5 (page redirects) and §6 (control visibility/disabled state). |
| `features/extension/16-home-vs-markets-split.md` | Cite §5 rows for `/` and `/markets` as the canonical access spec; this doc only specifies the *layout* differences, not who can see them. |
| `features/extension/17-market-creation-validation.md` | Read the `/markets/create` row in §5 and the `POST /api/markets` row in §7b for the access spec; this doc adds *input validation* on top. |
| `features/extension/18-dummy-data-removal.md` | No direct reference — but any seeded user/market that pretends to be a real role must respect the matrix once kept; otherwise it must be deleted. |

---

## Changelog

| Date | Change | By |
|---|---|---|
| 2026-05-08 | Initial draft from codebase audit (routers + pages enumerated; UI controls and `?` cells require team ratification) | Cursor (Claude) |
| 2026-05-08 | Team ratified Q1–Q7. Stated policy: admin = user + admin extras (only admin-resolve, backroll, admin pages, super-admin user mgmt are admin-only). §6a / §7b / §7d cells updated. §7f `POST /{id}/read` non-owner finalized as `404`. §8 repurposed from "Open Questions" to "Known Implementation Gaps" (B-1, B-2, B-3 listed for fix in `features/extension/13-backend-hardening.md`). New downstream docs scoped: `features/extension/16-home-vs-markets-split.md`, `features/extension/17-market-creation-validation.md`, `features/extension/18-dummy-data-removal.md`. | Team + Cursor (Claude) |
| 2026-05-09 | Added §5 row for `/admin/admin-review`; reshaped §6a "Admin Resolve" entry into an informational banner (action moved to admin page); added §6c rows for the four dashboard cards and the per-market resolve buttons; added §7e row for relocated `POST /api/admin/markets/{id}/resolve`; tightened §7b Gap B-3 footnote to reflect "no frontend caller" finding (`rg "markets/admin"` clean); added Gap B-4 (missing `admin_review` resolution UI) with team direction to build it; added Q8 to resolved questions; updated header status to four gaps. | Team + Cursor (Claude) |
