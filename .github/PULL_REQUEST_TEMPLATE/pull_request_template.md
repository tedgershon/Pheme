<!-- Format rules and a filled-in example: CONTRIBUTING.md section 7.
     Delete these comments before submitting. -->

## What

<!-- 1-3 short paragraphs of plain prose: the behavior change; key routes, files
     and migrations in backticks; any fix found along the way. Name any policy
     choices the reviewer should confirm. -->

## Why

<!-- Closes #<issue>. Name the roadmap step in #40 if there is one (e.g.
     "Implements phase 3 step 2 (13.5) of #40") and give the reason briefly.
     Note that the roadmap checkbox stays unchecked until merge. -->

## Verification

<!-- One bullet per check: the command, then the result with counts, e.g.
     "`pytest -q` from `backend/`: 261 passed". Include the disposable database
     harness when SQL changed, `git diff --check` and GitHub CI status. Say
     explicitly what was NOT verified (manual, browser, hosted). -->

## Deployment and manual check

<!-- Delete this section unless an operator action is needed. Give the
     migration/deploy order, the linked-project dry run and a short smoke test,
     linking to the docs/ section instead of repeating it. -->

## Checklist

<!-- Check honestly; add a short parenthetical where a check is partial. -->

- [ ] CI is green
- [ ] Tested locally (backend and/or frontend, as relevant)
- [ ] No secrets or `.env` values committed
- [ ] Docs updated if behavior changed (`README.md`, `docs/`)
