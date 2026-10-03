# Script Catalog

Use `npm run` to list all supported commands. Scripts remain at their existing
paths so package scripts, scheduled jobs and deployment tooling do not break.

| Area | Main commands | Notes |
| --- | --- | --- |
| Development | `dev:web`, `dev`, `jobs:seed:local` | `dev` also manages the local ingestion daemon |
| Repository checks | `repo:check`, `lint`, `typecheck`, `test:unit` | No production mutation |
| Browser extension | `extension:build`, `extension:test:*` | Some live tests need explicit account/upload consent |
| UI verification | `test:workspace:layout`, files in `tests/e2e/` | Requires a local running app and test database |
| Ingestion | `ingest`, `ingest:daemon`, `source:discover` | Writes source/job records and calls external services |
| Supply diagnostics | `supply:health`, `source:report-*`, `jobs:diagnose-*` | Read script options and target environment first |
| Repair and retention | `jobs:repair-*`, `source:prune`, `db:storage-lifecycle` | Review targets and backup requirements before execution |
| Backups | `db:backup:storage`, `db:restore:storage` | Restore is destructive to the selected database |
| Recommendations | `top-picks:worker`, `top-picks:drain` | Background refresh queues |
| Releases | `deploy:single-vps`, `deploy:build-local`, `deploy:staging-vps` | These deploy, not just build |

Keep reusable logic in `src/lib/` and CLI orchestration here. Tests should live in
`tests/` unless a standalone browser/runtime harness needs a script entry point.
Write screenshots and transient reports to ignored `output/` subdirectories.
