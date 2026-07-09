import assert from "node:assert/strict";
import test from "node:test";

import {
  COVERAGE_GAP_MIN_AGGREGATOR_JOBS,
  classifyCoverageGap,
} from "@/lib/ingestion/coverage-gap-policy";

test("aggregator-only company with no healthy source is a coverage gap", () => {
  assert.equal(
    classifyCoverageGap({
      aggregatorJobs: COVERAGE_GAP_MIN_AGGREGATOR_JOBS,
      firstPartyJobs: 0,
      healthySources: 0,
    }),
    true
  );
  assert.equal(
    classifyCoverageGap({
      aggregatorJobs: 120,
      firstPartyJobs: 0,
      healthySources: 0,
    }),
    true
  );
});

test("companies with first-party visible jobs are not gaps", () => {
  assert.equal(
    classifyCoverageGap({
      aggregatorJobs: 50,
      firstPartyJobs: 1,
      healthySources: 0,
    }),
    false
  );
});

test("companies with a healthy source are not gaps", () => {
  assert.equal(
    classifyCoverageGap({
      aggregatorJobs: 50,
      firstPartyJobs: 0,
      healthySources: 1,
    }),
    false
  );
});

test("companies below the aggregator job floor are not gaps", () => {
  assert.equal(
    classifyCoverageGap({
      aggregatorJobs: COVERAGE_GAP_MIN_AGGREGATOR_JOBS - 1,
      firstPartyJobs: 0,
      healthySources: 0,
    }),
    false
  );
  assert.equal(
    classifyCoverageGap({
      aggregatorJobs: 0,
      firstPartyJobs: 0,
      healthySources: 0,
    }),
    false
  );
});
