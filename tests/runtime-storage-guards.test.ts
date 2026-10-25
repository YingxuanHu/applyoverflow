import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";

const migration = readFileSync("deploy/single-vps/migrate-runtime-storage.sh", "utf8");
const reclaim = readFileSync("deploy/single-vps/reclaim-migrated-root.sh", "utf8");

test("runtime maintenance scripts parse and refuse unrecognized modes before any mutation", () => {
  for (const path of ["migrate-runtime-storage.sh", "reclaim-migrated-root.sh", "rebuild.sh", "build-release-local.sh"]) {
    execFileSync("bash", ["-n", `deploy/single-vps/${path}`]);
  }
  const invalid = spawnSync("bash", ["deploy/single-vps/migrate-runtime-storage.sh", "--delete"], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Use --preflight/);
});

// These structural guards supplement the real host preflight and cold-copy
// verification. They are not a substitute for a mount/restore rehearsal.
test("storage cutover preserves both runtime paths and verifies a stopped copy", () => {
  assert.match(migration, /mountpoint -q "\$VOLUME"/);
  assert.match(migration, /for name in docker containerd/);
  assert.match(migration, /reserve=\$\(\(capacity \/ 5\)\)/);
  assert.match(migration, /CONFIRM_RUNTIME_MAINTENANCE/);
  assert.match(migration, /age <= 86400/);
  assert.ok(migration.indexOf('systemctl stop docker.socket') < migration.indexOf('echo \'All writers stopped.'));
  assert.ok(migration.indexOf('rsync -aHAXSxnc') < migration.indexOf('systemctl enable --now'));
  assert.ok(migration.indexOf('attached-runtime-started') < migration.indexOf('systemctl start containerd.service docker.service'));
  assert.match(migration, /BindsTo=\$volume_unit/);
  assert.match(migration, /findmnt --fstab --evaluate/);
  assert.match(migration, /ctr --namespace "\$namespace" tasks list/);
  assert.match(migration, /Nested runtime mounts survived/);
  assert.match(migration, /checksum=\(--checksum\)/);
  assert.match(migration, /ExecStartPre=\/usr\/local\/sbin\/applyoverflow-runtime-mount-check/);
  assert.doesNotMatch(migration, /rm -rf|volume prune|VACUUM FULL/);
});

test("reclamation targets only a separately verified root view and retains mount directories", () => {
  assert.match(reclaim, /CONFIRM_RECLAIM_OLD_RUNTIME/);
  assert.match(reclaim, /cold-copy-verified/);
  assert.match(reclaim, /State\.Health\.Status/);
  assert.match(reclaim, /mount --bind \/ "\$view"/);
  assert.match(reclaim, /mount --make-private "\$view"/);
  assert.match(reclaim, /stat -c '%d:%i'/);
  assert.match(reclaim, /find "\$path" -mindepth 1 -maxdepth 1 -exec rm -rf --one-file-system/);
  assert.doesNotMatch(reclaim, /rm -rf.*\/var\/lib/);
});
