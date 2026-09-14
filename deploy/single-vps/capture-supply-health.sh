#!/usr/bin/env bash

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/autoapplication}"
COMPOSE_FILE="$APP_DIR/deploy/single-vps/docker-compose.yml"
ENV_FILE="$APP_DIR/deploy/single-vps/.env.production"
LOG_DIR="${SUPPLY_HEALTH_LOG_DIR:-$APP_DIR/logs}"
mkdir -p "$LOG_DIR"
# A slow capture must not overlap the next cron run.
exec 9>"$LOG_DIR/.supply-health.lock"
flock -n 9 || exit 0
TIMESTAMP="$(date -u +%Y%m%d%H)"
OUTPUT_FILE="$LOG_DIR/supply-health-$TIMESTAMP.json"
TEMP_FILE="$(mktemp "$LOG_DIR/.supply-health-$TIMESTAMP.XXXXXX")"

cleanup() {
  rm -f "$TEMP_FILE"
}
trap cleanup EXIT

# The shared Prisma bootstrap emits a short diagnostic before the report. Keep
# the durable artifact parseable JSON so health checks and future alerts can
# read it without special-case log parsing.
(
  cd "$APP_DIR"
  timeout 480s /usr/bin/docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T \
    worker-maintenance node_modules/.bin/tsx -r dotenv/config \
    scripts/report-supply-health.ts --json
) | awk 'found || /^\{/ { found = 1; print }' > "$TEMP_FILE"

# Validate with the runtime's JSON parser before replacing the previous sample.
/usr/bin/docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T worker-maintenance \
  node -e 'let input="";process.stdin.on("data",c=>input+=c).on("end",()=>{const r=JSON.parse(input);if(!r.generatedAt || !r.publicBoard)process.exit(1);if(r.complete===false)console.error("Supply-health capture is partial: "+r.warnings.join("; "));});' < "$TEMP_FILE"

mv "$TEMP_FILE" "$OUTPUT_FILE"
find "$LOG_DIR" -maxdepth 1 -type f -name 'supply-health-*.json' -mtime +14 -delete
