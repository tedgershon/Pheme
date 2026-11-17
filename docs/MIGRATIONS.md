# Database migrations

The only executable chain is [supabase/migrations/](../supabase/migrations/).
Supabase records timestamp versions in `supabase_migrations.schema_migrations`.
Files in [backend/supabase/migrations/](../backend/supabase/migrations/) are
archived history and test fixtures. Do not sort or replay them.

| Version | Purpose |
| --- | --- |
| `20261114000000` | Fresh-only baseline from the consolidated snapshot at `c20e0e5`, including avatars, equipped badges, aggregation RPCs and badge RLS. Removes the account-specific super-admin assignment. |
| `20261114000100` | Forward repair: final notification constraints, ownership policies and RPCs; net-worth leaderboard; expired-open proposal handling; nullable `bets.side` for option bets. Supports installations with some or all later patches already applied. |
| `20261115000000` | Operator-only exact-email signup exceptions; no users or roles are seeded. Applies domain enforcement to email changes as well as signup. |
| `20261116000400` | Private pending-review/denied market reads limited to creator/admin; option labels inherit parent visibility. No data or wallet mutations. |

Never edit an applied version. Add a new timestamped file for future changes.
The baseline contains initial `CREATE TABLE` statements and must **never** be
replayed on an existing application database.

## Fresh local bootstrap

Install Docker and Node.js, then from the repository root:

```sh
npm ci
npx --no-install supabase start
npx --no-install supabase db reset --local
npx --no-install supabase migration list --local
```

Use the CLI pinned by `package-lock.json` (2.84.5). Avoid unpinned CLI downloads:
CLI 3 has incompatible configuration keys. Allow the Supabase package's
postinstall to install its binary. `db reset --local` destroys data in that
local project; use it only for disposable development databases. No seed file
is required; badge definitions are installed by the baseline. No account is
automatically promoted.

For an empty hosted Supabase project, use the same chain with the normal
linked-project `supabase db push` workflow after reviewing its dry run.
Hosted deployment remains an operator action; the verification below uses
local Supabase, not a production project.

## Existing deployment: adopt, then upgrade

1. Back up the database and restore it to a disposable Supabase project.
   Stop application writers while adopting and upgrading. Record current
   migration history and inspect the intended target before running commands.
2. Run [adopt_legacy.sql](../scripts/db/adopt_legacy.sql) as the database owner,
   using `psql` connection environment variables (`PGHOST`, `PGPORT`,
   `PGDATABASE`, `PGUSER`, and `PGPASSWORD` or a password file):

   ```sh
   psql -X -v ON_ERROR_STOP=1 -f scripts/db/adopt_legacy.sql
   ```

   The script compares columns, types, defaults, nullability, constraints,
   indexes, RLS, policies, triggers and function definitions with the frozen
   consolidated baseline. It also checks the avatar bucket and badge catalog.
   Only known differences repaired by the next migration are excluded. It
   records `20261114000000` in a transaction **only after** the checks pass;
   it does not recreate tables or change application data. Repeating it is safe.
3. On the disposable local copy, apply forward migrations and inspect history:

   ```sh
   npx --no-install supabase migration up --local
   npx --no-install supabase migration list --local
   ```

   For a hosted target, configure the corresponding linked project, inspect
   `supabase db push --dry-run`, then use `supabase db push`. It must list only
   forward migrations, never the baseline. Preserve pre-existing migration
   history; do not delete or indiscriminately repair versions to bypass errors.
4. Verify application behavior and data preservation on the restored copy.
   Repeat the reviewed procedure on the deployment during its maintenance
   window, then resume writers.

The supported starting point is the consolidated-equivalent schema, optionally
with later notification/net-worth/proposal patches. Earlier, customized or
incomplete installations fail with a catalog-difference list. They need a
reviewed, deployment-specific forward repair before adoption; do not mark the
baseline applied manually. Function fingerprints are deliberately conservative:
even a changed body requires review. The contract was captured on PostgreSQL 17.

Duplicate lifecycle notifications or invalid `metadata.market_id` UUIDs make
the forward repair fail atomically, leaving its version unapplied. Inspect and
reconcile those notification records on the restored copy first. The migration
never silently deletes records to make an index succeed. A missing daily-claim
uniqueness index is a schema mismatch, not permission to delete monetary
ledger entries.

## Initial super-admin

Create and confirm the intended account through Auth first. Ordinary signup
requires `@andrew.cmu.edu`. For an external operator account, approve its exact
email with `scripts/db/allow_signup_email.sql` before signup; see the
[local setup procedure](LOCAL_DEVELOPMENT.md#operator-signup-exception-and-initial-super-admin).
Obtain its UUID from `auth.users`, verify its identity, then run as the database
operator:

```sh
psql -X -v ON_ERROR_STOP=1 -v user_id=CONFIRMED_USER_UUID -f scripts/db/bootstrap_super_admin.sql
```

The script requires an existing confirmed CMU or operator-approved user and profile. It refuses to
promote a different account if a super-admin already exists; repeating the same
assignment is safe. It updates `role`, letting the existing trigger synchronize
`is_admin`, and prints the resulting identity and role. Retain the operator
execution record. Later role changes use the authorized admin workflow. No
bootstrap RPC is exposed to clients. Existing roles survive adoption unchanged.

## Historical reconciliation decisions

- Archived `020_fix_claim_race_condition.sql` depends on `transactions` from
  001 and the `daily_claim` type from 012. The baseline installs it after both,
  then installs capped function 038. The unique index uses the New York calendar
  day; the final function also locks the profile row. Both protections remain.
  Replaying older function 018 would regress the cap.
- Duplicate 007 and 060 prefixes are archive identifiers, not applied versions.
  The obsolete 007 voting file is a no-op. Both 060 aggregation and 060
  notification changes are accounted for in the canonical chain.
- Notification 055/056 permissive insertion policies are superseded by 059.
  The repair installs the final policy state directly, includes 054, 057, 058
  and the idempotent 060 market-notification RPC, and installs 061.
- The separate top-level 021 proposal patch follows the baseline. Top-level
  022 is an old one-time data update and is **not** replayed: existing market
  states must not change merely because the schema is upgraded. Runtime
  lifecycle normalization and `close_expired_markets()` remain responsible
  for closing expired markets. These migrations do not provision a scheduler.
- Archived 031 adds option bets but retains `bets.side NOT NULL` from 001.
  The repair drops that constraint while retaining the side/option check,
  allowing the existing transactional option-bet RPC to work.
- Resolution and balance mutations retain the existing transactional engine
  and dual-track application workflow. This is not a general audit of legacy
  RPC authorization; known API-policy gaps remain in
  [AUTHZ_MATRIX.md](AUTHZ_MATRIX.md).

## Reproducible verification

From the repository root, with Docker running, Python 3.12+ and `npm ci` complete:

```sh
python scripts/db/test_migrations.py
npx --no-install supabase stop --workdir .migration-test --no-backup
```

The harness uses fixed disposable project `pheme-issue36`, a generated config
under `.migration-test/`, and separate ports (API 55321, database 55322). It
never reads application environment files or accepts a remote database URL.
It resets **only that project**, leaving the normal development project alone.
A failed run leaves the project available for inspection.

The same command runs in CI. It exercises an empty Supabase bootstrap, the
original consolidated schema with persisted users/bets/claims/notifications,
and a legacy schema with later patches already installed. Checks include:

- unchanged application rows, roles, balances and ledger across adoption;
- matching fresh/upgraded schema dumps and recorded versions;
- refusal of unsupported drift and atomic failure on duplicate events;
- signup/domain enforcement, initial grant, binary and option bets, creator
  proposal/dispute window, community vote, settlement and repeat rejection;
- capped claims, New York date boundaries, unique-index enforcement and six
  concurrent claim sessions producing one credit;
- all literal backend RPC names, leaderboard/badge queries, avatar ownership,
  public badge RLS, notification ownership, mark-read/delete and event dedup.
- explicit super-admin bootstrap, retry, unconfirmed-user refusal and refusal
  to replace an existing super-admin.
- operator-approved external signup and confirmed bootstrap, rejection of
  metadata-based bypasses and unapproved email changes, and client/service-role
  denial of access to the exception list.

Verified locally on 2026-11-14 with CLI 2.84.5, PostgreSQL 17.6, Docker Desktop
and Python 3.14 on Windows. All three database scenarios passed; backend Ruff
and 114 unit tests also passed. CI runs the harness on Linux with Python 3.12.

SQL tests call settlement where the backend would invoke it after a resolution
window. They do not claim legacy RPCs independently enforce every application
authorization or timing rule. Backend unit tests cover lifecycle coordination.

For recovery, restore the verified backup or apply a reviewed forward repair.
Do not replay initial table creation, erase migration history, or improvise
balance adjustments outside the transactional engine.

## Governance and accounting repairs (#38)

Apply versions `20261116000000`, `20261116000100`, and `20261116000200` in order.
They enforce dispute/option-bet eligibility, preserve refunded participation via
bet-placement ledger entries, correct option refund pools, and make new community
settlement/rewards atomic. Betting and backroll take market locks before wallet
locks; multi-user credits lock profiles in UUID order.

The last migration adds `private.community_settlements`; clients cannot write its
receipts. It does not infer or replay rewards for previously resolved markets.
Any historic missed/duplicate rewards require a separate audited reconciliation.
No application balances are rewritten by these migrations. Deploy all migrations
before the coordinator change; old coordinators' extra reward call becomes a no-op
for newly completed community settlements. The disposable harness includes forced
reward failure, retries, concurrent settlements/refunds and post-refund eligibility.

## Deploying proposed-market privacy (13.8)

Merge and deploy the API/frontend changes together with migration
`20261116000400_proposed_market_privacy.sql`. Deploy the API first: its JWT
forwarding preserves creator/admin reads once the restrictive SELECT policies
are applied. Until the migration is applied, direct Supabase reads still use
the old public policies even though the API is protected.

For the intended hosted development project, confirm the linked project in
`supabase/.temp/project-ref` against its dashboard, then run from the root:

```sh
npx --no-install supabase migration list --linked
npx --no-install supabase db push --linked --dry-run
npx --no-install supabase db push --linked
```

Review every pending version in the dry run; never replay the baseline on an
existing database. These are operator deployment steps, separate from the
PR's disposable migration tests. No hosted reset or manual data edit is needed.

For a browser smoke check, propose a market as user A, then open `/portfolio`
as user B in a separate browser profile. B must not see A's pending or denied
proposal. In the Network panel, proposals must come from
`/api/portfolio/proposed-markets`, with no pending/denied public-list requests.
A should still see their proposal and its review notes. Check that an admin
can still see both users' proposals in `/admin/review`. Also sign out of A
and into B in the same browser to verify cached private content disappears.

The automated checks cover HTTP ownership/404 contracts, cache clearing and
request cancellation, and real database SELECT policies for anonymous users,
both creators, admins and super-admins on fresh and legacy-upgraded schemas.
