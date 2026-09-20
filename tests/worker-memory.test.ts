import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import { workerMemoryPressure } from "../src/lib/ingestion/worker-memory";
import { withRuntimeDeadline, RuntimeBudgetExceededError } from "../src/lib/ingestion/runtime-control";
import { getScheduledConnectors } from "../src/lib/ingestion/registry";

test("memory admission is opt-in and has an exact bounded threshold", () => {
  const memory = { rss: 800 * 1024 * 1024, heapUsed: 300 * 1024 * 1024, heapTotal: 400 * 1024 * 1024, external: 20 * 1024 * 1024, arrayBuffers: 0 };
  for (const invalid of [0, -1, NaN, Infinity]) assert.equal(workerMemoryPressure(memory, invalid), null);
  assert.equal(workerMemoryPressure(memory, 801), null);
  assert.deepEqual(workerMemoryPressure(memory, 800), { rssMb: 800, heapUsedMb: 300, externalMb: 20, limitMb: 800 });
});

test("completed and failed fetches release their abort listeners immediately", async () => {
  const controller = new AbortController();
  for (let i = 0; i < 100; i++) {
    assert.equal(await withRuntimeDeadline(Promise.resolve(i), 600000, "fixture", controller.signal), i);
    await assert.rejects(withRuntimeDeadline(Promise.reject(new Error("fixture")), 600000, "fixture", controller.signal), /fixture/);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
});

test("deadline and abort still reject and release listeners", async () => {
  const keepAlive = setInterval(() => {}, 1000);
  const controller = new AbortController();
  try {
    await assert.rejects(withRuntimeDeadline(new Promise(() => {}), 10, "fixture", controller.signal), RuntimeBudgetExceededError);
    const pending = withRuntimeDeadline(new Promise(() => {}), 600000, "fixture", controller.signal);
    controller.abort(new Error("stop fixture"));
    await assert.rejects(pending, /stop fixture/);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  } finally { clearInterval(keepAlive); }
});

test("fixed Job Bank archives are excluded from recurring schedules by default", () => {
  const previous = process.env.JOBBANK_ARCHIVE_SCHEDULE_ENABLED;
  try {
    process.env.JOBBANK_ARCHIVE_SCHEDULE_ENABLED = "false";
    assert.equal(getScheduledConnectors().some(({ connector }) => connector.key.startsWith("jobbank:")), false);
    assert.ok(getScheduledConnectors().some(({ connector }) => connector.key.startsWith("jobbank-live:")));
  } finally {
    if (previous === undefined) delete process.env.JOBBANK_ARCHIVE_SCHEDULE_ENABLED;
    else process.env.JOBBANK_ARCHIVE_SCHEDULE_ENABLED = previous;
  }
});
