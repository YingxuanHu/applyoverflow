import assert from "node:assert/strict";
import test from "node:test";

import {
  RETENTION_CLAIM_STALENESS_HOURS,
  RETENTION_EVIDENCE_WINDOW_HOURS,
  computeRetentionClaimSplit,
  computeRetentionPriorityBoost,
  computeRetentionUrgency,
  shouldExemptFromGrowthPenalties,
} from "@/lib/ingestion/retention-poll-policy";

const NOW = new Date("2026-07-09T12:00:00.000Z");

function hoursAgo(hours: number) {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

test("no urgency for sources without retained live jobs", () => {
  const urgency = computeRetentionUrgency({
    now: NOW,
    lastSuccessfulPollAt: hoursAgo(400),
    retainedLiveJobCount: 0,
  });
  assert.equal(urgency.urgency, 0);
  assert.equal(urgency.atRiskJobCount, 0);
  assert.equal(
    computeRetentionPriorityBoost({
      now: NOW,
      lastSuccessfulPollAt: hoursAgo(400),
      retainedLiveJobCount: 0,
    }),
    0
  );
});

test("no urgency inside the first half of the evidence window", () => {
  const urgency = computeRetentionUrgency({
    now: NOW,
    lastSuccessfulPollAt: hoursAgo(RETENTION_EVIDENCE_WINDOW_HOURS * 0.4),
    retainedLiveJobCount: 500,
  });
  assert.equal(urgency.urgency, 0);
  assert.equal(
    computeRetentionPriorityBoost({
      now: NOW,
      lastSuccessfulPollAt: hoursAgo(RETENTION_EVIDENCE_WINDOW_HOURS * 0.4),
      retainedLiveJobCount: 500,
    }),
    0
  );
});

test("urgency ramps as the evidence cliff approaches and saturates past it", () => {
  const mid = computeRetentionUrgency({
    now: NOW,
    lastSuccessfulPollAt: hoursAgo(RETENTION_EVIDENCE_WINDOW_HOURS * 0.75),
    retainedLiveJobCount: 100,
  });
  const nearCliff = computeRetentionUrgency({
    now: NOW,
    lastSuccessfulPollAt: hoursAgo(RETENTION_EVIDENCE_WINDOW_HOURS * 0.99),
    retainedLiveJobCount: 100,
  });
  const pastCliff = computeRetentionUrgency({
    now: NOW,
    lastSuccessfulPollAt: hoursAgo(RETENTION_EVIDENCE_WINDOW_HOURS * 2),
    retainedLiveJobCount: 100,
  });

  assert.ok(mid.urgency > 0 && mid.urgency < nearCliff.urgency);
  assert.ok(nearCliff.urgency <= 1);
  assert.equal(pastCliff.urgency, 1);
  assert.ok(pastCliff.hoursUntilEvidenceCliff < 0);
});

test("boost scales with at-risk job count and stays within the cap", () => {
  const at = (retained: number) =>
    computeRetentionPriorityBoost({
      now: NOW,
      lastSuccessfulPollAt: hoursAgo(RETENTION_EVIDENCE_WINDOW_HOURS + 24),
      retainedLiveJobCount: retained,
    });

  const small = at(5);
  const medium = at(300);
  const huge = at(1_000_000);

  assert.ok(small > 0);
  assert.ok(medium > small);
  // A source retaining ~300 live jobs at full urgency must outrank stacked
  // growth-mode penalties (up to ~3.0k) so the death spiral cannot cancel it.
  assert.ok(medium >= 3_000, `expected >= 3000, got ${medium}`);
  assert.ok(huge <= 4_500);
});

test("never-polled sources fall back to the provided reference date", () => {
  const boost = computeRetentionPriorityBoost({
    now: NOW,
    lastSuccessfulPollAt: null,
    fallbackReferenceAt: hoursAgo(RETENTION_EVIDENCE_WINDOW_HOURS + 1),
    retainedLiveJobCount: 40,
  });
  assert.ok(boost > 0);

  const noReference = computeRetentionUrgency({
    now: NOW,
    lastSuccessfulPollAt: null,
    retainedLiveJobCount: 40,
  });
  assert.equal(noReference.urgency, 0);
});

test("claim split reserves a share and never consumes the whole batch", () => {
  assert.deepEqual(computeRetentionClaimSplit(120, 0.4), {
    reserved: 48,
    general: 72,
  });
  // Tiny batches: always leave at least one general slot.
  assert.deepEqual(computeRetentionClaimSplit(2, 0.9), {
    reserved: 1,
    general: 1,
  });
  // Share floor: any positive share on a real batch reserves at least one.
  assert.deepEqual(computeRetentionClaimSplit(10, 0.01), {
    reserved: 1,
    general: 9,
  });
  // Degenerate limits reserve nothing.
  assert.deepEqual(computeRetentionClaimSplit(1, 0.5), {
    reserved: 0,
    general: 1,
  });
  assert.deepEqual(computeRetentionClaimSplit(0, 0.5), {
    reserved: 0,
    general: 0,
  });
  assert.deepEqual(computeRetentionClaimSplit(50, 0), {
    reserved: 0,
    general: 50,
  });
});

test("claim staleness threshold matches the urgency ramp start", () => {
  assert.equal(
    RETENTION_CLAIM_STALENESS_HOURS,
    RETENTION_EVIDENCE_WINDOW_HOURS / 2
  );
});

test("growth-penalty exemption applies only near or past the cliff", () => {
  const farOut = shouldExemptFromGrowthPenalties({
    now: NOW,
    lastSuccessfulPollAt: hoursAgo(24),
    retainedLiveJobCount: 200,
  });
  const nearCliff = shouldExemptFromGrowthPenalties({
    now: NOW,
    lastSuccessfulPollAt: hoursAgo(RETENTION_EVIDENCE_WINDOW_HOURS - 48),
    retainedLiveJobCount: 200,
  });
  const pastCliff = shouldExemptFromGrowthPenalties({
    now: NOW,
    lastSuccessfulPollAt: hoursAgo(RETENTION_EVIDENCE_WINDOW_HOURS + 200),
    retainedLiveJobCount: 200,
  });
  const noJobs = shouldExemptFromGrowthPenalties({
    now: NOW,
    lastSuccessfulPollAt: hoursAgo(RETENTION_EVIDENCE_WINDOW_HOURS + 200),
    retainedLiveJobCount: 0,
  });

  assert.equal(farOut, false);
  assert.equal(nearCliff, true);
  assert.equal(pastCliff, true);
  assert.equal(noJobs, false);
});
