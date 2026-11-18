# Market lifecycle

How a market moves through its statuses, and where each status appears in the
admin panel. Source of truth: `backend/services/market_state_machine.py` (timed
transitions) and the resolution functions in `supabase/migrations/`.

Timed transitions are lazy. They run when a market is read through the API,
not on a schedule, so a market can sit past a deadline until someone loads it.

## Decision tree

```mermaid
flowchart TD
    A([Creator submits market]) --> PR[pending_review]
    PR -->|Admin approves| O[open]
    PR -->|Admin denies| D([denied])
    PR -->|close_at passes before review| D

    O -->|close_at passes, or admin backroll closes it| C[closed]

    C -->|Creator proposes YES/NO| PP["pending_resolution<br/>(proposal, 24h dispute window)"]
    C -->|Creator starts community resolution| PC["pending_resolution<br/>(no proposal, 24h community vote)"]
    C -.->|Creator does nothing| C

    PP -->|Window ends with no concern filed| R([resolved: proposed outcome])
    PP -->|A non-creator files the first concern| DS["disputed<br/>(48h neutral vote; more concerns may join)"]

    DS -->|Voting ends: 3+ votes and no tie| R2([resolved: vote winner])
    DS -->|Voting ends: under 3 votes or a tie| AR["admin_review<br/>(shown in Resolve Markets)"]

    PC -->|Window ends: 3+ votes and no tie| R3([resolved: vote winner])
    PC -->|Window ends: under 3 votes or a tie| AR

    AR -->|Admin decides YES / NO| R4([resolved: payout])
    AR -->|Admin decides AMBIGUOUS| R5([resolved: every bet refunded])
```

A closed market whose creator never acts stays `closed`. The state machine
has no timeout for it; admins can only send reminders
(`POST /api/admin/markets/resolution-reminders/run`).

## Where each status appears for admins

Admin dashboard panels, in the order a market reaches them:

- **Approve New Markets** (`/admin/review`)
- **Monitor Disputes** (`/admin/disputes`), which is view-only
- **Resolve Markets** (`/admin/resolve`)
- **Platform Statistics** (`/admin/stats`)
- **Manage User Roles** (`/admin/users`), for super admins only

| Status | Admin panel location | Admin action available |
| --- | --- | --- |
| `pending_review` | Approve New Markets, **Pending Approval** | Approve, edit or deny |
| `denied` | Approve New Markets, **Denied** (latest 50) | None |
| `open` | Approve New Markets, **Approved** (badge: Open) | Backroll panel on the market page |
| `closed` | Approve New Markets, **Approved** (badge: Closed) | Backroll panel on the market page; resolution reminders |
| `pending_resolution` | Approve New Markets, **Approved** (badge: Pending Resolution) | Backroll panel on the market page |
| `disputed` | Monitor Disputes, **Voting**; **Approved** (badge: Disputed) | Read concerns and tallies; vote like any neutral user; backroll |
| `admin_review` (from a dispute) | Resolve Markets (decide here); Monitor Disputes, **Pending Admin**; **Approved** (badge: Pending Admin) | Resolve YES, NO or AMBIGUOUS |
| `admin_review` (from community resolution) | Resolve Markets (no dispute case, so not in Monitor Disputes); **Approved** (badge: Pending Admin) | Resolve YES, NO or AMBIGUOUS |
| `resolved` | Approve New Markets, **Approved** (badge: Resolved) | None (backroll refuses resolved markets) |

Platform Statistics counts markets in every status.

Notes:

- **Approved list:** this is the approval history, holding the latest 50 approved
  markets whatever has happened since. A badge shows each market's current
  status.
- **Status name:** the database status `admin_review` was kept when its page was
  renamed to Resolve Markets.
- **Backroll:** available to admins on the market page for any status except
  `resolved`. It refunds bets placed after a cutoff and, by default, moves the
  market to `closed` with the cutoff as its close time.
- **Dispute voting:** the creator and anyone who bet on the market, including
  refunded bettors, cannot vote. Anyone except the creator can file one
  concern. See [AUTHZ_MATRIX.md](AUTHZ_MATRIX.md).
