import assert from "node:assert/strict";
import test from "node:test";

import { extractSalaryV2 } from "../src/lib/ingestion/extraction/salary-extractor-v2";

test("structured salary below the annual floor is not emitted as an annual figure", () => {
  const hourlyLike = extractSalaryV2({
    salaryMin: 45,
    salaryMax: 90,
    salaryCurrency: "USD",
    regionHint: "US",
  });

  assert.equal(hourlyLike.status, "ambiguous");
  assert.equal(hourlyLike.source, "none");
  assert.equal(hourlyLike.period, null);
  assert.equal(hourlyLike.annualizedMin, null);
  assert.equal(hourlyLike.annualizedMax, null);
  assert.equal(hourlyLike.min, null);
  assert.equal(hourlyLike.max, null);
  assert.ok(hourlyLike.reasons.includes("structured_salary_below_annual_floor"));
});

test("a single sub-floor structured value is treated as ambiguous", () => {
  const single = extractSalaryV2({
    salaryMin: 45,
    salaryMax: null,
    salaryCurrency: "CAD",
    regionHint: "CA",
  });

  assert.equal(single.status, "ambiguous");
  assert.equal(single.annualizedMin, null);
  assert.equal(single.annualizedMax, null);
});

test("a structured range with any sub-floor bound is dropped, not partially annualized", () => {
  const mixed = extractSalaryV2({
    salaryMin: 45,
    salaryMax: 95_000,
    salaryCurrency: "USD",
    regionHint: "US",
  });

  assert.equal(mixed.status, "ambiguous");
  assert.equal(mixed.annualizedMax, null);
});

test("genuine annual structured salaries pass through untouched", () => {
  const annual = extractSalaryV2({
    salaryMin: 90_000,
    salaryMax: 130_000,
    salaryCurrency: "CAD",
    regionHint: "CA",
  });

  assert.equal(annual.status, "present");
  assert.equal(annual.source, "structured");
  assert.equal(annual.period, "year");
  assert.equal(annual.min, 90_000);
  assert.equal(annual.max, 130_000);
  assert.equal(annual.annualizedMin, 90_000);
  assert.equal(annual.annualizedMax, 130_000);
  assert.equal(annual.currency, "CAD");
});

test("a structured value exactly at the annual floor is kept", () => {
  const atFloor = extractSalaryV2({
    salaryMin: 10_000,
    salaryMax: 12_000,
    salaryCurrency: "USD",
    regionHint: "US",
  });

  assert.equal(atFloor.status, "present");
  assert.equal(atFloor.annualizedMin, 10_000);
  assert.equal(atFloor.annualizedMax, 12_000);
});
