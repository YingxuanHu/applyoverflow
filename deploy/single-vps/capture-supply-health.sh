#!/usr/bin/env bash

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/autoapplication}"
COMPOSE_FILE="$APP_DIR/deploy/single-vps/docker-compose.yml"
ENV_FILE="$APP_DIR/deploy/single-vps/.env.production"
LOG_DIR="$APP_DIR/logs"
TIMESTAMP="$(date -u +%Y%m%d%H)"
OUTPUT_FILE="$LOG_DIR/supply-health-$TIMESTAMP.json"
TEMP_FILE="$(mktemp "$LOG_DIR/.supply-health-$TIMESTAMP.XXXXXX")"

cleanup() {
  rm -f "$TEMP_FILE"
}
trap cleanup EXIT

mkdir -p "$LOG_DIR"

# The shared Prisma bootstrap emits a short diagnostic before the report. Keep
# the durable artifact parseable JSON so health checks and future alerts can
# read it without special-case log parsing.
(
  cd "$APP_DIR"
  /usr/bin/docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T \
    worker-maintenance node_modules/.bin/tsx -r dotenv/config \
    scripts/report-supply-health.ts --json
) | awk 'found || /^\{/ { found = 1; print }' > "$TEMP_FILE"

if ! grep -q '"generatedAt"' "$TEMP_FILE"; then
  echo "Supply-health capture did not produce a report." >&2
  exit 1
fi

mv "$TEMP_FILE" "$OUTPUT_FILE"
find "$LOG_DIR" -name 'supply-health-*.json' -mtime +14 -delete
