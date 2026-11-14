# Development documentation

| Document | Purpose |
| --- | --- |
| [PROJECT_SPECS.md](PROJECT_SPECS.md) | Product rules, implemented workflows and architecture |
| [AUTHZ_MATRIX.md](AUTHZ_MATRIX.md) | Intended page, control and API authorization policy |
| [DATA_MODEL.md](DATA_MODEL.md) | Persistent entities, relationships and database invariants |
| [MIGRATIONS.md](MIGRATIONS.md) | SQL layout, setup limitations and change procedure |
| [OBSERVABILITY.md](OBSERVABILITY.md) | Error handling, logging and Sentry configuration |

Use [GitHub Issues](https://github.com/tedgershon/Pheme/issues) for feature
designs, implementation steps and acceptance criteria. A documented policy is
not proof that every route enforces it: known gaps are linked to issues.
SQL files describe repository schema history, not the state of a deployed
database. Update the relevant docs alongside behavior changes.

For local setup and checks, see the [root README](../README.md),
[backend guide](../backend/README.md), [frontend guide](../frontend/README.md)
and [contribution workflow](../CONTRIBUTING.md).