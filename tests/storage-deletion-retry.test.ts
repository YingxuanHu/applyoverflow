import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  retryStorageDeletions,
  STORAGE_DELETION_RETRY_DELAY_MS,
  STORAGE_DELETION_RETRY_RUNTIME_MS,
  type StorageDeletionRetryDatabase,
} from "../scripts/lib/storage-deletion-retry";

const root = fileURLToPath(new URL("..", import.meta.url));
const epoch = Date.UTC(2026, 9, 25);

function fixture(count = 1) {
  const state = { time: epoch, active: 0, maxActive: 0, claims: 0, scans: 0 };
  const tasks = new Map(Array.from({ length: count }, (_, i) => [
    `private-document-${String(i).padStart(3, "0")}`, epoch,
  ]));
  const deleted: string[] = [];
  const delegates = {
    storageDeletionTask: {
      async findMany(args: { where: { nextAttemptAt: { lte: Date } }; take: number }) {
        assert.equal(args.take, 50);
        return [...tasks].filter(([, due]) => due <= args.where.nextAttemptAt.lte.getTime())
          .slice(0, args.take).map(([storageKey]) => ({ storageKey }));
      },
      async updateMany(args: {
        where: { storageKey: string; nextAttemptAt: { lte: Date } };
        data: { nextAttemptAt: Date };
      }) {
        state.claims += 1;
        const due = tasks.get(args.where.storageKey);
        if (due === undefined || due > args.where.nextAttemptAt.lte.getTime()) return { count: 0 };
        tasks.set(args.where.storageKey, args.data.nextAttemptAt.getTime());
        return { count: 1 };
      },
    },
    resourceBudget: {
      async findMany(args: { take: number; where: { resetAt: { lt: Date } } }): Promise<Array<{ key: string }>> {
        state.scans += 1;
        assert.equal(args.take, 100);
        assert.equal(args.where.resetAt.lt.getTime(), epoch - 86_400_000);
        return [];
      },
      async deleteMany(args: unknown) { assert.ok(args); return { count: 0 }; },
    },
    resourceLease: {
      async findMany(args: { take: number; where: { expiresAt: { lt: Date } } }): Promise<Array<{ id: string }>> {
        state.scans += 1;
        assert.equal(args.take, 100);
        assert.equal(args.where.expiresAt.lt.getTime(), epoch);
        return [];
      },
      async deleteMany(args: unknown) { assert.ok(args); return { count: 0 }; },
    },
  };
  const dependencies = {
    database: delegates as unknown as StorageDeletionRetryDatabase,
    now: () => state.time,
    async deleteFile(storageKey: string) {
      assert.equal(tasks.get(storageKey), state.time + STORAGE_DELETION_RETRY_DELAY_MS);
      state.active += 1;
      state.maxActive = Math.max(state.maxActive, state.active);
      await Promise.resolve();
      deleted.push(storageKey);
      tasks.delete(storageKey);
      state.active -= 1;
    },
  };
  return { state, tasks, deleted, delegates, dependencies };
}

test("one pass selects at most 50 due tasks and deletes sequentially after claiming", async () => {
  const f = fixture(55);
  f.tasks.set("future-document", epoch + 1_000);
  const result = await retryStorageDeletions(f.dependencies);
  assert.deepEqual(result, {
    selected: 50, attempted: 50, completed: 50, failed: 0, skipped: 0,
    deferred: 0, prunedBudgets: 0, prunedLeases: 0, deadlineReached: false,
  });
  assert.equal(f.deleted.length, 50);
  assert.equal(f.state.maxActive, 1);
  assert.equal(f.tasks.size, 6);
  assert.ok(f.tasks.has("future-document"));
});

test("failed deletions retain intent, continue the batch, and return only aggregate evidence", async () => {
  const f = fixture(2);
  const remove = f.dependencies.deleteFile;
  f.dependencies.deleteFile = async (key) => {
    if (key.endsWith("000")) throw new Error("private provider details for " + key);
    await remove(key);
  };
  const result = await retryStorageDeletions(f.dependencies);
  assert.equal(result.failed, 1);
  assert.equal(result.completed, 1);
  assert.equal(f.tasks.get("private-document-000"), epoch + STORAGE_DELETION_RETRY_DELAY_MS);
  assert.doesNotMatch(JSON.stringify(result), /private|document|provider/);
});

test("overlapping passes cannot both claim the same due task", async () => {
  const f = fixture();
  const results = await Promise.all([
    retryStorageDeletions(f.dependencies), retryStorageDeletions(f.dependencies),
  ]);
  assert.equal(f.deleted.length, 1);
  assert.equal(results.reduce((sum, result) => sum + result.attempted, 0), 1);
  assert.equal(results.reduce((sum, result) => sum + result.skipped, 0), 1);
});

test("soft deadline defers remaining tasks and skips housekeeping", async () => {
  const f = fixture(3);
  const remove = f.dependencies.deleteFile;
  f.dependencies.deleteFile = async (key) => {
    await remove(key);
    f.state.time += STORAGE_DELETION_RETRY_RUNTIME_MS;
  };
  const result = await retryStorageDeletions(f.dependencies);
  assert.equal(result.attempted, 1);
  assert.equal(result.deferred, 2);
  assert.equal(result.deadlineReached, true);
  assert.equal(f.state.scans, 0);
  assert.equal(f.tasks.size, 2);
});

test("an exhausted selection budget starts no claims or deletions", async () => {
  const f = fixture();
  const find = f.delegates.storageDeletionTask.findMany;
  f.delegates.storageDeletionTask.findMany = async (args) => {
    const rows = await find(args);
    f.state.time += STORAGE_DELETION_RETRY_RUNTIME_MS;
    return rows;
  };
  const result = await retryStorageDeletions(f.dependencies);
  assert.equal(result.attempted, 0);
  assert.equal(result.deferred, 1);
  assert.equal(f.state.claims, 0);
  assert.equal(f.state.scans, 0);
});

test("a claim that exhausts the budget retains intent for a later pass without storage I/O", async () => {
  const f = fixture();
  const claim = f.delegates.storageDeletionTask.updateMany;
  f.delegates.storageDeletionTask.updateMany = async (args) => {
    const result = await claim(args);
    f.state.time += STORAGE_DELETION_RETRY_RUNTIME_MS;
    return result;
  };
  const result = await retryStorageDeletions(f.dependencies);
  assert.equal(result.attempted, 0);
  assert.equal(result.deferred, 1);
  assert.equal(f.tasks.get("private-document-000"), epoch + STORAGE_DELETION_RETRY_DELAY_MS);
  assert.deepEqual(f.deleted, []);
});

test("interrupted claims become eligible after the fixed retry delay", async () => {
  const f = fixture();
  f.tasks.set("private-document-000", epoch + STORAGE_DELETION_RETRY_DELAY_MS);
  assert.equal((await retryStorageDeletions(f.dependencies)).selected, 0);
  f.state.time += STORAGE_DELETION_RETRY_DELAY_MS;
  // This test advances the clock; housekeeping is tested separately below.
  f.delegates.resourceBudget.findMany = async () => [];
  f.delegates.resourceLease.findMany = async () => [];
  assert.equal((await retryStorageDeletions(f.dependencies)).completed, 1);
});

test("housekeeping deletes only bounded selected identities still expired at delete time", async () => {
  const f = fixture(0);
  const budgets = f.delegates.resourceBudget.findMany;
  const leases = f.delegates.resourceLease.findMany;
  f.delegates.resourceBudget.findMany = async (args) => {
    await budgets(args);
    return [{ key: "expired-budget" }, { key: "renewed-budget" }];
  };
  f.delegates.resourceLease.findMany = async (args) => {
    await leases(args);
    return [{ id: "expired-lease" }, { id: "renewed-lease" }];
  };
  f.delegates.resourceBudget.deleteMany = async (args) => {
    assert.deepEqual(args, { where: {
      key: { in: ["expired-budget", "renewed-budget"] }, resetAt: { lt: new Date(epoch - 86_400_000) },
    } });
    return { count: 1 };
  };
  f.delegates.resourceLease.deleteMany = async (args) => {
    assert.deepEqual(args, { where: {
      id: { in: ["expired-lease", "renewed-lease"] }, expiresAt: { lt: new Date(epoch) },
    } });
    return { count: 1 };
  };
  const result = await retryStorageDeletions(f.dependencies);
  assert.equal(result.prunedBudgets, 1);
  assert.equal(result.prunedLeases, 1);
});

test("database selection and claim failures fail closed before storage I/O", async () => {
  for (const method of ["findMany", "updateMany"] as const) {
    const f = fixture();
    f.delegates.storageDeletionTask[method] = async () => { throw new Error("database unavailable"); };
    await assert.rejects(retryStorageDeletions(f.dependencies), /database unavailable/);
    assert.equal(f.deleted.length, 0);
    assert.equal(f.tasks.size, 1);
  }
});

type ScheduledApp = { name: string; script: string; args: string; autorestart: boolean; cron_restart?: string; env: Record<string, string> };
function scheduledApps(group: string) {
  const result = spawnSync(process.execPath, ["-e", `
    console.log(JSON.stringify(require('./ecosystem.config.cjs').apps.map(app => ({
      name: app.name, script: app.script, args: app.args, autorestart: app.autorestart,
      cron_restart: app.cron_restart, env: {
        DATABASE_PROCESS_ROLE: app.env?.DATABASE_PROCESS_ROLE,
        DATABASE_POOL_MAX_MAINTENANCE: app.env?.DATABASE_POOL_MAX_MAINTENANCE
      }
    }))));
  `], { cwd: root, env: { NODE_ENV: "test", PATH: process.env.PATH, APPLYOVERFLOW_WORKER_GROUPS: group }, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as ScheduledApp[];
}

test("exactly one bounded retry loop is selected in maintenance/all and no other worker group", () => {
  for (const group of ["all", "maintenance", "ingestion", "source-workers", "top-picks", "overnight"]) {
    const entries = scheduledApps(group).filter((app) => app.name === "maintenance-storage-deletions");
    assert.equal(entries.length, ["all", "maintenance"].includes(group) ? 1 : 0, group);
    for (const app of entries) {
      assert.equal(app.script, "bash");
      assert.equal(app.autorestart, true);
      assert.equal(app.cron_restart, undefined);
      assert.equal(app.env.DATABASE_PROCESS_ROLE, "maintenance");
      assert.equal(app.env.DATABASE_POOL_MAX_MAINTENANCE, "1");
      assert.match(app.args, /sleep 120; while true; do timeout --kill-after=10s 180s/);
      assert.match(app.args, /scripts\/retry-storage-deletions\.ts/);
      assert.match(app.args, /storage-deletion-retry-pass-failed >&2; sleep 900; done/);
    }
  }
});

test("scheduled shell retries after failure without launching real workers", () => {
  const app = scheduledApps("maintenance").find((item) => item.name === "maintenance-storage-deletions")!;
  const command = app.args.slice(5, -1);
  // Shell functions intercept every operation: no tsx, database, storage,
  // timers, dotenv, or production process is executed by this fixture.
  const result = spawnSync("bash", ["--noprofile", "--norc", "-c", `
    passes=0
    sleep() { printf 'sleep:%s\n' "$1"; if [ "$passes" -ge 2 ]; then exit 0; fi; }
    timeout() { passes=$((passes + 1)); printf 'timeout:%s\n' "$*"; return 1; }
    ${command}
  `], { cwd: root, env: { NODE_ENV: "test", PATH: process.env.PATH }, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.match(/timeout:--kill-after=10s 180s /g)?.length, 2);
  assert.equal(result.stdout.match(/sleep:900/g)?.length, 2);
  assert.equal(result.stderr.match(/storage-deletion-retry-pass-failed/g)?.length, 2);
});

test("CLI delegates deletion to the guarded storage implementation and reports failed passes", () => {
  const cli = readFileSync(new URL("../scripts/retry-storage-deletions.ts", import.meta.url), "utf8");
  assert.match(cli, /import \{ deleteFile \} from "\.\.\/src\/lib\/storage"/);
  assert.match(cli, /createBoundedMaintenanceClient\(\)/);
  assert.match(cli, /retryStorageDeletions\(\{ database: maintenance, deleteFile \}\)/);
  assert.match(cli, /result\.failed \|\| result\.deadlineReached/);
  assert.doesNotMatch(cli, /console\.error\(error\)|deleteObject|storageDeletionTask\.delete/);
});
