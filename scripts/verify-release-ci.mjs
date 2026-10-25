import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const expectedRepository = "YingxuanHu/applyoverflow";
const workflow = ".github/workflows/verify.yml";

export function verifyReleaseCI({ sha, headSha, repository = expectedRepository }, readGitHub) {
  assert.match(sha ?? "", /^[a-f0-9]{40}$/, "A full lowercase release SHA is required");
  assert.equal(sha, headSha, "Release SHA must match the local checkout HEAD");
  assert.equal(repository, expectedRepository, "Only the expected release repository is allowed");
  const base = `repos/${repository}/actions`;
  const result = readGitHub(`${base}/workflows/verify.yml/runs?head_sha=${sha}&event=push&branch=main&per_page=100`);
  assert.ok(Array.isArray(result.workflow_runs), "Invalid workflow-runs response");
  const runs = result.workflow_runs.filter(run => run.head_sha === sha && run.event === "push" && run.head_branch === "main");
  assert.ok(runs.length, "No Verify push run on main exists for the exact release SHA");
  // A newer failed/in-progress run must never be hidden by an older success.
  const run = runs.sort((a, b) => b.id - a.id)[0];
  assert.equal(run.repository?.full_name, repository, "Workflow repository mismatch");
  assert.equal(run.head_repository?.full_name, repository, "Fork runs cannot authorize a release");
  assert.equal(run.name, "Verify", "Unexpected workflow name");
  assert.equal(run.path, workflow, "Unexpected workflow path");
  assert.equal(run.status, "completed", "Verify has not completed");
  assert.equal(run.conclusion, "success", "Verify did not succeed");
  assert.ok(Number.isSafeInteger(run.id) && run.id > 0, "Invalid run ID");
  assert.ok(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0, "Invalid run attempt");
  const jobs = readGitHub(`${base}/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  assert.ok(Array.isArray(jobs.jobs) && jobs.total_count === jobs.jobs.length, "Incomplete jobs response");
  const application = jobs.jobs.filter(job => job.name === "application");
  assert.equal(application.length, 1, "Required application job missing or ambiguous");
  assert.equal(application[0].status, "completed", "Required application job has not completed");
  assert.equal(application[0].conclusion, "success", "Required application job did not pass (skipped is not success)");
  return {
    sha, repository, workflow, runId: run.id, runAttempt: run.run_attempt,
    url: `https://github.com/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}`,
  };
}

function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { sha: { type: "string" }, repo: { type: "string" } } });
  assert.ok(positionals.length <= 1 && !(values.sha && positionals.length), "Usage: verify-release-ci.mjs --sha <full-sha> (or one positional SHA)");
  const root = resolve(import.meta.dirname, "..");
  const headSha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const remote = execFileSync("git", ["-C", root, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(remote);
  assert.equal(match?.[1], expectedRepository, "Checkout origin must be the expected GitHub release repository");
  const repository = values.repo || process.env.GITHUB_REPOSITORY || expectedRepository;
  const evidence = verifyReleaseCI({ sha: values.sha || positionals[0], headSha, repository }, endpoint => JSON.parse(execFileSync(
    "gh", ["api", "--hostname", "github.com", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2022-11-28", endpoint],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  )));
  console.log(JSON.stringify(evidence));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) {
    console.error(`Release blocked: ${error.message}`);
    process.exitCode = 1;
  }
}
