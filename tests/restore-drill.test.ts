import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Every Docker call and Linux storage probe is mocked. These tests cannot start
// a container, contact object storage, or touch a production database.
const harness = String.raw`
mountpoint() { return 0; }
timeout() { return 99; }
flock() { return 0; }
realpath() { while [[ "$1" == -* ]]; do shift; done; printf '%s\n' "$1"; }
stat() { if [[ "$*" == '-c %d /' ]]; then printf '1\n'; else printf '2\n'; fi; }
df() {
  local free=300000000000
  [[ "$CASE" != capacity ]] || free=100000000000
  [[ ! -f "$FIXTURE/breach" ]] || free=1000
  if [[ "$*" == *--output=size,avail* ]]; then printf 'Size Avail\n400000000000 %s\n' "$free";
  else printf 'Avail\n%s\n' "$free"; fi
}
rm() { if [[ "$1" == -rf && "$2" == --one-file-system ]]; then shift 2; command rm -rf "$@"; else command rm "$@"; fi; }
docker() {
  printf '%s\n' "$*" >> "$FIXTURE/docker-calls"
  case "$*" in
    'compose --env-file'*) printf 'DB_BACKUP_VOLUME_MOUNT=%s/volume\nDB_BACKUP_HOST_DIR=%s/volume/backups\n' "$FIXTURE" "$FIXTURE"; return 0;;
    'image inspect'*) printf 'sha256:test-image\n'; return 0;;
    'container inspect'*) [[ -f "$FIXTURE/$3" ]]; return;;
    'rm -f'*) command rm -f "$FIXTURE/$3"; printf 'removed\n' > "$FIXTURE/removed"; return 0;;
  esac
  case "$1" in
    info) return 0;;
    inspect)
      if [[ "$2" == --format ]]; then printf '%s\n' "$TOKEN";
      else printf '[{"Config":{"Labels":{"applyoverflow.restore-drill":"%s"}},"HostConfig":{"NetworkMode":"none","PortBindings":{},"Memory":2147483648}}]\n' "$TOKEN"; fi
      return 0;;
    run)
      if [[ "$*" == *--inspect* ]]; then
        printf '{"manifest":{"sizeBytes":19224706886}}\n'
      elif [[ "$*" == *--download-only* ]]; then
        printf 'tiny-test-fixture' > "$RUN_DIR/backup.dump"
        printf '{"status":"verified"}\n'
      else printf 'owned\n' > "$FIXTURE/$RUN_ID"; fi
      return 0;;
    exec)
      if [[ "$*" == *pg_restore* ]]; then
        [[ "$CASE" != fail-fast ]] || return 1
        if [[ "$CASE" == guard ]]; then
          printf 'breach\n' > "$FIXTURE/breach"
          for ((i=0; i<60; i++)); do [[ ! -f "$FIXTURE/removed" ]] || return 1; sleep 0.2; done
          return 98
        fi
      elif [[ "$*" == *'SELECT count(*) FROM pg_stat_activity'* ]]; then printf '0\n'
      elif [[ "$*" == *'SELECT token FROM'* ]]; then printf '%s\n' "$TOKEN"
      elif [[ "$*" == *psql* && "$*" != *' -c '* ]]; then
        printf '{"schemaPresent":true,"sentinelPresent":true,"invalidIndexes":0,"unvalidatedConstraints":0,"checkConstraintViolations":0,"exactCounts":{"User":15}}\n'
      fi
      return 0;;
  esac
  echo "Unexpected Docker call: $*" >&2; return 91
}
source "$REPO/deploy/single-vps/restore-drill.sh" 'database-backups/test/exact.dump'
`;

for (const mode of ["success", "capacity", "fail-fast", "guard"]) {
  test(`isolated drill ${mode} preserves namespace and evidence`, { timeout: 20000 }, async () => {
    const fixture = await realpath(await mkdtemp(path.join(tmpdir(), "ao-drill-test-")));
    await mkdir(path.join(fixture, "volume/backups"), { recursive: true });
    try {
      const result = spawnSync("bash", ["-s"], {
        encoding: "utf8", timeout: 15000, input: harness,
        env: { ...process.env, FIXTURE: fixture, REPO: process.cwd(), CASE: mode, AO_DRILL_TIMED: "1",
          CONFIRM_ISOLATED_RESTORE_DRILL: "yes", DB_RESTORE_DRILL_DATABASE_BYTES: "155465979583",
          DB_RESTORE_DRILL_MANIFEST: "", DB_RESTORE_DRILL_BASELINE_FILE: "" },
      });
      assert.equal(result.status, mode === "success" ? 0 : 1, result.stderr + result.stdout);
      const calls = await readFile(path.join(fixture, "docker-calls"), "utf8");
      const runs = await readdir(path.join(fixture, "volume/backups/restore-drills"));
      assert.equal(runs.length, 1);
      const run = path.join(fixture, "volume/backups/restore-drills", runs[0]);
      const evidence = JSON.parse(await readFile(path.join(run, "evidence.json"), "utf8"));
      assert.equal(evidence.status, mode === "success" ? "passed" : "failed");
      assert.equal(evidence.cleanupComplete, true);
      assert.equal(evidence.pointInTimeRecovery, false);
      assert.equal(evidence.productionCutover, false);
      assert.doesNotMatch(calls, /DATABASE_URL|prisma|compose .* (up|stop)|--publish| -p /);
      for (const removal of calls.split("\n").filter((line) => line.startsWith("rm -f "))) {
        assert.match(removal, /^rm -f ao-restore-drill-[a-f0-9]{32}(?:-download)?$/);
      }
      if (mode === "capacity") assert.doesNotMatch(calls, /--download-only|pg_restore|run -d/);
      else assert.match(calls, /pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --no-tablespaces/);
      if (mode === "guard") assert.match(await readFile(path.join(run, "disk-guard-failure.txt"), "utf8"), /reserve breached/);
      await assert.rejects(readFile(path.join(run, "backup.dump")));
      await assert.rejects(readdir(path.join(run, "pgdata")));
    } finally { await rm(fixture, { recursive: true, force: true }); }
  });
}
