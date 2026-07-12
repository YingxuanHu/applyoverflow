#!/usr/bin/env bash
# Download a stored dump and restore it into the local compose Postgres database.
# This is destructive and requires CONFIRM_RESTORE=<POSTGRES_DB>.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.production"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$SCRIPT_DIR/docker-compose.yml")

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy .env.production.example and fill it first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ "${CONFIRM_RESTORE:-}" != "$POSTGRES_DB" ]]; then
  cat >&2 <<EOF
Refusing to restore $POSTGRES_DB.

This will replace data in the target database. Re-run with:

  CONFIRM_RESTORE=$POSTGRES_DB deploy/single-vps/restore-from-storage.sh

EOF
  exit 1
fi

RESTORE_KEY="${1:-latest}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$SCRIPT_DIR/backups"
RESTORE_FILE="$BACKUP_DIR/restore-${POSTGRES_DB}-${STAMP}.dump"

mkdir -p "$BACKUP_DIR"
cd "$REPO_ROOT"

if [[ "$RESTORE_KEY" == "latest" ]]; then
  echo "Downloading latest backup to $RESTORE_FILE"
  "${COMPOSE[@]}" run --rm backup-runner \
    npm run db:restore:storage -- \
    --latest \
    --download-only \
    --output-file="/backups/$(basename "$RESTORE_FILE")"
else
  echo "Downloading $RESTORE_KEY to $RESTORE_FILE"
  "${COMPOSE[@]}" run --rm backup-runner \
    npm run db:restore:storage -- \
    --key="$RESTORE_KEY" \
    --download-only \
    --output-file="/backups/$(basename "$RESTORE_FILE")"
fi

if [[ "${SKIP_PRE_RESTORE_BACKUP:-0}" != "1" ]]; then
  echo "Taking pre-restore backup before replacing the database."
  "$SCRIPT_DIR/backup-to-storage.sh" "pre-restore"
fi

echo "Restoring $POSTGRES_DB from $RESTORE_FILE"
cat "$RESTORE_FILE" | "${COMPOSE[@]}" exec -T postgres pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB"

echo "Applying Prisma migrations after restore"
"${COMPOSE[@]}" run -T --rm backup-runner npx prisma migrate deploy </dev/null

echo "Restore complete."
