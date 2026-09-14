#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/autoapplication}"
CRON_FILE="${MONITOR_CRON_FILE:-/etc/cron.d/applyoverflow-health}"
# A small daily batch avoids a large WAL burst on the root-backed cluster
# while the attached volume absorbs the index tier.
TABLESPACE_MAX_MOVES="${POSTGRES_TABLESPACE_MAX_MOVES:-8}"

cat > "$CRON_FILE" <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

*/5 * * * * root APP_DIR=$APP_DIR bash $APP_DIR/deploy/single-vps/monitor-health.sh
# Repair the managed index tier during the off-peak window. The policy refuses
# table moves, respects the backup reserve, and runs a bounded migration batch.
35 4 * * * root APP_DIR=$APP_DIR POSTGRES_TABLESPACE_MAX_MOVES=$TABLESPACE_MAX_MOVES bash $APP_DIR/deploy/single-vps/postgres-tablespace-policy.sh --apply >> /var/log/autoapplication/postgres-tablespace-policy.log 2>&1
EOF

chmod 0644 "$CRON_FILE"
echo "Installed $CRON_FILE"

# The maintenance worker owns summary refreshes. Remove only the obsolete
# standalone-web command, leaving backups, supply captures and other jobs intact.
if legacy_cron="$(crontab -l 2>/dev/null)" &&
  printf '%s\n' "$legacy_cron" | grep -Fq 'exec -T app npx tsx scripts/refresh-job-feed-summary.ts'; then
  printf '%s\n' "$legacy_cron" |
    awk 'index($0, "exec -T app npx tsx scripts/refresh-job-feed-summary.ts") == 0' |
    crontab -
  echo "Removed obsolete app-container feed-summary cron; maintenance worker remains the owner."
fi
