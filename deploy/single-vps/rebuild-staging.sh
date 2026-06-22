#!/usr/bin/env bash
# Sync the current checkout to the staging app directory, rebuild the staging
# app/worker images, migrate the staging database, and restart staging services.
# This never touches the production Postgres volume or production app services.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

REMOTE_HOST="${SINGLE_VPS_HOST:-root@5.78.195.237}"
REMOTE_APP_DIR="${SINGLE_VPS_STAGING_APP_DIR:-/opt/autoapplication-staging}"
ENV_FILE="${SINGLE_VPS_STAGING_ENV_FILE:-deploy/single-vps/.env.staging}"
COMPOSE_FILE="${SINGLE_VPS_STAGING_COMPOSE_FILE:-deploy/single-vps/docker-compose.staging.yml}"
COMPOSE_PROJECT="${SINGLE_VPS_STAGING_COMPOSE_PROJECT:-applyoverflow-staging}"
BUILD_SERVICES="${SINGLE_VPS_STAGING_BUILD_SERVICES:-app-staging worker-ingestion-staging worker-source-workers-staging worker-maintenance-staging worker-top-picks-staging}"
SERVICES="${SINGLE_VPS_STAGING_SERVICES:-$BUILD_SERVICES}"

DOCKER_BUILD_CACHE_MAX_AGE="${DOCKER_BUILD_CACHE_MAX_AGE:-0}"
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
  --exclude='deploy/single-vps/.env.staging'
  --exclude='deploy/single-vps/backups'
)

echo "Syncing staging checkout $REPO_ROOT to $REMOTE_HOST:$REMOTE_APP_DIR/"
rsync -az --delete "${RSYNC_EXCLUDES[@]}" "$REPO_ROOT/" "$REMOTE_HOST:$REMOTE_APP_DIR/"

remote_script=$(cat <<'REMOTE_SCRIPT'
set -euo pipefail

cd "$REMOTE_APP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $REMOTE_APP_DIR/$ENV_FILE. Copy .env.staging.example and fill it first." >&2
  exit 1
fi

echo "Disk before staging rebuild:"
df -h /
echo
docker system df || true
echo

COMPOSE=(docker compose --project-name "$COMPOSE_PROJECT" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

echo "Building staging services: $BUILD_SERVICES"
"${COMPOSE[@]}" build $BUILD_SERVICES

echo "Starting staging Postgres"
"${COMPOSE[@]}" up -d postgres-staging

echo "Applying staging database migrations"
"${COMPOSE[@]}" run --rm app-staging npx prisma migrate deploy

echo "Restarting staging services: $SERVICES"
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
echo "Staging container status:"
"${COMPOSE[@]}" ps

echo
echo "Disk after staging cleanup:"
df -h /
echo
docker system df || true
REMOTE_SCRIPT
)

printf -v quoted_remote_app_dir "%q" "$REMOTE_APP_DIR"
printf -v quoted_env_file "%q" "$ENV_FILE"
printf -v quoted_compose_file "%q" "$COMPOSE_FILE"
printf -v quoted_compose_project "%q" "$COMPOSE_PROJECT"
printf -v quoted_build_services "%q" "$BUILD_SERVICES"
printf -v quoted_services "%q" "$SERVICES"
printf -v quoted_cache_max_age "%q" "$DOCKER_BUILD_CACHE_MAX_AGE"
printf -v quoted_prune_images "%q" "$PRUNE_UNUSED_IMAGES"

ssh "$REMOTE_HOST" \
  "REMOTE_APP_DIR=$quoted_remote_app_dir ENV_FILE=$quoted_env_file COMPOSE_FILE=$quoted_compose_file COMPOSE_PROJECT=$quoted_compose_project BUILD_SERVICES=$quoted_build_services SERVICES=$quoted_services DOCKER_BUILD_CACHE_MAX_AGE=$quoted_cache_max_age PRUNE_UNUSED_IMAGES=$quoted_prune_images bash -s" \
  <<< "$remote_script"
