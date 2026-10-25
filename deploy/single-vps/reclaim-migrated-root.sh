#!/usr/bin/env bash
# Remove ONLY the hidden, obsolete root copies after a verified cold cutover.
set -euo pipefail
umask 077
VOLUME="${RUNTIME_VOLUME_MOUNT:-/mnt/HC_Volume_105915443}"
STATE="$VOLUME/autoapplication/storage-cutover"
fail() { echo "$*" >&2; exit 1; }
[[ $(id -u) == 0 ]] || fail 'Root required.'
[[ "${CONFIRM_RECLAIM_OLD_RUNTIME:-}" == 'verified-attached-runtime' ]] || fail 'Verify migrated databases/application before approving reclamation.'
[[ -f "$STATE/cutover-completed" && -f "$STATE/cold-copy-verified" && -s "$STATE/backup-key" ]] || fail 'Missing cutover/backup evidence.'
mountpoint -q "$VOLUME" || fail 'Attached volume missing.'
root_device=$(stat -c %d /)
volume_device=$(stat -c %d "$VOLUME")
[[ "$root_device" != "$volume_device" ]] || fail 'Volume is on root.'
for name in docker containerd; do
  mountpoint -q "/var/lib/$name" || fail 'Runtime mount missing.'
  [[ $(stat -c %d "/var/lib/$name") == "$volume_device" ]] || fail 'Runtime is not on attached storage.'
done
[[ $(docker inspect -f '{{.State.Health.Status}}' single-vps-postgres-1) == healthy ]] || fail 'Production database is not healthy.'
[[ $(docker inspect -f '{{.State.Health.Status}}' single-vps-app-1) == healthy ]] || fail 'Production web application is not healthy.'
/usr/local/sbin/applyoverflow-runtime-mount-check || fail 'Persistent runtime identity guard failed.'
exec 9>"$STATE/migration.lock"
flock -n 9 || fail 'Migration/deployment is running.'
view=$(mktemp -d /run/applyoverflow-root-view.XXXXXX)
cleanup() { mountpoint -q "$view" && umount "$view"; rmdir "$view"; }
trap cleanup EXIT
mount --bind / "$view"
mount --make-private "$view"
for name in docker containerd; do
  path="$view/var/lib/$name"
  [[ -d "$path" && ! -L "$path" && $(stat -c %d "$path") == "$root_device" ]] || fail 'Old runtime path is not on root.'
  [[ $(stat -c '%d:%i' "$path") != $(stat -c '%d:%i' "/var/lib/$name") ]] || fail 'Old and live runtime are the same directory.'
  # A non-recursive root bind must not expose any nested runtime mounts.
  [[ $(findmnt -n -o TARGET -T "$path") == "$view" ]] || fail 'Unexpected mount under the root view.'
  echo "Reclaiming obsolete root copy: /var/lib/$name (NOT the live mount)"
  # Preserve the mount-point directory itself for subsequent boots.
  find "$path" -mindepth 1 -maxdepth 1 -exec rm -rf --one-file-system -- {} +
done
date -u +%FT%TZ > "$STATE/root-reclaimed"
df -h / "$VOLUME"
