# Production And Staging Deployment

ApplyOverflow runs production and staging as separate Docker Compose projects on
the same VPS. Production remains user-facing. Staging is for developer testing
before production rebuilds.

## Environments

| Environment | Domain | App directory | Compose project | Database |
| --- | --- | --- | --- | --- |
| Production | `applyoverflow.com` | `/opt/autoapplication` | default | `postgres` volume |
| Staging | `dev.applyoverflow.com` | `/opt/autoapplication-staging` | `applyoverflow-staging` | `postgres-staging-data` volume |

Production and staging must not share `DATABASE_URL`, auth secrets, or Postgres
volumes. Use a separate object-storage bucket for staging when testing document
uploads or generated files. Staging may use a refreshed copy of production data,
but only through the explicit refresh script.

## Branch Policy

- Deploy `dev` to staging.
- Deploy the stable production branch to production.
- Test UI, migrations, and worker behavior on staging before production.
- Keep production ingestion as the main ingestion system.
- Keep staging ingestion throttled unless intentionally testing ingestion logic.

## DNS

Point the staging hostname to the VPS:

```text
dev.applyoverflow.com A 5.78.195.237
```

Caddy serves both production and staging. The production Caddy container proxies
`dev.applyoverflow.com` to the staging app on the VPS loopback port.

## One-Time Staging Setup

Create the staging directory and environment file on the VPS:

```bash
ssh root@5.78.195.237 'mkdir -p /opt/autoapplication-staging/deploy/single-vps'
scp deploy/single-vps/.env.staging.example \
  root@5.78.195.237:/opt/autoapplication-staging/deploy/single-vps/.env.staging
```

Then edit the remote staging env:

```bash
ssh root@5.78.195.237
nano /opt/autoapplication-staging/deploy/single-vps/.env.staging
```

Use staging-specific values:

- `APP_ENV=staging`
- `APP_DOMAIN=dev.applyoverflow.com`
- `APP_URL=https://dev.applyoverflow.com`
- `BETTER_AUTH_URL=https://dev.applyoverflow.com`
- `NEXT_PUBLIC_BETTER_AUTH_URL=https://dev.applyoverflow.com`
- a different `POSTGRES_PASSWORD`
- a different `BETTER_AUTH_SECRET`
- a different R2 bucket if you test uploads or generated documents
- `DB_BACKUP_STORAGE_PREFIX=database-backups/staging`

Do not point staging at the production Postgres service.

## Deploy Staging

From the local checkout:

```bash
npm run deploy:staging-vps
```

The staging deploy script:

1. syncs the current checkout to `/opt/autoapplication-staging`
2. builds staging images
3. starts staging Postgres
4. runs Prisma migrations on staging
5. restarts staging web and limited staging workers

To deploy only the staging web app:

```bash
SINGLE_VPS_STAGING_BUILD_SERVICES=app-staging \
SINGLE_VPS_STAGING_SERVICES=app-staging \
npm run deploy:staging-vps
```

## Refresh Staging Data From Production

This replaces only the staging database with a production snapshot. It does not
modify production.

```bash
CONFIRM_REFRESH_STAGING=autoapplication_staging npm run deploy:refresh-staging
```

If the staging database name is changed, use that exact database name in
`CONFIRM_REFRESH_STAGING`.

By default the script also writes a pre-refresh staging dump to `/tmp` on the
VPS. To skip that staging backup:

```bash
SKIP_STAGING_PRE_REFRESH_BACKUP=1 \
CONFIRM_REFRESH_STAGING=autoapplication_staging \
npm run deploy:refresh-staging
```

## Deploy Production

Production deploy remains:

```bash
npm run deploy:single-vps
```

The production deploy now rebuilds app and worker images, applies migrations,
and recreates Caddy so domain routing changes are picked up.

## Ingestion Rules

Production is the canonical ingestion environment. Staging runs limited workers
by default so it can validate ingestion changes without consuming the same CPU,
network, and external-source quotas as production.

The staging compose file intentionally uses lower concurrency and source-poll
limits. If you need to test full ingestion behavior, raise those limits only for
a short test window and then put them back.

## Rollback

If staging deploy fails, production is unaffected.

If production deploy fails after staging passed:

1. SSH to the VPS.
2. Inspect `docker compose ps` and `docker compose logs`.
3. Re-deploy the previous known-good branch with `npm run deploy:single-vps`.

Do not delete Docker volumes during rollback; the production Postgres data lives
there.
