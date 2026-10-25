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
BUILD_SERVICES="${SINGLE_VPS_BUILD_SERVICES:-app worker-ingestion worker-source-workers worker-maintenance}"
SERVICES="${SINGLE_VPS_SERVICES:-$BUILD_SERVICES}"
LEGACY_SERVICES="${SINGLE_VPS_LEGACY_SERVICES-worker}"
REMOTE_BUILDER="${SINGLE_VPS_BUILDER:-}"
PREBUILT_SHA="${SINGLE_VPS_PREBUILT_SHA:-}"
BUILD_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
if [[ -n "$PREBUILT_SHA" && "$PREBUILT_SHA" != "$BUILD_SHA" ]]; then
  echo "Prebuilt images must match this checkout's commit." >&2
  exit 1
fi
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=normal)" ]]; then
  echo "Commit the release checkout before deploying so its build revision is reproducible." >&2
  exit 1
fi
node "$REPO_ROOT/scripts/verify-release-ci.mjs" "$BUILD_SHA"
if [[ -z "$PREBUILT_SHA" && "${SINGLE_VPS_ALLOW_REMOTE_BUILD:-0}" != 1 ]]; then
  echo 'Build away from production with npm run deploy:build-local. A reviewed emergency remote build requires SINGLE_VPS_ALLOW_REMOTE_BUILD=1.' >&2
  exit 1
fi

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
  --exclude='data/uploads'
  --exclude='data/automation-screenshots'
  --exclude='logs'
  --exclude='output'
  --exclude='.playwright-cli'
  --exclude='deploy/single-vps/.env.production'
  --exclude='deploy/single-vps/backups'
)

echo "Syncing $REPO_ROOT to $REMOTE_HOST:$REMOTE_APP_DIR/"
rsync -az --delete --rsync-path='flock -n /mnt/HC_Volume_105915443/autoapplication/storage-cutover/migration.lock rsync' \
  "${RSYNC_EXCLUDES[@]}" "$REPO_ROOT/" "$REMOTE_HOST:$REMOTE_APP_DIR/"

remote_script=$(cat <<'REMOTE_SCRIPT'
set -euo pipefail

cd "$REMOTE_APP_DIR"
export BUILD_SHA
PREBUILT_SHA="${PREBUILT_SHA:-}"

echo "Disk before rebuild:"
df -h /
echo
docker system df || true
echo

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
# Do not deploy into an ongoing cutover or onto a root-backed database runtime.
VOLUME=/mnt/HC_Volume_105915443
mountpoint -q "$VOLUME" || { echo 'Attached volume is missing.' >&2; exit 1; }
for runtime in /var/lib/docker /var/lib/containerd; do
  mountpoint -q "$runtime" && [[ "$(stat -c %d "$runtime")" == "$(stat -c %d "$VOLUME")" ]] || { echo "Runtime storage is not on the attached volume: $runtime" >&2; exit 1; }
done
exec 8>"$VOLUME/autoapplication/storage-cutover/migration.lock"
flock -n 8 || { echo 'Storage migration is in progress.' >&2; exit 1; }
root_free=$(df -B1 --output=avail / | tail -1)
read -r volume_size volume_free < <(df -B1 --output=size,avail "$VOLUME" | tail -1)
(( root_free >= 5368709120 && volume_free >= volume_size / 5 )) || { echo 'Insufficient deployment disk reserve (5 GiB root and 20% attached required).' >&2; exit 1; }
BUILD_COMMAND=("${COMPOSE[@]}" build)
if [[ -n "${REMOTE_BUILDER:-}" ]]; then
  BUILD_COMMAND+=(--builder "$REMOTE_BUILDER")
fi

docker network inspect applyoverflow-edge >/dev/null 2>&1 || docker network create applyoverflow-edge >/dev/null

# Keep the prior images independently of mutable Compose tags and cache cleanup.
for variant in web worker; do
  service=worker-maintenance
  [[ "$variant" != web ]] || service=app
  # Mutable tags may already point at a candidate from a failed earlier deploy.
  previous_container=$("${COMPOSE[@]}" ps --all --quiet "$service")
  if [[ -n "$previous_container" ]]; then
    previous=$(docker inspect --format '{{.Image}}' "$previous_container")
    docker image tag "$previous" "applyoverflow-rollback:previous-$variant"
  fi
done

EXPECTED_IMAGES="$("${COMPOSE[@]}" --profile ops config --images)"
printf '%s\n' "$EXPECTED_IMAGES" | grep -Fx -e 'single-vps-backup-runner:latest' -e 'single-vps-backup-runner' >/dev/null || { echo 'Unexpected compose image name for backup-runner; refusing to retag.' >&2; exit 1; }
if [[ -n "$PREBUILT_SHA" ]]; then
  WORKER_IMAGE="applyoverflow-release:$PREBUILT_SHA-worker"
  PREBUILT_VARIANTS=(worker)
  if [[ " $BUILD_SERVICES " == *" app "* ]]; then
    PREBUILT_VARIANTS+=(web)
  fi
  for variant in "${PREBUILT_VARIANTS[@]}"; do
    IMAGE="applyoverflow-release:$PREBUILT_SHA-$variant"
    REVISION="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IMAGE")"
    PLATFORM="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$IMAGE")"
    [[ "$REVISION" == "$BUILD_SHA" && "$PLATFORM" == "linux/amd64" ]] || { echo "Candidate image verification failed: $IMAGE" >&2; exit 1; }
  done
  for service in $BUILD_SERVICES worker-maintenance; do
    if [[ "$service" == "app" ]]; then
      variant=web
    elif [[ "$service" == "worker-ingestion" || "$service" == "worker-source-workers" || "$service" == "worker-maintenance" ]]; then
      variant=worker
    else
      echo "Unsupported prebuilt service: $service" >&2
      exit 1
    fi
    target="single-vps-$service:latest"
    printf '%s\n' "$EXPECTED_IMAGES" | grep -Fx -e "$target" -e "${target%:latest}" >/dev/null || { echo "Unexpected compose image name for $service; refusing to retag." >&2; exit 1; }
    docker image tag "applyoverflow-release:$PREBUILT_SHA-$variant" "$target"
  done
else
  echo "Building: $BUILD_SERVICES"
  "${BUILD_COMMAND[@]}" $BUILD_SERVICES
  # App-only releases still need migrations from this exact checkout.
  if [[ " $BUILD_SERVICES " != *" worker-maintenance "* ]]; then
    "${BUILD_COMMAND[@]}" worker-maintenance
  fi
  WORKER_IMAGE=single-vps-worker-maintenance:latest
fi
echo "Verifying guarded HTTP transport in the candidate runtime"
"${COMPOSE[@]}" run -T --rm --no-deps worker-maintenance node --import tsx --test tests/ssrf-guard.test.ts </dev/null
if [[ " $BUILD_SERVICES " == *" app "* ]]; then
  echo "Verifying PDF generation in the candidate web runtime"
  "${COMPOSE[@]}" run -T --rm --no-deps app node pdf-smoke/pdf-runtime-smoke.mjs </dev/null
fi
echo "Applying database migrations"
"${COMPOSE[@]}" run -T --rm --no-deps worker-maintenance npx prisma migrate deploy </dev/null

echo "Restarting: $SERVICES"
"${COMPOSE[@]}" up -d --no-deps --no-build --force-recreate --wait --wait-timeout 120 $SERVICES

if [[ " $SERVICES " == *" app "* ]]; then
  "${COMPOSE[@]}" exec -T -e EXPECTED_REVISION="$BUILD_SHA" app node -e '
    fetch("http://127.0.0.1:3000/api/health", {signal: AbortSignal.timeout(10000)})
      .then(async response => { const body = await response.json(); if (!response.ok || body.status !== "ready" || body.revision !== process.env.EXPECTED_REVISION) throw new Error("Released health/revision verification failed"); })
      .catch(error => { console.error(error.message); process.exit(1); });'
fi

# Cron's ops runner must use the verified worker dependencies, including on an
# app-only release. Promote only after runtime checks, and retain its old alias.
candidate_worker=$(docker image inspect --format '{{.Id}}' "$WORKER_IMAGE")
if previous_backup=$(docker image inspect --format '{{.Id}}' single-vps-backup-runner:latest 2>/dev/null); then
  if [[ "$previous_backup" != "$candidate_worker" ]]; then
    docker image tag "$previous_backup" applyoverflow-rollback:previous-backup-runner
  fi
fi
docker image tag "$WORKER_IMAGE" single-vps-backup-runner:latest

if [[ -n "$PREBUILT_SHA" ]]; then
  # Compose's verified runtime tags keep these layers. Drop only the temporary
  # transport aliases so future safe cleanup is not pinned by every release.
  for variant in "${PREBUILT_VARIANTS[@]}"; do
    docker image rm "applyoverflow-release:$PREBUILT_SHA-$variant"
  done
fi

if [[ -n "$LEGACY_SERVICES" ]]; then
  echo
  echo "Stopping legacy services if present: $LEGACY_SERVICES"
  "${COMPOSE[@]}" stop $LEGACY_SERVICES || true
  "${COMPOSE[@]}" rm -f $LEGACY_SERVICES || true
fi

echo
if [[ -z "$PREBUILT_SHA" ]]; then
  echo "Pruning Docker build cache..."
  CACHE_PRUNE=(docker builder prune)
  if [[ -n "${REMOTE_BUILDER:-}" ]]; then
    CACHE_PRUNE=(docker buildx --builder "$REMOTE_BUILDER" prune)
  fi
  if [[ "$DOCKER_BUILD_CACHE_MAX_AGE" == "0" || "$DOCKER_BUILD_CACHE_MAX_AGE" == "all" ]]; then
    "${CACHE_PRUNE[@]}" -af
  else
    "${CACHE_PRUNE[@]}" -af --filter "until=$DOCKER_BUILD_CACHE_MAX_AGE"
  fi
fi

if [[ "$PRUNE_UNUSED_IMAGES" == "1" || "$PRUNE_UNUSED_IMAGES" == "true" ]]; then
  echo
  echo "Pruning untagged Docker images; retaining rollback and other tagged images..."
  docker image prune -f
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
printf -v quoted_build_services "%q" "$BUILD_SERVICES"
printf -v quoted_services "%q" "$SERVICES"
printf -v quoted_legacy_services "%q" "$LEGACY_SERVICES"
printf -v quoted_cache_max_age "%q" "$DOCKER_BUILD_CACHE_MAX_AGE"
printf -v quoted_prune_images "%q" "$PRUNE_UNUSED_IMAGES"
printf -v quoted_build_sha "%q" "$BUILD_SHA"
printf -v quoted_builder "%q" "$REMOTE_BUILDER"
printf -v quoted_prebuilt_sha "%q" "$PREBUILT_SHA"

ssh "$REMOTE_HOST" \
  "BUILD_SHA=$quoted_build_sha PREBUILT_SHA=$quoted_prebuilt_sha REMOTE_BUILDER=$quoted_builder REMOTE_APP_DIR=$quoted_remote_app_dir ENV_FILE=$quoted_env_file COMPOSE_FILE=$quoted_compose_file BUILD_SERVICES=$quoted_build_services SERVICES=$quoted_services LEGACY_SERVICES=$quoted_legacy_services DOCKER_BUILD_CACHE_MAX_AGE=$quoted_cache_max_age PRUNE_UNUSED_IMAGES=$quoted_prune_images bash -s" \
  <<< "$remote_script"
