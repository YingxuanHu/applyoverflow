import assert from "node:assert/strict";
import test from "node:test";
import { formatSalary } from "../src/lib/job-display";

test("salary display restores the source period and names the currency", () => {
  const clean = (value: string) => value.replace(/\u00a0/g, " ");
  assert.equal(clean(formatSalary(34840, 45656, "CAD", "hour")), "CAD 16.75 - CAD 21.95/hour");
  assert.equal(clean(formatSalary(120000, null, "USD", "month")), "USD 10,000.00+/month");
  assert.equal(clean(formatSalary(80000, 100000, "CAD", "year")), "CAD 80,000 - CAD 100,000/year");
  assert.equal(clean(formatSalary(null, 100000, "USD")), "Up to USD 100,000/year");
  assert.equal(formatSalary(null, null, "CAD", "hour"), "");
});
