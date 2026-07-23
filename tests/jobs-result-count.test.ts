import assert from "node:assert/strict";
import test from "node:test";

import { formatJobResultCount } from "../src/lib/jobs/result-count";

const base = {
  hasScopedResults: true,
  total: null as number | null,
  liveJobCount: 404689,
};

test("unscoped headline shows the full live pool size", () => {
  const result = formatJobResultCount({ ...base, hasScopedResults: false });
  assert.equal(result.label, "404,689");
  assert.equal(result.isExact, true);
});

test("an exact total is shown precisely with no '+'", () => {
  const result = formatJobResultCount({ ...base, total: 5018 });
  assert.equal(result.label, "5,018");
  assert.equal(result.isExact, true);
});

test("a known small total never renders the fabricated '50+'", () => {
  const result = formatJobResultCount({ ...base, total: 78774 });
  assert.equal(result.label, "78,774");
  assert.doesNotMatch(result.label, /\+/);
});

test("an unknown total never falls back to a partial-page count", () => {
  const result = formatJobResultCount({ ...base, total: null });
  assert.equal(result.label, "Exact count unavailable");
  assert.equal(result.isExact, false);
});
