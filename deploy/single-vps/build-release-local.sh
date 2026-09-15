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
HOST="${SINGLE_VPS_HOST:-root@5.78.195.237}"
BUILD=(docker buildx build --platform linux/amd64 --load --build-arg "BUILD_SHA=$SHA" --label "org.opencontainers.image.revision=$SHA")
if [[ -n "${LOCAL_RELEASE_BUILDER:-}" ]]; then BUILD+=(--builder "$LOCAL_RELEASE_BUILDER"); fi
"${BUILD[@]}" --target web -t "applyoverflow-release:$SHA-web" "$REPO_ROOT"
"${BUILD[@]}" --target runner -t "applyoverflow-release:$SHA-worker" "$REPO_ROOT"
docker image save "applyoverflow-release:$SHA-web" "applyoverflow-release:$SHA-worker" | gzip -1 | ssh "$HOST" 'set -o pipefail; gzip -d | docker image load'
SINGLE_VPS_PREBUILT_SHA="$SHA" bash "$SCRIPT_DIR/rebuild.sh"
