# Contributing to Hunch

Thanks for contributing! Work is tracked entirely in [GitHub Issues](../../issues),
which replaced the old in-repo `issues/` markdown format from BananaGains. This
guide covers the workflow, branch naming, and the rules enforced in review.

## 1. Workflow

1. Pick an open issue (see "Picking up an issue" below), or open one first for
   anything nontrivial.
2. Create a **type-prefixed** branch off `main` (see below).
3. Push it: `git push -u origin <branch>`.
4. Open a **PR to `main`**. Fill in the PR template and reference the issue
   (`Closes #12`).
5. CI must be green and you need **one review** before merge. Squash-merge.

## 2. Branch naming

The prefix maps to the area you're touching, so branches are self-describing
and reviews route by area.

| Prefix            | Use for                               | Example                     |
| ------------------ | -------------------------------------- | ---------------------------- |
| `backend/<slug>`   | betting engine, resolution, auth, API | `backend/parimutuel-payout`  |
| `frontend/<slug>`  | UI, pages, client state               | `frontend/market-card`       |
| `infra/<slug>`     | CI, migrations, deploy                | `infra/add-staging-env`      |
| `docs/<slug>`      | README, specs, architecture           | `docs/resolution-flow`       |
| `fix/<slug>`       | bug fixes                             | `fix/websocket-reconnect`    |
| `chore/<slug>`     | dependencies, tooling                 | `chore/bump-nextjs`          |

Keep branches short-lived and one-contribution-each.

## 3. Picking up an issue

Issues are labeled by area (`backend`, `frontend`, `infra`) and status
(`ready`, `blocked`, `in-progress`). `blocked` means it depends on another
open issue, noted in the issue body.

1. Comment to claim it and assign yourself.
2. Move it to `in-progress` (label, or the Project board column).
3. Reference it in your PR (`Closes #<n>`); merging the PR closes it.

## 4. Rules (enforced in review)

1. Markets resolve only through the dual-track path (creator call, then
   community vote on dispute). No direct admin edits to a resolved outcome.
2. All balance changes go through the transactional engine. No ad hoc writes
   to a user's balance from elsewhere in the codebase.
3. Real-time updates (odds, resolution) publish over the existing Redis
   pub/sub channel, not a new one, so the frontend has one source of truth.
4. The virtual currency is never exposed through a purchase, sale, or
   cash-out path, in code or in copy. This is a compliance rule, not a style
   preference.

## 5. Local commands

**Backend** (from `backend/`): `pytest` (test) · `ruff check .` (lint)

**Frontend** (from `frontend/`): `pnpm lint` · `pnpm exec tsc --noEmit` · `pnpm build`

## 6. CI

Every PR runs `.github/workflows/ci.yml`: lint, type-check, and test for both
the backend and frontend. Keep `requirements.txt` and `pnpm-lock.yaml` in
sync with any dependency changes, since CI installs from the lockfiles.
