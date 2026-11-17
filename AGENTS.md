# Agents / new contributors, start here

- **Development documentation:** [docs/](docs/README.md) (AUTHZ_MATRIX, DATA_MODEL, MARKET_LIFECYCLE, MIGRATIONS, PROJECT_SPECS, OBSERVABILITY).
- **Design plans and work queue:** [GitHub Issues](https://github.com/tedgershon/Pheme/issues), filtered by label.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for the issue lifecycle. Keep feature
  plans in remote issues and durable contracts in `docs/`. Prefix major
  architecture proposals with `[EXTENSION]`.

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
5. Commit subjects, the PR title and description, and the squash-merge message
   follow [CONTRIBUTING.md section 7](CONTRIBUTING.md#7-commit-pr-and-squash-merge-format).
   Start from [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md);
   section 7 has the rules and a worked example. You do not need to look up
   past PRs.

## Rules

See CONTRIBUTING.md section 4. The short version: resolution always goes
through the dual-track path, balance changes always go through the
transactional engine, and the virtual currency is never purchasable or
cashable, in code or in copy.
