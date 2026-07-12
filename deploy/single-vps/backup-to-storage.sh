#!/usr/bin/env bash
# Dump the local compose Postgres database with the matching Postgres image,
# then upload the dump to the configured S3-compatible storage.

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

LABEL="${1:-auto}"
SAFE_LABEL="$(printf '%s' "$LABEL" | tr -cs '[:alnum:]_.-' '-')"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$SCRIPT_DIR/backups"
BACKUP_BASENAME="${SAFE_LABEL}-${POSTGRES_DB}-${STAMP}.dump"
BACKUP_FILE="$BACKUP_DIR/$BACKUP_BASENAME"

mkdir -p "$BACKUP_DIR"

cd "$REPO_ROOT"

if ! docker image inspect single-vps-backup-runner:latest >/dev/null 2>&1; then
  echo "Backup runner image missing; building backup-runner"
  "${COMPOSE[@]}" build backup-runner
fi

echo "Dumping $POSTGRES_DB to $BACKUP_FILE"
"${COMPOSE[@]}" exec -T postgres pg_dump \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -Fc > "$BACKUP_FILE"

echo "Uploading $BACKUP_BASENAME to object storage"
"${COMPOSE[@]}" run --rm backup-runner \
  npm run db:backup:storage -- \
  --upload-file="/backups/$BACKUP_BASENAME" \
  --label="$SAFE_LABEL"

if [[ "${DB_BACKUP_KEEP_LOCAL:-0}" != "1" ]]; then
  rm -f "$BACKUP_FILE"
fi

echo "Backup complete."
