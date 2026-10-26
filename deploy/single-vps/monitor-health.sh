#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_DIR="${APP_DIR:-/opt/autoapplication}"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/single-vps/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-deploy/single-vps/.env.production}"
LOG_FILE="${MONITOR_LOG_FILE:-/var/log/autoapplication/health-alerts.log}"
STATE_FILE="${MONITOR_STATE_FILE:-$LOG_FILE.state.json}"
REPEAT_SECONDS="${MONITOR_ALERT_REPEAT_SECONDS:-86400}"
RECOVERY_SECONDS="${MONITOR_RECOVERY_STABLE_SECONDS:-600}"
RETRY_SECONDS="${MONITOR_DELIVERY_RETRY_SECONDS:-900}"
NOTIFICATION_POLICY="${MONITOR_NOTIFICATION_POLICY_FILE:-$(dirname "${BASH_SOURCE[0]}")/monitor-notification-policy.jq}"
BACKUP_MAX_AGE_SECONDS="${MONITOR_BACKUP_MAX_AGE_SECONDS:-93600}"

DISK_WARN_PERCENT="${MONITOR_DISK_USAGE_WARN_PERCENT:-85}"
MEM_AVAILABLE_WARN_MB="${MONITOR_MEMORY_AVAILABLE_WARN_MB:-768}"
SWAP_WARN_PERCENT="${MONITOR_SWAP_USAGE_WARN_PERCENT:-80}"
LOAD_WARN_PER_CORE="${MONITOR_LOAD_WARN_PER_CORE:-2.0}"
FIVE_XX_WARN_COUNT="${MONITOR_5XX_WARN_COUNT:-20}"
TABLESPACE_POLICY_SCRIPT="${POSTGRES_TABLESPACE_POLICY_SCRIPT:-$APP_DIR/deploy/single-vps/postgres-tablespace-policy.sh}"

mkdir -p "$(dirname "$LOG_FILE")"
mkdir -p "$(dirname "$STATE_FILE")"
if ! command -v jq >/dev/null; then
  printf '%s delivery-unverified: jq unavailable; health checks could not run\n' "$(date -Is)" >> "$LOG_FILE"
  exit 1
fi
for seconds in "$REPEAT_SECONDS" "$BACKUP_MAX_AGE_SECONDS" "$RECOVERY_SECONDS" "$RETRY_SECONDS"; do
  [[ "$seconds" =~ ^[1-9][0-9]*$ ]] || exit 1
done
if command -v flock >/dev/null; then
  exec 9>"$STATE_FILE.lock"
  flock -n 9 || exit 0
fi

# Docker Compose env files are not shell programs; some valid Compose values
# cannot be sourced by Bash. Read only the optional alert webhook literally.
read_compose_env_value() {
  local key="$1"
  local line value env_path="$ENV_FILE"
  [[ "$env_path" == /* ]] || env_path="$APP_DIR/$env_path"
  [[ -f "$env_path" ]] || return 0
  line="$(awk -v key="$key" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }' "$env_path")"
  value="$line"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

if [[ -z "${MONITOR_ALERT_WEBHOOK_URL:-}" ]]; then
  MONITOR_ALERT_WEBHOOK_URL="$(read_compose_env_value MONITOR_ALERT_WEBHOOK_URL)"
fi
if [[ -z "${MONITOR_ALERT_EMAIL:-}" ]]; then
  MONITOR_ALERT_EMAIL="$(read_compose_env_value MONITOR_ALERT_EMAIL)"
fi

send_smtp_alert() {
  local payload="$1" response
  [[ "${MONITOR_ALERT_EMAIL:-}" == alvin.hu@mail.utoronto.ca && -r "$APP_DIR/scripts/send-health-alert.mjs" ]] || return 1
  # Existing worker environment owns SMTP secrets. Only fixed code lists cross
  # stdin; the checked-in helper source contains no credentials or log contents.
  response="$(cd "$APP_DIR" && printf '%s' "$payload" | timeout 40s docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" \
    exec -T --workdir /app -e "MONITOR_ALERT_EMAIL=$MONITOR_ALERT_EMAIL" worker-maintenance \
    node --input-type=module -e "$(< "$APP_DIR/scripts/send-health-alert.mjs")" -- --send-health-alert 2>/dev/null)" || return 1
  jq -e '.delivery == "smtp-accepted"' <<< "$response" >/dev/null 2>&1
}

alerts=()
alert_keys=()

add_alert() {
  alerts+=("$1")
  alert_keys+=("${2:-$1}")
}

root_disk_pct="$(df -P / | awk 'NR == 2 { gsub("%", "", $5); print $5 }')"
if [[ "$root_disk_pct" =~ ^[0-9]+$ ]] && (( root_disk_pct >= DISK_WARN_PERCENT )); then
  add_alert "root disk is ${root_disk_pct}% full" root-disk
fi

volume_mount="${MONITOR_VOLUME_MOUNT:-$(read_compose_env_value DB_BACKUP_VOLUME_MOUNT)}"
volume_mount="${volume_mount:-/mnt/HC_Volume_105915443}"
if mountpoint -q "$volume_mount"; then
  volume_disk_pct="$(df -P "$volume_mount" | awk 'NR == 2 { gsub("%", "", $5); print $5 }')"
  if [[ "$volume_disk_pct" =~ ^[0-9]+$ ]] && (( volume_disk_pct >= DISK_WARN_PERCENT )); then
    add_alert "backup volume is ${volume_disk_pct}% full" volume-disk
  fi
else
  add_alert "required backup/runtime volume is not mounted: $volume_mount" volume-missing
fi

backup_dir="${MONITOR_BACKUP_DIR:-$(read_compose_env_value DB_BACKUP_HOST_DIR)}"
backup_dir="${backup_dir:-$APP_DIR/deploy/single-vps/backups}"
[[ "$backup_dir" == /* ]] || backup_dir="$APP_DIR/deploy/single-vps/$backup_dir"
receipt="$backup_dir/latest-verified-backup.json"
now="$(date +%s)"
if [[ ! -f "$receipt" ]]; then
  add_alert 'verified backup receipt missing; off-host backup age and integrity are unknown' backup-receipt
elif ! backup_epoch="$(jq -er '
  select(.status == "verified" and .manifest.schemaVersion == 1) | .manifest |
  select((.sizeBytes | type) == "number" and .sizeBytes > 0 and (.sha256 | test("^[a-f0-9]{64}$"))) |
  select((.key | endswith(".dump")) and (.bucket | length > 0)) |
  (.remoteVerifiedAt | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) as $verified |
  (.createdAt | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) as $created |
  select($created <= $verified and $verified <= now + 300) | $created' "$receipt" 2>/dev/null)"; then
  add_alert 'verified backup receipt invalid; backup integrity is unknown' backup-receipt
elif (( now - backup_epoch > BACKUP_MAX_AGE_SECONDS || backup_epoch > now + 300 )); then
  add_alert "verified backup is stale or future-dated (age $((now - backup_epoch))s; limit ${BACKUP_MAX_AGE_SECONDS}s)" backup-age
fi
if [[ -f "$backup_dir/last-backup-failure.txt" ]]; then
  add_alert 'last database backup attempt failed; inspect backup logs' backup-failure
fi

if [[ -x "$TABLESPACE_POLICY_SCRIPT" ]]; then
  if ! tablespace_report="$(
    APP_DIR="$APP_DIR" \
      COMPOSE_FILE="$COMPOSE_FILE" \
      ENV_FILE="$ENV_FILE" \
      "$TABLESPACE_POLICY_SCRIPT" --check 2>&1
  )"; then
    tablespace_report="$(printf '%s\n' "$tablespace_report" | awk '!/\[tablespace-policy\] resident /')"
    tablespace_report="${tablespace_report//$'\n'/; }"
    add_alert "PostgreSQL tablespace policy: ${tablespace_report:0:700}" tablespace-policy
  fi
fi

mem_available_mb="$(free -m | awk '/^Mem:/ { print $7 }')"
if [[ "$mem_available_mb" =~ ^[0-9]+$ ]] && (( mem_available_mb < MEM_AVAILABLE_WARN_MB )); then
  add_alert "available memory is ${mem_available_mb}MB" memory
fi

swap_pct="$(free -m | awk '/^Swap:/ { if ($2 > 0) printf "%.0f", ($3 / $2) * 100; else print 0 }')"
if [[ "$swap_pct" =~ ^[0-9]+$ ]] && (( swap_pct >= SWAP_WARN_PERCENT )); then
  add_alert "swap usage is ${swap_pct}%" swap
fi

load_1m="$(awk '{ print $1 }' /proc/loadavg)"
cpu_count="$(nproc 2>/dev/null || echo 1)"
load_too_high="$(awk -v current_load="$load_1m" -v cpus="$cpu_count" -v warn="$LOAD_WARN_PER_CORE" 'BEGIN { print (current_load > cpus * warn) ? 1 : 0 }')"
if [[ "$load_too_high" == "1" ]]; then
  add_alert "1m load is ${load_1m} on ${cpu_count} CPUs" load
fi

supply_log_dir="${SUPPLY_HEALTH_LOG_DIR:-$APP_DIR/logs}"
recent_supply_report=""
if [[ -d "$supply_log_dir" ]]; then
  recent_supply_report="$(find "$supply_log_dir" -maxdepth 1 -type f -name 'supply-health-*.json' -mmin -120 -print | sort | tail -1)"
fi
if [[ -z "$recent_supply_report" ]]; then
  add_alert "supply-health report missing or over 2 hours old" supply-missing
elif grep -Eq '"complete"[[:space:]]*:[[:space:]]*false' "$recent_supply_report"; then
  add_alert "supply-health report is partial; inspect section query budgets" supply-partial
fi

if command -v docker >/dev/null 2>&1 && [[ -d "$APP_DIR" ]]; then
  compose=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
  if ! unhealthy="$(
    cd "$APP_DIR" &&
      "${compose[@]}" ps --format '{{.Name}} {{.State}} {{.Health}}' 2>/dev/null |
      awk '$2 != "running" || ($3 != "" && $3 != "healthy") { print }'
  )"; then
    add_alert "could not inspect container health" container-inspection
  elif [[ -n "$unhealthy" ]]; then
    add_alert "container health issue: ${unhealthy//$'\n'/; }" container-health
  fi

  if ! five_xx_count="$(
    cd "$APP_DIR" &&
      "${compose[@]}" logs --since 5m caddy 2>/dev/null |
      awk '/"status":[[:space:]]*5[0-9][0-9]/ { count++ } END { print count + 0 }'
  )"; then
    add_alert "could not inspect Caddy errors" caddy-inspection
  elif [[ "$five_xx_count" =~ ^[0-9]+$ ]] && (( five_xx_count >= FIVE_XX_WARN_COUNT )); then
    add_alert "Caddy logged ${five_xx_count} 5xx responses in the last 5 minutes" caddy-5xx
  fi
fi

if [[ -z "${MONITOR_ALERT_WEBHOOK_URL:-}" && -z "${MONITOR_ALERT_EMAIL:-}" ]]; then
  add_alert 'delivery-unverified: no alert webhook or SMTP recipient configured; local logs are not off-host notification' alert-delivery
fi
current='{}'
for ((i=0; i<${#alerts[@]}; i++)); do
  current="$(jq -cn --argjson active "$current" --arg key "${alert_keys[$i]}" --arg message "${alerts[$i]}" '$active + {($key):$message}')"
done
previous='{"alerts":{},"lastLoggedAt":0,"lastDeliveredAt":0,"delivery":"delivery-unverified"}'
if [[ -f "$STATE_FILE" ]]; then
  previous="$(jq -ce 'select((.alerts | type) == "object" and (.lastLoggedAt | type) == "number" and (.lastDeliveredAt | type) == "number")' "$STATE_FILE")" || {
    printf '%s delivery-unverified: monitor state invalid; rebuilding dedup state\n' "$(date -Is)" >> "$LOG_FILE"
    previous='{"alerts":{},"lastLoggedAt":0,"lastDeliveredAt":0,"delivery":"delivery-unverified"}'
  }
fi
changes="$(jq -cn --argjson prior "$previous" --argjson active "$current" '
  {opened:($active | with_entries(select(.key as $key | $prior.alerts | has($key) | not))),
   recovered:($prior.alerts | with_entries(select(.key as $key | $active | has($key) | not)))}')"
last_logged="$(jq -r '.lastLoggedAt' <<< "$previous")"
last_delivered="$(jq -r '.lastDeliveredAt' <<< "$previous")"
delivery="$(jq -r '.delivery' <<< "$previous")"
if [[ -z "${MONITOR_ALERT_WEBHOOK_URL:-}" && -z "${MONITOR_ALERT_EMAIL:-}" ]]; then delivery=delivery-unverified; fi
plan="$(jq -cn --argjson previous "$previous" --argjson active "$current" --argjson now "$now" \
  --argjson repeatSeconds "$REPEAT_SECONDS" --argjson recoverySeconds "$RECOVERY_SECONDS" \
  --argjson retrySeconds "$RETRY_SECONDS" --argjson test "$([[ "${MONITOR_TEST_ALERT:-0}" == 1 ]] && echo true || echo false)" \
  -f "$NOTIFICATION_POLICY")"
# Read-only operator preview: do not send, consume notification state, or log a delivery.
if [[ "${MONITOR_NOTIFICATION_DRY_RUN:-0}" == 1 ]]; then
  jq '{send,pending,payload}' <<< "$plan"
  exit 0
fi
notifications="$(jq -c '.attempted' <<< "$plan")"
pending="$(jq -r '.pending' <<< "$plan")"
send="$(jq -r '.send' <<< "$plan")"
log_event=false
if jq -e '(.opened | length) + (.recovered | length) > 0' <<< "$changes" >/dev/null || \
  (( ${#alerts[@]} > 0 && now - last_logged >= REPEAT_SECONDS )); then log_event=true; fi
message="$(jq -rn --arg host "$(hostname)" --argjson active "$current" --argjson changes "$changes" '
  "ApplyOverflow health on " + $host + ": " +
  (if ($active | length) == 0 then "all monitored conditions recovered" else ($active | to_entries | map(.value) | join("; ")) end) +
  (if ($changes.recovered | length) > 0 then "; RECOVERED: " + ($changes.recovered | keys | join(", ")) else "" end)')"
notification=suppressed
if [[ "$send" == true ]]; then
  payload="$(jq -c '.payload' <<< "$plan")"
  # Delivery recoveries compare against the last accepted notification, not the
  # preceding poll. Failed sends retain that baseline and retry with a cooldown.
  notification="$(jq -r '.payload.kind' <<< "$plan")"
  mail_recovered="$(jq -r '.payload.recovered | join(", ")' <<< "$plan")"
  webhook_message="$message"
  [[ -z "$mail_recovered" ]] || webhook_message="$webhook_message; NOTIFIED RECOVERIES: $mail_recovered"
  pending=true
  delivery=delivery-unverified
  if [[ -n "${MONITOR_ALERT_WEBHOOK_URL:-}" ]]; then
    http_status="$(curl -fsS -m 8 -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "$(jq -cn --arg text "$webhook_message" '{text:$text}')" "$MONITOR_ALERT_WEBHOOK_URL" 2>/dev/null)" || http_status=failed
    if [[ "$http_status" =~ ^2[0-9][0-9]$ ]]; then
      delivery=webhook-accepted
      last_delivered="$now"
      pending=false
    else delivery=delivery-unverified; fi
  fi
  if [[ "$delivery" != webhook-accepted && -n "${MONITOR_ALERT_EMAIL:-}" ]]; then
    if send_smtp_alert "$payload"; then delivery=smtp-accepted; pending=false; last_delivered="$now"; fi
  fi
  if [[ "$pending" == false ]]; then notifications="$(jq -c '.delivered' <<< "$plan")"; fi
  log_event=true
fi
if [[ "$log_event" == true ]]; then
  printf '%s %s notification=%s delivery=%s\n' "$(date -Is)" "$message" "$notification" "$delivery" >> "$LOG_FILE"
  last_logged="$now"
fi
jq -n --argjson alerts "$current" --argjson lastLoggedAt "$last_logged" --argjson lastDeliveredAt "$last_delivered" \
  --argjson pendingDelivery "$pending" --arg delivery "$delivery" --argjson notifications "$notifications" \
  '{alerts:$alerts,lastLoggedAt:$lastLoggedAt,lastDeliveredAt:$lastDeliveredAt,delivery:$delivery,pendingDelivery:$pendingDelivery,notifications:$notifications}' > "$STATE_FILE.$$.tmp"
mv "$STATE_FILE.$$.tmp" "$STATE_FILE"
