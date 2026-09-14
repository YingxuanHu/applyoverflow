import assert from "node:assert/strict";
import test from "node:test";
import { JobCountBusyError, runBoundedJobCount } from "../src/lib/queries/job-count-budget";

test("optional counts cap concurrency without queuing and release slots after failure", async () => {
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const first = runBoundedJobCount(() => pending);
  const second = runBoundedJobCount(() => pending);
  let called = false;
  await assert.rejects(runBoundedJobCount(async () => { called = true; }), JobCountBusyError);
  assert.equal(called, false);
  finish();
  await Promise.all([first, second]);
  await assert.rejects(runBoundedJobCount(async () => { throw new Error("timeout"); }), /timeout/);
  assert.equal(await runBoundedJobCount(async () => 12), 12);
});
