import test from "node:test";
import assert from "node:assert/strict";

import {
  BAD_URL_HEALTH_RESULTS,
  buildSourceImpact,
  summarizeSourceImpacts,
  verdictForSourceImpact,
  type SourceImpactInput,
} from "../src/lib/ingestion/source-impact-assessment";

function source(overrides: Partial<SourceImpactInput> = {}): SourceImpactInput {
  return {
    sourceId: "source_1",
    companyName: "Acme",
    sourceName: "Ashby:acme",
    connectorName: "ashby",
    boardUrl: "https://jobs.ashbyhq.com/acme",
    status: "ACTIVE",
    validationState: "VALIDATED",
    pollState: "READY",
    sourceQualityScore: 0.9,
    yieldScore: 0.7,
    priorityScore: 0.8,
    retainedLiveJobCount: 0,
    validationSuccessCount: 1,
    pollSuccessCount: 0,
    recentRunCount: 0,
    recentSuccessCount: 0,
    recentFailedCount: 0,
    recentFetchedCount: 0,
    recentAcceptedCount: 0,
    recentCreatedCount: 0,
    recentDedupedCount: 0,
    activeMappingCount: 0,
    visibleFeedJobCount: 0,
    urlHealthCheckedCount: 0,
    urlHealthBadCount: 0,
    ...overrides,
  };
}

test("bad URL health results match the existing health enum failure states", () => {
  assert.deepEqual(BAD_URL_HEALTH_RESULTS, ["DEAD", "BLOCKED", "ERROR"]);
});

test("verdictForSourceImpact marks newly productive sources by created or visible jobs", () => {
  assert.equal(
    verdictForSourceImpact(source({ recentCreatedCount: 4 }), {}),
    "productive"
  );
  assert.equal(
    verdictForSourceImpact(source({ visibleFeedJobCount: 20 }), {}),
    "productive"
  );
});

test("verdictForSourceImpact distinguishes pending validation from poll queue", () => {
  assert.equal(
    verdictForSourceImpact(
      source({ validationState: "UNVALIDATED" }),
      { "SOURCE_VALIDATION:PENDING": 1 }
    ),
    "pending_validation"
  );
  assert.equal(
    verdictForSourceImpact(source(), { "CONNECTOR_POLL:PENDING": 1 }),
    "validated_waiting_for_poll"
  );
});

test("verdictForSourceImpact marks failed, blocked, and no-yield sources", () => {
  assert.equal(
    verdictForSourceImpact(source({ validationState: "BLOCKED" }), {}),
    "failed_or_blocked"
  );
  assert.equal(
    verdictForSourceImpact(source({ status: "DISABLED" }), {}),
    "failed_or_blocked"
  );
  assert.equal(
    verdictForSourceImpact(source({ recentRunCount: 1, pollSuccessCount: 1 }), {}),
    "polled_no_yield_yet"
  );
});

test("summarizeSourceImpacts reports source yield, novelty, and URL quality", () => {
  const summary = summarizeSourceImpacts([
    buildSourceImpact(
      source({
        sourceId: "source_1",
        recentFetchedCount: 100,
        recentAcceptedCount: 50,
        recentCreatedCount: 10,
        retainedLiveJobCount: 10,
        visibleFeedJobCount: 9,
        urlHealthCheckedCount: 5,
        urlHealthBadCount: 1,
      })
    ),
    buildSourceImpact(
      source({
        sourceId: "source_2",
        connectorName: "greenhouse",
        recentFetchedCount: 50,
        recentAcceptedCount: 25,
        recentCreatedCount: 5,
        retainedLiveJobCount: 5,
        visibleFeedJobCount: 4,
        urlHealthCheckedCount: 5,
        urlHealthBadCount: 0,
      })
    ),
  ]);

  assert.equal(summary.totalSources, 2);
  assert.equal(summary.recentFetched, 150);
  assert.equal(summary.recentAccepted, 75);
  assert.equal(summary.recentCreated, 15);
  assert.equal(summary.acceptanceRate, 0.5);
  assert.equal(summary.noveltyRate, 0.2);
  assert.equal(summary.badUrlRate, 0.1);
  assert.deepEqual(summary.connectorCounts, { ashby: 1, greenhouse: 1 });
});
