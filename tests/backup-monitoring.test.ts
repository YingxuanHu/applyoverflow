import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const harness = String.raw`
df() { printf 'Filesystem Blocks Used Available Capacity Mounted\n/dev/test 100 90 10 %s%% /\n' "$MOCK_USAGE"; }
free() { printf 'Mem: 8000 2000 4000 0 0 2000\nSwap: 0 0 0\n'; }
mountpoint() { [[ "$MOCK_MOUNT" == 1 ]]; }
nproc() { printf '100000\n'; }
awk() { if [[ "$*" == *"/proc/loadavg"* ]]; then printf '0\n'; else command awk "$@"; fi; }
docker() {
  if [[ "$*" == *--send-health-alert* ]]; then
    command cat > "$APP_DIR/smtp-payload.json"
    printf '{"delivery":"smtp-accepted"}\n'
  fi
  return 0
}
timeout() { shift; "$@"; }
curl() { printf 'attempt\n' >> "$APP_DIR/delivery-attempts"; printf '%s' "$MOCK_HTTP"; }
source "$REPO/deploy/single-vps/monitor-health.sh"
`;
function run(dir: string, env: Record<string, string> = {}) {
  const result = spawnSync("bash", ["-s"], {
    encoding: "utf8", timeout: 5000, input: harness,
    env: { ...process.env, APP_DIR: dir, REPO: process.cwd(), MONITOR_LOG_FILE: path.join(dir, "alerts.log"),
      MONITOR_STATE_FILE: path.join(dir, "state.json"), MONITOR_BACKUP_DIR: dir, MONITOR_ALERT_WEBHOOK_URL: "", MONITOR_ALERT_EMAIL: "",
      MONITOR_ALERT_REPEAT_SECONDS: "21600", MOCK_USAGE: "90", MOCK_MOUNT: "1", MOCK_HTTP: "200", ...env },
  });
  assert.equal(result.status, 0, result.stderr);
}
async function freshReceipt(dir: string, ageHours = 0) {
  await writeFile(path.join(dir, "latest-verified-backup.json"), JSON.stringify({ status: "verified", manifest: {
    schemaVersion: 1, bucket: "test", key: "test.dump", sizeBytes: 100, sha256: "a".repeat(64),
    createdAt: new Date(Date.now() - ageHours * 3600000).toISOString(), remoteVerifiedAt: new Date().toISOString(),
  } }));
}

test("backup age and missing mounts alert, repeated conditions deduplicate, recoveries emit", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ao-backup-monitor-"));
  try {
    await mkdir(path.join(dir, "logs"));
    await writeFile(path.join(dir, "logs/supply-health-fixture.json"), '{"complete":true}');
    await freshReceipt(dir, 30);
    run(dir, { MOCK_MOUNT: "0" });
    let log = await readFile(path.join(dir, "alerts.log"), "utf8");
    assert.match(log, /backup is stale/);
    assert.match(log, /volume is not mounted/);
    assert.match(log, /delivery-unverified/);
    run(dir, { MOCK_MOUNT: "0", MOCK_USAGE: "99" });
    assert.equal(await readFile(path.join(dir, "alerts.log"), "utf8"), log);
    await freshReceipt(dir);
    run(dir, { MOCK_USAGE: "20" });
    log = await readFile(path.join(dir, "alerts.log"), "utf8");
    assert.match(log, /RECOVERED:.*backup-age.*root-disk.*volume-missing/);
    const state = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
    assert.deepEqual(Object.keys(state.alerts), ["alert-delivery"]);
    assert.equal(state.delivery, "delivery-unverified");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("host falls back to SMTP with code-only payload and records acceptance", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ao-backup-smtp-"));
  try {
    await mkdir(path.join(dir, "scripts"));
    await writeFile(path.join(dir, "scripts/send-health-alert.mjs"), "// mocked helper; never executed by a real transport\n");
    await freshReceipt(dir);
    run(dir, { MONITOR_ALERT_WEBHOOK_URL: "https://alerts.invalid/test", MONITOR_ALERT_EMAIL: "alvin.hu@mail.utoronto.ca", MOCK_HTTP: "500" });
    const state = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
    assert.equal(state.delivery, "smtp-accepted");
    assert.equal(state.pendingDelivery, false);
    const payload = JSON.parse(await readFile(path.join(dir, "smtp-payload.json"), "utf8"));
    assert.deepEqual(payload.active, ["root-disk", "supply-missing", "volume-disk"]);
    assert.deepEqual(Object.keys(payload).sort(), ["active", "kind", "opened", "recovered", "schemaVersion", "source"]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("HTTP failure/redirect stays unverified and failed recovery delivery retries", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ao-backup-delivery-"));
  const webhook = { MONITOR_ALERT_WEBHOOK_URL: "https://alerts.invalid/test" };
  try {
    await mkdir(path.join(dir, "logs"));
    await writeFile(path.join(dir, "logs/supply-health-fixture.json"), '{"complete":true}');
    await freshReceipt(dir);
    run(dir, { ...webhook, MOCK_HTTP: "302" });
    let state = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
    assert.equal(state.delivery, "delivery-unverified");
    assert.equal(state.lastDeliveredAt, 0);
    run(dir, webhook);
    run(dir, webhook);
    assert.equal((await readFile(path.join(dir, "delivery-attempts"), "utf8")).trim().split("\n").length, 2);
    run(dir, { ...webhook, MOCK_USAGE: "20", MOCK_HTTP: "500" });
    state = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
    assert.equal(state.pendingDelivery, true);
    assert.deepEqual(state.alerts, {});
    run(dir, { ...webhook, MOCK_USAGE: "20" });
    state = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
    assert.equal(state.delivery, "webhook-accepted");
    assert.equal(state.pendingDelivery, false);
    assert.equal((await readFile(path.join(dir, "delivery-attempts"), "utf8")).trim().split("\n").length, 4);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
