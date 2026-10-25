#!/usr/bin/env bash
# Build on this machine and stream images over SSH; no registry or image tar
# on the production root disk. The VPS only loads, verifies, and starts them.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain --untracked-files=normal)" ]]; then
  echo "Commit the release checkout before building." >&2
  exit 1
fi
node "$REPO_ROOT/scripts/verify-release-ci.mjs" "$SHA"
HOST="${SINGLE_VPS_HOST:-root@5.78.195.237}"
ssh "$HOST" 'set -e
  volume=/mnt/HC_Volume_105915443
  mountpoint -q "$volume"
  for directory in /var/lib/docker /var/lib/containerd; do
    mountpoint -q "$directory"
    test "$(stat -c %d "$directory")" = "$(stat -c %d "$volume")"
  done
  read -r size available < <(df -B1 --output=size,avail "$volume" | tail -1)
  test "$available" -ge "$((size / 5))"' || { echo 'Production storage preflight failed; no images transferred.' >&2; exit 1; }
BUILD=(docker buildx build --platform linux/amd64 --load --build-arg "BUILD_SHA=$SHA" --label "org.opencontainers.image.revision=$SHA")
if [[ -n "${LOCAL_RELEASE_BUILDER:-}" ]]; then BUILD+=(--builder "$LOCAL_RELEASE_BUILDER"); fi
"${BUILD[@]}" --target web -t "applyoverflow-release:$SHA-web" "$REPO_ROOT"
"${BUILD[@]}" --target runner -t "applyoverflow-release:$SHA-worker" "$REPO_ROOT"
transfer_script=$(cat <<'TRANSFER_SCRIPT'
set -euo pipefail
volume=/mnt/HC_Volume_105915443
mountpoint -q "$volume"
exec 8>"$volume/autoapplication/storage-cutover/migration.lock"
flock -n 8 || { echo 'Storage migration/deployment is in progress; no images loaded.' >&2; exit 1; }
for directory in /var/lib/docker /var/lib/containerd; do
  mountpoint -q "$directory"
  test "$(stat -c %d "$directory")" = "$(stat -c %d "$volume")"
done
read -r size available < <(df -B1 --output=size,avail "$volume" | tail -1)
test "$available" -ge "$((size / 5))"
gzip -d | docker image load
TRANSFER_SCRIPT
)
printf -v quoted_transfer_script '%q' "$transfer_script"
docker image save "applyoverflow-release:$SHA-web" "applyoverflow-release:$SHA-worker" | gzip -1 | ssh "$HOST" "bash -c $quoted_transfer_script"
SINGLE_VPS_PREBUILT_SHA="$SHA" bash "$SCRIPT_DIR/rebuild.sh"
