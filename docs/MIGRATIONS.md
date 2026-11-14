# Database migrations

SQL source lives in [backend/supabase/migrations/](../backend/supabase/migrations/).
It contains historical iterations, a partial consolidated snapshot and two
top-level patches. It is **not** a verified single numeric migration chain.
[Issue #36](https://github.com/tedgershon/Pheme/issues/36) tracks a reproducible
bootstrap and upgrade path.

## What is on disk

| Location | Contents and limitations |
| --- | --- |
| `consolidated_all_migrations.sql` | Initial tables and functions through 049, plus profile/avatar changes 050–053, leaderboard/badge aggregation and badge RLS 062. Its header understates its contents. It omits later notification changes and net-worth aggregation. |
| `iterations/` | Historical schema/function revisions, including notification changes 054–060, aggregation 060–061 and badge RLS 062. Prefixes 007 and 060 each occur twice. |
| `021_fn_propose_resolution_close_now.sql` | A separate patch allowing creator proposals to close expired open markets before proposing. Not the role-system migration with the same prefix. |
| `022_close_expired_markets.sql` | A one-time data update that closes expired open markets. Not the admin-RLS migration with the same prefix. |
| `supabase/config.toml` (repo root) | CLI configuration; the repository has no corresponding canonical `supabase/migrations/` chain. A reset alone does not install the application schema. |

The consolidated file is not safe to replay on an existing database: initial
tables and some policies use unconditional creation statements. Its contents
also overlap the iteration files. Do not execute both sets wholesale.

## Provisioning or updating a database

1. Use a disposable Supabase database to validate the intended sequence first.
   Compare its installed tables, columns, constraints, policies and RPCs to
   the source files; repository filenames do not prove deployment state.
2. For a fresh schema, the consolidated file is only a starting snapshot.
   Reconcile omitted notification constraints/RLS/RPCs and
   `get_networth_leaderboard` before treating it as application-ready.
   For an existing schema, apply only reviewed missing changes.
3. Record the exact filenames and versions applied. Numeric prefixes alone
   are insufficient because they overlap.
4. Verify auth/profile creation, roles, avatar access, market review, binary
   and option bets, daily claims, resolution, notifications and leaderboard
   queries against that database.
5. Apply the reviewed sequence through the Supabase SQL editor or an explicit
   database migration process. Keep a backup and a tested recovery plan for
   schema/data changes.

No fresh-database bootstrap was executed as part of the documentation audit.
Do not infer a working deployment recipe from the inventory above.

## Schema details that affect setup

- Domain enforcement is in `iterations/006_auth_cmu_domain_trigger.sql`.
  The previously documented `005_cmu_email_rls.sql` is absent; do not assume
  its policies exist.
- `iterations/020_fix_claim_race_condition.sql` adds a per-user, New York
  calendar-day claim uniqueness index. The capped claim function in 038 also
  locks the profile row; retain both protections when reconciling history.
- `iterations/021_role_system.sql` contains a legacy one-time promotion
  keyed to an account identifier. If the profile is absent, it updates no rows;
  it does not arrange promotion on a later signup. Initial privileged access
  needs an explicit operator procedure, tracked in #36.
- `iterations/037_fn_auto_resolution_window.sql` updates close/window
  functions and triggers. Check the actual installed scheduler separately;
  Python lifecycle normalization is request-driven.
- Notification RPCs and policies changed repeatedly. In particular, the
  idempotent market notification RPC in
  `iterations/060_notifications_idempotent_market_rpc.sql` is required by
  `backend/notification_service.py`.
- Profile avatars and equipped badges require 050–053; net-worth ranking
  requires 061; public badge definitions require the RLS policy in 062.

## Future migration changes

Use unique identifiers and include prerequisites, expected installed schema,
verification and recovery instructions in the PR. Keep monetary changes in
transactional functions with ledger entries. Exercise RLS with public,
authenticated and privileged clients. Prefer reviewed forward repairs over
generic destructive rollback snippets.

[DATA_MODEL.md](DATA_MODEL.md) describes the entities; SQL remains the source
for exact constraints and function definitions.