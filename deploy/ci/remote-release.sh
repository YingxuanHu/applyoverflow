#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
mode=${1:-}
[[ $mode == deploy || $mode == rollback ]] || fail 'Expected deploy or rollback'
root=${DEPLOY_ROOT:-/opt/autoapplication}
project=${DEPLOY_COMPOSE_PROJECT:-single-vps}
compose_file="$root/deploy/single-vps/docker-compose.yml"
env_file="$root/deploy/single-vps/.env.production"
state="$root/.github-deploy"
[[ -f $compose_file && -f $env_file ]] || fail 'Missing existing production Compose configuration'
for command in docker jq flock curl; do command -v "$command" >/dev/null || fail "Missing $command"; done
mkdir -p "$state"
exec 9> "$state/release.lock"
flock -w 600 9 || fail 'Another deployment holds the server lock'

compose=(docker compose --project-name "$project" --env-file "$env_file" -f "$compose_file")
container=$("${compose[@]}" ps -q app)
[[ -n $container ]] || fail 'No existing app container; bootstrap manually first'
previous_image=$(docker inspect --format '{{.Image}}' "$container")
[[ $previous_image =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'Cannot identify current app image'
previous_sha=$(docker exec "$container" node -e \
  'fetch("http://127.0.0.1:3000/api/health", {signal: AbortSignal.timeout(5000)}).then(async r => {const h = await r.json(); if (!r.ok || h.status !== "ready") process.exit(1); console.log(h.revision)}).catch(() => process.exit(1))')
[[ $previous_sha =~ ^[a-f0-9]{40}$ ]] || fail 'Current app is not a known healthy revision; investigate before releasing'

temporary=$(mktemp -d "$state/attempt.XXXXXX")
changed=0
finished=0
write_override() {
  printf 'services:\n  app:\n    image: "%s"\n    pull_policy: never\n' "$1" > "$2"
}
activate() {
  "${compose[@]}" -f "$1" up -d --no-deps --no-build --pull never app
}
check_health() {
  local expected=$1 candidate attempt
  for ((attempt=0; attempt<${HEALTH_ATTEMPTS:-36}; attempt++)); do
    candidate=$("${compose[@]}" ps -q app) || return 1
    if docker exec "$candidate" node -e \
      'fetch("http://127.0.0.1:3000/api/health", {signal: AbortSignal.timeout(5000)}).then(async r => {const h = await r.json(); if (!r.ok || h.status !== "ready" || h.revision !== process.argv[1]) process.exit(1)}).catch(() => process.exit(1))' "$expected" \
      && curl -fsS --max-time 10 https://applyoverflow.com/api/health \
        | jq -e --arg sha "$expected" '.status == "ready" and .revision == $sha' >/dev/null; then
      return 0
    fi
    sleep "${HEALTH_DELAY:-5}"
  done
  return 1
}
cleanup() {
  local result=$?
  trap - EXIT INT TERM
  if [[ $changed == 1 && $finished == 0 ]]; then
    printf 'Deployment failed; restoring revision %s\n' "$previous_sha" >&2
    if activate "$temporary/previous.yml" && check_health "$previous_sha"; then
      printf 'Rollback verified. The release remains failed.\n' >&2
    else
      printf 'CRITICAL: rollback could not be verified; immediate operator intervention required.\n' >&2
    fi
    result=1
  fi
  rm -rf "$temporary"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
write_override "$previous_image" "$temporary/previous.yml"
# Retain the running image even while Docker recreates its container.
docker image tag "$previous_image" applyoverflow-ci:inflight

if [[ $mode == deploy ]]; then
  sha=${2:-} web=${3:-} migrations=${4:-} registry_user=${5:-}
  [[ $sha =~ ^[a-f0-9]{40}$ ]] || fail 'Invalid revision'
  [[ $web =~ ^ghcr.io/yingxuanhu/applyoverflow-web@sha256:[a-f0-9]{64}$ ]] || fail 'Expected immutable web digest'
  [[ $migrations =~ ^ghcr.io/yingxuanhu/applyoverflow-migrations@sha256:[a-f0-9]{64}$ ]] || fail 'Expected immutable migration-check digest'
  [[ $registry_user =~ ^[a-zA-Z0-9_-]+$ ]] || fail 'Invalid registry user'
  docker_root=$(docker info --format '{{.DockerRootDir}}')
  available=$(df -Pk "$docker_root" | awk 'NR == 2 {print $4}')
  [[ $available =~ ^[0-9]+$ && $available -ge 6291456 ]] || fail 'At least 6 GiB free Docker storage is required; no automatic pruning'

  export DOCKER_CONFIG="$temporary/registry"
  mkdir -p "$DOCKER_CONFIG"
  docker login ghcr.io --username "$registry_user" --password-stdin
  docker pull "$web"
  docker pull "$migrations"
  rm -rf "$DOCKER_CONFIG"
  unset DOCKER_CONFIG
  for image in "$web" "$migrations"; do
    [[ $(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image") == linux/amd64 ]] || fail 'Wrong image platform'
    [[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image") == "$sha" ]] || fail 'Image revision mismatch'
  done
  # Read-only preflight: schema changes require a separately reviewed migration rollout.
  docker run --rm --network "${project}_default" --env-file "$env_file" "$migrations"
  docker run --rm --network none "$web" node pdf-smoke/pdf-parser-smoke.mjs
  target_image=$web
else
  [[ -f $state/previous.json ]] || fail 'No previous successful deployment recorded'
  [[ -f $state/current.json ]] || fail 'No current deployment recorded'
  [[ $(jq -er .image "$state/current.json") == "$previous_image" && $(jq -er .revision "$state/current.json") == "$previous_sha" ]] || fail 'Running app changed outside CI; reconcile deployment records before rollback'
  target_image=$(jq -er .image "$state/previous.json")
  sha=$(jq -er .revision "$state/previous.json")
  [[ $target_image =~ ^sha256:[a-f0-9]{64}$ && $sha =~ ^[a-f0-9]{40}$ ]] || fail 'Invalid rollback record'
  docker image inspect "$target_image" >/dev/null
fi

expected_image=$(docker image inspect --format '{{.Id}}' "$target_image")
[[ $expected_image =~ ^sha256:[a-f0-9]{64}$ ]] || fail 'Cannot identify target image'
if [[ $expected_image == "$previous_image" ]]; then
  check_health "$sha" || fail 'Already-deployed image failed public verification'
  printf 'Image already deployed; previous rollback target preserved.\n'
  exit 0
fi
write_override "$target_image" "$temporary/target.yml"
changed=1
activate "$temporary/target.yml"
check_health "$sha" || fail 'New app failed internal or public revision checks'
current_container=$("${compose[@]}" ps -q app)
current_image=$(docker inspect --format '{{.Image}}' "$current_container")
[[ $current_image == "$expected_image" ]] || fail 'Running container does not match the requested image'
docker image tag "$previous_image" applyoverflow-ci:previous
docker image tag "$current_image" applyoverflow-ci:current
jq -n --arg image "$previous_image" --arg revision "$previous_sha" '{image:$image, revision:$revision}' > "$temporary/previous.json"
jq -n --arg image "$current_image" --arg revision "$sha" '{image:$image, revision:$revision}' > "$temporary/current.json"
mv "$temporary/previous.json" "$state/previous.json"
mv "$temporary/current.json" "$state/current.json"
cp "$temporary/target.yml" "$state/current.yml"
finished=1
printf 'Verified production web revision %s. Workers and database services were not restarted.\n' "$sha"
