#!/usr/bin/env bash
# Read-only, bounded host and PostgreSQL inventory. Does not write a report,
# delete files, vacuum, move data, or print container environment variables.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-/opt/autoapplication}"
VOLUME_MOUNT="${STORAGE_VOLUME_MOUNT:-/mnt/HC_Volume_105915443}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-single-vps-postgres-1}"
failures=0

inspect_section() {
  local label="$1"
  shift
  printf '\n[storage] %s\n' "$label"
  if ! timeout 30s "$@"; then
    echo "[storage] Section unavailable or timed out: $label" >&2
    failures=$((failures + 1))
  fi
}

date -u
inspect_section 'Root capacity and inodes' df -h /
inspect_section 'Root inodes' df -i /
if mountpoint -q "$VOLUME_MOUNT"; then
  inspect_section 'Attached volume capacity' df -h "$VOLUME_MOUNT"
  inspect_section 'Attached volume inodes' df -i "$VOLUME_MOUNT"
  inspect_section 'Attached volume usage by directory (allocated bytes)' du -x -B1 --max-depth=2 "$VOLUME_MOUNT"
else
  echo "[storage] ALERT: attached volume is not mounted: $VOLUME_MOUNT" >&2
  failures=$((failures + 1))
fi
inspect_section 'Application usage by directory (allocated bytes)' du -x -B1 --max-depth=2 "$APP_DIR"
inspect_section 'Host log usage (allocated bytes)' du -x -B1 --max-depth=1 /var/log
inspect_section 'Docker disk usage (shared layers are not additive)' docker system df
inspect_section 'Database mounts' docker inspect --format '{{range .Mounts}}{{println .Type .Source "->" .Destination}}{{end}}' "$POSTGRES_CONTAINER"
inspect_section 'Container logging configuration' bash -ec '
  ids="$(docker ps -aq)"
  for id in $ids; do
    docker inspect --format "{{.Name}} {{json .HostConfig.LogConfig}}" "$id"
  done
'
inspect_section 'PostgreSQL WAL directory (allocated bytes)' docker exec "$POSTGRES_CONTAINER" sh -c 'du -sk "$PGDATA/pg_wal"'
inspect_section 'Read-only database storage inventory' docker exec -i "$POSTGRES_CONTAINER" sh -c \
  'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$SCRIPT_DIR/storage-report.sql"
printf '\n[storage] unavailable_sections=%s; no storage changes performed\n' "$failures"
(( failures == 0 ))
