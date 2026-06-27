export const DEFAULT_ZERO_GROWTH_ACCEPTED_THRESHOLD = 25;

export function shouldDeferZeroGrowthPollSource(input: {
  pollAttemptCount: number;
  lastJobsCreatedCount: number;
  jobsCreatedCount: number;
  recentAcceptedCount: number;
  recentCanonicalCreatedCount: number;
  retainedLiveJobCount?: number;
  overdueByCadence?: boolean;
}, options: { acceptedThreshold?: number } = {}) {
  const acceptedThreshold =
    options.acceptedThreshold ?? DEFAULT_ZERO_GROWTH_ACCEPTED_THRESHOLD;

  if ((input.retainedLiveJobCount ?? 0) > 0 && input.overdueByCadence === true) {
    return false;
  }

  return (
    input.pollAttemptCount >= 2 &&
    input.lastJobsCreatedCount === 0 &&
    input.recentCanonicalCreatedCount === 0 &&
    (input.recentAcceptedCount >= acceptedThreshold ||
      input.jobsCreatedCount <= 10)
  );
}

export function shouldExemptProductiveSourceFromFamilyChurn(input: {
  recentCanonicalCreatedCount: number;
  recentRemovedCount: number;
  lastJobsCreatedCount: number;
  jobsCreatedCount: number;
}) {
  if (
    input.recentCanonicalCreatedCount > 0 &&
    input.recentCanonicalCreatedCount >= input.recentRemovedCount
  ) {
    return true;
  }

  return input.lastJobsCreatedCount > 0 && input.jobsCreatedCount >= 25;
}
