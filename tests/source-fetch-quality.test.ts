import assert from "node:assert/strict";
import test from "node:test";

import {
  assessCompanySiteCompleteness,
  readCompanySiteCompletenessSignal,
} from "../src/lib/ingestion/source-fetch-quality";

test("recognizes a connector-reported company-site extraction shortfall", () => {
  assert.deepEqual(
    readCompanySiteCompletenessSignal({
      completenessSuspect: true,
      displayedJobCount: 1739,
      fetchedJobCount: 23,
    }),
    { displayedJobCount: 1739, fetchedJobCount: 23 }
  );
});

test("does not treat an unmeasured or clean source fetch as incomplete", () => {
  assert.equal(readCompanySiteCompletenessSignal({ completenessSuspect: false }), null);
  assert.equal(readCompanySiteCompletenessSignal({ completenessSuspect: true }), null);
});

test("requires repeated shortfalls before source rediscovery", () => {
  const fetchMetadata = {
    completenessSuspect: true,
    displayedJobCount: 120,
    fetchedJobCount: 8,
  };

  const first = assessCompanySiteCompleteness({
    fetchMetadata,
    sourceMetadata: {},
    rediscoveryThreshold: 2,
  });
  assert.equal(first.consecutiveSuspectPolls, 1);
  assert.equal(first.shouldRediscover, false);

  const second = assessCompanySiteCompleteness({
    fetchMetadata,
    sourceMetadata: {
      extractionCompleteness: { consecutiveSuspectPolls: 1 },
    },
    rediscoveryThreshold: 2,
  });
  assert.equal(second.consecutiveSuspectPolls, 2);
  assert.equal(second.shouldRediscover, true);
});

test("resets the shortfall streak after a clean fetch", () => {
  const assessment = assessCompanySiteCompleteness({
    fetchMetadata: { completenessSuspect: false },
    sourceMetadata: {
      extractionCompleteness: { consecutiveSuspectPolls: 3 },
    },
    rediscoveryThreshold: 2,
  });

  assert.equal(assessment.consecutiveSuspectPolls, 0);
  assert.equal(assessment.shouldRediscover, false);
});
