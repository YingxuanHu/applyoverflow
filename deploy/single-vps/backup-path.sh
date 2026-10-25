#!/usr/bin/env bash
# Shared by backup and restore; callers supply SCRIPT_DIR and COMPOSE.

compose_env_value() {
  "${COMPOSE[@]}" config --environment | awk -F= -v key="$1" \
    '$1 == key { value = substr($0, index($0, "=") + 1) } END { if (value != "") print value }'
}

resolve_backup_directory() {
  local configured_dir volume_mount resolved_mount existing_dir staging_device volume_device
  configured_dir="$(compose_env_value DB_BACKUP_HOST_DIR)" || return 1
  volume_mount="$(compose_env_value DB_BACKUP_VOLUME_MOUNT)" || return 1
  configured_dir="${configured_dir:-$SCRIPT_DIR/backups}"
  # Compose resolves relative bind mounts from the compose file's directory.
  [[ "$configured_dir" == /* ]] || configured_dir="$SCRIPT_DIR/$configured_dir"
  BACKUP_DIR="$(realpath -m -- "$configured_dir")" || return 1

  # Older Hetzner configs need the same protection without a new env setting.
  if [[ -z "$volume_mount" && "$configured_dir" =~ ^(/mnt/HC_Volume_[^/]+)(/|$) ]]; then
    volume_mount="${BASH_REMATCH[1]}"
  fi
  if [[ -z "$volume_mount" && "$BACKUP_DIR" =~ ^(/mnt/HC_Volume_[^/]+)(/|$) ]]; then
    volume_mount="${BASH_REMATCH[1]}"
  fi
  if [[ -z "$volume_mount" ]]; then
    echo "Refusing backup/restore: set DB_BACKUP_VOLUME_MOUNT to a dedicated mounted filesystem" >&2
    return 1
  fi
  if [[ -n "$volume_mount" ]]; then
    if ! mountpoint -q -- "$volume_mount"; then
      echo "Refusing backup/restore: volume is not mounted: $volume_mount" >&2
      return 1
    fi
    resolved_mount="$(realpath -e -- "$volume_mount")" || return 1
    if [[ "$resolved_mount" == "/" || "$BACKUP_DIR" != "$resolved_mount/"* ]]; then
      echo "Refusing backup/restore: staging directory must be inside $volume_mount" >&2
      return 1
    fi
    existing_dir="$BACKUP_DIR"
    while [[ ! -d "$existing_dir" ]]; do existing_dir="$(dirname "$existing_dir")"; done
    staging_device="$(stat -c %d -- "$existing_dir")" || return 1
    volume_device="$(stat -c %d -- "$resolved_mount")" || return 1
    if [[ "$volume_device" == "$(stat -c %d /)" ]]; then
      echo "Refusing backup/restore: staging volume is on the root filesystem" >&2
      return 1
    fi
    if [[ "$staging_device" != "$volume_device" ]]; then
      echo "Refusing backup/restore: staging directory is on a different filesystem" >&2
      return 1
    fi
  fi
  # Ensure the uploader/download container uses exactly the validated path.
  export DB_BACKUP_HOST_DIR="$BACKUP_DIR"
  BACKUP_VOLUME_MOUNT="$resolved_mount"
}

require_backup_free_space() {
  local needed="$1" available
  [[ "$needed" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid free-space requirement" >&2; return 1; }
  available="$(df -B1 --output=avail "$BACKUP_VOLUME_MOUNT" | tail -1 | tr -d ' ')" || return 1
  [[ "$available" =~ ^[0-9]+$ ]] && (( available >= needed )) || {
    echo "Insufficient attached-volume space: need $needed bytes; available $available" >&2
    return 1
  }
}

# Use the checked-in recovery tools with the existing image; no rebuild or
# dependent-service recreation is permitted during backup/recovery operations.
backup_runner() {
  "${COMPOSE[@]}" run -T --rm --no-deps \
    -v "$REPO_ROOT/scripts/db-backup-storage.ts:/app/scripts/db-backup-storage.ts:ro" \
    -v "$REPO_ROOT/scripts/db-restore-storage.ts:/app/scripts/db-restore-storage.ts:ro" \
    backup-runner "$@"
}
