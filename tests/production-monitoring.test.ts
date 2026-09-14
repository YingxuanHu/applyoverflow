import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { collectReportSections } from "../src/lib/ingestion/supply-report-runner";

test("supply sections run serially and retain healthy results after a failure", async () => {
  let active = 0;
  let maxActive = 0;
  const order: string[] = [];
  const task = (name: string, fail = false) => async () => {
    maxActive = Math.max(maxActive, ++active);
    order.push(name);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    if (fail) throw new Error("secret database URL");
    return name;
  };
  const result = await collectReportSections({ publicBoard: task("public"), heavy: task("heavy", true), coverage: task("coverage") });
  assert.equal(maxActive, 1);
  assert.deepEqual(order, ["public", "heavy", "coverage"]);
  assert.equal(result.publicBoard.data, "public");
  assert.equal(result.heavy.data, null);
  assert.ok(result.heavy.error);
  assert.equal(result.coverage.data, "coverage");
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

for (const failedDocker of [false, true]) {
  test(`disk alerts survive ${failedDocker ? "failed Docker inspection" : "zero Caddy errors"}`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ao-monitor-test-"));
    const log = path.join(dir, "alerts.log");
    try {
      const result = spawnSync("bash", ["-s"], {
        cwd: process.cwd(), encoding: "utf8", timeout: 5000,
        env: { ...process.env, APP_DIR: dir, MONITOR_LOG_FILE: log, MONITOR_ALERT_WEBHOOK_URL: "", POSTGRES_TABLESPACE_POLICY_SCRIPT: "/not-present", FAIL_DOCKER: String(failedDocker) },
        input: `
df() { printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\n/dev/test 100 87 13 87%% /\\n'; }
free() { printf 'Mem: 8000 2000 4000 0 0 2000\\nSwap: 0 0 0\\n'; }
mountpoint() { return 1; }
nproc() { printf '100000\\n'; }
awk() { if [[ "$*" == *"/proc/loadavg"* ]]; then printf '0\\n'; else command awk "$@"; fi; }
docker() { [[ "$FAIL_DOCKER" != true ]] || return 1; }
source "$PWD/deploy/single-vps/monitor-health.sh"
`,
      });
      assert.equal(result.status, 0, result.stderr);
      const output = await readFile(log, "utf8");
      assert.match(output, /root disk is 87% full/);
      if (failedDocker) assert.match(output, /could not inspect Caddy errors/);
      else assert.doesNotMatch(output, /Caddy logged/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}

test("cron installation removes only the obsolete summary entry", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ao-cron-test-"));
  try {
    const result = spawnSync("bash", ["-s"], {
      encoding: "utf8", timeout: 5000,
      env: { ...process.env, MONITOR_CRON_FILE: path.join(dir, "health"), CRON_RESULT: path.join(dir, "root-cron") },
      input: `crontab() {
  if [[ "$1" == -l ]]; then
    printf '%s\\n' '0 8 * * * backup-command' '*/5 * * * * docker compose exec -T app npx tsx scripts/refresh-job-feed-summary.ts' '5 * * * * capture-supply-health.sh'
  else tee "$CRON_RESULT" >/dev/null; fi
}
source deploy/single-vps/install-monitoring-cron.sh
`,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(path.join(dir, "root-cron"), "utf8"), "0 8 * * * backup-command\n5 * * * * capture-supply-health.sh\n");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
