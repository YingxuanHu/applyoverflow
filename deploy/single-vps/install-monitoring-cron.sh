#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/autoapplication}"
CRON_FILE="/etc/cron.d/applyoverflow-health"

cat > "$CRON_FILE" <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

*/5 * * * * root APP_DIR=$APP_DIR bash $APP_DIR/deploy/single-vps/monitor-health.sh
EOF

chmod 0644 "$CRON_FILE"
echo "Installed $CRON_FILE"
