# Fixture cleanup

[TEARDOWN.sql](TEARDOWN.sql) removes legacy fixture accounts and related data.
It is maintenance tooling, not an automatic seed or schema migration.

The script selects profiles using eight hardcoded Andrew IDs. That match alone
does not prove a profile is synthetic: inspect the selected profiles and linked
rows before use. Related activity by other users can also be affected.

The transaction reverses non-fixture users' net ledger impact on fixture
markets before deleting related data, and records the adjustment. Preview on
a disposable copy by changing the final `COMMIT` to `ROLLBACK`; review the
row counts and balance effects. Execute only against the intended database
with an operator-reviewed backup/recovery plan.

There is no maintained data-seeding command here. Create normal development
data through the application; isolate automated fixtures in a test database.
See [MIGRATIONS.md](../docs/MIGRATIONS.md) for schema setup.