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

cd "$REPO_ROOT"

# Compose .env files are not shell scripts: values may contain quotes or
# characters that `source` would interpret. Read the database identity from
# the running service instead so scheduled backups do not fail before dumping.
mapfile -t POSTGRES_IDENTITY < <(
  "${COMPOSE[@]}" exec -T postgres sh -lc 'printf "%s\\n%s\\n" "$POSTGRES_DB" "$POSTGRES_USER"'
)
POSTGRES_DB="${POSTGRES_IDENTITY[0]:-}"
POSTGRES_USER="${POSTGRES_IDENTITY[1]:-}"

if [[ -z "$POSTGRES_DB" || -z "$POSTGRES_USER" ]]; then
  echo "Could not read Postgres database identity from the running service." >&2
  exit 1
fi

compose_env_value() {
  "${COMPOSE[@]}" config --environment | awk -F= -v key="$1" \
    '$1 == key { value = substr($0, index($0, "=") + 1) } END { if (value != "") print value }'
}

# Compose reads dotenv safely; never evaluate the production env file in this
# shell. The host staging directory and the container bind mount resolve from
# the same setting, so large dumps can live on an attached volume.
DB_BACKUP_KEEP_LOCAL="$(compose_env_value DB_BACKUP_KEEP_LOCAL)"
DB_BACKUP_KEEP_LOCAL="${DB_BACKUP_KEEP_LOCAL:-0}"
DB_BACKUP_HOST_DIR="$(compose_env_value DB_BACKUP_HOST_DIR)"
BACKUP_DIR="${DB_BACKUP_HOST_DIR:-$SCRIPT_DIR/backups}"

LABEL="${1:-auto}"
SAFE_LABEL="$(printf '%s' "$LABEL" | tr -cs '[:alnum:]_.-' '-')"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_BASENAME="${SAFE_LABEL}-${POSTGRES_DB}-${STAMP}.dump"
BACKUP_FILE="$BACKUP_DIR/$BACKUP_BASENAME"
backup_completed=0

cleanup_failed_backup() {
  if [[ "$backup_completed" != "1" && "$DB_BACKUP_KEEP_LOCAL" != "1" ]]; then
    rm -f "$BACKUP_FILE"
  fi
}
trap cleanup_failed_backup EXIT

mkdir -p "$BACKUP_DIR"

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
# The dump is already complete. The uploader only needs the mounted dump and
# object-storage credentials, so never let Compose recreate Postgres here.
"${COMPOSE[@]}" run --rm --no-deps backup-runner \
  npm run db:backup:storage -- \
  --upload-file="/backups/$BACKUP_BASENAME" \
  --label="$SAFE_LABEL"

if [[ "${DB_BACKUP_KEEP_LOCAL:-0}" != "1" ]]; then
  rm -f "$BACKUP_FILE"
fi

backup_completed=1
echo "Backup complete."
