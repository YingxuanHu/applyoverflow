import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  INACTIVE_JOB_RETENTION_DAYS,
  INACTIVE_JOB_STATUSES,
  isInactiveJobStatus,
} from "../src/lib/ingestion/inactive-job-retention";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("only definitively inactive statuses enter the destructive retention path", () => {
  assert.equal(INACTIVE_JOB_RETENTION_DAYS, 14);
  assert.deepEqual(INACTIVE_JOB_STATUSES, ["EXPIRED", "REMOVED"]);
  assert.equal(isInactiveJobStatus("EXPIRED"), true);
  assert.equal(isInactiveJobStatus("REMOVED"), true);
  assert.equal(isInactiveJobStatus("LIVE"), false);
  assert.equal(isInactiveJobStatus("AGING"), false);
  assert.equal(isInactiveJobStatus("STALE"), false);
});

test("storage lifecycle preserves user material while removing inactive and orphaned payloads", () => {
  const source = readRepoFile("scripts/apply-storage-lifecycle.ts");

  assert.match(source, /old-unreferenced-inactive-canonical-jobs/);
  assert.match(source, /"SavedJob"/);
  assert.match(source, /"ApplicationSubmission"/);
  assert.match(source, /"ApplicationPackage"/);
  assert.match(
    source,
    /select 1 from "ApplicationPackage" package where package\."canonicalJobId" = job\.id\s*\n\s*\)/
  );
  assert.match(source, /record\."canonicalJobId" is null/);
  assert.doesNotMatch(source, /old-unmapped-rejected-raw-jobs/);
  assert.match(source, /Unknown cleanup target\(s\)/);
  assert.match(source, /args\.targetNames\.includes\(target\.name\)/);
});

test("scheduled maintenance limits its routine work to inactive jobs and orphaned payloads", () => {
  const source = readRepoFile("ecosystem.config.cjs");

  assert.match(source, /maintenance-storage-lifecycle/);
  assert.match(source, /--target=old-unreferenced-inactive-canonical-jobs/);
  assert.match(source, /--target=old-unmapped-raw-jobs/);
});

test("backup runner never evaluates the compose dotenv file as shell code", () => {
  const source = readRepoFile("deploy/single-vps/backup-to-storage.sh");

  assert.doesNotMatch(source, /source "\$ENV_FILE"/);
  assert.match(source, /POSTGRES_IDENTITY/);
  assert.match(source, /DB_BACKUP_HOST_DIR/);
  assert.match(source, /END \{ if \(value != ""\) print value \}/);
  assert.match(source, /cleanup_failed_backup/);
  assert.match(source, /run --rm --no-deps backup-runner/);
});

test("backup-runner mounts the configurable host staging directory", () => {
  const source = readRepoFile("deploy/single-vps/docker-compose.yml");

  assert.match(source, /\$\{DB_BACKUP_HOST_DIR:-\.\/backups\}:\/backups/);
});
