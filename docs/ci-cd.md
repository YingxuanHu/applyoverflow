# GitHub CI/CD

## Verification

`Verify` runs on every pull request and every push to `dev` or `main`:

- **quality:** lint, TypeScript, unit tests, and deployment failure/rollback tests.
- **extension:** isolated Chromium autofill, semantic history completion, on-form
  answer progress, custom questions, stale-worker readiness, undo, packaging, and
  detection-policy fixtures. Failed screenshots
  are retained for seven days. No personal Chrome profiles or live applications.
- **integration:** fresh PostgreSQL 18 migrations, repeatability, ingestion/storage,
  profile import, extension authorization, resume sharing, and mocked AI suggestions,
  including profile-backed semantic answer drafts.
- **build:** standalone production build, PDF parser smoke, database-backed health
  check, anonymous auth redirect, and downloadable extension ZIP validation.

The final **application** check fails if any prerequisite fails, is cancelled, or
is skipped. Require **application** and **dependencies** in the `main` branch ruleset. Require PRs,
resolved review conversations, and up-to-date branches; disable force pushes and
deletions. For a solo maintainer, do not require a review by a second person unless
another reviewer is available. Dependency review rejects newly introduced high or
critical vulnerabilities. Dependabot opens grouped update PRs; nothing auto-merges.

CI uses synthetic data and needs no production secrets. Third-party Actions are
commit-pinned. Superseded verification runs are cancelled, but deploys are not.
Dependency review requires GitHub's dependency graph under repository
**Settings > Advanced Security**. Dependency alerts and the graph are enabled for
this repository; review the existing vulnerability backlog separately.
The interactive `extension:test:detection` and `extension:test:frames` scripts
require Chrome's native site-permission approval and are not unattended CI gates.
Run those separately in disposable headed Chrome before extension releases;
fixture tests do not prove every employer's current live form works.

## Enable Production Deployment

Deployment is deliberately **disabled** until configured. These files do not grant
GitHub access to the VPS or change existing environment protection rules.

1. In repository **Settings > Environments > Production**, restrict deployment to
   the selected branch `main`. Add your account as a required reviewer and disable
   admin bypass. A solo owner must leave "Prevent self-review" off, or supply a
   second reviewer. Environment approval happens before SSH secrets are released.
2. Provision a **dedicated deployment SSH key** on the VPS. Docker access is
   effectively root access; use a dedicated account, restrict its key where
   practical, and do not reuse a personal root key. The account needs Docker,
   Compose v2, `jq`, `curl`, `flock`, and write access to
   `/opt/autoapplication/.github-deploy`. Existing Compose configuration and its
   `.env.production` stay on the server. No database/API secrets go into GitHub.
3. Add environment secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, and
   `DEPLOY_KNOWN_HOSTS`. Obtain the SSH host public key through a trusted existing
   session and verify its fingerprint. Do not trust an unverified `ssh-keyscan`
   result. The workflow uses strict host checking and port 22.
4. Enable repository Actions package-write permission if organization policy
   restricts it. GHCR packages `applyoverflow-web` and `applyoverflow-migrations`
   inherit access from this repository. Keep them private unless intentionally
   published. GitHub uses a short-lived token for the pull; no registry PAT is
   stored on the VPS.
5. Set repository variable `PRODUCTION_DEPLOY_ENABLED=true`. Leave
   `AUTO_DEPLOY_PRODUCTION` unset for manual releases. Set it to `true` only to
   request a release after every successful `main` verification; the Production
   environment approval still applies.
6. Run **Actions > Release production > Run workflow**, selecting `main`. Review
   the exact commit and approve the environment deployment. The workflow reruns
   all verification before building and rejects superseded commits before deploy.

## Release Contract

GitHub builds Linux/amd64 images and publishes commit tags, but the VPS pulls and
deploys **immutable digests**. OCI revision labels and architecture are validated.
The host checks free Docker storage (at least 6 GiB), takes an exclusive release
lock, and confirms the existing app is healthy before changing anything.

The migration-check image runs **`prisma migrate status` only** against production.
Pending/failed/divergent migrations stop the release before the app is replaced.
For schema changes, review compatibility with BOTH old and new app/workers, verify
a recent recoverable backup, apply the reviewed migrations via the existing
operator process, and rerun the release. Use expand/contract migrations. Never
automatically reverse a schema migration or run `db push` in production.

Only **app** is recreated, using `--no-deps --no-build`. Ingestion/source workers,
PostgreSQL, Caddy, and storage lifecycle services are not restarted. Worker
releases remain a separate operation through `deploy/single-vps/rebuild.sh`.
Changes requiring coordinated worker/config updates must use that reviewed path.
The workflow does not synchronize a new source checkout over running worker bind
mounts. Database availability and the exact new revision must pass both the
container health check and `https://applyoverflow.com/api/health`.

This is a single-instance deployment, not zero downtime: brief reconnects are
possible while Compose replaces the web container. There is no automatic pruning,
volume cleanup, or production monitoring schedule.

## Rollback and Operations

If app startup or revision health checks fail, the script restores the previously
healthy image and verifies it. The workflow stays **failed** even when rollback
succeeds. If rollback also fails, the log emits a CRITICAL operator alert.
The pre-release known-good image and failed candidate identity are retained in
`recovery.json`, so the manual workflow can retry recovery even if the current app
is unhealthy or stopped. An unrelated manual deployment is not silently rolled
back: image identity must match the recorded deployment or failed candidate.

For a manual rollback use **Actions > Roll back production web**, select `main`,
and type `rollback-production`. It uses the same Production approval and release
lock. The two known-good images are tagged `applyoverflow-ci:current` and
`applyoverflow-ci:previous`; preserve them during maintenance. Rollback switches
web code only, never data. Do not roll back across incompatible schema changes.
Also preserve `applyoverflow-ci:inflight` while a deployment or recovery is pending.

Release records and an active Compose overlay live in
`/opt/autoapplication/.github-deploy`. Normal manual Compose commands must include
`-f /opt/autoapplication/.github-deploy/current.yml` to preserve the CI image, or
use the existing full manual release script intentionally. The checked-out source
SHA on the VPS is NOT the deployed web SHA; use `/api/health` and `current.json`.

Do not prune rollback tags. Failed candidate images may remain for diagnosis;
review capacity and remove only confirmed unused candidates during maintenance.
Test the first real release and rollback while an operator is available before
enabling automatic releases. Mock-host regression tests do not prove production
SSH permissions, networking, registry access, or recovery from host power loss.
