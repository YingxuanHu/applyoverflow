#!/usr/bin/env bash
# Restore an exact remote object into a disposable, network-isolated cluster.
set -euo pipefail
umask 077

fail() { echo "$*" >&2; exit 1; }
[[ $# == 1 && "$1" == *.dump && "$1" != -* ]] || fail 'Usage: restore-drill.sh <exact-remote-key.dump>'
[[ "${CONFIRM_ISOLATED_RESTORE_DRILL:-}" == yes ]] || fail 'Set CONFIRM_ISOLATED_RESTORE_DRILL=yes after capacity review.'
TIMEOUT_SECONDS="${DB_RESTORE_DRILL_TIMEOUT_SECONDS:-7200}"
[[ "$TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail 'Invalid drill timeout.'
for tool in docker jq timeout flock realpath mountpoint stat df od; do command -v "$tool" >/dev/null || fail "Missing tool: $tool"; done
if [[ "${AO_DRILL_TIMED:-}" != 1 ]]; then
  exec timeout --signal=TERM --kill-after=60s "${TIMEOUT_SECONDS}s" env AO_DRILL_TIMED=1 bash "$0" "$@"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${DB_RESTORE_DRILL_ENV_FILE:-$SCRIPT_DIR/.env.production}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$SCRIPT_DIR/docker-compose.yml")
source "$SCRIPT_DIR/backup-path.sh"
resolve_backup_directory
VOLUME_DEVICE="$(stat -c %d "$BACKUP_VOLUME_MOUNT")"
mkdir -p "$BACKUP_DIR/restore-drills"
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || fail 'A backup or restore drill is already running.'

DATABASE_BYTES="${DB_RESTORE_DRILL_DATABASE_BYTES:-}"
[[ "$DATABASE_BYTES" =~ ^[1-9][0-9]*$ && ${#DATABASE_BYTES} -le 13 ]] || fail 'Set DB_RESTORE_DRILL_DATABASE_BYTES to measured pg_database_size, including tablespaces.'
read -r capacity available < <(df -B1 --output=size,avail "$BACKUP_VOLUME_MOUNT" | tail -1)
RESERVE_BYTES=$((capacity / 5))
(( RESERVE_BYTES >= 64424509440 )) || RESERVE_BYTES=64424509440
IMAGE="${DB_RESTORE_DRILL_POSTGRES_IMAGE:-postgres:18-bookworm}"
RUNNER_IMAGE="${DB_RESTORE_DRILL_RUNNER_IMAGE:-single-vps-backup-runner:latest}"
docker image inspect "$IMAGE" >/dev/null || fail 'Postgres image missing; prepare images outside the drill.'
docker image inspect "$RUNNER_IMAGE" >/dev/null || fail 'Backup runner image missing; no automatic build or pull.'

new_token() { od -An -N16 -tx1 /dev/urandom | tr -d ' \n'; }
TOKEN="$(new_token)"
[[ "$TOKEN" =~ ^[a-f0-9]{32}$ ]] || fail 'Could not generate drill namespace.'
RUN_ID="ao-restore-drill-$TOKEN"
DB_NAME="ao_restore_drill_$TOKEN"
RUN_DIR="$BACKUP_DIR/restore-drills/$RUN_ID"
[[ "$(realpath -m "$RUN_DIR")" == "$RUN_DIR" ]] || fail 'Drill path must not traverse symlinks.'
mkdir -m 700 "$RUN_DIR"
printf '%s\n' "$TOKEN" > "$RUN_DIR/.restore-drill-owner"
KEY="$1"
STARTED_AT="$(date -u +%FT%TZ)"
STARTED_SECONDS=$SECONDS
PHASE=inspect
SUCCESS=false
GUARD_PID=""
DOWNLOAD_SECONDS=0
RESTORE_SECONDS=0
CHECK_SECONDS=0
POSTGRES_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE")"

owned_container_remove() {
  local name="$1" owner
  if ! docker container inspect "$name" >/dev/null 2>&1; then
    docker info >/dev/null 2>&1 || return 1
    return 0
  fi
  owner="$(docker inspect --format '{{index .Config.Labels "applyoverflow.restore-drill"}}' "$name")" || return 1
  [[ "$name" == "$RUN_ID" || "$name" == "$RUN_ID-download" ]] && [[ "$owner" == "$TOKEN" ]] || return 1
  docker rm -f "$name" >/dev/null
}

cleanup() {
  local result=$? cleanup_ok=true
  trap - EXIT INT TERM
  if [[ -n "$GUARD_PID" ]]; then kill "$GUARD_PID" 2>/dev/null || true; wait "$GUARD_PID" 2>/dev/null || true; fi
  owned_container_remove "$RUN_ID-download" || cleanup_ok=false
  owned_container_remove "$RUN_ID" || cleanup_ok=false
  if [[ "$cleanup_ok" == true && "$(realpath -e "$RUN_DIR")" == "$RUN_DIR" &&
        ! -L "$RUN_DIR/.restore-drill-owner" && "$(< "$RUN_DIR/.restore-drill-owner")" == "$TOKEN" &&
        "$(stat -c %d "$RUN_DIR")" == "$(stat -c %d "$BACKUP_VOLUME_MOUNT")" ]]; then
    # Never remove the run directory or evidence, and never traverse another mount.
    rm -rf --one-file-system -- "$RUN_DIR/pgdata" || cleanup_ok=false
    rm -f -- "$RUN_DIR/backup.dump" "$RUN_DIR"/backup.dump.*.partial || cleanup_ok=false
  else cleanup_ok=false; fi
  [[ "$result" == 0 && "$cleanup_ok" == true ]] || SUCCESS=false
  jq -n --arg status "$SUCCESS" --arg key "$KEY" --arg runId "$RUN_ID" \
    --arg database "$DB_NAME" --arg startedAt "$STARTED_AT" --arg completedAt "$(date -u +%FT%TZ)" \
    --arg phase "$PHASE" --arg image "$POSTGRES_IMAGE_ID" --arg cleanup "$cleanup_ok" \
    --argjson exitCode "$result" --argjson totalSeconds "$((SECONDS - STARTED_SECONDS))" \
    --argjson downloadSeconds "$DOWNLOAD_SECONDS" --argjson restoreSeconds "$RESTORE_SECONDS" \
    --argjson checkSeconds "$CHECK_SECONDS" --argjson reserveBytes "$RESERVE_BYTES" \
    --slurpfile inspection "$RUN_DIR/inspection.json" --slurpfile verification "$RUN_DIR/verification.json" \
    --slurpfile checks "$RUN_DIR/checks.json" \
    '{schemaVersion:1,status:(if $status == "true" then "passed" else "failed" end),runId:$runId,key:$key,database:$database,
      startedAt:$startedAt,completedAt:$completedAt,phase:$phase,exitCode:$exitCode,postgresImageId:$image,
      timings:{totalSeconds:$totalSeconds,downloadVerifySeconds:$downloadSeconds,restoreSeconds:$restoreSeconds,checkSeconds:$checkSeconds},
      minimumFreeBytes:$reserveBytes,cleanupComplete:($cleanup == "true"),inspection:$inspection[0],verification:$verification[0],checks:$checks[0],
      pointInTimeRecovery:false,productionCutover:false,applicationJourneyVerified:false,documentObjectsVerified:false}' \
    > "$RUN_DIR/evidence.json.tmp" && mv "$RUN_DIR/evidence.json.tmp" "$RUN_DIR/evidence.json" || result=1
  echo "Restore drill evidence: $RUN_DIR/evidence.json"
  [[ "$SUCCESS" == true ]] || result=1
  exit "$result"
}
# Files exist even when an early phase fails, so failure evidence remains valid JSON.
printf 'null\n' > "$RUN_DIR/inspection.json"
printf 'null\n' > "$RUN_DIR/verification.json"
printf 'null\n' > "$RUN_DIR/checks.json"
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

remote_args=("--key=$KEY")
if [[ -n "${DB_RESTORE_DRILL_MANIFEST:-}" ]]; then
  # Explicit operator-trusted manifest permits legacy objects, never a hash
  # invented from an unverified download. Bucket/key/bytes/hash are still checked.
  cp -- "$DB_RESTORE_DRILL_MANIFEST" "$RUN_DIR/input.manifest.json"
  remote_args+=(--manifest=/drill/input.manifest.json)
fi

storage_tool() (
  local name value
  local -a environment=()
  for name in STORAGE_BUCKET STORAGE_REGION STORAGE_ENDPOINT STORAGE_ACCESS_KEY_ID STORAGE_SECRET_ACCESS_KEY STORAGE_FORCE_PATH_STYLE; do
    value="$(compose_env_value "$name")"
    export "$name=$value"
    environment+=(--env "$name")
  done
  # Only storage credentials enter this short-lived downloader. No DATABASE_URL,
  # production env-file, Docker socket, production data mount, or exposed port.
  docker run --rm --name "$RUN_ID-download" --label "applyoverflow.restore-drill=$TOKEN" \
    --memory 512m --memory-swap 512m --cpus 0.5 --pids-limit 128 \
    "${environment[@]}" --mount "type=bind,src=$RUN_DIR,dst=/drill" \
    --mount "type=bind,src=$REPO_ROOT/scripts/db-restore-storage.ts,dst=/app/scripts/db-restore-storage.ts,readonly" \
    --workdir /app --entrypoint node "$RUNNER_IMAGE" --import tsx scripts/db-restore-storage.ts "$@"
)

DRILL_PID=$$
disk_guard() {
  local free
  while kill -0 "$DRILL_PID" 2>/dev/null; do
    free="$(df -B1 --output=avail "$BACKUP_VOLUME_MOUNT" 2>/dev/null | tail -1 | tr -d ' ')" || free=0
    if ! mountpoint -q "$BACKUP_VOLUME_MOUNT" || [[ "$(stat -c %d "$BACKUP_VOLUME_MOUNT" 2>/dev/null)" != "$VOLUME_DEVICE" ]] || [[ ! "$free" =~ ^[0-9]+$ ]] || (( free < RESERVE_BYTES )); then
      echo 'Attached-volume reserve breached or mount lost; stopping only this isolated drill.' > "$RUN_DIR/disk-guard-failure.txt" 2>/dev/null || true
      owned_container_remove "$RUN_ID-download" || true
      owned_container_remove "$RUN_ID" || true
      kill -TERM "$DRILL_PID"
      return
    fi
    sleep 5
  done
}
disk_guard >/dev/null 2>&1 & GUARD_PID=$!

storage_tool "${remote_args[@]}" --inspect > "$RUN_DIR/inspection.json.tmp"
mv "$RUN_DIR/inspection.json.tmp" "$RUN_DIR/inspection.json"
DUMP_BYTES="$(jq -er '.manifest.sizeBytes | select(type == "number" and . > 0)' "$RUN_DIR/inspection.json")"
# Include the exact compressed dump, measured DB bytes, 25% expansion/WAL margin,
# and the larger of 20% filesystem capacity or 60 GiB remaining free.
REQUIRED_BYTES=$((DUMP_BYTES + DATABASE_BYTES + DATABASE_BYTES / 4 + RESERVE_BYTES))
require_backup_free_space "$REQUIRED_BYTES" || fail 'Use a larger external isolated host. Do not reduce the reserve to force a production-host drill.'
PHASE=download
phase_started=$SECONDS
storage_tool "${remote_args[@]}" --download-only --output-file=/drill/backup.dump > "$RUN_DIR/verification.json.tmp"
mv "$RUN_DIR/verification.json.tmp" "$RUN_DIR/verification.json"
DOWNLOAD_SECONDS=$((SECONDS - phase_started))
require_backup_free_space "$((DATABASE_BYTES + DATABASE_BYTES / 4 + RESERVE_BYTES))"

PHASE=initialize
mkdir -m 700 "$RUN_DIR/pgdata"
export POSTGRES_PASSWORD="$TOKEN-$(new_token)"
docker run -d --name "$RUN_ID" --label "applyoverflow.restore-drill=$TOKEN" \
  --network none --memory 2g --memory-swap 2g --cpus 1 --pids-limit 128 --shm-size 128m \
  --env POSTGRES_USER=drill_owner --env POSTGRES_PASSWORD --env POSTGRES_DB=postgres \
  --env PGDATA=/var/lib/postgresql/data \
  --mount "type=bind,src=$RUN_DIR/pgdata,dst=/var/lib/postgresql" \
  --mount "type=bind,src=$RUN_DIR/backup.dump,dst=/restore/backup.dump,readonly" \
  "$IMAGE" postgres -c listen_addresses= -c max_connections=10 -c shared_buffers=128MB \
  -c work_mem=8MB -c maintenance_work_mem=128MB -c max_locks_per_transaction=512 >/dev/null
unset POSTGRES_PASSWORD
ready=false
for ((attempt=0; attempt<120; attempt++)); do
  if docker exec "$RUN_ID" pg_isready -U drill_owner -d postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ "$ready" == true ]] || fail 'Isolated Postgres did not become ready.'
docker inspect "$RUN_ID" | jq -e --arg token "$TOKEN" '.[0] | .Config.Labels["applyoverflow.restore-drill"] == $token and .HostConfig.NetworkMode == "none" and ((.HostConfig.PortBindings // {}) | length) == 0 and .HostConfig.Memory == 2147483648' >/dev/null
docker exec "$RUN_ID" createdb -U drill_owner --template=template0 "$DB_NAME"
psql_drill() { docker exec -i "$RUN_ID" psql -X -qAt -v ON_ERROR_STOP=1 -U drill_owner -d "$DB_NAME" "$@"; }
[[ "$(psql_drill -c "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()")" == 0 ]] || fail 'Unexpected target database connections.'
psql_drill -c "CREATE SCHEMA ao_restore_drill_guard; CREATE TABLE ao_restore_drill_guard.sentinel (token text PRIMARY KEY); INSERT INTO ao_restore_drill_guard.sentinel VALUES ('$TOKEN');"

PHASE=restore
phase_started=$SECONDS
# Fresh target only, no --clean, no migrations, no production roles/tablespaces.
docker exec "$RUN_ID" pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --no-tablespaces \
  -U drill_owner -d "$DB_NAME" /restore/backup.dump 2> "$RUN_DIR/restore.log"
RESTORE_SECONDS=$((SECONDS - phase_started))
[[ "$(psql_drill -c 'SELECT token FROM ao_restore_drill_guard.sentinel')" == "$TOKEN" ]] || fail 'Target sentinel changed.'

PHASE=check
phase_started=$SECONDS
psql_drill < "$SCRIPT_DIR/restore-drill-checks.sql" > "$RUN_DIR/checks.json.tmp"
mv "$RUN_DIR/checks.json.tmp" "$RUN_DIR/checks.json"
jq -e '.schemaPresent and .sentinelPresent and .invalidIndexes == 0 and .unvalidatedConstraints == 0 and .checkConstraintViolations == 0' "$RUN_DIR/checks.json" >/dev/null
if [[ -n "${DB_RESTORE_DRILL_BASELINE_FILE:-}" ]]; then
  cp -- "$DB_RESTORE_DRILL_BASELINE_FILE" "$RUN_DIR/baseline.json"
  jq -e --slurpfile baseline "$RUN_DIR/baseline.json" '.exactCounts as $actual | $baseline[0] | to_entries | length > 0 and all(.[]; . as $row | $actual[$row.key] == $row.value)' "$RUN_DIR/checks.json" >/dev/null
fi
CHECK_SECONDS=$((SECONDS - phase_started))
PHASE=complete
SUCCESS=true
