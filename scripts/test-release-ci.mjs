import assert from "node:assert/strict";
import test from "node:test";
import { verifyReleaseCI } from "./verify-release-ci.mjs";

const sha = "a".repeat(40);
const repository = "YingxuanHu/applyoverflow";
const options = { sha, headSha: sha, repository };
const run = {
  id: 123, run_attempt: 2, head_sha: sha, event: "push", head_branch: "main",
  repository: { full_name: repository }, head_repository: { full_name: repository },
  name: "Verify", path: ".github/workflows/verify.yml", status: "completed", conclusion: "success",
};
const job = { name: "application", status: "completed", conclusion: "success" };
function read(runs = [run], jobs = [job]) {
  return endpoint => endpoint.includes("/workflows/")
    ? { workflow_runs: runs }
    : { total_count: jobs.length, jobs };
}

test("authorizes only exact SHA, main push, latest successful run attempt and required job", () => {
  const calls = [];
  const result = verifyReleaseCI(options, endpoint => { calls.push(endpoint); return read()(endpoint); });
  assert.equal(result.sha, sha);
  assert.equal(result.runId, 123);
  assert.equal(result.runAttempt, 2);
  assert.match(calls[0], new RegExp(`head_sha=${sha}&event=push&branch=main`));
  assert.match(calls[1], /\/runs\/123\/attempts\/2\/jobs\?/);
});

test("rejects absent runs and another SHA, branch or event", () => {
  for (const runs of [[], [{ ...run, head_sha: "b".repeat(40) }], [{ ...run, head_branch: "dev" }], [{ ...run, event: "pull_request" }]]) {
    assert.throws(() => verifyReleaseCI(options, read(runs)), /No Verify push run/);
  }
});

test("rejects invalid provenance and failed, skipped, pending or cancelled verification", () => {
  for (const patch of [
    { repository: { full_name: "fork/repository" } }, { head_repository: { full_name: "fork/repository" } },
    { path: ".github/workflows/other.yml" }, { name: "Not Verify" }, { status: "in_progress" },
    { conclusion: "failure" }, { conclusion: "skipped" }, { conclusion: "cancelled" },
    { id: "123" }, { run_attempt: 0 },
  ]) assert.throws(() => verifyReleaseCI(options, read([{ ...run, ...patch }])));
});

test("never falls back to an older successful run", () => {
  assert.throws(() => verifyReleaseCI(options, read([run, { ...run, id: 124, conclusion: "failure" }])), /did not succeed/);
});

test("requires a successful, unskipped application job", () => {
  for (const jobs of [[], [{ ...job, name: "other" }], [job, job], [{ ...job, conclusion: "skipped" }], [{ ...job, conclusion: "failure" }], [{ ...job, status: "in_progress" }]]) {
    assert.throws(() => verifyReleaseCI(options, read([run], jobs)));
  }
});

test("fails closed on API failures, malformed responses and pagination", () => {
  assert.throws(() => verifyReleaseCI(options, () => { throw new Error("HTTP 403"); }), /HTTP 403/);
  assert.throws(() => verifyReleaseCI(options, () => ({})), /Invalid workflow/);
  assert.throws(() => verifyReleaseCI(options, endpoint => endpoint.includes("/workflows/")
    ? { workflow_runs: [run] } : { jobs: [job], total_count: 101 }), /Incomplete jobs/);
});

test("rejects abbreviated SHAs and invalid repositories before requesting GitHub", () => {
  for (const invalid of [{ ...options, sha: "abc123" }, { ...options, repository: "owner/repo?x=1" }, { ...options, repository: "fork/applyoverflow" }, { ...options, headSha: "b".repeat(40) }, { repository }, { sha }]) {
    assert.throws(() => verifyReleaseCI(invalid, () => assert.fail("Unexpected network request")));
  }
});
