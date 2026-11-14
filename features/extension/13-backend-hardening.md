# Feature 13: Backend Hardening — Error Envelope, Auth Audit, Gap Remediation

**Status:** Design ratified
**Phase:** Hardening — depends on `features/extension/12-observability.md`
**Parallelizable with:** `features/extension/16-home-vs-markets-split.md`, `features/extension/17-market-creation-validation.md`, `features/extension/18-dummy-data-removal.md`
**Reads from:** `project-specs/AUTHZ_MATRIX.md` (audit driven by §7; gap remediation closes B-1, B-2, B-3 from §8)
**Branch:** `feature/backend-hardening` → multiple sub-PRs (see `issues/13.*.md`)
**Execution items:** `issues/13.1-error-envelope-foundation.md` through `issues/13.10-error-code-tag-verification.md`

---

## Summary

Three coordinated changes that together close every leak surface in the current backend:

1. **Structured error envelope.** Every HTTP error response — 4xx or 5xx — returns `{"detail": {"code": "<ENUM>", "message": "<safe>"}}`. A new `AppError` exception class (built on `report_and_safe_message` from doc 12) enforces the shape and captures the original exception to Sentry with an `error_code` tag. **`AppError` becomes the only exception routers raise.**
2. **FastAPI dependency audit.** Walk every `@router.` declaration against AUTHZ_MATRIX §7 and confirm the right `Depends(...)` is applied. Replace one inline `current_user.get("is_admin")` check with `require_admin`; add `get_current_user_optional` to two GET routes for instrumentation consistency. The codebase is mostly correct already — the value of the audit is the audit table itself, which becomes doc 14's test specification.
3. **Remediate matrix gaps B-1, B-2, B-3.** Server-side gate on `/markets/create`; new dedicated `/api/portfolio/proposed-markets` endpoint to fix the cross-user leak on `/portfolio`; relocate the dead admin-resolve route to `/api/admin/markets/{id}/resolve` to align with the rest of the admin surface. (Gap **B-4** — the missing `admin_review` resolution UI — is **out of scope** for this doc; tracked separately.)

The frontend changes are scoped to the smallest possible surface: extend `ApiError` in `frontend/src/lib/api.ts` to parse the envelope, expose a `parseApiError(err)` helper, and migrate the existing `err instanceof Error ? err.message : ...` patterns to it. Backwards-compatible during the rollout.

---

## Why this ordering is rigid

- **Doc 12 ships first.** `AppError` imports `report_and_safe_message` and uses the request/user `ContextVar`s. Without doc 12, sanitizing user-facing messages destroys debugging signal.
- **`AppError` ships before any router migration** (PR-13.1). Otherwise each router PR would have to pull the helper into a separate file or duplicate the Sentry-capture pattern.
- **Frontend `parseApiError` ships before any router migration** (PR-13.2). Otherwise the moment a backend route returns the new envelope, the frontend renders raw JSON in error toasts. Backwards-compat handling avoids a flag day.
- **Gap fixes B-1, B-2, B-3 ship after the envelope work.** Each introduces or moves a route; the new shape lets us wire them up correctly without touching them again.

---

## Part 1: Structured Error Envelope

### 1a. The shape

Every error response — 4xx or 5xx, from any router — has this body:

```json
{
  "detail": {
    "code": "BET_INSUFFICIENT_BALANCE",
    "message": "Insufficient banana balance."
  }
}
```

Properties:

- `detail` is an **object**, never a string and never a list. (FastAPI's default 422 returns `detail: [...]` from Pydantic — handled below in §1d.)
- `code` is a stable, machine-readable identifier from the `ErrorCode` enum below. The frontend switches on it to render localized messages, retry hints, or specific UI states.
- `message` is a short, user-safe sentence. No schema names, no SQL, no stack frames.
- Optional `errors` field (a list of per-field details) is allowed for `code: VALIDATION_FAILED` only — the validation handler populates it so forms can surface field-level errors.

The HTTP status code remains the truthful HTTP status (401, 403, 404, 409, 500, etc., per AUTHZ_MATRIX §7). The envelope is in the body; the status is in the status line. Both matter.

### 1b. The `ErrorCode` enum (canonical)

Defined once in `backend/observability.py`. Codes are stable contracts — never repurpose, only deprecate-and-add. CI (doc 14) enforces that every code in the enum is reachable and that no router invents an inline code string.

```python
class ErrorCode(str, Enum):
    # Generic — middleware and fallbacks
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    VALIDATION_FAILED = "VALIDATION_FAILED"
    RATE_LIMITED = "RATE_LIMITED"        # reserved for feature 11
    INTERNAL_ERROR = "INTERNAL_ERROR"

    # Auth
    AUTH_PROFILE_INCOMPLETE = "AUTH_PROFILE_INCOMPLETE"

    # Markets
    MARKET_NOT_FOUND = "MARKET_NOT_FOUND"
    MARKET_NOT_OPEN = "MARKET_NOT_OPEN"
    MARKET_NOT_CLOSED = "MARKET_NOT_CLOSED"
    MARKET_NOT_PENDING_REVIEW = "MARKET_NOT_PENDING_REVIEW"
    MARKET_NOT_PENDING_RESOLUTION = "MARKET_NOT_PENDING_RESOLUTION"
    MARKET_NOT_DISPUTED = "MARKET_NOT_DISPUTED"
    MARKET_NOT_ADMIN_REVIEW = "MARKET_NOT_ADMIN_REVIEW"
    MARKET_ALREADY_RESOLVED = "MARKET_ALREADY_RESOLVED"
    MARKET_CLOSE_DATE_PASSED = "MARKET_CLOSE_DATE_PASSED"
    MARKET_NOT_MULTICHOICE = "MARKET_NOT_MULTICHOICE"

    # Bets
    BET_INSUFFICIENT_BALANCE = "BET_INSUFFICIENT_BALANCE"
    BET_INVALID_AMOUNT = "BET_INVALID_AMOUNT"
    BET_INVALID_OPTION = "BET_INVALID_OPTION"
    BET_CREATOR_RESTRICTED = "BET_CREATOR_RESTRICTED"

    # Resolution
    RESOLUTION_NOT_CREATOR = "RESOLUTION_NOT_CREATOR"
    RESOLUTION_WINDOW_EXPIRED = "RESOLUTION_WINDOW_EXPIRED"
    DISPUTE_NOT_FOUND = "DISPUTE_NOT_FOUND"
    DISPUTE_ALREADY_FILED = "DISPUTE_ALREADY_FILED"
    DISPUTE_BETTOR_RESTRICTED = "DISPUTE_BETTOR_RESTRICTED"
    DISPUTE_CREATOR_RESTRICTED = "DISPUTE_CREATOR_RESTRICTED"
    DISPUTE_VOTE_DUPLICATE = "DISPUTE_VOTE_DUPLICATE"
    COMMUNITY_VOTE_DUPLICATE = "COMMUNITY_VOTE_DUPLICATE"
    COMMUNITY_VOTE_CREATOR_RESTRICTED = "COMMUNITY_VOTE_CREATOR_RESTRICTED"

    # Daily claim
    CLAIM_ALREADY_TODAY = "CLAIM_ALREADY_TODAY"
    CLAIM_AT_BALANCE_CAP = "CLAIM_AT_BALANCE_CAP"

    # Admin / super-admin
    ADMIN_REQUIRED = "ADMIN_REQUIRED"
    SUPER_ADMIN_REQUIRED = "SUPER_ADMIN_REQUIRED"
    ADMIN_CANNOT_CHANGE_OWN_ROLE = "ADMIN_CANNOT_CHANGE_OWN_ROLE"

    # Notifications
    NOTIFICATION_NOT_FOUND = "NOTIFICATION_NOT_FOUND"
```

Any new code must be added here, **never** invented inline.

### 1c. The `AppError` exception (canonical contract)

Subclass of `HTTPException` that produces the envelope and captures to Sentry in one call. Defined in `backend/observability.py` next to the enum. Public signature:

```python
class AppError(HTTPException):
    def __init__(
        self,
        status_code: int,
        code: ErrorCode,
        message: str,
        *,
        original: BaseException | None = None,
        extras: dict[str, Any] | None = None,
        errors: list[dict[str, Any]] | None = None,
    ) -> None: ...
```

Behavior:

- If `original` is set, the exception is captured to Sentry with `error_code` as a tag and `extras` as Sentry event extras.
- The HTTP detail body is always `{"code": code.value, "message": message}`, plus `"errors": [...]` when provided (validation case).
- `from exc` chaining is preserved — Python's traceback shows the underlying error in dev.

Two usage patterns:

```python
# Wrapping an underlying exception
try:
    ...
except SomeRpcError as exc:
    raise AppError(
        409,
        ErrorCode.BET_INSUFFICIENT_BALANCE,
        "Insufficient banana balance.",
        original=exc,
        extras={"market_id": market_id, "side": body.side},
    ) from exc

# Pure authorization / validation case (no underlying exception)
raise AppError(403, ErrorCode.BET_CREATOR_RESTRICTED, "Creators cannot bet on their own markets.")
```

`report_and_safe_message` from doc 12 stays as the lower-level primitive for non-HTTP code paths (e.g., a service function that wants Sentry capture without raising). `AppError` is what 99% of router code touches.

### 1d. Validation errors and unhandled exceptions

FastAPI's defaults break the envelope shape in two cases. Both need a global handler in `backend/main.py`:

- **`@app.exception_handler(RequestValidationError)`** — converts Pydantic `[{...}, {...}]` lists into envelope shape with the per-field details preserved under `errors[]`. Status remains 422; code is `VALIDATION_FAILED`.
- **`@app.exception_handler(Exception)`** — last-resort safety net for any unhandled exception. Captures to Sentry via `report_and_safe_message`, returns a generic envelope with `code: INTERNAL_ERROR`. Routers should catch and raise `AppError` themselves; this handler exists so a forgotten case never leaks a stack trace to the client.

After both handlers are in place, **there is exactly one error-response shape across the entire API.**

### 1e. Frontend integration (canonical contract)

Extend `ApiError` in `frontend/src/lib/api.ts` to parse the envelope and add a `parseApiError(err)` helper. Backwards-compatible: if the body isn't an envelope, falls back to current behavior.

```ts
export interface ApiErrorBody {
  code: string;
  message: string;
  errors?: { field: string; message: string; type: string }[];
}

export class ApiError extends Error {
  public readonly code: string;
  public readonly userMessage: string;
  public readonly fieldErrors: { field: string; message: string }[];
  public readonly raw: string;
  constructor(public status: number, raw: string) { /* parse envelope from raw */ }
}

export function parseApiError(err: unknown, fallback = "Something went wrong."): {
  code: string;
  message: string;
  fieldErrors: { field: string; message: string }[];
};
```

`parseApiError` handles three cases beyond a normal `ApiError`:

- `AbortError` → `code: ABORTED`, message "Request cancelled."
- `TypeError` matching `/fetch/i` → `code: NETWORK_ERROR`, message "Connection failed. Check your internet."
- Anything else → `code: UNKNOWN`, message = supplied `fallback`.

Every call site that does `err instanceof Error ? err.message : "..."` becomes `parseApiError(err, "...").message`. Mechanical, low-risk. For places that want to switch on the code (e.g., a 409 → `CLAIM_ALREADY_TODAY`-specific UX), the helper exposes `code` directly.

Full implementation lives in `issues/13.2-frontend-parse-api-error.md`.

---

## Part 2: FastAPI Dependency Audit

Walk every `@router.` declaration against AUTHZ_MATRIX §7. The current state is mostly correct (the codebase already uses `require_admin` and `require_super_admin` correctly throughout `backend/routers/admin.py`). The audit below is the full sweep — **the table is the ground truth for doc 14's contract tests, even where no fix is needed.**

### 2a. Audit table

Legend: `OK` = no change; `FIX` = action needed.

| Router | Method | Path | Current dependency | Required (per matrix) | Status |
|---|---|---|---|---|---|
| auth | GET | `/api/auth/me` | `get_current_user` | `get_current_user` | OK |
| auth | POST | `/api/auth/profile` | `get_current_user` | `get_current_user` | OK |
| auth | PATCH | `/api/auth/profile` | `get_current_user` | `get_current_user` | OK |
| auth | POST | `/api/auth/claim-daily` | `get_current_user` | `get_current_user` | OK |
| markets | GET | `/api/markets` | `get_current_user_optional` | `get_current_user_optional` | OK |
| markets | GET | `/api/markets/hot` | `get_current_user_optional` | `get_current_user_optional` | OK |
| markets | GET | `/api/markets/trending` | `get_current_user_optional` | `get_current_user_optional` | OK |
| markets | GET | `/api/markets/top` | `get_current_user_optional` | `get_current_user_optional` | OK |
| markets | GET | `/api/markets/{id}` | `get_current_user_optional` | `get_current_user_optional` | OK |
| markets | POST | `/api/markets` | `get_current_user` | `get_current_user` | OK |
| markets | POST | `/api/markets/{id}/resolve` | `get_current_user` + inline creator check | same | OK |
| markets | POST | `/api/markets/{id}/community-resolution` | `get_current_user` + inline creator check | same | OK |
| markets | POST | `/api/markets/{id}/dispute` | `get_current_user` (RPC enforces) | same | OK — confirm RPC text matches new error codes |
| markets | GET | `/api/markets/{id}/dispute` | `get_current_user_optional` | `get_current_user_optional` | OK |
| markets | POST | `/api/markets/{id}/dispute/vote` | `get_current_user` (RPC enforces) | same | OK |
| markets | GET | `/api/markets/{id}/dispute/votes` | `get_current_user_optional` | `get_current_user_optional` | OK |
| markets | POST | `/api/markets/admin/{id}/resolve` | `get_current_user` + inline `is_admin` check | `require_admin` + relocate to `/api/admin/markets/{id}/resolve` | **FIX (Gap B-3)** |
| bets | POST | `/api/markets/{id}/bets` | `get_current_user` | same | OK |
| bets | POST | `/api/markets/{id}/bets/option` | `get_current_user` | same | OK |
| bets | GET | `/api/markets/{id}/bets` | `get_current_user_optional` | `get_current_user_optional` | OK |
| resolution | GET | `/api/resolutions` | `get_current_user_optional` | `get_current_user_optional` | OK |
| resolution | POST | `/api/{id}/community-vote` | `get_current_user` | `get_current_user` | OK |
| resolution | GET | `/api/{id}/community-votes` | **none** | `get_current_user_optional` | **FIX (consistency)** |
| admin | POST | `/api/admin/markets/resolution-reminders/run` | `require_admin` | `require_admin` | OK |
| admin | GET | `/api/admin/stats` | `require_admin` | `require_admin` | OK |
| admin | GET | `/api/admin/users/search` | `require_super_admin` | `require_super_admin` | OK |
| admin | PUT | `/api/admin/users/{id}/role` | `require_super_admin` | `require_super_admin` | OK |
| admin | POST | `/api/admin/markets/{id}/backroll` | `require_admin` | `require_admin` | OK |
| admin | GET | `/api/admin/markets/review` | `require_admin` | `require_admin` | OK |
| admin | POST | `/api/admin/markets/{id}/review` | `require_admin` | `require_admin` | OK |
| notifications | GET | `/api/notifications` | `get_current_user` | `get_current_user` | OK |
| notifications | GET | `/api/notifications/unread-count` | `get_current_user` | `get_current_user` | OK |
| notifications | POST | `/api/notifications/read` | `get_current_user` | `get_current_user` | OK |
| notifications | POST | `/api/notifications/{id}/read` | `get_current_user` | `get_current_user` + 404-not-403 for non-owner | **FIX (raise `NOTIFICATION_NOT_FOUND`)** |
| notifications | DELETE | `/api/notifications/{id}` | `get_current_user` | same as above | **FIX (same)** |
| portfolio | GET | `/api/portfolio` | `get_current_user` | `get_current_user` | OK |
| portfolio | GET | `/api/transactions` | `get_current_user` | `get_current_user` | OK |
| portfolio | GET | `/api/portfolio/proposed-markets` | n/a (does not exist yet) | `get_current_user` | **NEW (Gap B-2)** |
| rewards | GET | `/api/rewards` | `get_current_user` | `get_current_user` | OK |
| rewards | GET | `/api/rewards/badges/{user_id}` | **none** | `get_current_user_optional` | **FIX (consistency; route stays public per matrix)** |
| rewards | POST | `/api/rewards/check` | `get_current_user` | `get_current_user` | OK |
| leaderboard | GET | `/api/leaderboard` | `get_current_user_optional` | `get_current_user_optional` | OK |
| leaderboard | GET | `/api/leaderboard/weekly` | `get_current_user_optional` | `get_current_user_optional` | OK |

### 2b. Summary of audit fixes

- **Gap B-3** (markets → admin route): one PR. Move the handler + relocate path + swap inline `is_admin` for `require_admin` dependency.
- **Notifications 404-vs-403** (two routes): replace any non-owner branch with `AppError(404, ErrorCode.NOTIFICATION_NOT_FOUND, "Notification not found.")` per matrix §7f.
- **Two GET routes lacking `get_current_user_optional`** (`resolution.list_community_votes`, `rewards.get_user_badges`): cosmetic — adds the same `_current_user` parameter the other public GETs use, so doc 12's `set_user_context` fires uniformly when a token is present (better Sentry attribution).

### 2c. Anti-pattern removal — inline `is_admin` checks

The audit also flushes one anti-pattern: routes that take `get_current_user` and then do `if not current_user.get("is_admin"): raise ...` inline. Today this exists in exactly one place — `backend/routers/markets.py::admin_resolve` (lines 478–480). It moves to `Depends(require_admin)` as part of Gap B-3. **Future code review must reject re-introductions** — the only acceptable role check is the FastAPI dependency.

### 2d. F-string error-leak inventory

While in each router, replace every `f"...: {e}"` interpolation with `AppError(..., original=exc)`. Known leak sites:

- `backend/routers/markets.py` — lines 287, ~330, ~376–388 (the dispute except chain), 441, 496
- `backend/routers/admin.py` — lines 188, 300

`backend/routers/bets.py` is **already clean** (lines 50–75 and 103–133) and serves as the reference pattern. The migration converts those mappings into `AppError` raises with the appropriate `ErrorCode`. Per-router playbooks and exact line-by-line rewrites are in `issues/13.3` (markets), `issues/13.4` (admin), and `issues/13.5` (the smaller routers bundled together).

---

## Part 3: Gap Remediation (B-1, B-2, B-3)

Full rationale + implementation playbooks in their respective issue files. Summarized here for the design rationale reader.

### 3a. Gap B-1 — `/markets/create` renders for unauthenticated users

**Spec (matrix §5):** `redirect→/auth` for `anon` and `demo`.
**Today:** Page renders the create-market template regardless of auth status; the API call would fail with 401 but the form is shown and the user wastes time filling it in.
**Fix:** Server-side gate, not a client-side `useEffect` redirect. Two equivalent approaches:

- **Approach 1 — Server component with `redirect()`** in `frontend/src/app/markets/create/page.tsx`. Local to the route; minimal blast radius.
- **Approach 2 — Next.js middleware** at `frontend/src/middleware.ts` covering all matrix-§5 routes that say `redirect→/auth` (`/markets/create`, `/portfolio`, `/profile`, `/rewards`, `/admin/*`).

**Recommendation: Approach 2** if no `middleware.ts` exists yet — it centralizes the gating logic and closes any other route that turns out to be only client-side-gated. Defense in depth: `POST /api/markets` already requires `get_current_user`, so even if the page rendered briefly, the form's submit fails with `AppError(401, UNAUTHORIZED, ...)` and `parseApiError` surfaces the correct message.

Execution: `issues/13.7-gap-b1-create-market-gate.md`.

### 3b. Gap B-2 — `/portfolio` shows other users' proposed markets

**Root cause (verified in code):** `frontend/src/app/portfolio/page.tsx` lines 51–57 call `marketsQuery({status:"pending_review"})` and `marketsQuery({status:"denied"})`. These hit `GET /api/markets?status=...` which `backend/routers/markets.py::list_markets` returns **without filtering by `creator_id`**. The portfolio page then renders the union as "Proposed Markets," implying ownership and exposing other users' full market metadata.

This is a real cross-user data leak. Matrix §7b "GET `` `200`" cell did not constrain *content*; this fix tightens the contract.

**Fix — new dedicated endpoint** (cleanest): add `GET /api/portfolio/proposed-markets` in `backend/routers/portfolio.py`, scoped to `current_user["id"]`, returning markets where `creator_id = current_user.id AND status IN ('pending_review', 'denied')`. Frontend swaps the two `marketsQuery({status:...})` calls for a new `proposedMarketsQuery()` against the new endpoint.

**Why a new endpoint and not filtering the existing one:**

- `GET /api/markets?status=pending_review` is *also* used by admin tooling. Adding role-conditional `creator_id` filtering would create a behavior fork that's hard to test.
- A purpose-built endpoint with an explicit name makes the access control obvious from the route. Easier to reason about, easier to test, easier to grep for in the future.

Execution: `issues/13.8-gap-b2-portfolio-proposed-markets.md`.

### 3c. Gap B-3 — Relocate `POST /api/markets/admin/{id}/resolve` under `/api/admin/...`

**Spec (matrix §7e):** Should live in the admin router for consistency.
**Today:** Mounted on the markets router with an inline `is_admin` check. **No frontend caller exists** (`rg "markets/admin"` returns no matches outside specs).

**Fix:** Move the handler from `markets.py::admin_resolve` (lines 470–496) to `admin.py::admin_resolve_market`. Use `Depends(require_admin)` instead of the inline check. Update path to `POST /api/admin/markets/{id}/resolve`. **No frontend changes needed today** — the relocated route is what the future Gap B-4 UI will call.

**Note on the missing UI (Gap B-4):** the matrix tracks a separate gap — there is no UI for an admin to resolve a market that has reached `admin_review` status. The state machine *can* place markets there (`backend/services/market_state_machine.py` lines 257, 297) but no app path resolves them. This is **out of scope for doc 13**; the team's preferred resolution is to build a `/admin/admin-review` page and add an "Admin Review" card to the `/admin` dashboard. Tracked as Gap B-4 in `AUTHZ_MATRIX.md` §8 with future doc reference (e.g., `features/19-admin-resolution-ui.md`). The relocation in PR-13.9 is a prerequisite for that future work — once relocated, the new UI calls a route that already lives in the right place.

Execution: `issues/13.9-gap-b3-admin-resolve-route-move.md`.

---

## 4. ErrorCode → User-Facing Message Catalog

Maintained in `backend/observability.py` next to the `ErrorCode` enum, **for documentation only**. Routers always pass an explicit `message=` to `AppError`; this table is the agreed-upon canonical phrasing so toast text stays consistent across endpoints. Doc 14's tests assert the message matches the catalog; doc 15's tests assert the rendered toast matches.

| ErrorCode | Default user-facing message | Frontend treatment hint |
|---|---|---|
| `UNAUTHORIZED` | "You need to sign in." | Redirect to `/auth` after toast |
| `FORBIDDEN` | "You don't have permission." | Generic toast |
| `NOT_FOUND` | "Not found." | Generic toast |
| `VALIDATION_FAILED` | "Validation failed." | Read `errors[]` for per-field surfaces |
| `INTERNAL_ERROR` | "Something went wrong. Try again." | Generic toast; offer "report" link with `request_id` |
| `MARKET_NOT_OPEN` | "This market is no longer accepting bets." | Disable bet buttons; refresh data |
| `MARKET_ALREADY_RESOLVED` | "This market is already resolved." | Refresh data |
| `BET_INSUFFICIENT_BALANCE` | "Not enough bananas." | CTA to claim daily bonus |
| `BET_CREATOR_RESTRICTED` | "Creators cannot bet on their own markets." | Hide bet UI (matches matrix §6a) |
| `RESOLUTION_NOT_CREATOR` | "Only the market creator can do this." | Hide control |
| `RESOLUTION_WINDOW_EXPIRED` | "The resolution window has expired." | Refresh data |
| `DISPUTE_BETTOR_RESTRICTED` | "Bettors cannot vote on disputes for markets they bet on." | Hide vote UI |
| `DISPUTE_VOTE_DUPLICATE` | "You've already voted." | Show vote tally |
| `COMMUNITY_VOTE_DUPLICATE` | "You've already voted." | Show vote tally |
| `CLAIM_ALREADY_TODAY` | "Already claimed today." | Show "Come back tomorrow" |
| `CLAIM_AT_BALANCE_CAP` | "You're at the balance cap." | Hide claim button |
| `ADMIN_REQUIRED` | "Admin access required." | Should never reach user-visible UI; if it does, log loudly |
| `NOTIFICATION_NOT_FOUND` | "Notification not found." | Refresh notifications |

---

## 5. Files Affected

| Area | File | Change |
|---|---|---|
| Backend | `backend/observability.py` | MODIFY — add `ErrorCode` enum, `AppError` class. Co-located with `report_and_safe_message` from doc 12. |
| Backend | `backend/main.py` | MODIFY — add `validation_handler` and `unhandled_exception_handler`. |
| Backend | `backend/routers/markets.py` | MODIFY — migrate `HTTPException(...)` → `AppError(...)`. Replace `f"...: {e}"`. **Delete** `admin_resolve` (Gap B-3 destination is `admin.py`). |
| Backend | `backend/routers/admin.py` | MODIFY — migrate exceptions. **Add** `admin_resolve_market` (Gap B-3 destination). |
| Backend | `backend/routers/auth.py` | MODIFY — migrate exceptions. |
| Backend | `backend/routers/bets.py` | MODIFY — migrate exceptions (logic unchanged — already clean). |
| Backend | `backend/routers/resolution.py` | MODIFY — migrate exceptions. Add `Depends(get_current_user_optional)` to `list_community_votes`. |
| Backend | `backend/routers/notifications.py` | MODIFY — migrate exceptions. Audit fix: non-owner returns `AppError(404, NOTIFICATION_NOT_FOUND, ...)`. |
| Backend | `backend/routers/portfolio.py` | MODIFY — migrate exceptions. **Add** `get_my_proposed_markets` route (Gap B-2). |
| Backend | `backend/routers/rewards.py` | MODIFY — migrate exceptions. Add `Depends(get_current_user_optional)` to `get_user_badges`. |
| Backend | `backend/routers/leaderboard.py` | MODIFY — migrate exceptions if any (mostly read-only; may be no-op). |
| Frontend | `frontend/src/lib/api.ts` | MODIFY — extend `ApiError` with envelope parsing. Add `parseApiError` helper. Add `getMyProposedMarkets` (Gap B-2). |
| Frontend | `frontend/src/lib/query/keys.ts` | MODIFY — add `portfolio.proposedMarkets` key. |
| Frontend | `frontend/src/lib/query/queries/portfolio.ts` | MODIFY — add `proposedMarketsQuery`. |
| Frontend | `frontend/src/app/portfolio/page.tsx` | MODIFY — replace `marketsQuery({status:'pending_review'\|'denied'})` with `proposedMarketsQuery()`. Closes Gap B-2. |
| Frontend | `frontend/src/middleware.ts` (if not present) | NEW — server-side gate for matrix-§5 protected routes. Closes Gap B-1. |
| Frontend | `frontend/src/app/markets/create/page.tsx` | MODIFY (alternative to middleware) — server-component auth check + redirect. |
| Frontend | `frontend/src/app/markets/[id]/detail-client.tsx` | MODIFY — replace ~10 `err instanceof Error ? err.message : "..."` with `parseApiError(...)` calls. |
| Frontend | All other `frontend/src/app/**/*-client.tsx` | MODIFY — same `parseApiError` migration; mechanical sweep. |
| Spec | `project-specs/AUTHZ_MATRIX.md` | MODIFY — close gaps B-1, B-2, B-3 from §8 as their PRs land. (B-4 stays open per current scope.) |

---

## 6. Execution

Ten PRs, in order. See the linked issue files for scope, acceptance criteria, and verification:

| Issue | Title | Depends on |
|---|---|---|
| `issues/13.1-error-envelope-foundation.md` | `ErrorCode`, `AppError`, validation + unhandled handlers. No router changes. | doc 12 fully landed |
| `issues/13.2-frontend-parse-api-error.md` | Extend `ApiError`, add `parseApiError`. Backwards-compatible. | — (independent of 13.1) |
| `issues/13.3-migrate-markets-router.md` | Migrate `routers/markets.py` exceptions to `AppError`. Skip `admin_resolve`. | 13.1 |
| `issues/13.4-migrate-admin-router.md` | Migrate `routers/admin.py` exceptions. | 13.1 |
| `issues/13.5-migrate-remaining-routers.md` | Migrate `auth/bets/resolution/notifications/portfolio/rewards/leaderboard`. Notifications 404-not-403 audit fix lands here. | 13.1 |
| `issues/13.6-frontend-error-reader-migration.md` | Sweep `err.message` patterns → `parseApiError`. | 13.2, 13.3, 13.4, 13.5 |
| `issues/13.7-gap-b1-create-market-gate.md` | Server-side gate for `/markets/create` (and other matrix-§5 routes if middleware approach chosen). | 13.6 (parses 401 envelope cleanly) |
| `issues/13.8-gap-b2-portfolio-proposed-markets.md` | New `/api/portfolio/proposed-markets` endpoint + frontend wiring. | 13.5 (portfolio router migrated), 13.6 |
| `issues/13.9-gap-b3-admin-resolve-route-move.md` | Move admin-resolve to `/api/admin/markets/{id}/resolve`. No frontend churn. | 13.4 (admin router migrated) |
| `issues/13.10-error-code-tag-verification.md` | Verify every `AppError` raise tags Sentry events with `error_code`. Likely no-op if 13.1's class is correct. | 13.3, 13.4, 13.5 |

PRs 13.3, 13.4, and 13.5 can run in parallel (different routers, independent merge conflicts). PRs 13.7, 13.8, 13.9 can run in parallel (different concerns). 13.6 must follow 13.2–13.5; 13.10 must follow 13.3–13.5.

---

## 7. Cross-References

| Doc | Relationship |
|---|---|
| `project-specs/AUTHZ_MATRIX.md` | Drives §2a audit (every cell tested); §3 closes Gaps B-1, B-2, B-3 from §8. Updates §7e (B-3 destination), §7g (B-2 new endpoint). Gap B-4 (admin_review UI) explicitly out of scope. |
| `features/extension/12-observability.md` | This doc imports `report_and_safe_message`, `set_user_context`, `RequestContextMiddleware`. `AppError` defined here uses `sentry_sdk.capture_exception` directly inside a Sentry scope to attach the `error_code` tag. |
| `features/extension/14-api-contract-tests.md` | Asserts every cell in matrix §7 against the migrated routes. Specifically asserts that `code` in the envelope matches the expected `ErrorCode` and `message` is from the §4 catalog. |
| `features/extension/15-playwright-ui-tests.md` | Asserts that visible toasts render `parseApiError(err).message` from the §4 catalog (allow-list), not raw exception text. Verifies B-1 redirect and B-2 absence-from-portfolio in browser. |
| `features/extension/16-home-vs-markets-split.md` / `17-market-creation-validation.md` | Land in parallel; touching different files. The validation doc adds new `VALIDATION_FAILED` cases that this doc's envelope/handler already supports. |
| `features/extension/11-redis-websockets.md` | Reserves `ErrorCode.RATE_LIMITED` for use by feature 11's rate-limit middleware. No work in feature 13 to wire up. |
| Future doc (e.g., `features/19-admin-resolution-ui.md`) | Will close Gap B-4 by adding `/admin/admin-review` page + dashboard card. Calls the relocated `POST /api/admin/markets/{id}/resolve` route from PR-13.9. |
