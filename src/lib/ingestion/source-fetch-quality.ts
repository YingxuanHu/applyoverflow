export type CompanySiteCompletenessSignal = {
  displayedJobCount: number;
  fetchedJobCount: number;
};

export type CompanySiteCompletenessAssessment = {
  signal: CompanySiteCompletenessSignal | null;
  consecutiveSuspectPolls: number;
  shouldRediscover: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

export function readCompanySiteCompletenessSignal(
  fetchMetadata: unknown
): CompanySiteCompletenessSignal | null {
  const metadata = asRecord(fetchMetadata);
  if (!metadata || metadata.completenessSuspect !== true) return null;

  const displayedJobCount = readNonNegativeInteger(metadata.displayedJobCount);
  const fetchedJobCount = readNonNegativeInteger(metadata.fetchedJobCount);
  if (displayedJobCount === null || fetchedJobCount === null) return null;

  return { displayedJobCount, fetchedJobCount };
}

function readPreviousSuspectPolls(sourceMetadata: unknown): number {
  const metadata = asRecord(sourceMetadata);
  const completeness = asRecord(metadata?.extractionCompleteness);
  return readNonNegativeInteger(completeness?.consecutiveSuspectPolls) ?? 0;
}

// A displayed count is advisory, so require repeat confirmation before a
// source enters repair. This avoids reacting to stale page counters while
// protecting full-snapshot freshness from repeated partial extractions.
export function assessCompanySiteCompleteness(input: {
  fetchMetadata: unknown;
  sourceMetadata: unknown;
  rediscoveryThreshold: number;
}): CompanySiteCompletenessAssessment {
  const signal = readCompanySiteCompletenessSignal(input.fetchMetadata);
  if (!signal) {
    return {
      signal: null,
      consecutiveSuspectPolls: 0,
      shouldRediscover: false,
    };
  }

  const consecutiveSuspectPolls = readPreviousSuspectPolls(input.sourceMetadata) + 1;
  return {
    signal,
    consecutiveSuspectPolls,
    shouldRediscover:
      consecutiveSuspectPolls >= Math.max(2, Math.floor(input.rediscoveryThreshold)),
  };
}
