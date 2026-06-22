#!/usr/bin/env bash
# Destructively refresh the staging database from the production database.
# This keeps production untouched and replaces only the staging Postgres data.

set -euo pipefail

REMOTE_HOST="${SINGLE_VPS_HOST:-root@5.78.195.237}"
PROD_APP_DIR="${SINGLE_VPS_APP_DIR:-/opt/autoapplication}"
STAGING_APP_DIR="${SINGLE_VPS_STAGING_APP_DIR:-/opt/autoapplication-staging}"
PROD_ENV_FILE="${SINGLE_VPS_ENV_FILE:-deploy/single-vps/.env.production}"
STAGING_ENV_FILE="${SINGLE_VPS_STAGING_ENV_FILE:-deploy/single-vps/.env.staging}"
PROD_COMPOSE_FILE="${SINGLE_VPS_COMPOSE_FILE:-deploy/single-vps/docker-compose.yml}"
STAGING_COMPOSE_FILE="${SINGLE_VPS_STAGING_COMPOSE_FILE:-deploy/single-vps/docker-compose.staging.yml}"
STAGING_COMPOSE_PROJECT="${SINGLE_VPS_STAGING_COMPOSE_PROJECT:-applyoverflow-staging}"

remote_script=$(cat <<'REMOTE_SCRIPT'
set -euo pipefail

if [[ ! -f "$PROD_APP_DIR/$PROD_ENV_FILE" ]]; then
  echo "Missing production env file: $PROD_APP_DIR/$PROD_ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$STAGING_APP_DIR/$STAGING_ENV_FILE" ]]; then
  echo "Missing staging env file: $STAGING_APP_DIR/$STAGING_ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$PROD_APP_DIR/$PROD_ENV_FILE"
PROD_POSTGRES_DB="$POSTGRES_DB"
PROD_POSTGRES_USER="$POSTGRES_USER"
set +a

set -a
# shellcheck disable=SC1090
source "$STAGING_APP_DIR/$STAGING_ENV_FILE"
STAGING_POSTGRES_DB="$POSTGRES_DB"
STAGING_POSTGRES_USER="$POSTGRES_USER"
set +a

if [[ "${CONFIRM_REFRESH_STAGING:-}" != "$STAGING_POSTGRES_DB" ]]; then
  cat >&2 <<EOF
Refusing to replace staging database $STAGING_POSTGRES_DB.

This will overwrite staging data only. Re-run with:

  CONFIRM_REFRESH_STAGING=$STAGING_POSTGRES_DB deploy/single-vps/refresh-staging-from-prod.sh

EOF
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="/tmp/applyoverflow-prod-to-staging-${STAMP}.dump"

PROD_COMPOSE=(docker compose --env-file "$PROD_ENV_FILE" -f "$PROD_COMPOSE_FILE")
STAGING_COMPOSE=(docker compose --project-name "$STAGING_COMPOSE_PROJECT" --env-file "$STAGING_ENV_FILE" -f "$STAGING_COMPOSE_FILE")

echo "Starting staging Postgres if needed"
cd "$STAGING_APP_DIR"
"${STAGING_COMPOSE[@]}" up -d postgres-staging

if [[ "${SKIP_STAGING_PRE_REFRESH_BACKUP:-0}" != "1" ]]; then
  echo "Taking a staging backup before refresh"
  "${STAGING_COMPOSE[@]}" exec -T postgres-staging pg_dump \
    -U "$STAGING_POSTGRES_USER" \
    -d "$STAGING_POSTGRES_DB" \
    -Fc > "/tmp/applyoverflow-staging-pre-refresh-${STAMP}.dump" || true
fi

echo "Dumping production database $PROD_POSTGRES_DB"
cd "$PROD_APP_DIR"
"${PROD_COMPOSE[@]}" exec -T postgres pg_dump \
  -U "$PROD_POSTGRES_USER" \
  -d "$PROD_POSTGRES_DB" \
  -Fc > "$DUMP_FILE"

echo "Restoring production dump into staging database $STAGING_POSTGRES_DB"
cd "$STAGING_APP_DIR"
cat "$DUMP_FILE" | "${STAGING_COMPOSE[@]}" exec -T postgres-staging pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  -U "$STAGING_POSTGRES_USER" \
  -d "$STAGING_POSTGRES_DB"

echo "Applying staging migrations after refresh"
"${STAGING_COMPOSE[@]}" run --rm app-staging npx prisma migrate deploy

rm -f "$DUMP_FILE"

echo "Staging refresh from production complete."
REMOTE_SCRIPT
)

printf -v quoted_prod_app_dir "%q" "$PROD_APP_DIR"
printf -v quoted_staging_app_dir "%q" "$STAGING_APP_DIR"
printf -v quoted_prod_env_file "%q" "$PROD_ENV_FILE"
printf -v quoted_staging_env_file "%q" "$STAGING_ENV_FILE"
printf -v quoted_prod_compose_file "%q" "$PROD_COMPOSE_FILE"
printf -v quoted_staging_compose_file "%q" "$STAGING_COMPOSE_FILE"
printf -v quoted_staging_compose_project "%q" "$STAGING_COMPOSE_PROJECT"

ssh "$REMOTE_HOST" \
  "PROD_APP_DIR=$quoted_prod_app_dir STAGING_APP_DIR=$quoted_staging_app_dir PROD_ENV_FILE=$quoted_prod_env_file STAGING_ENV_FILE=$quoted_staging_env_file PROD_COMPOSE_FILE=$quoted_prod_compose_file STAGING_COMPOSE_FILE=$quoted_staging_compose_file STAGING_COMPOSE_PROJECT=$quoted_staging_compose_project bash -s" \
  <<< "$remote_script"
