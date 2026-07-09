import assert from "node:assert/strict";
import test from "node:test";

import { ReconcileGate } from "@/lib/ingestion/readiness-reconcile-gate";

test("first run passes, repeats inside the interval are gated", () => {
  let now = 0;
  const gate = new ReconcileGate({ intervalMs: 300_000, clock: () => now });

  assert.equal(gate.shouldRun("connector-poll"), true);
  now += 60_000;
  assert.equal(gate.shouldRun("connector-poll"), false);
  now += 300_000;
  assert.equal(gate.shouldRun("connector-poll"), true);
});

test("force bypasses the interval and resets it", () => {
  let now = 0;
  const gate = new ReconcileGate({ intervalMs: 300_000, clock: () => now });

  assert.equal(gate.shouldRun("connector-poll"), true);
  now += 10_000;
  assert.equal(gate.shouldRun("connector-poll", { force: true }), true);
  now += 290_000;
  // Interval restarts from the forced run.
  assert.equal(gate.shouldRun("connector-poll"), false);
  now += 10_000;
  assert.equal(gate.shouldRun("connector-poll"), true);
});

test("keys are tracked independently", () => {
  let now = 0;
  const gate = new ReconcileGate({ intervalMs: 300_000, clock: () => now });

  assert.equal(gate.shouldRun("connector-poll"), true);
  assert.equal(gate.shouldRun("rediscovery"), true);
  now += 60_000;
  assert.equal(gate.shouldRun("connector-poll"), false);
  assert.equal(gate.shouldRun("rediscovery"), false);
});
