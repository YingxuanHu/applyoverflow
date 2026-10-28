import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

type Alerts = Record<string, string>;
type State = { alerts: Alerts; lastDeliveredAt: number; delivery: string; notifications?: unknown };
const start = 1_800_000_000;
const alerts = (...codes: string[]): Alerts => Object.fromEntries(codes.map(code => [code, code]));
const empty = (): State => ({ alerts: {}, lastDeliveredAt: 0, delivery: "delivery-unverified" });
function plan(previous: State, active: Alerts, now = start, isTest = false) {
  const args = ["-cn", "--argjson", "previous", JSON.stringify(previous), "--argjson", "active", JSON.stringify(active),
    "--argjson", "now", String(now), "--argjson", "repeatSeconds", "86400", "--argjson", "recoverySeconds", "600",
    "--argjson", "retrySeconds", "900", "--argjson", "test", String(isTest), "-f", "deploy/single-vps/monitor-notification-policy.jq"];
  const result = spawnSync("jq", args, { encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function poll(previous: State, active: Alerts, now: number, accepted = true) {
  const result = plan(previous, active, now);
  const delivered = result.send && accepted;
  return { result, state: { alerts: active, lastDeliveredAt: delivered ? now : previous.lastDeliveredAt,
    delivery: result.send ? (accepted ? "smtp-accepted" : "delivery-unverified") : previous.delivery,
    notifications: delivered ? result.delivered : result.attempted } as State };
}

test("routine load flapping produces at most one summary per rolling day", () => {
  let state = empty();
  let sends = 0;
  for (let i = 0; i < 288; i++) {
    const step = poll(state, alerts("supply-partial", ...(i % 2 ? ["load"] : [])), start + i * 300);
    state = step.state;
    if (step.result.send) { sends++; assert.equal(step.result.payload.kind, "summary"); }
  }
  assert.equal(sends, 1);
  assert.equal(plan(state, alerts("supply-partial", "load"), start + 86400).send, true);
});

test("new backup and service incidents bypass a recent routine summary, unchanged incidents wait a day", () => {
  let step = poll(empty(), alerts("load"), start);
  step = poll(step.state, alerts("load", "backup-failure"), start + 300);
  assert.equal(step.result.send, true);
  assert.equal(step.result.payload.kind, "alert");
  assert.deepEqual(step.result.payload.opened, ["backup-failure"]);
  const unchanged = plan(step.state, { "backup-failure": "updated numeric details" }, start + 600);
  assert.equal(unchanged.send, false);
  step = poll(step.state, alerts("backup-failure", "container-health"), start + 900);
  assert.equal(step.result.send, true);
  assert.deepEqual(step.result.payload.opened, ["container-health"]);
  assert.equal(plan(step.state, alerts("backup-failure", "container-health"), start + 900 + 86400).send, true);
});

test("critical recovery waits ten minutes and a brief recurrence stays in the same incident", () => {
  let step = poll(empty(), alerts("container-health"), start);
  step = poll(step.state, {}, start + 300);
  assert.equal(step.result.send, false);
  step = poll(step.state, alerts("container-health"), start + 600);
  assert.equal(step.result.send, false);
  step = poll(step.state, {}, start + 900);
  assert.equal(step.result.send, false);
  step = poll(step.state, {}, start + 1499);
  assert.equal(step.result.send, false);
  step = poll(step.state, {}, start + 1500);
  assert.equal(step.result.send, true);
  assert.equal(step.result.payload.kind, "recovery");
  assert.deepEqual(step.result.payload.recovered, ["container-health"]);
  assert.equal(plan(step.state, {}, start + 1800).send, false);
});

test("failed recovery retains delivered evidence and retries with the same recovered codes", () => {
  let step = poll(empty(), alerts("volume-missing"), start);
  step = poll(step.state, {}, start + 300);
  step = poll(step.state, {}, start + 900, false);
  assert.equal(step.result.send, true);
  assert.equal(step.state.lastDeliveredAt, start);
  step = poll(step.state, {}, start + 1200);
  assert.equal(step.result.send, false);
  assert.equal(step.result.pending, true);
  step = poll(step.state, {}, start + 1800);
  assert.equal(step.result.send, true);
  assert.deepEqual(step.result.payload.recovered, ["volume-missing"]);
  assert.equal(plan(step.state, {}, start + 2100).send, false);
});

test("failed critical mail is throttled even when warning fields flap; a new urgent incident can bypass", () => {
  let step = poll(empty(), alerts("backup-age", "load"), start, false);
  step = poll(step.state, alerts("backup-age"), start + 300, false);
  assert.equal(step.result.send, false);
  assert.equal(plan(step.state, alerts("backup-age", "load"), start + 900).send, true);
  assert.equal(plan(step.state, alerts("backup-age", "volume-missing"), start + 600).send, true);
});

test("legacy delivered state migrates without another email or false recovery", () => {
  const state: State = { alerts: alerts("backup-receipt", "load", "supply-partial"), lastDeliveredAt: start - 300, delivery: "smtp-accepted" };
  const result = plan(state, alerts("backup-receipt", "supply-partial"));
  assert.equal(result.send, false);
  assert.equal(result.attempted.lastRoutineAt, start - 300);
  assert.equal(result.attempted.lastCriticalAt, start - 300);
  assert.equal(plan(state, state.alerts, start - 300 + 86400).send, true);
});

test("unaccepted legacy state does not pretend that an urgent email was sent", () => {
  const result = plan({ alerts: alerts("backup-failure"), lastDeliveredAt: 0, delivery: "delivery-unverified" }, alerts("backup-failure"));
  assert.equal(result.send, true);
  assert.deepEqual(result.payload.opened, ["backup-failure"]);
});

test("routine-only recovery is summarized later, not mailed immediately", () => {
  let step = poll(empty(), alerts("memory", "swap"), start);
  step = poll(step.state, {}, start + 300);
  assert.equal(step.result.send, false);
  step = poll(step.state, {}, start + 86400);
  assert.equal(step.result.send, true);
  assert.equal(step.result.payload.kind, "summary");
  assert.deepEqual(step.result.payload.recovered, ["memory", "swap"]);
  assert.equal(plan(step.state, {}, start + 172800).send, false);
});

test("test notices do not consume incident state or notification budget", () => {
  const result = plan(empty(), alerts("backup-failure"), start, true);
  assert.equal(result.send, true);
  assert.equal(result.payload.kind, "test");
  assert.deepEqual(result.delivered.notifiedAlerts, {});
  assert.equal(result.delivered.lastRoutineAt, 0);
  assert.equal(plan({ ...empty(), notifications: result.delivered }, alerts("backup-failure"), start).send, true);
});

test("partial recovery never clears a condition still waiting for stable recovery", () => {
  let step = poll(empty(), alerts("volume-missing", "container-health"), start);
  step = poll(step.state, alerts("container-health"), start + 300);
  step = poll(step.state, {}, start + 600);
  step = poll(step.state, {}, start + 900);
  assert.deepEqual(step.result.payload.recovered, ["volume-missing"]);
  assert.equal(step.result.payload.kind, "summary");
  assert.deepEqual(Object.keys(step.result.delivered.notifiedAlerts), ["container-health"]);
  step = poll(step.state, {}, start + 1200);
  assert.deepEqual(step.result.payload.recovered, ["container-health"]);
  assert.equal(step.result.payload.kind, "recovery");
});

test("a monitoring gap resets recovery evidence instead of assuming uninterrupted health", () => {
  let step = poll(empty(), alerts("container-health"), start);
  step = poll(step.state, {}, start + 300);
  step = poll(step.state, {}, start + 3600);
  assert.equal(step.result.send, false);
  step = poll(step.state, {}, start + 4200);
  assert.equal(step.result.send, true);
  assert.equal(step.result.payload.kind, "recovery");
});

test("invalid new notification state falls back to the validated legacy delivery baseline", () => {
  const state: State = { alerts: alerts("backup-receipt"), lastDeliveredAt: start - 300, delivery: "smtp-accepted",
    notifications: { notifiedAlerts: "bad", lastRoutineAt: "not-a-time" } };
  const result = plan(state, state.alerts);
  assert.equal(result.send, false);
  assert.deepEqual(result.attempted.notifiedAlerts, state.alerts);
});
