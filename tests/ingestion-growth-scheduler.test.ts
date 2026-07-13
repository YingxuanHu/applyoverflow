import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/applyoverflow_test";
process.env.INGEST_GROWTH_MODE = "1";

const OLD_DATE = new Date("2026-01-01T00:00:00.000Z");
const NOW = new Date("2026-06-21T12:00:00.000Z");

function refreshHeavyInput(sourceType: string | null) {
  return {
    now: NOW,
    createdAt: OLD_DATE,
    updatedAt: OLD_DATE,
    lastSuccessfulPollAt: OLD_DATE,
    pollAttemptCount: 8,
    pollSuccessCount: 8,
    recentAcceptedCount: 200,
    recentCanonicalCreatedCount: 0,
    jobsAcceptedCount: 1_200,
    jobsCreatedCount: 12,
    lastJobsCreatedCount: 0,
    noveltyRatio: 0.01,
    sourceType,
    metadataJson: null,
    companyMetadataJson: null,
  };
}

test("growth scheduler cools refresh-heavy direct source types", async () => {
  const { computeGrowthModePollSignals } = await import(
    "../src/lib/ingestion/company-discovery"
  );

  for (const sourceType of ["ATS", "COMPANY_JSON", "COMPANY_HTML"]) {
    const signals = computeGrowthModePollSignals(refreshHeavyInput(sourceType));

    assert.equal(signals.frontierCandidate, false);
    assert.equal(signals.refreshHeavyCandidate, true);
    assert.equal(signals.shouldHardCooldown, true);
    assert.ok(signals.priorityAdjustment < 0);
  }
});

test("growth scheduler does not hard-cool unsupported low-novelty source types", async () => {
  const { computeGrowthModePollSignals } = await import(
    "../src/lib/ingestion/company-discovery"
  );

  const signals = computeGrowthModePollSignals(refreshHeavyInput("BOARD"));

  assert.equal(signals.refreshHeavyCandidate, false);
  assert.equal(signals.shouldHardCooldown, false);
});

test("serializes Workday polling inside a batch while leaving other ATS APIs unconstrained", async () => {
  const { getConnectorPollRuntimeBatchCap } = await import(
    "../src/lib/ingestion/company-discovery"
  );

  assert.equal(getConnectorPollRuntimeBatchCap("workday"), 1);
  assert.equal(getConnectorPollRuntimeBatchCap("greenhouse"), Number.MAX_SAFE_INTEGER);
});
