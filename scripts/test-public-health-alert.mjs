import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import yaml from "js-yaml";
import { parseAlert } from "./send-health-alert.mjs";
import { alertEnvelope, BASELINE_PREFIX, DELIVERY_PREFIX, notificationState, PLAN_STEP,
  planPublicHealthAlert, REPOSITORY, STATE_PREFIX, WORKFLOW } from "./plan-public-health-alert.mjs";

const context = { repository: REPOSITORY, defaultBranch: "main", ref: "refs/heads/main",
  workflowRef: `${REPOSITORY}/${WORKFLOW}@refs/heads/main`, eventName: "schedule", runId: 100, outcome: "success" };
const step = (name, conclusion = "success") => ({ name, status: "completed", conclusion });
const jobs = (...steps) => ({ total_count: 1, jobs: [{ name: "readiness", status: "completed", steps }] });
const run = (id = 90, overrides = {}) => ({ id, run_attempt: 1, status: "completed", conclusion: "failure",
  repository: { full_name: REPOSITORY }, head_repository: { full_name: REPOSITORY }, name: "Public Health", path: WORKFLOW,
  head_branch: "main", event: "schedule", updated_at: `2026-10-25T12:00:${String(id % 60).padStart(2, "0")}Z`, ...overrides });
function reader(runs, responses, requests = []) {
  return endpoint => {
    requests.push(endpoint);
    if (endpoint.includes("/workflows/")) return { total_count: runs.length, workflow_runs: runs };
    const match = /\/runs\/(\d+)\/attempts\/(\d+)\/jobs\?per_page=100$/.exec(endpoint);
    assert.ok(match, "Only exact-attempt jobs and workflow-run reads are allowed");
    assert.ok(responses[match[1]], "Unexpected run lookup");
    return responses[match[1]];
  };
}

test("transition matrix sends only outage/recovery changes, with silent healthy bootstrap", () => {
  for (const previous of ["unknown", "healthy", "unhealthy"]) for (const outcome of ["success", "failure"]) {
    const current = outcome === "success" ? "healthy" : "unhealthy";
    const action = current === "unhealthy" ? previous === "unhealthy" ? "none" : "alert" : previous === "unhealthy" ? "recovery" : "none";
    const plan = planPublicHealthAlert({ ...context, outcome }, reader([run()], { 90: jobs(step(BASELINE_PREFIX + previous)) }));
    assert.deepEqual(plan, { previous, current, action });
  }
  assert.deepEqual(planPublicHealthAlert(context, reader([], {})), { previous: "unknown", current: "healthy", action: "none" });
});

test("failed SMTP and dependency installs preserve baseline and retry both alert and recovery", () => {
  for (const [previous, outcome, action] of [["healthy", "failure", "alert"], ["unhealthy", "success", "recovery"], ["unknown", "failure", "alert"]]) {
    for (const conclusion of ["failure", "cancelled", "skipped"]) {
      const previousJobs = jobs(step(PLAN_STEP), step(BASELINE_PREFIX + previous), step(DELIVERY_PREFIX + action, conclusion));
      // An arbitrarily long delivery failure streak never advances or loses its baseline.
      for (let attempt = 0; attempt < 30; attempt++) {
        assert.equal(planPublicHealthAlert({ ...context, outcome }, reader([run()], { 90: previousJobs })).action, action);
      }
    }
  }
});

test("accepted delivery suppresses repeats even when the final checkpoint or workflow failed", () => {
  for (const [action, current, outcome] of [["alert", "unhealthy", "failure"], ["recovery", "healthy", "success"]]) {
    const response = jobs(step(BASELINE_PREFIX + "unknown"), step(DELIVERY_PREFIX + action));
    assert.equal(notificationState(response), current);
    assert.equal(planPublicHealthAlert({ ...context, outcome }, reader([run()], { 90: response })).action, "none");
  }
  assert.equal(planPublicHealthAlert(context, reader([run()], { 90: jobs(step(DELIVERY_PREFIX + "alert")) })).action, "recovery");
});

test("latest completed trusted run wins, ignoring current, PR, fork and non-default runs", () => {
  const requests = [];
  const ignored = [run(100), run(99, { event: "pull_request" }), run(98, { head_branch: "feature" }),
    run(97, { head_repository: { full_name: "other/fork" } }), run(96, { repository: { full_name: "other/fork" } }),
    run(95, { path: ".github/workflows/evil.yml" }), run(94, { name: "Other" }), run(93, { status: "in_progress" })];
  const result = planPublicHealthAlert({ ...context, outcome: "failure" }, reader([
    ...ignored, run(80, { updated_at: "2026-10-25T13:00:00Z", run_attempt: 3 }), run(90),
  ], { 80: jobs(step(STATE_PREFIX + "unhealthy")) }, requests));
  assert.equal(result.action, "none");
  assert.equal(requests.length, 2);
  assert.match(requests[1], /\/80\/attempts\/3\/jobs/);
});

test("interrupted planning searches previous receipts; pre-alert workflow is an unknown bootstrap", () => {
  assert.equal(planPublicHealthAlert(context, reader([run(90), run(80)], {
    90: jobs(step(PLAN_STEP, "failure")), 80: jobs(step(STATE_PREFIX + "unhealthy")),
  })).action, "recovery");
  assert.equal(notificationState({ total_count: 0, jobs: [] }), null);
  assert.equal(notificationState(jobs(step("Verify public HTTP readiness and immutable app revision", "failure"))), "unknown");
});

test("untrusted execution is rejected before any GitHub request", () => {
  for (const invalid of [{ repository: "other/fork" }, { ref: "refs/heads/feature" }, { defaultBranch: "bad\nbranch" },
    { workflowRef: `${REPOSITORY}/${WORKFLOW}@refs/pull/1/merge` }, { eventName: "pull_request" },
    { eventName: "pull_request_target" }, { eventName: "workflow_run" }, { runId: NaN }, { outcome: "skipped" }]) {
    assert.throws(() => planPublicHealthAlert({ ...context, ...invalid }, () => assert.fail("Must not query GitHub")));
  }
});

test("invalid or truncated state and unavailable history fail closed without logging API data", () => {
  for (const response of [
    { total_count: 2, jobs: [] }, jobs(step(STATE_PREFIX + "healthy"), step(STATE_PREFIX + "unhealthy")),
    jobs(step(BASELINE_PREFIX + "private content")), jobs(step(DELIVERY_PREFIX + "alert"), step(STATE_PREFIX + "healthy")),
  ]) assert.throws(() => notificationState(response));
  assert.throws(() => planPublicHealthAlert(context, () => { throw new Error("private API detail"); }));
  const runs = Array.from({ length: 11 }, (_, index) => run(index + 1));
  const interrupted = Object.fromEntries(runs.map(item => [item.id, jobs(step(PLAN_STEP, "failure"))]));
  assert.throws(() => planPublicHealthAlert(context, reader(runs, interrupted)), /safety limit/);
  assert.throws(() => planPublicHealthAlert(context, () => ({ total_count: 101, workflow_runs: [] })), /safety limit/);
});

test("outgoing envelopes contain only helper-allowlisted external health condition codes", () => {
  for (const action of ["alert", "recovery"]) {
    const envelope = alertEnvelope(action);
    assert.deepEqual(parseAlert(envelope), envelope);
    assert.equal(envelope.source, "external");
    assert.deepEqual(Object.keys(envelope).sort(), ["active", "kind", "opened", "recovered", "schemaVersion", "source"]);
    assert.deepEqual(envelope.active, action === "alert" ? ["public-health"] : []);
    assert.deepEqual(envelope.recovered, action === "recovery" ? ["public-health"] : []);
  }
  assert.throws(() => alertEnvelope("none"));
});

test("manual test-email success or failure never changes the health notification state", () => {
  for (const state of ["unknown", "healthy", "unhealthy"]) for (const conclusion of ["success", "failure", "skipped"]) {
    assert.equal(notificationState(jobs(step(PLAN_STEP), step(BASELINE_PREFIX + state),
      step("Send owner health test notification", conclusion))), state);
  }
  assert.equal(notificationState(jobs(step(PLAN_STEP), step("Send owner health test notification"))), null);
});

test("CLI accepts injected gh JSON and writes only fixed outputs and envelope, without sending mail", () => {
  const directory = mkdtempSync(join(tmpdir(), "public-health-plan-"));
  try {
    const fakeGh = join(directory, "gh");
    writeFileSync(fakeGh, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(${JSON.stringify({ total_count: 0, workflow_runs: [] })}));\n`, { mode: 0o700 });
    const env = { PATH: directory, RUNNER_TEMP: directory, GITHUB_OUTPUT: join(directory, "output"),
      GITHUB_REPOSITORY: context.repository, PUBLIC_HEALTH_DEFAULT_BRANCH: context.defaultBranch, GITHUB_REF: context.ref,
      GITHUB_WORKFLOW_REF: context.workflowRef, GITHUB_EVENT_NAME: context.eventName, GITHUB_RUN_ID: String(context.runId), PUBLIC_HEALTH_OUTCOME: "failure" };
    const output = execFileSync(process.execPath, [new URL("./plan-public-health-alert.mjs", import.meta.url).pathname], { env, encoding: "utf8" });
    assert.deepEqual(JSON.parse(output), { previous: "unknown", current: "unhealthy", action: "alert" });
    assert.equal(readFileSync(env.GITHUB_OUTPUT, "utf8"), "previous=unknown\ncurrent=unhealthy\naction=alert\n");
    assert.deepEqual(JSON.parse(readFileSync(join(directory, "public-health-alert.json"), "utf8")), alertEnvelope("alert"));
    writeFileSync(fakeGh, `#!${process.execPath}\nprocess.stderr.write('secret-provider-error');process.exit(1);\n`, { mode: 0o700 });
    assert.throws(() => execFileSync(process.execPath, [new URL("./plan-public-health-alert.mjs", import.meta.url).pathname],
      { env, encoding: "utf8", stdio: "pipe" }), error => {
      assert.equal(error.status, 1);
      assert.doesNotMatch(error.stderr, /secret-provider-error/);
      assert.match(error.stderr, /delivery-unverified/);
      return true;
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("secret workflow is default-branch-only, read-only, pinned, lifecycle-free and retains failures", () => {
  const workflow = yaml.load(readFileSync(new URL("../.github/workflows/public-health.yml", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(workflow.on).sort(), ["schedule", "workflow_dispatch"]);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs, { test_notification: {
    description: "Send one fixed owner test email without changing health notification state", required: false, default: false, type: "boolean",
  } });
  assert.deepEqual(workflow.permissions, { contents: "read", actions: "read" });
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  const job = workflow.jobs.readiness;
  assert.equal(job.environment, "public-health-alerts");
  assert.match(job.if, /github\.repository == 'YingxuanHu\/applyoverflow'/);
  assert.match(job.if, /github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/);
  assert.match(job.if, /github\.workflow_ref == format/);
  const steps = job.steps;
  for (const action of steps.filter(item => item.uses)) assert.match(action.uses, /@[a-f0-9]{40}$/);
  assert.equal(steps[0].with["persist-credentials"], false);
  assert.equal(steps.find(item => item.id === "health")["continue-on-error"], true);
  assert.equal(steps.find(item => item.id === "dependencies").run, "npm ci --omit=dev --ignore-scripts --no-audit --no-fund");
  assert.match(steps.find(item => item.id === "dependencies").if, /github\.event_name == 'workflow_dispatch' && inputs\.test_notification/);
  for (const action of ["alert", "recovery"]) {
    const delivery = steps.find(item => item.id === action);
    assert.equal(delivery.name, DELIVERY_PREFIX + action);
    assert.match(delivery.if, new RegExp(`steps.plan.outputs.action == '${action}'`));
    assert.equal(delivery.env.MONITOR_ALERT_EMAIL, "alvin.hu@mail.utoronto.ca");
    assert.equal(delivery.run, 'node scripts/send-health-alert.mjs < "$RUNNER_TEMP/public-health-alert.json"');
    for (const key of ["HOST", "PORT", "USER", "PASS", "FROM"]) assert.equal(delivery.env[`SMTP_${key}`], `\${{ secrets.PUBLIC_HEALTH_SMTP_${key} }}`);
  }
  const manualTest = steps.find(item => item.id === "test_notification");
  assert.ok(!manualTest.name.startsWith(DELIVERY_PREFIX));
  assert.equal(manualTest.if, "always() && github.event_name == 'workflow_dispatch' && inputs.test_notification && steps.dependencies.outcome == 'success'");
  assert.equal(manualTest["continue-on-error"], undefined);
  const testEnvelope = JSON.parse(/printf '%s\\n' '([^']+)'/.exec(manualTest.run)[1]);
  assert.deepEqual(parseAlert(testEnvelope), { schemaVersion: 1, source: "external", kind: "test", active: [], opened: [], recovered: [] });
  assert.match(manualTest.run, /\|\n\s+node scripts\/send-health-alert\.mjs\n$/);
  assert.doesNotMatch(manualTest.run, /\$\{\{/);
  assert.deepEqual(manualTest.env, steps.find(item => item.id === "alert").env);
  for (const item of steps.filter(item => !["alert", "recovery", "test_notification"].includes(item.id))) assert.doesNotMatch(JSON.stringify(item), /secrets\./);
  for (const state of ["healthy", "unhealthy"]) {
    const receipt = steps.find(item => item.name === STATE_PREFIX + state);
    assert.match(receipt.if, /steps\.plan\.outcome == 'success'/);
    assert.match(receipt.if, new RegExp(`steps.${state === "healthy" ? "recovery" : "alert"}.outcome == 'success'`));
  }
  assert.equal(steps.at(-1).if, "always() && steps.health.outcome != 'success'");
  assert.equal(steps.at(-1).run, "exit 1");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(pkg.dependencies.nodemailer, lock.packages["node_modules/nodemailer"].version);
  assert.match(lock.packages["node_modules/nodemailer"].integrity, /^sha512-/);
});
