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

`pytest` includes the matrix-driven endpoint tests: every cell of
[AUTHZ_MATRIX.md](docs/AUTHZ_MATRIX.md) section 7 is a test in
`backend/tests/_matrix_cells.py`, and `test_route_coverage.py` fails when a
mounted `/api` route has no cell. Add the matrix row and the cell together when
you add or change a route. CI uploads the JUnit report (`backend-pytest-report`)
so a failing cell is named by method, path and role. These tests use an
in-memory database that emulates stored-function preconditions; SQL behavior
stays in the disposable-database suite above.

Optional schema fuzzing and Playwright coverage are planned in
[#13](https://github.com/tedgershon/Pheme/issues/13) and the
[browser testing issues](https://github.com/tedgershon/Pheme/issues/14); they are
not in CI yet.

## 7. Commit, PR and squash-merge format

Everything needed is in this section and the
[PR template](.github/PULL_REQUEST_TEMPLATE.md); you do not need to look up
past PRs.

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

**PR description.** Start from the
[PR template](.github/PULL_REQUEST_TEMPLATE.md). GitHub pre-fills it in the web
UI. With `gh pr create`, copy it into a body file, fill in each section, delete
the guidance comments and pass `--body-file`. Sections, in order: What, Why,
Verification, Deployment and manual check (only when an operator action is
needed), and Checklist. Write plain factual prose with exact commands and test
counts. Add another section only for reference material, such as an audited
route inventory table. Do not add emoji, summary banners or generated-by
footers.

Filled-in example (PR #56). Its title was
`Move admin resolution route under admin API (13.9)`:

````markdown
## What

Move admin market resolution from `POST /api/markets/admin/{id}/resolve` to `POST /api/admin/markets/{id}/resolve`. Use `require_admin` and safe `AppError` responses while preserving the transactional `admin_resolve_market` RPC. Update route tests and the authorization matrix.

## Why

Closes #10. The old handler checked a legacy `is_admin` field and lived in the markets router. The moved route uses the shared role dependency and is ready for the future admin review queue.

## Verification

- `python -m pytest -q` from `backend/`: 261 passed.
- `python -m ruff check .` from `backend/`: passed.
- `git diff --check`: passed.
- `rg "/api/markets/admin/" frontend/src`: no matches.
- GitHub CI: database, backend, and frontend jobs passed.

The current schema and SQL accept YES/NO outcomes. Ambiguous outcome and refund support remain in #31.

## Checklist

- [x] CI is green
- [x] Tested locally (backend and/or frontend, as relevant)
- [x] No secrets or `.env` values committed
- [x] Docs updated if behavior changed (`README.md`, `docs/`)
````

It has no Deployment section because no operator action was needed.

**Squash merge.** Use the PR title plus ` (#<pr>)` as the subject. The extended
description is one `* <commit subject>` bullet per branch commit, in order,
separated by blank lines. For the example above:

```text
Move admin resolution route under admin API (13.9) (#56)

* Move admin resolution to guarded admin route

* Document relocated admin resolution authorization
```

GitHub's default squash text includes full commit bodies and trailers. Trim it
to the subject bullets before merging.

When the template's sections change, update the example above in the same PR.
