# Agents / new contributors, start here

- **Product contract:** `project-specs/` (AUTHZ_MATRIX, DATA_MODEL, MIGRATIONS, PROJECT_SPECS).
- **Active design docs:** `features/`.
- **Work queue:** [GitHub Issues](../../issues), filtered by label, not an
  in-repo file. Previously, work was tracked in `issues/`; that format is
  retired, see `CONTRIBUTING.md` for the current lifecycle.

## Picking a task (agents)

```
gh issue list --state open --label ready --label backend   # or --label frontend
gh issue view <n>                                            # read the body for acceptance criteria
```

A `blocked` label means the issue names another open issue it depends on in
its body; skip those until the blocker closes. Issues with no overlapping
label set (e.g. one `backend`-only and one `frontend`-only) can run in
parallel; anything both touch should not run concurrently.

## Workflow

1. Comment on the issue to claim it, assign yourself, move to `in-progress`.
2. Branch off `origin/main`: `<area>/<slug>` (see CONTRIBUTING.md for prefixes).
3. Commit in 2 to 4 logical steps, each leaving the codebase in a valid state.
4. Open a PR referencing the issue (`Closes #<n>`); use the PR template's
   checklist. CI must be green; one review required before squash-merge.

## Rules

See CONTRIBUTING.md section 4. The short version: resolution always goes
through the dual-track path, balance changes always go through the
transactional engine, and the virtual currency is never purchasable or
cashable, in code or in copy.