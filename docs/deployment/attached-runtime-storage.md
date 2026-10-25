# Fixed Root, Expandable Runtime Storage

The operating-system disk is fixed. Keep the entire Docker data directory and
containerd content/snapshots on attached storage. Moving only PostgreSQL indexes
does not relocate its heap, WAL, Docker images, or containerd snapshots.

`deploy/single-vps/migrate-runtime-storage.sh` keeps the existing runtime paths
using systemd-managed bind mounts. Compose volume names and internal absolute
paths remain unchanged. Both daemons require their storage mounts before they
start. A missing volume must fail closed, never initialize an empty database on
root. The existing external PostgreSQL tablespace and BuildKit mounts remain on
the same attached volume; `rsync -x` deliberately does not copy them recursively.

## Preconditions

- Read the script, inventory all containers, and approve a maintenance window.
- Expand the provider volume AND its filesystem. Verify the actual mount/device.
- Inspect a recent off-host backup using the storage API. Upload success alone
  is not restore evidence; a timed isolated restore drill remains a separate gate.
- Allow room for runtime data plus at least 20% headroom (minimum 60 GiB), backup
  staging, and the isolated restore. Do not run a restore concurrently with copy.
- Ensure SSH/provider console access is available if a service fails to restart.
- Do not run releases, pruning, backups, or other storage migration concurrently.

## Cutover

Run on the host as root:

```bash
bash deploy/single-vps/migrate-runtime-storage.sh --preflight
bash deploy/single-vps/migrate-runtime-storage.sh --precopy
# Verify the off-host object timestamp/size first, then supply its real identity.
VERIFIED_BACKUP_KEY='<verified object key>' VERIFIED_BACKUP_TIME='<UTC timestamp>' \
  CONFIRM_RUNTIME_MAINTENANCE=stop-all-containers \
  bash deploy/single-vps/migrate-runtime-storage.sh --cutover
```

The live precopy is not a recoverable database. Cutover stops cron, all containers,
Docker and containerd, completes a cold copy, and checks every copied byte before
installing the mounts. Original root files are retained, not deleted. Evidence
and the originally running container IDs are stored under the attached volume's
`autoapplication/storage-cutover` directory (private permissions).

Verify PostgreSQL identity/version/database size and key account/application
counts, migration history, `pg_isready`, application health/revision, authenticated
read-only journeys, all expected workers, table/index access, and backup storage
access. Check both runtime paths with `findmnt` and compare device IDs to the
attached volume. Review database logs for corruption or tablespace errors.

## Failure And Rollback

The script stops on error; it never guesses that a stale database is safe. If it
fails BEFORE `attached-runtime-started`, no new runtime writes have been accepted.
Inspect the phase evidence, stop daemons, unmount only migration-created runtime
mounts if present, disable/remove those mount units and drop-ins, reload systemd,
and start the original runtime and recorded containers. Restore cron's prior
state. Do not discard the cold copy until the cause is understood.

AFTER `attached-runtime-started`, original root data can be stale. Do not switch
back by merely unmounting. Quiesce all writers and copy the current data back only
if root has sufficient space, or restore to a separate adequately sized target.
Record the recovery point and verify before returning traffic.

## Reclaim Root

Only after all verification passes: expose the root filesystem through a
non-recursive bind mount in a private maintenance directory. Confirm that its
`var/lib/docker` and `var/lib/containerd` have the root device ID, while the live
paths have the attached device ID. Copy critical recovery evidence off-host,
then remove only those obsolete root copies. Never run removal against the live
runtime paths or use Docker volume pruning. Removing the retained copy makes
off-host backup/restore the recovery route; an old copy is not a live rollback.

Monitor attached-volume free bytes, growth rate and headroom. Root still needs
a small operational reserve for the OS and bounded logs; a genuinely exhausted
root must not be ignored. Database and image growth should no longer consume it.
