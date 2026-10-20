# Pheme Feature Implementation — Master Instructions

## Overview

This document orchestrates the implementation of **10 new feature areas** for Pheme. Each feature has its own detailed instruction file in this `features/course/` directory (numbered `01`–`10`). Features are organized into **four implementation phases** based on dependencies.

> **Status (post-reorg):** features 01–10 have shipped. This document is preserved as a historical artifact of the course-era workflow; the canonical product behavior lives in `project-specs/`, and ongoing work uses the `issues/`-driven flow described in `issues/README.md`. Anything below describing *future* implementation work is no longer active.

**Note:** `features/extension/11-redis-websockets.md` is **not** part of the 01–10 phased plan below; treat it as a separate initiative unless you explicitly scope it in. (Originally sat in this folder; moved to `features/extension/` during the course/extension reorganization.)

Subagents implementing a later phase **must wait** for all earlier phases to be merged and tested before beginning work. Within a phase, features marked as **parallelizable** have **no dependencies on each other** (so the team *could* split them across people or branches). If you use the **`LLM-instructions.md` orchestrator**, follow that doc instead: **one feature at a time, no parallel feature work** — subagents are still encouraged for delegation within a feature.

---

## Implementation Phases

### Phase 1 — Foundation (no dependencies, parallelizable)

| File | Feature | Scope |
|------|---------|-------|
| `01-admin-system.md` | Admin & Super Admin Roles | DB schema, backend RBAC, admin UI pages, super admin tools |
| `05-coin-claiming.md` | Coin Claiming Rules Update | Backend logic change, frontend text update |
| `06-user-profile.md` | User Profile Dropdown | Frontend-only: profile avatar, dropdown menu |

**Notes for subagents:** These three features have zero cross-dependencies. Human teams may implement them in parallel on separate branches. **`LLM-instructions.md` orchestrator:** one feature at a time (subagents still used inside each feature), in table order (`01` → `05` → `06`). None depends on any other feature in this batch.

---

### Phase 2 — Core Workflow Changes (depends on Phase 1)

| File | Feature | Depends On |
|------|---------|------------|
| `02-market-creation-review.md` | Market Creation & Admin Review | `01-admin-system` |
| `04-market-resolution.md` | Automated Resolution & Community Voting | `01-admin-system` |
| `10-safety-logic.md` | Safety Constraints & Admin Backroll | `01-admin-system` |

**Notes for subagents:**
- All three depend on `01-admin-system` being complete (admin role checks, admin review page infrastructure).
- `02` and `04` can be parallelized with each other since they touch different parts of the market lifecycle (creation vs. close/resolution).
- `10` should be started after `02` and `04` are at least schema-complete, since safety logic validates constraints introduced by those features.
- **`LLM-instructions.md` orchestrator:** implement **one at a time** in table order (`02` → `04` → `10`); that satisfies the dependency on `02`/`04` before `10`.

---

### Phase 3 — Extended Features (depends on Phase 2)

| File | Feature | Depends On |
|------|---------|------------|
| `03-multichoice-markets.md` | Non-Binary Market Options | `02-market-creation-review` |
| `07-notifications.md` | In-App & Email Notifications | `02-market-creation-review`, `01-admin-system` |

**Notes for subagents:**
- `03` extends the market creation form and display from `02`. It adds new DB tables and significantly changes the betting/pool model for multichoice markets.
- `07` triggers notifications based on admin approval events from `02`. It also requires the user profile dropdown from `06` to display the notification indicator.
- These two can be parallelized with each other.
- **`LLM-instructions.md` orchestrator:** implement **one at a time** in table order (`03` → `07`).

---

### Phase 4 — Polish & Display (depends on Phases 2–3)

| File | Feature | Depends On |
|------|---------|------------|
| `08-main-page.md` | Homepage: Hottest Market, Trending, Top, Leaderboard | `02-market-creation-review`, `04-market-resolution` |
| `09-claimable-rewards.md` | Badges & Reward Tracks | `01-admin-system`, `04-market-resolution` |

**Notes for subagents:**
- `08` rebuilds the homepage with new sections. It reads from market and leaderboard data but doesn't change core business logic.
- `09` adds a gamification layer. It needs user activity data (bets, markets created, coins earned) that must be tracked by the time this is implemented.
- These two can be parallelized with each other.
- **`LLM-instructions.md` orchestrator:** implement **one at a time** in table order (`08` → `09`).

---

## Dependency Graph

```
Phase 1 (parallel):
  01-admin-system ─────┬──────────────────────────────────────┐
  05-coin-claiming     │                                      │
  06-user-profile ─────│──────────────────────┐               │
                       │                      │               │
Phase 2 (parallel):    ▼                      │               │
  02-market-creation ──┬──────────┐           │               │
  04-market-resolution─┤          │           │               │
  10-safety-logic ─────┘          │           │               │
                                  │           │               │
Phase 3 (parallel):               ▼           ▼               │
  03-multichoice-markets          07-notifications            │
                                                              │
Phase 4 (parallel):                                           ▼
  08-main-page                    09-claimable-rewards
```

---

## Subagent Management Guidelines

### Before Starting Work

1. **Read the feature file thoroughly** — each file contains full context: what to build, which files to touch, exact schema changes, API contracts, and frontend component specs.
2. **Check phase dependencies** — do not begin a Phase N feature until all Phase N-1 features have been merged and pass tests.
3. **Read the current migration numbering** — migrations are in `backend/supabase/migrations/`. The latest is `020_fix_claim_race_condition.sql`. New migrations should start at `021` and increment sequentially. If multiple features create migrations in parallel, coordinate numbering at merge time.

### During Implementation

4. **Follow existing patterns** — the codebase uses FastAPI + Supabase (Python backend), Next.js App Router + shadcn (TypeScript frontend). Match existing code style exactly.
5. **Run linting** — backend uses standard Python formatting; frontend uses Biome (`pnpm lint` / `pnpm format`).
6. **Test the happy path** — verify each feature works end-to-end before marking complete.
7. **Do not modify unrelated code** — keep changes scoped to the feature being implemented.

### After Implementation

8. **Update the feature file** — mark any implementation notes, deviations, or follow-up tasks at the bottom of the feature file.
9. **Update `project-specs/`** — if your feature changes the data model, API surface, or market lifecycle, update the corresponding spec files.

### Commits and pull requests (orchestrator / LLM runs)

For automated or LLM-assisted implementation, use `LLM-instructions.md` as the source of truth. In short: **one PR per feature (01–10)**; **many small commits** inside each feature; **subagents encouraged** but **no parallelizing different features**; the agent should **prompt the user periodically** with files to stage and a concise commit message, and **wait between features** so the user can open a PR. Do **not** implement `features/extension/11-redis-websockets.md` as part of the 01–10 batch.

---

## Migration Numbering Plan

To avoid conflicts when features are implemented in parallel, reserve these migration number ranges:

| Feature | Migration Range | Description |
|---------|----------------|-------------|
| 01 Admin System | 021–024 | Role enum, super admin seed, admin RLS policies |
| 02 Market Creation & Review | 025–028 | Market approval status, review columns, linting |
| 03 Multichoice Markets | 029–033 | Market type, options table, option pools, multichoice bet fn |
| 04 Market Resolution | 034–037 | Community voting, voter rewards, auto-finalize |
| 05 Coin Claiming | 038–039 | Updated claim function with 5000 cap |
| 06 User Profile | — | No schema changes (initials-only avatar) |
| 07 Notifications | 041–043 | Notifications table, Resend integration |
| 08 Main Page | — | No schema changes (read-only queries) |
| 09 Claimable Rewards | 044–046 | Badge definitions, user badges, achievement tracking |
| 10 Safety Logic | 047–049 | Constraints, backroll function, RLS updates |

**Important:** These ranges are reserved but not all slots may be used. Subagents should use the minimum number of migrations needed and leave gaps for future use.

---

## New Database Migrations Summary

See `project-specs/MIGRATIONS.md` for the full list of new migrations with complete SQL specifications that must be run manually in the Supabase SQL editor.

---

## Quick Reference: Files Affected by Each Feature

| Feature | Backend Files | Frontend Files | New Routes |
|---------|--------------|----------------|------------|
| 01 Admin | `routers/admin.py`, `schemas/admin.py`, `dependencies.py` | `app/admin/`, `components/role-toggle.tsx` | `/admin`, `/admin/review`, `/admin/stats`, `/admin/users` |
| 02 Market Creation | `routers/markets.py`, `schemas/market.py` | `app/markets/create/page.tsx` | — (existing route enhanced) |
| 03 Multichoice | `routers/markets.py`, `routers/bets.py`, `schemas/market.py`, `schemas/bet.py` | `app/markets/[id]/page.tsx`, `components/probability-chart.tsx` | — |
| 04 Resolution | `routers/markets.py`, `routers/resolution.py` | `app/resolutions/page.tsx`, `app/markets/[id]/page.tsx` | `/resolutions` |
| 05 Coin Claiming | `routers/auth.py` | `app/portfolio/page.tsx`, `components/daily-claim-banner.tsx` | — |
| 06 User Profile | — | `components/navbar.tsx`, `components/user-menu.tsx` | — |
| 07 Notifications | `routers/notifications.py`, `schemas/notification.py` | `app/notifications/page.tsx`, `components/user-menu.tsx` | `/notifications`, `POST /api/notifications/read` |
| 08 Main Page | `routers/markets.py`, `routers/leaderboard.py` | `app/page.tsx`, new homepage components | — (existing route rebuilt) |
| 09 Rewards | `routers/rewards.py`, `schemas/reward.py` | `app/rewards/page.tsx`, `components/badge.tsx` | `/rewards`, `GET /api/rewards` |
| 10 Safety | `routers/markets.py`, `routers/bets.py`, `routers/admin.py` | — (backend enforcement) | `POST /api/admin/markets/{id}/backroll` |
