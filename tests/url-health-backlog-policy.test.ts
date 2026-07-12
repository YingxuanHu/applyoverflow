import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveUrlHealthEnqueueBudget,
  resolveUrlHealthPendingCeiling,
  shouldEnqueueUrlHealth,
} from "@/lib/ingestion/url-health-backlog-policy";

test("shouldEnqueueUrlHealth allows enqueues only below the ceiling", () => {
  assert.equal(shouldEnqueueUrlHealth(0, 6_000), true);
  assert.equal(shouldEnqueueUrlHealth(5_999, 6_000), true);
  assert.equal(shouldEnqueueUrlHealth(6_000, 6_000), false);
  assert.equal(shouldEnqueueUrlHealth(9_108, 6_000), false);
});

test("resolveUrlHealthEnqueueBudget clamps the batch to remaining headroom", () => {
  // Plenty of headroom: the requested limit passes through untouched.
  assert.equal(resolveUrlHealthEnqueueBudget(3_000, 0, 6_000), 3_000);

  // Partial headroom: a full batch would overshoot the ceiling, so only the
  // remaining slots are granted.
  assert.equal(resolveUrlHealthEnqueueBudget(3_000, 5_500, 6_000), 500);

  // At or over the ceiling: nothing may be enqueued.
  assert.equal(resolveUrlHealthEnqueueBudget(3_000, 6_000, 6_000), 0);
  assert.equal(resolveUrlHealthEnqueueBudget(3_000, 9_108, 6_000), 0);
});

test("resolveUrlHealthEnqueueBudget never returns a negative budget", () => {
  assert.equal(resolveUrlHealthEnqueueBudget(0, 100, 6_000), 0);
  assert.equal(resolveUrlHealthEnqueueBudget(-5, 100, 6_000), 0);
});

test("resolveUrlHealthPendingCeiling parses a positive integer override", () => {
  assert.equal(resolveUrlHealthPendingCeiling("4000"), 4_000);
  assert.equal(resolveUrlHealthPendingCeiling("1"), 1);
});

test("resolveUrlHealthPendingCeiling falls back to the default when unset or invalid", () => {
  assert.equal(resolveUrlHealthPendingCeiling(undefined), 6_000);
  assert.equal(resolveUrlHealthPendingCeiling(""), 6_000);
  assert.equal(resolveUrlHealthPendingCeiling("not-a-number"), 6_000);
  assert.equal(resolveUrlHealthPendingCeiling("0"), 6_000);
  assert.equal(resolveUrlHealthPendingCeiling("-500"), 6_000);
});
