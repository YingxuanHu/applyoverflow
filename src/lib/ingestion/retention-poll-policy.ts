// Feed visibility hides jobs whose newest source evidence is older than 14
// days (RECENT_SOURCE_EVIDENCE_MAX_AGE_MS in search-index.ts). Every job a
// source retains therefore carries a hard re-confirmation deadline: when the
// source is not successfully polled before its retained jobs cross that
// window, the jobs are hidden by the feed gate and then expired by lifecycle
// even though nothing changed on the employer's board.
//
// Growth-mode priority optimizes for net-new yield, so pure retention polls
// systematically lose the admission race — and a starved source looks
// "net-negative" (its jobs get removed because our evidence went stale), which
// earns it churn penalties and starves it further. This module is the
// deadline-driven counterweight: urgency grows as a productive source
// approaches the evidence cliff, and sources close to the cliff are exempt
// from growth-mode churn penalties so the boost cannot be cancelled out.

// Keep in sync with RECENT_SOURCE_EVIDENCE_MAX_AGE_MS (search-index.ts).
export const RETENTION_EVIDENCE_WINDOW_HOURS = 14 * 24;

// Urgency starts ramping once this fraction of the evidence window has passed
// without a successful poll. Before that point retention pressure is zero and
// growth economics decide the ordering as before.
const RETENTION_URGENCY_RAMP_START_RATIO = 0.5;

// Growth penalties are skipped once a productive source is within this many
// hours of the evidence cliff (or already past it).
const RETENTION_PENALTY_EXEMPTION_HOURS = 96;

const RETENTION_BOOST_BASE = 800;
const RETENTION_BOOST_PER_LOG_JOB = 450;
const RETENTION_BOOST_MAX = 4_500;

export type RetentionUrgencyInput = {
  now: Date;
  lastSuccessfulPollAt: Date | null | undefined;
  // Fallback reference when the source has never been polled successfully
  // (mirrors isCompanySourceOverdueForPoll's fallback chain).
  fallbackReferenceAt?: Date | null;
  retainedLiveJobCount: number;
};

export type RetentionUrgency = {
  // Hours until the source's retained jobs cross the evidence window,
  // measured from its last successful poll. Negative when already past.
  hoursUntilEvidenceCliff: number;
  // 0 when far from the cliff, ramping to 1 at the cliff and beyond.
  urgency: number;
  atRiskJobCount: number;
};

export function computeRetentionUrgency(
  input: RetentionUrgencyInput
): RetentionUrgency {
  const retainedLiveJobCount = Math.max(0, input.retainedLiveJobCount);
  const reference =
    input.lastSuccessfulPollAt ?? input.fallbackReferenceAt ?? null;

  if (retainedLiveJobCount === 0 || !reference) {
    return {
      hoursUntilEvidenceCliff: Number.POSITIVE_INFINITY,
      urgency: 0,
      atRiskJobCount: 0,
    };
  }

  const hoursSincePoll =
    (input.now.getTime() - reference.getTime()) / (60 * 60 * 1000);
  const hoursUntilEvidenceCliff =
    RETENTION_EVIDENCE_WINDOW_HOURS - hoursSincePoll;

  const rampStartHours =
    RETENTION_EVIDENCE_WINDOW_HOURS * RETENTION_URGENCY_RAMP_START_RATIO;
  if (hoursSincePoll <= rampStartHours) {
    return { hoursUntilEvidenceCliff, urgency: 0, atRiskJobCount: 0 };
  }

  // Quadratic ramp from the ramp-start point to 1.0 at the cliff; clamped to
  // 1.0 once overdue so already-dark supply keeps maximum retention pressure.
  const rampSpanHours = RETENTION_EVIDENCE_WINDOW_HOURS - rampStartHours;
  const progressed = Math.min(
    1,
    (hoursSincePoll - rampStartHours) / rampSpanHours
  );
  const urgency = progressed * progressed;

  return {
    hoursUntilEvidenceCliff,
    urgency,
    atRiskJobCount: retainedLiveJobCount,
  };
}

// Priority boost applied to retention-lane candidates. Scales with how close
// the source is to the evidence cliff and (logarithmically) with how many
// live jobs depend on it. At full urgency a source retaining ~300 jobs gets
// ~+3.4k — enough to outrank novelty candidates without a penalty exemption
// race, and capped so a single mega-source cannot monopolize admissions.
export function computeRetentionPriorityBoost(
  input: RetentionUrgencyInput
): number {
  const { urgency, atRiskJobCount } = computeRetentionUrgency(input);
  if (urgency <= 0 || atRiskJobCount <= 0) return 0;

  const boost =
    urgency *
    (RETENTION_BOOST_BASE +
      Math.log1p(atRiskJobCount) * RETENTION_BOOST_PER_LOG_JOB);
  return Math.round(Math.min(RETENTION_BOOST_MAX, boost));
}

// A source whose retained jobs are approaching (or past) the evidence cliff
// must not be pushed further down the queue by churn/net-negative penalties:
// the "churn" it shows is usually our own stale-evidence removals, and
// penalizing it creates a death spiral (staler -> more removals -> lower
// priority -> staler).
export function shouldExemptFromGrowthPenalties(
  input: RetentionUrgencyInput
): boolean {
  const { hoursUntilEvidenceCliff, atRiskJobCount } =
    computeRetentionUrgency(input);
  return (
    atRiskJobCount > 0 &&
    hoursUntilEvidenceCliff <= RETENTION_PENALTY_EXEMPTION_HOURS
  );
}
