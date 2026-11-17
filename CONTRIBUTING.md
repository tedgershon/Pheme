# Contributing to Pheme

Work is tracked in [GitHub Issues](https://github.com/tedgershon/Pheme/issues).
Keep durable behavior and operational documentation in [docs/](docs/README.md).
Feature proposals, implementation plans and acceptance criteria belong in issues.

## 1. Workflow

1. Pick an open issue or create one for nontrivial work. Comment to claim it,
   assign yourself and apply `in-progress`.
2. Branch from `origin/main` with a prefix from the table below.
3. Commit in 2 to 4 logical steps, each leaving the codebase valid.
4. Push the branch and open a PR to `main`, using the PR template and
   `Closes #<number>` for the issue being completed.
5. Wait for green CI and one review before squash-merging.

## 2. Branch naming

| Prefix | Area | Example |
| --- | --- | --- |
| `backend/` | API, betting engine, resolution, auth | `backend/settlement` |
| `frontend/` | Pages, components, client state | `frontend/market-card` |
| `infra/` | CI, migrations, deployment | `infra/migration-bootstrap` |
| `docs/` | Development documentation | `docs/resolution-flow` |
| `fix/` | Bug fixes | `fix/claim-validation` |
| `chore/` | Dependencies and tooling | `chore/update-dependencies` |

## 3. Issue lifecycle

Use area labels (`backend`, `frontend`, `infra`, `documentation`) and status
labels (`ready`, `blocked`, `in-progress`). A blocked issue must link its open
prerequisites by GitHub issue number. Remove `blocked` when those prerequisites
are complete. Optional proposals need not be labeled `ready`.

Prefix major architecture proposals with `[EXTENSION]`. Check existing issues
before adding a proposal; add missing design detail to the existing issue when
it already covers the work. Keep issue references current when docs move.

## 4. Rules (enforced in review)

1. Preserve the dual-track resolution process: creator proposals with a dispute
   window, or community voting, with admin adjudication for escalated markets.
   Do not bypass it with direct edits to settled outcomes.
2. Balance changes and their ledger entries belong in the transactional database
   engine. Do not add ad hoc application writes to balances.
3. Keep client state consistent through existing query keys and invalidators.
   Redis/WebSocket delivery is proposed in [#30](https://github.com/tedgershon/Pheme/issues/30)
   and is not a current dependency.
4. Virtual currency is never purchasable, saleable or cashable, in code or copy.
5. Update [AUTHZ_MATRIX.md](docs/AUTHZ_MATRIX.md) when routes or permissions change.
   UI visibility does not replace server authorization. Treat the matrix as the
   intended policy; its linked issues identify known implementation gaps.

## 5. Local checks

From `backend/` with the virtual environment active:

```sh
pip install ruff==0.17.1 pytest==9.1.1
ruff check .
pytest
```

From `frontend/`:

```sh
pnpm lint
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

Use `pnpm format` for frontend formatting (Biome). For documentation-only
changes, verify links, source claims and `git diff --check`; no runtime test
additions are needed.

For database migration changes, install the root lockfile with `npm ci`, start
Docker, and run `python scripts/db/test_migrations.py` from the repository root.
See [MIGRATIONS.md](docs/MIGRATIONS.md) for the disposable project and cleanup.

## 6. CI

[ci.yml](.github/workflows/ci.yml) runs backend Ruff and pytest, plus frontend
Biome, TypeScript, Vitest and the Next.js build on PRs and pushes to `main`.
It also runs fresh-database and legacy-upgrade checks in disposable Supabase.
Keep `backend/requirements.txt` and `frontend/pnpm-lock.yaml` consistent with
dependency changes. Backend requirements are installed directly; frontend CI
uses `pnpm install --frozen-lockfile`.

Matrix-driven API coverage, optional schema fuzzing and Playwright coverage are
planned in [API testing issues](https://github.com/tedgershon/Pheme/issues/11)
and [browser testing issues](https://github.com/tedgershon/Pheme/issues/14);
they are not all present in CI yet.

## 7. Commit, PR and squash-merge format

Follow merged PRs #51–#56 as examples.

**Branch commits.** Write each message as a single imperative subject line in
sentence case, with no trailing period, for example
`Move admin resolution to guarded admin route`. A `fix:` or `docs:` prefix is
optional. Put details in the PR description, not in commit bodies: these
subjects become the squash body.

**PR title.** Write an imperative summary of the whole change. If the issue
title starts with a legacy feature number (`13.9-gap-b3-...`), append it in
parentheses: `Move admin resolution route under admin API (13.9)`. Otherwise
add no suffix. Do not put the issue number in the title; GitHub appends the PR
number on merge.

**PR description.** Use these sections in this order, in plain factual prose:

1. `## What`: one to three short paragraphs covering the behavior change, key
   routes, files and migrations (in backticks), and any fix found along the way.
   Name policy choices a reviewer should confirm.
2. `## Why`: start with `Closes #<n>.`, then name the roadmap step
   (for example "Implements phase 3 step 2 (13.5) of #40") and give the reason
   briefly. Say that the roadmap checkbox stays unchecked until merge.
3. `## Verification`: one bullet per check, giving the command and result with
   counts (for example "`pytest -q` from `backend/`: 261 passed"). Include the
   disposable database harness when SQL changed, `git diff --check` and
   GitHub CI status. State explicitly what was **not** verified, such as
   manual, browser or hosted checks.
4. `## Deployment and manual check` (only when an operator action is needed):
   migration/deploy order, linked-project dry run, then a short smoke test.
   Link to the relevant `docs/` section instead of repeating it.
5. `## Checklist`: the template's four items, checked honestly. Add a short
   parenthetical where a check is partial.

Add another section only for reference material, such as an audited route
inventory table. Do not add emoji, summary banners or generated-by footers.

**Squash merge.** Use the PR title plus ` (#<pr>)` as the subject. The extended
description is one `* <commit subject>` bullet per branch commit, in order,
separated by blank lines:

```text
Move admin resolution route under admin API (13.9) (#56)

* Move admin resolution to guarded admin route

* Document relocated admin resolution authorization
```

GitHub's default squash text includes full commit bodies and trailers. Trim it
to the subject bullets before merging.
