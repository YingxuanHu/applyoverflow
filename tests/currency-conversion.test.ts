import assert from "node:assert/strict";
import test from "node:test";

import {
  convertSalaryAmount,
  convertSalaryRange,
  normalizeSalaryCurrency,
} from "../src/lib/currency-conversion";

test("salary currencies normalize common aliases", () => {
  assert.equal(normalizeSalaryCurrency("cad"), "CAD");
  assert.equal(normalizeSalaryCurrency("CA$"), "CAD");
  assert.equal(normalizeSalaryCurrency("US$"), "USD");
  assert.equal(normalizeSalaryCurrency("JPY"), null);
});

test("salary amounts convert between supported currencies", () => {
  assert.equal(convertSalaryAmount(80_000, "CAD", "USD"), 57_952);
  assert.equal(convertSalaryAmount(100_000, "USD", "CAD"), 138_045);
  assert.equal(convertSalaryAmount(100_000, "EUR", "CAD"), 160_719);
});

test("salary ranges preserve missing bounds during conversion", () => {
  assert.deepEqual(
    convertSalaryRange({
      salaryMin: 80_000,
      salaryMax: null,
      fromCurrency: "CAD",
      toCurrency: "USD",
    }),
    { salaryMin: 57_952, salaryMax: null }
  );
});
