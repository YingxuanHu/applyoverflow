import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const REPOSITORY = "YingxuanHu/applyoverflow";
export const WORKFLOW = ".github/workflows/public-health.yml";
export const PLAN_STEP = "Plan health notification transition";
export const BASELINE_PREFIX = "Health notification baseline v1: ";
export const STATE_PREFIX = "Health notification state v1: ";
export const DELIVERY_PREFIX = "Deliver owner health ";
const states = ["healthy", "unhealthy", "unknown"];

export function notificationState(jobs) {
  assert.ok(Array.isArray(jobs.jobs) && jobs.total_count === jobs.jobs.length, "Incomplete jobs response");
  const readiness = jobs.jobs.filter(job => job.name === "readiness");
  assert.ok(readiness.length <= 1, "Ambiguous readiness job");
  if (!readiness.length || (readiness[0].conclusion === "cancelled" && !readiness[0].steps)) return null;
  assert.ok(Array.isArray(readiness[0].steps), "Missing readiness steps");
  const steps = readiness[0].steps;
  const successful = prefix => steps.filter(step => step.status === "completed" && step.conclusion === "success" &&
    step.name.startsWith(prefix)).map(step => step.name.slice(prefix.length));
  const committed = successful(STATE_PREFIX);
  const baseline = successful(BASELINE_PREFIX);
  const delivered = successful(DELIVERY_PREFIX);
  assert.ok(committed.length <= 1 && baseline.length <= 1 && delivered.length <= 1, "Ambiguous notification state");
  assert.ok(committed.every(state => states.slice(0, 2).includes(state)) && baseline.every(state => states.includes(state)), "Invalid notification state");
  assert.ok(delivered.every(action => ["alert", "recovery"].includes(action)), "Invalid delivery state");
  // A successful SMTP step is evidence even if cancellation interrupted the final checkpoint.
  if (delivered.length) {
    const state = delivered[0] === "alert" ? "unhealthy" : "healthy";
    assert.ok(!committed.length || committed[0] === state, "Conflicting delivery state");
    return state;
  }
  // Baseline survives SMTP/install failures; only a successful delivery advances it.
  if (committed.length) return committed[0];
  if (baseline.length) return baseline[0];
  if (!steps.some(step => step.name === PLAN_STEP)) return "unknown"; // Pre-alert workflow bootstrap.
  return null; // Interrupted before checkpoint: inspect the preceding run, never assume delivery.
}

export function planPublicHealthAlert(context, readGitHub) {
  const { repository, defaultBranch, ref, workflowRef, eventName, runId, outcome } = context;
  assert.equal(repository, REPOSITORY, "Unexpected repository");
  assert.match(defaultBranch ?? "", /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/, "Invalid default branch");
  assert.equal(ref, `refs/heads/${defaultBranch}`, "Default branch required");
  assert.equal(workflowRef, `${REPOSITORY}/${WORKFLOW}@${ref}`, "Unexpected workflow source");
  assert.ok(["schedule", "workflow_dispatch"].includes(eventName), "Untrusted event");
  assert.ok(Number.isSafeInteger(runId) && runId > 0, "Invalid run ID");
  assert.ok(["success", "failure"].includes(outcome), "Health probe did not complete");

  const base = `repos/${REPOSITORY}/actions`;
  const result = readGitHub(`${base}/workflows/public-health.yml/runs?branch=${encodeURIComponent(defaultBranch)}&status=completed&per_page=100`);
  assert.ok(Array.isArray(result.workflow_runs) && Number.isSafeInteger(result.total_count) && result.total_count >= result.workflow_runs.length, "Invalid runs response");
  const runs = result.workflow_runs.filter(run => run.id !== runId && run.status === "completed" &&
    run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY &&
    run.name === "Public Health" && [WORKFLOW, `${WORKFLOW}@${defaultBranch}`, `${WORKFLOW}@${ref}`].includes(run.path) &&
    run.head_branch === defaultBranch && ["schedule", "workflow_dispatch"].includes(run.event));
  assert.ok(runs.every(run => Number.isSafeInteger(run.id) && run.id > 0 && Number.isSafeInteger(run.run_attempt) &&
    run.run_attempt > 0 && Number.isFinite(Date.parse(run.updated_at))), "Invalid previous run");
  runs.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id);
  let previous;
  for (const run of runs.slice(0, 10)) {
    previous = notificationState(readGitHub(`${base}/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`));
    if (previous !== null) break;
  }
  if (previous == null) {
    assert.ok(runs.length <= 10 && result.total_count <= result.workflow_runs.length, "Notification history unavailable within safety limit");
    previous = "unknown";
  }
  const current = outcome === "success" ? "healthy" : "unhealthy";
  const action = current === previous || (current === "healthy" && previous === "unknown") ? "none" :
    current === "unhealthy" ? "alert" : "recovery";
  return { previous, current, action };
}

export function alertEnvelope(action) {
  assert.ok(["alert", "recovery"].includes(action), "No notification to deliver");
  const failed = action === "alert";
  return { schemaVersion: 1, source: "external", kind: action,
    active: failed ? ["public-health"] : [], opened: failed ? ["public-health"] : [], recovered: failed ? [] : ["public-health"] };
}

function main() {
  const env = process.env;
  assert.ok(env.GITHUB_OUTPUT && env.RUNNER_TEMP, "GitHub runner output paths required");
  const deadline = Date.now() + 60_000;
  const plan = planPublicHealthAlert({ repository: env.GITHUB_REPOSITORY, defaultBranch: env.PUBLIC_HEALTH_DEFAULT_BRANCH,
    ref: env.GITHUB_REF, workflowRef: env.GITHUB_WORKFLOW_REF, eventName: env.GITHUB_EVENT_NAME,
    runId: Number(env.GITHUB_RUN_ID), outcome: env.PUBLIC_HEALTH_OUTCOME }, endpoint => {
    assert.ok(Date.now() < deadline, "History timeout");
    return JSON.parse(execFileSync("gh", ["api", "--hostname", "github.com", "-H", "Accept: application/vnd.github+json",
      "-H", "X-GitHub-Api-Version: 2022-11-28", endpoint], {
      encoding: "utf8", timeout: Math.min(10_000, deadline - Date.now()), maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }));
  });
  if (plan.action !== "none") writeFileSync(join(env.RUNNER_TEMP, "public-health-alert.json"), JSON.stringify(alertEnvelope(plan.action)), { mode: 0o600 });
  appendFileSync(env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}\n`).join(""));
  console.log(JSON.stringify(plan));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch {
    console.error("Health notification planning failed; delivery-unverified. Inspect workflow permissions and history.");
    process.exitCode = 1;
  }
}
