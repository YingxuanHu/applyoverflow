import assert from "node:assert/strict";
import test from "node:test";

import { formatJobResultCount } from "../src/lib/jobs/result-count";

const base = {
  hasScopedResults: true,
  total: null as number | null,
  dataLength: 50,
  page: 1,
  pageSize: 50,
  hasNextPage: true,
  liveJobCount: 404689,
};

test("unscoped headline shows the full live pool size", () => {
  const result = formatJobResultCount({ ...base, hasScopedResults: false });
  assert.equal(result.label, "404,689");
  assert.equal(result.isExact, true);
});

test("an exact total is shown precisely with no '+'", () => {
  const result = formatJobResultCount({ ...base, total: 5018, hasNextPage: true });
  assert.equal(result.label, "5,018");
  assert.equal(result.isExact, true);
  assert.equal(result.isLowerBound, false);
});

test("a known small total never renders the fabricated '50+'", () => {
  // Even with a full first page and a next page, a known total wins.
  const result = formatJobResultCount({ ...base, total: 78774, hasNextPage: true });
  assert.equal(result.label, "78,774");
  assert.doesNotMatch(result.label, /\+/);
});

test("a capped total is shown as an honest lower bound", () => {
  const result = formatJobResultCount({ ...base, total: 10000, capped: true });
  assert.equal(result.label, "10,000+");
  assert.equal(result.isExact, false);
  assert.equal(result.isLowerBound, true);
});

test("an unknown total with more pages shows an honest lower bound, not a fake exact", () => {
  const result = formatJobResultCount({ ...base, total: null, dataLength: 50, page: 1, hasNextPage: true });
  assert.equal(result.label, "50+");
  assert.equal(result.isExact, false);
  assert.equal(result.isLowerBound, true);
});

test("unknown total lower bound accounts for the current page offset", () => {
  const result = formatJobResultCount({ ...base, total: null, page: 3, dataLength: 50, hasNextPage: true });
  // 2 full prior pages + 50 on this page = 150 proven so far.
  assert.equal(result.label, "150+");
});

test("unknown total on the last page is exact (no '+')", () => {
  const result = formatJobResultCount({ ...base, total: null, dataLength: 23, hasNextPage: false });
  assert.equal(result.label, "23");
  assert.equal(result.isExact, true);
});
