# Single VPS Migration Runbook

This runbook migrates the app from the current DigitalOcean/Vercel split into
one VPS running:

- Next.js web server behind Caddy
- PM2 ingestion worker
- PostgreSQL 18
- nightly database backups to S3-compatible storage such as Cloudflare R2

For a self-managed Postgres database, the safest cheap production topology is
to run the web app on the VPS too. Keeping Vercel as the production web host
would require exposing Postgres publicly to Vercel's dynamic infrastructure,
which is not worth it for the current test-user stage. Vercel can stay as a
preview/staging deployment with ingestion disabled.

## Non-Negotiable Data Safety Rules

1. Do not destroy the old DigitalOcean database or droplets until the new VPS
   has been verified with matching row counts and a working app login.
2. Do not run more than one ingestion daemon during migration.
3. Take a pre-migration backup before any restore attempt.
4. During final cutover, stop old ingestion first, take a final backup, restore
   that final backup, verify, then start the new worker.
5. Keep object storage private. Database dumps contain user data and job
   application data.

## Files Added For This Migration

- `Dockerfile` builds one runtime image for web, worker, and backup tooling.
- `deploy/single-vps/docker-compose.yml` runs Postgres, app, worker, Caddy, and
  an on-demand backup runner.
- `deploy/single-vps/.env.production.example` is the production env template.
- `deploy/single-vps/backup-to-storage.sh` dumps compose Postgres with the
  matching Postgres container and uploads to object storage.
- `deploy/single-vps/restore-from-storage.sh` downloads a backup and restores it
  into compose Postgres.
- `scripts/db-backup-storage.ts` uploads a local or generated `pg_dump` file to
  S3-compatible storage.
- `scripts/db-restore-storage.ts` downloads/restores backups from S3-compatible
  storage.
- `scripts/db-snapshot-counts.ts` captures row counts for before/after
  migration verification.

## One-Time Cloud Setup

1. Create the VPS:
   - Hetzner CPX31 US, 4 vCPU / 8 GB RAM.
   - Ubuntu 24.04 LTS.
   - Add SSH key auth.
   - Firewall: allow 22, 80, 443. Do not expose 5432 publicly.

2. Create object storage:
   - Cloudflare R2 bucket, private.
   - Create an access key with read/write access to that bucket.
   - Use:
     - `STORAGE_PROVIDER="Cloudflare R2"`
     - `STORAGE_REGION="auto"`
     - `STORAGE_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"`

3. Point DNS to the VPS when ready:
   - `A <domain> -> <vps-ip>`
   - Keep the old deployment alive until verification passes.

## Prepare A Backup From The Current Database

Capture counts first:

```bash
npm run db:snapshot-counts > migration-counts-before.json
```

The default snapshot uses exact counts for user/application/document tables and
planner estimates for the large ingestion tables so it returns quickly. If you
want exact counts for every large ingestion table too, use:

```bash
npm run db:snapshot-counts -- --exact > migration-counts-before-exact.json
```

Create a storage-backed backup. The current database reports PostgreSQL 18.3,
so use a matching Postgres image if the local machine does not have `pg_dump`
18 installed:

```bash
DB_BACKUP_PG_DUMP_DOCKER_IMAGE=postgres:18-bookworm \
  npm run db:backup:storage -- --label=pre-migration
```

If Docker is not available locally, run this from any machine that has Docker
and the current `.env` values.

## VPS Bootstrap

SSH into the new VPS:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git

curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker
```

Clone the repo:

```bash
git clone <repo-url> autoapplication
cd autoapplication
```

Create the production env:

```bash
cp deploy/single-vps/.env.production.example deploy/single-vps/.env.production
```

Fill in:

- `APP_DOMAIN`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `DATABASE_URL_FOR_BACKUP`
- `DATABASE_URL_FOR_RESTORE`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `NEXT_PUBLIC_BETTER_AUTH_URL`
- all `STORAGE_*` values
- `OPENAI_API_KEY`
- SMTP values, if used
- source API keys and ATS tokens from the old environment

For the current production domain, use:

```bash
APP_DOMAIN="applyoverflow.com, www.applyoverflow.com"
APP_NAME="ApplyOverflow"
APP_URL="https://applyoverflow.com"
BETTER_AUTH_URL="https://applyoverflow.com"
NEXT_PUBLIC_BETTER_AUTH_URL="https://applyoverflow.com"
AUTH_ALLOW_INSECURE_COOKIES="false"
```

If the source backup came from the current DigitalOcean database named
`defaultdb` and the new database is named `autoapplication`, set:

```bash
DB_RESTORE_SOURCE_DATABASE_NAME="defaultdb"
```

Build and start only Postgres first:

```bash
docker compose \
  --env-file deploy/single-vps/.env.production \
  -f deploy/single-vps/docker-compose.yml \
  up -d postgres
```

## First Restore Rehearsal

Restore the latest uploaded backup into the new VPS database:

```bash
CONFIRM_RESTORE=autoapplication \
SKIP_PRE_RESTORE_BACKUP=1 \
deploy/single-vps/restore-from-storage.sh latest
```

If `POSTGRES_DB` is not `autoapplication`, use that database name in
`CONFIRM_RESTORE`.

Start web without the worker first:

```bash
docker compose \
  --env-file deploy/single-vps/.env.production \
  -f deploy/single-vps/docker-compose.yml \
  up -d app caddy
```

Verify:

```bash
docker compose \
  --env-file deploy/single-vps/.env.production \
  -f deploy/single-vps/docker-compose.yml \
  run --rm backup-runner npm run db:snapshot-counts > migration-counts-after.json
```

Compare `migration-counts-before.json` and `migration-counts-after.json`.
Important counts should match: users, profiles, documents, canonical jobs,
source mappings, saved jobs, tracked applications, notifications, and reminders.
For the final cutover, use `--exact` once if you want a stricter but slower
large-table comparison.

Then open:

```text
http://<vps-ip>
```

or the configured domain after DNS is pointed.

## Final Cutover

1. Stop old ingestion on DigitalOcean:

```bash
npx pm2 stop ingest-daemon ingest-poll-worker
```

2. Disable any old web process that can write to the old database, or put the
   old app in maintenance mode if available.

3. Take a final backup from the old database:

```bash
DB_BACKUP_PG_DUMP_DOCKER_IMAGE=postgres:18-bookworm \
  npm run db:backup:storage -- --label=final-cutover
```

4. Restore the final backup on the VPS:

```bash
CONFIRM_RESTORE=autoapplication \
deploy/single-vps/restore-from-storage.sh latest
```

5. Rebuild and start all services:

```bash
npm run deploy:single-vps
```

The deploy helper syncs the checkout to the VPS, rebuilds `app` and `worker`,
recreates those containers, then prunes safe Docker build/image cache. By
default it keeps build cache from the last 24 hours and never prunes Docker
volumes, so the Postgres data volume is not touched.

Useful overrides:

```bash
# Prune all unused build cache after a successful rebuild.
DOCKER_BUILD_CACHE_MAX_AGE=0 npm run deploy:single-vps

# Keep unused old images for rollback debugging, but still prune build cache.
PRUNE_UNUSED_IMAGES=0 npm run deploy:single-vps
```

6. Verify login, `/jobs`, `/applications`, document download, AI actions, and
   one manual ingestion poll.

7. Point DNS to the VPS if not already done.

8. Keep the old DigitalOcean database and droplets for at least 48 hours before
   deleting anything.

## Nightly Backups

Install a cron entry on the VPS:

```bash
crontab -e
```

Add:

```cron
15 3 * * * cd /home/<user>/autoapplication && deploy/single-vps/backup-to-storage.sh auto >> logs/db-backup.log 2>&1
```

Run one manual backup immediately after final cutover:

```bash
deploy/single-vps/backup-to-storage.sh post-cutover
```

## Rollback

If the new VPS fails before old infrastructure is deleted:

1. Stop the new worker:

```bash
docker compose \
  --env-file deploy/single-vps/.env.production \
  -f deploy/single-vps/docker-compose.yml \
  stop worker
```

2. Point DNS back to the old deployment.
3. Restart old PM2 ingestion only after confirming the old app is primary again.

No data should be deleted from the old stack until the new stack is verified and
has survived at least one backup cycle.
