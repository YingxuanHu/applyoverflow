import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  shouldDeferZeroGrowthPollSource,
  shouldExemptProductiveSourceFromFamilyChurn,
} from "@/lib/ingestion/source-poll-growth-guards";

describe("shouldDeferZeroGrowthPollSource", () => {
  it("defers repeatedly polled sources that accepted jobs but created none", () => {
    assert.equal(
      shouldDeferZeroGrowthPollSource({
        pollAttemptCount: 2,
        lastJobsCreatedCount: 0,
        jobsCreatedCount: 42,
        recentAcceptedCount: 25,
        recentCanonicalCreatedCount: 0,
      }),
      true
    );
  });

  it("defers small exhausted sources even without recent accepted jobs", () => {
    assert.equal(
      shouldDeferZeroGrowthPollSource({
        pollAttemptCount: 4,
        lastJobsCreatedCount: 0,
        jobsCreatedCount: 10,
        recentAcceptedCount: 0,
        recentCanonicalCreatedCount: 0,
      }),
      true
    );
  });

  it("does not defer new or productive sources", () => {
    assert.equal(
      shouldDeferZeroGrowthPollSource({
        pollAttemptCount: 1,
        lastJobsCreatedCount: 0,
        jobsCreatedCount: 0,
        recentAcceptedCount: 100,
        recentCanonicalCreatedCount: 0,
      }),
      false
    );

    assert.equal(
      shouldDeferZeroGrowthPollSource({
        pollAttemptCount: 3,
        lastJobsCreatedCount: 0,
        jobsCreatedCount: 10,
        recentAcceptedCount: 100,
        recentCanonicalCreatedCount: 1,
      }),
      false
    );
  });

  it("does not defer overdue sources that still retain live jobs", () => {
    assert.equal(
      shouldDeferZeroGrowthPollSource({
        pollAttemptCount: 8,
        lastJobsCreatedCount: 0,
        jobsCreatedCount: 6,
        recentAcceptedCount: 0,
        recentCanonicalCreatedCount: 0,
        retainedLiveJobCount: 120,
        overdueByCadence: true,
      }),
      false
    );
  });
});

describe("shouldExemptProductiveSourceFromFamilyChurn", () => {
  it("keeps recently net-positive sources pollable inside a churning connector family", () => {
    assert.equal(
      shouldExemptProductiveSourceFromFamilyChurn({
        recentCanonicalCreatedCount: 6,
        recentRemovedCount: 3,
        lastJobsCreatedCount: 0,
        jobsCreatedCount: 8,
      }),
      true
    );
  });

  it("keeps historically productive sources pollable when the last poll created jobs", () => {
    assert.equal(
      shouldExemptProductiveSourceFromFamilyChurn({
        recentCanonicalCreatedCount: 0,
        recentRemovedCount: 0,
        lastJobsCreatedCount: 2,
        jobsCreatedCount: 42,
      }),
      true
    );
  });

  it("does not exempt weak sources just because their connector family has some good members", () => {
    assert.equal(
      shouldExemptProductiveSourceFromFamilyChurn({
        recentCanonicalCreatedCount: 0,
        recentRemovedCount: 3,
        lastJobsCreatedCount: 0,
        jobsCreatedCount: 8,
      }),
      false
    );
  });
});
