import assert from "node:assert/strict";
import test from "node:test";

import {
  compareSourceIntelligenceBaselines,
  formatSourceIntelligenceComparisonMarkdown,
} from "@/lib/ingestion/source-intelligence-metrics";

test("source intelligence comparison reports stable deltas across baseline snapshots", () => {
  const comparison = compareSourceIntelligenceBaselines(
    {
      generatedAt: "2026-06-25T12:00:00.000Z",
      summary: {
        feedIndexLiveJobCount: 100,
        strictCanonicalVisibleJobCount: 90,
      },
      sourceRegistry: {
        activeValidatedPollableCount: 10,
        byStatus: { ACTIVE: 7, DEGRADED: 3 },
        byValidationState: { VALIDATED: 9, SUSPECT: 1 },
        byPollState: { READY: 6, BACKOFF: 4 },
      },
      queues: { pendingCount: 20, runningCount: 2 },
      ingestion: {
        windowTotals: {
          canonicalCreatedCount: 50,
          createdPerMinute: 1.25,
        },
      },
    },
    {
      generatedAt: "2026-06-25T13:00:00.000Z",
      summary: {
        feedIndexLiveJobCount: 125,
        strictCanonicalVisibleJobCount: 102,
      },
      sourceRegistry: {
        activeValidatedPollableCount: 14,
        byStatus: { ACTIVE: 10, DEGRADED: 2 },
        byValidationState: { VALIDATED: 12, SUSPECT: 0 },
        byPollState: { READY: 9, BACKOFF: 2 },
      },
      queues: { pendingCount: 18, runningCount: 4 },
      ingestion: {
        windowTotals: {
          canonicalCreatedCount: 60,
          createdPerMinute: 1.5,
        },
      },
    }
  );

  const feedLive = comparison.metrics.find((metric) => metric.key === "feed_live_jobs");
  const pollable = comparison.metrics.find(
    (metric) => metric.key === "active_validated_pollable_sources"
  );
  const backoff = comparison.metrics.find((metric) => metric.key === "source_poll_backoff");
  const createdRate = comparison.metrics.find(
    (metric) => metric.key === "ingestion_created_per_minute_7d"
  );

  assert.equal(feedLive?.delta, 25);
  assert.equal(feedLive?.percentDelta, 0.25);
  assert.equal(pollable?.delta, 4);
  assert.equal(backoff?.delta, -2);
  assert.equal(createdRate?.delta, 0.25);

  const markdown = formatSourceIntelligenceComparisonMarkdown(comparison);
  assert.match(markdown, /Source Intelligence Comparison/);
  assert.match(markdown, /feed_live_jobs/);
  assert.match(markdown, /\+25/);
  assert.match(markdown, /-2/);
});
