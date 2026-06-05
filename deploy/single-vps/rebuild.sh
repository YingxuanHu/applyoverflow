#!/usr/bin/env bash
# Sync the current checkout to the single VPS, rebuild app/worker, restart them,
# then reclaim safe Docker build/image space. This intentionally never prunes
# Docker volumes because the Postgres data volume lives there.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

REMOTE_HOST="${SINGLE_VPS_HOST:-root@5.78.195.237}"
REMOTE_APP_DIR="${SINGLE_VPS_APP_DIR:-/opt/autoapplication}"
ENV_FILE="${SINGLE_VPS_ENV_FILE:-deploy/single-vps/.env.production}"
COMPOSE_FILE="${SINGLE_VPS_COMPOSE_FILE:-deploy/single-vps/docker-compose.yml}"
SERVICES="${SINGLE_VPS_SERVICES:-app worker}"

# Remove unused Docker build cache after each successful rebuild so the single
# VPS does not slowly fill up. Set DOCKER_BUILD_CACHE_MAX_AGE=24h if you want to
# keep a small recent cache for repeated rebuilds.
DOCKER_BUILD_CACHE_MAX_AGE="${DOCKER_BUILD_CACHE_MAX_AGE:-0}"
# Keep disabled by default because ops-profile images like backup-runner are not
# running services, but cron still depends on them being available.
PRUNE_UNUSED_IMAGES="${PRUNE_UNUSED_IMAGES:-0}"

RSYNC_EXCLUDES=(
  --exclude='.git'
  --exclude='.next'
  --exclude='node_modules'
  --exclude='.env'
  --exclude='.env.*'
  --exclude='.runtime'
  --exclude='logs'
  --exclude='deploy/single-vps/.env.production'
  --exclude='deploy/single-vps/backups'
)

echo "Syncing $REPO_ROOT to $REMOTE_HOST:$REMOTE_APP_DIR/"
rsync -az --delete "${RSYNC_EXCLUDES[@]}" "$REPO_ROOT/" "$REMOTE_HOST:$REMOTE_APP_DIR/"

remote_script=$(cat <<'REMOTE_SCRIPT'
set -euo pipefail

cd "$REMOTE_APP_DIR"

echo "Disk before rebuild:"
df -h /
echo
docker system df || true
echo

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

echo "Building: $SERVICES"
"${COMPOSE[@]}" build $SERVICES

echo "Restarting: $SERVICES"
"${COMPOSE[@]}" up -d --force-recreate $SERVICES

echo
echo "Pruning Docker build cache..."
if [[ "$DOCKER_BUILD_CACHE_MAX_AGE" == "0" || "$DOCKER_BUILD_CACHE_MAX_AGE" == "all" ]]; then
  docker builder prune -af
else
  docker builder prune -af --filter "until=$DOCKER_BUILD_CACHE_MAX_AGE"
fi

if [[ "$PRUNE_UNUSED_IMAGES" == "1" || "$PRUNE_UNUSED_IMAGES" == "true" ]]; then
  echo
  echo "Pruning unused Docker images..."
  docker image prune -af
fi

echo
echo "Container status:"
"${COMPOSE[@]}" ps

echo
echo "Disk after cleanup:"
df -h /
echo
docker system df || true
REMOTE_SCRIPT
)

printf -v quoted_remote_app_dir "%q" "$REMOTE_APP_DIR"
printf -v quoted_env_file "%q" "$ENV_FILE"
printf -v quoted_compose_file "%q" "$COMPOSE_FILE"
printf -v quoted_services "%q" "$SERVICES"
printf -v quoted_cache_max_age "%q" "$DOCKER_BUILD_CACHE_MAX_AGE"
printf -v quoted_prune_images "%q" "$PRUNE_UNUSED_IMAGES"

ssh "$REMOTE_HOST" \
  "REMOTE_APP_DIR=$quoted_remote_app_dir ENV_FILE=$quoted_env_file COMPOSE_FILE=$quoted_compose_file SERVICES=$quoted_services DOCKER_BUILD_CACHE_MAX_AGE=$quoted_cache_max_age PRUNE_UNUSED_IMAGES=$quoted_prune_images bash -s" \
  <<< "$remote_script"
