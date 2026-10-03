# Development Guide

## Setup

Use Node.js 24 (`nvm use`) and `npm ci`. Follow the [quick start](README.md#quick-start)
with a local PostgreSQL database. Never point development tests or seed commands
at production. Keep real environment files, uploaded documents and database
backups outside version control; commit only sanitized example configuration.

## Change Workflow

1. Start a short-lived feature or fix branch from the intended integration branch.
2. Keep changes scoped to a feature or subsystem and include regression coverage.
3. Run `npm run repo:check`, `npm run test:unit`, `npm run typecheck`, and `npm run lint`.
4. For browser changes, run the relevant extension/UI tests and inspect the rendered
   result. Test applications must never be submitted to employers.
5. Open a pull request. GitHub's Verify workflow also runs database integrations,
   browser regressions, a production build, and a PDF parser smoke test.
6. Validate on staging before promoting to `main`. Deployment is explicit, not
   triggered by a merge. See the [release runbook](docs/deployment/staging-production.md).

Delete merged feature branches. Preserve or explicitly abandon unmerged work
before deleting its last branch. Do not rewrite published history for routine cleanup.

## Where Changes Belong

- Routes and API handlers: `src/app/`.
- Shared presentation: `src/components/`.
- Domain logic and database query helpers: `src/lib/` and `src/lib/queries/`.
- Persistence: `prisma/schema.prisma` and additive migrations under `prisma/migrations/`.
- Chrome extension: `extensions/chrome/`; test the packaged extension as well as source.
- Operational entry points: `scripts/`; deployment operations: `deploy/single-vps/`.
- Reference and runbooks: `docs/`; source datasets: `data/`.

Consult `AGENTS.md` and the installed Next.js documentation before changing framework
behavior. Prefer existing helpers over new architectural layers. Keep CLI paths
stable because package commands, cron jobs and operational runbooks may invoke them.

## Release Safety

Release from a clean, committed checkout. Verify backups and migration compatibility;
preserve rollback images and protected user records. Never delete Docker volumes,
mass-prune images, or run database cleanup as a side effect of repository housekeeping.

Repository hygiene checks prevent common generated/private paths from being tracked.
They are not a substitute for reviewing diffs for credentials or personal information.
