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
# Count full uncompressed images without crediting shared/existing layers. Allow
# another copy for import/store overhead and leave 4 GiB for live services.
image_bytes=0
for variant in web worker; do
  size="$(docker image inspect --format '{{.Size}}' "applyoverflow-release:$SHA-$variant")"
  [[ "$size" =~ ^[1-9][0-9]{0,11}$ ]] || { echo "Invalid image size: $variant" >&2; exit 1; }
  image_bytes=$((image_bytes + size))
done
required_bytes=$((2 * image_bytes + 4 * 1024 * 1024 * 1024))
printf -v quoted_containerd_root '%q' "${SINGLE_VPS_CONTAINERD_ROOT:-}"
ssh "$HOST" "bash -s -- $required_bytes $quoted_containerd_root" <<'HEADROOM'
set -euo pipefail
required_bytes="$1"
docker_root="$(docker info --format '{{.DockerRootDir}}')"
driver="$(docker info --format '{{.Driver}}')"
store="$(docker info --format '{{range .DriverStatus}}{{if eq (index . 0) "driver-type"}}{{index . 1}}{{end}}{{end}}')"
paths=("$docker_root")
case "$driver:$store" in
  overlay2:) ;;
  overlayfs:io.containerd.snapshotter.v1)
    # DockerRootDir does not identify an external containerd content/snapshot
    # store. Require its operator-verified root; never assume /var/lib/containerd.
    [[ -n "$2" ]] || { echo 'Set SINGLE_VPS_CONTAINERD_ROOT to the verified containerd data root.' >&2; exit 1; }
    paths+=("$2") ;;
  *) echo "Unrecognized Docker storage layout: $driver:$store" >&2; exit 1 ;;
esac
check_headroom() {
  local path="$1" required="$2" available_kib available_bytes
  [[ "$path" == /* && "$path" != *$'\n'* && "$path" != *$'\r'* && -d "$path" ]] || {
    echo 'Cannot resolve an absolute Docker storage directory.' >&2; return 1;
  }
  available_kib="$(LC_ALL=C df -Pk -- "$path" | awk 'NR == 2 { print $4 }')"
  [[ "$available_kib" =~ ^(0|[1-9][0-9]{0,12})$ ]] || { echo 'Cannot read filesystem headroom.' >&2; return 1; }
  available_bytes=$((available_kib * 1024))
  printf 'Import headroom: path=%s available=%s required=%s bytes\n' "$path" "$available_bytes" "$required" >&2
  (( available_bytes >= required )) || { echo 'Image import blocked: insufficient disk headroom.' >&2; return 1; }
}
# Root may still hold PostgreSQL/WAL, logs or temporary files even when Docker's
# image stores are on attached volumes. Check each actual filesystem separately.
check_headroom / "$((4 * 1024 * 1024 * 1024))"
for path in "${paths[@]}"; do check_headroom "$path" "$required_bytes"; done
HEADROOM
docker image save "applyoverflow-release:$SHA-web" "applyoverflow-release:$SHA-worker" | gzip -1 | ssh "$HOST" 'set -o pipefail; gzip -d | docker image load'
SINGLE_VPS_PREBUILT_SHA="$SHA" bash "$SCRIPT_DIR/rebuild.sh"
