#!/usr/bin/env bash
# Cold cutover of Docker AND containerd onto attached storage, retaining paths.
# A live precopy is only staging; it must never be started as a database copy.
set -euo pipefail
umask 077

MODE="${1:---preflight}"
VOLUME="${RUNTIME_VOLUME_MOUNT:-/mnt/HC_Volume_105915443}"
DEST="$VOLUME/autoapplication/runtime"
STATE="$VOLUME/autoapplication/storage-cutover"
fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ "$MODE" =~ ^--(preflight|precopy|cutover)$ ]] || fail 'Use --preflight, --precopy, or --cutover.'
[[ $(id -u) == 0 ]] || fail 'Run on the deployment host as root.'
[[ "$VOLUME" =~ ^/mnt/[a-zA-Z0-9_-]+$ ]] || fail 'Use a dedicated /mnt/<name> mount without whitespace.'
for tool in docker ctr rsync findmnt mountpoint stat df du systemctl systemd-escape flock jq; do
  command -v "$tool" >/dev/null || fail "Missing tool: $tool"
done
mountpoint -q "$VOLUME" || fail 'Attached storage is not mounted; refusing root-disk fallback.'
[[ $(stat -c %d "$VOLUME") != $(stat -c %d /) ]] || fail 'Attached storage must be on a different filesystem.'
[[ $(realpath -e "$VOLUME") == "$VOLUME" ]] || fail 'Volume mount cannot be a symlink.'
volume_uuid=$(findmnt -nr -o UUID --mountpoint "$VOLUME")
[[ "$volume_uuid" =~ ^[a-fA-F0-9-]+$ ]] || fail 'Cannot determine attached filesystem UUID.'
persistent_source=$(findmnt --fstab --evaluate -nr -o SOURCE --mountpoint "$VOLUME")
[[ -b "$persistent_source" && $(readlink -f "$persistent_source") == $(findmnt -nr -o SOURCE --mountpoint "$VOLUME") ]] || fail 'A matching persistent /etc/fstab mount is required before cutover.'
persistent_options=$(findmnt --fstab -nr -o OPTIONS --mountpoint "$VOLUME")
[[ ",$persistent_options," != *,_netdev,* ]] || fail 'Network-dependent mounts need a separate boot-order plan.'
root_free=$(df -B1 --output=avail / | tail -1)
root_inodes=$(df --output=iavail / | tail -1)
(( root_free >= 268435456 && root_inodes >= 1000 )) || fail 'Root needs 256 MiB and 1000 free inodes for cutover units and operating-system writes.'
volume_unit=$(systemd-escape --path --suffix=mount "$VOLUME")
namespaces=$(ctr namespaces list -q) || fail 'Cannot inventory containerd namespaces.'
for namespace in $namespaces; do
  tasks=$(ctr --namespace "$namespace" tasks list -q) || fail "Cannot inventory containerd tasks in $namespace."
  if [[ "$namespace" != moby && -n "$tasks" ]]; then
    fail "Non-Docker containerd tasks in $namespace require a separate shutdown plan."
  fi
done

if mountpoint -q /var/lib/docker || mountpoint -q /var/lib/containerd; then
  fail 'Runtime paths are already mounts. Inspect the existing cutover; do not rerun migration.'
fi
[[ $(docker info --format '{{.DockerRootDir}}') == /var/lib/docker ]] || fail 'Unexpected Docker root; manual migration required.'
[[ -d /var/lib/containerd && ! -L /var/lib/containerd && ! -L /var/lib/docker ]] || fail 'Unexpected runtime paths.'
[[ ! -e /etc/systemd/system/var-lib-docker.mount && ! -e /etc/systemd/system/var-lib-containerd.mount ]] || fail 'Existing runtime mount units need operator review.'
[[ ! -e /etc/systemd/system/docker.service.d/attached-storage.conf && ! -e /etc/systemd/system/containerd.service.d/attached-storage.conf ]] || fail 'Existing runtime storage guards need operator review.'

source_bytes=0
copied_bytes=0
for name in docker containerd; do
  bytes=$(du -sx -B1 "/var/lib/$name" | awk '{print $1}')
  source_bytes=$((source_bytes + bytes))
  if [[ -e "$DEST/$name" ]]; then
    [[ -f "$STATE/precopy-started" ]] || fail 'Destination exists without a migration marker.'
    bytes=$(du -sx -B1 "$DEST/$name" | awk '{print $1}')
    copied_bytes=$((copied_bytes + bytes))
  fi
done
read -r capacity free < <(df -B1 --output=size,avail "$VOLUME" | tail -1)
remaining=$((source_bytes > copied_bytes ? source_bytes - copied_bytes : 0))
reserve=$((capacity / 5))
(( reserve >= 64424509440 )) || reserve=64424509440
(( free - remaining >= reserve )) || fail "Insufficient capacity: need $remaining bytes for copy plus $reserve bytes reserve; have $free."
printf 'Preflight OK: source=%s staged=%s available=%s reserve=%s bytes\n' "$source_bytes" "$copied_bytes" "$free" "$reserve"
[[ "$MODE" != --preflight ]] || exit 0

mkdir -p "$STATE" "$DEST"
exec 9>"$STATE/migration.lock"
flock -n 9 || fail 'Another storage migration is running.'
[[ ! -L "$STATE" && ! -L "$DEST" ]] || fail 'Migration directories cannot be symlinks.'
date -u +%FT%TZ > "$STATE/precopy-started"
copy_runtime() {
  local name result
  local -a checksum=()
  [[ "$MODE" != --cutover ]] || checksum=(--checksum)
  for name in docker containerd; do
    mkdir -p "$DEST/$name"
    result=0
    # Stay on the source filesystem: BuildKit and tablespaces are separate mounts.
    # Preserve ownership, ACLs, xattrs, sparse files and hard links.
    rsync -aHAXSx "${checksum[@]}" --numeric-ids --delete-delay "/var/lib/$name/" "$DEST/$name/" || result=$?
    if (( result != 0 )); then
      [[ "$MODE" == --precopy && "$result" == 24 ]] || return "$result"
    fi
  done
}
if [[ "$MODE" == --precopy ]]; then
  copy_runtime
  date -u +%FT%TZ > "$STATE/precopy-completed"
  echo 'Precopy complete. This is NOT a valid running database copy until the cold cutover succeeds.'
  exit 0
fi

[[ "${CONFIRM_RUNTIME_MAINTENANCE:-}" == 'stop-all-containers' ]] || fail 'Explicit maintenance approval required: CONFIRM_RUNTIME_MAINTENANCE=stop-all-containers'
[[ -f "$STATE/precopy-completed" ]] || fail 'Complete --precopy before taking the host offline.'
[[ -n "${VERIFIED_BACKUP_KEY:-}" && -n "${VERIFIED_BACKUP_TIME:-}" ]] || fail 'Verify a recent off-host backup and supply VERIFIED_BACKUP_KEY and VERIFIED_BACKUP_TIME.'
backup_time=$(date -d "$VERIFIED_BACKUP_TIME" +%s) || fail 'Invalid backup timestamp.'
age=$(( $(date +%s) - backup_time ))
(( age >= 0 && age <= 86400 )) || fail 'Verified off-host backup must be less than 24 hours old.'
printf '%s\n' "$VERIFIED_BACKUP_KEY" > "$STATE/backup-key"
docker ps --format '{{.ID}}' > "$STATE/running-container-ids"
docker ps --format '{{.ID}} {{.Names}}' > "$STATE/running-container-names"
systemctl is-active cron > "$STATE/cron-state" || true
date -u +%FT%TZ > "$STATE/maintenance-started"
findmnt -rn -o TARGET,SOURCE,FSTYPE | awk '$1 ~ /^\/var\/lib\/(docker|containerd)\//' > "$STATE/child-mounts-before.txt"

# Cron must not start a backup/report container between the final copy and switch.
systemctl stop cron
mapfile -t containers < "$STATE/running-container-ids"
(( ${#containers[@]} > 0 )) || fail 'No running containers; inspect host before cutover.'
docker stop --time 120 "${containers[@]}"
[[ -z $(docker ps -q) ]] || fail 'A container is still running. Do not copy a live database.'
namespaces=$(ctr namespaces list -q) || fail 'Cannot verify stopped containerd namespaces.'
for namespace in $namespaces; do
  tasks=$(ctr --namespace "$namespace" tasks list -q) || fail "Cannot verify stopped containerd tasks in $namespace."
  [[ -z "$tasks" ]] || fail "Containerd still has active tasks in $namespace."
done
systemctl stop docker.socket docker.service containerd.service
if systemctl is-active --quiet docker.service || systemctl is-active --quiet containerd.service; then
  fail 'Runtime services did not stop.'
fi
if ps -eo comm= | awk '/^containerd-shim|^runc$/ { found=1 } END { exit !found }'; then
  fail 'A runtime shim/runc process survived shutdown; inspect it before copying.'
fi
findmnt -rn -o TARGET,SOURCE,FSTYPE | awk '$1 ~ /^\/var\/lib\/(docker|containerd)\//' > "$STATE/child-mounts-after.txt"
[[ ! -s "$STATE/child-mounts-after.txt" ]] || fail 'Nested runtime mounts survived shutdown. Inspect the recorded inventory; do not hide or skip them.'
echo 'All writers stopped. Synchronizing cold runtime directories.'
copy_runtime
for name in docker containerd; do
  # Read every byte once more while stopped, not just rsync size/mtime checks.
  rsync -aHAXSxnc --numeric-ids --delete --itemize-changes "/var/lib/$name/" "$DEST/$name/" > "$STATE/$name-verify.txt"
  [[ ! -s "$STATE/$name-verify.txt" ]] || fail "Cold-copy verification failed for $name; originals are intact."
done
sync
date -u +%FT%TZ > "$STATE/cold-copy-verified"

cat > /usr/local/sbin/applyoverflow-runtime-mount-check <<EOF
#!/usr/bin/env bash
set -euo pipefail
test "\$(findmnt -nr -o UUID --mountpoint '$VOLUME')" = '$volume_uuid'
for directory in /var/lib/docker /var/lib/containerd; do
  mountpoint -q "\$directory"
  test "\$(stat -c %d "\$directory")" = "\$(stat -c %d '$VOLUME')"
done
EOF
chmod 0755 /usr/local/sbin/applyoverflow-runtime-mount-check

for name in docker containerd; do
  unit="var-lib-$name.mount"
  cat > "/etc/systemd/system/$unit" <<EOF
[Unit]
Description=ApplyOverflow $name on attached storage
RequiresMountsFor=$VOLUME
BindsTo=$volume_unit
Before=$name.service

[Mount]
What=$DEST/$name
Where=/var/lib/$name
Type=none
Options=bind

[Install]
WantedBy=multi-user.target
EOF
  mkdir -p "/etc/systemd/system/$name.service.d"
  cat > "/etc/systemd/system/$name.service.d/attached-storage.conf" <<EOF
[Unit]
Requires=var-lib-docker.mount var-lib-containerd.mount
After=var-lib-docker.mount var-lib-containerd.mount
BindsTo=var-lib-docker.mount var-lib-containerd.mount

[Service]
ExecStartPre=/usr/local/sbin/applyoverflow-runtime-mount-check
EOF
done
systemctl daemon-reload
systemctl enable --now var-lib-containerd.mount var-lib-docker.mount
for name in docker containerd; do
  [[ $(stat -c %d "/var/lib/$name") == $(stat -c %d "$VOLUME") ]] || fail 'Wrong runtime backing filesystem.'
done
# Restarting a runtime can start restart-policy containers: the old copy becomes
# stale from here. Never silently unmount or roll back after this marker.
date -u +%FT%TZ > "$STATE/attached-runtime-started"
systemctl start containerd.service docker.service
docker start "${containers[@]}"
if grep -qx active "$STATE/cron-state"; then systemctl start cron; fi
date -u +%FT%TZ > "$STATE/cutover-completed"
echo 'Cutover complete; verify database, application, workers, backups and mounts before reclaiming the ORIGINAL root directories.'
echo 'Original directories remain underneath bind mounts. Do not delete mounted /var/lib/docker or /var/lib/containerd.'
