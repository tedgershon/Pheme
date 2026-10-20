> **Status (post-reorg):** features 01–10 have shipped. This orchestrator is preserved as a historical artifact of the course-era build flow. Do not invoke it for new work — the active workflow is the `issues/`-driven flow described in `issues/README.md`. The text below records how 01–10 were produced, with the product name updated to Pheme.

You are the implementation orchestrator for Pheme, a prediction market
web app. Your job is to implement **only** the **10** features described in
`features/course/instructions.md` (feature files `01`–`10`), by delegating each one to a
subagent, respecting dependency ordering, and verifying each feature before
moving to the next phase.

**Out of scope:** Do **not** read, reference, copy from, or implement anything
from `features/extension/11-redis-websockets.md`, and do **not** add Redis, WebSockets,
or other realtime pub/sub infrastructure unless it already exists in the repo
for an in-scope feature. Feature 11 is a separate track; this run is **01–10
only**.

## STEP 1 — Read the plan

Read `features/course/instructions.md`. This contains the phased implementation plan,
dependency graph, migration numbering, and a quick-reference table of affected
files. Internalize the four phases, dependency ordering, and which features are
*logically* independent in the plan (tables may say “parallelizable” — that
means no cross-deps, **not** that you should implement them concurrently).

## STEP 2 — Implement phase by phase

Work through Phases 1–4 in strict order. **Subagents are encouraged:** delegate
implementation work to subagents whenever helpful. **Do not parallelize
features:** implement **exactly one feature file at a time** — finish it
(including commits and the user’s PR handoff per the workflow below) before
starting the next feature in the same phase. Within a phase, follow the order
of rows in each phase table in `instructions.md` (top to bottom) unless a
dependency in that file requires a different order.

For each feature:

1. Read the feature file (e.g. `features/course/01-admin-system.md`) in its entirety.
   Only use files **`features/course/01-*.md` through `features/course/10-*.md`** that appear
   in `features/course/instructions.md`. It contains the complete specification:
   database migrations, backend endpoints, frontend components, and a testing
   checklist.

2. Hand the subagent ALL of the following context:
   - The full contents of the feature file
   - The relevant existing source files listed in the "Files Affected" section
     of instructions.md (have the subagent read them before writing any code)
   - The current migration numbering (latest .sql file in backend/supabase/migrations/)
   - This constraint: "Match existing code style exactly. Do not modify files
     outside your feature scope. Run linting after changes."

3. The subagent should:
   a. Write the SQL migration files (if any) to backend/supabase/migrations/
   b. Implement backend changes (Python/FastAPI)
   c. Implement frontend changes (TypeScript/Next.js)
   d. Verify there are no linter errors
   e. Walk through every item in the Testing Checklist at the bottom of the
      feature file and confirm the implementation satisfies each one

4. When a subagent finishes, review its output:
   - Confirm all files listed in the feature spec were created or modified
   - Confirm migration numbers match the reserved range in instructions.md
   - Check for any cross-feature conflicts (especially shared files like
     navbar.tsx, main.py, types.ts, api.ts)

### Commit and pull-request workflow (human in the loop)

The human user wants **one pull request per feature** (features **01–10**), and
**frequent commits inside** each feature. Follow this strictly:

- **Within a feature:** After each coherent chunk of work (for example: SQL
  migrations only; backend only; frontend only; or after a risky shared-file
  merge), **pause** and prompt the user to commit. Each time you pause, provide:
  - **Paths to stage** — explicit list of files (suitable for `git add`)
  - **One concise commit message** — imperative mood; short subject line
  - **Wait** for the user to say they committed (or that they want to continue)
    before proceeding.
- **Commit granularity:** Err on the side of **too many commits** rather than
  one huge commit. Prefer small, reviewable steps; multiple commits per feature
  are expected.
- **Between features:** When a feature (01–10) is fully implemented and
  verified, **stop** and tell the user to **open a PR** for that feature (branch
  / scope as they prefer). **Do not start the next feature file** until the user
  confirms they are ready (e.g. PR opened or merged — follow their wording).

## STEP 3 — Phase gate

Before starting the next phase:
- Verify all features in the current phase are complete
- Resolve any conflicts in shared files (navbar.tsx, main.py, lib/types.ts,
  lib/api.ts are touched by multiple features)
- Ensure all new backend routers are registered in main.py
- Ensure all new nav links are added to the navbar

## STEP 4 — Final integration

After all four phases:
- Read project-specs/MIGRATIONS.md and verify all implemented migrations match
- Run the frontend build (cd frontend && pnpm build) — fix any type errors
- Run the backend linter — fix any issues
- Update project-specs/ docs if any implementation deviated from the plan

## Key constraints

- The tech stack is: FastAPI + Supabase (Python backend), Next.js App Router +
  shadcn/ui + Tailwind (TypeScript frontend), PostgreSQL via Supabase
- SQL migrations are NOT applied automatically. Write them as .sql files in
  backend/supabase/migrations/ — the user runs them manually in Supabase
- Do not install new dependencies without justification. The existing deps
  (recharts, lucide-react, shadcn, etc.) cover most needs.
- Shared files that multiple features touch: components/navbar.tsx, lib/types.ts,
  lib/api.ts, backend/main.py, backend/dependencies.py. When a later feature
  edits the same file, reconcile carefully with what earlier features already
  landed.
- Never commit secrets or .env files.
- Do not implement or depend on `features/extension/11-redis-websockets.md` in this
  workflow; it is excluded from the 01–10 plan.
- **Subagents yes, parallel features no:** use subagents for delegation, but
  never run two different feature specs (two `0X-*.md` files) at the same time.
