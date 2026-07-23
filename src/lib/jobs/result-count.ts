// Headline result-count label for the jobs feed.
//
// The jobs headline must never turn a first page into a fabricated "50+" match
// count. Scoped queries request an exact total. The cached public-board count
// is only a defensive numeric fallback, and callers label it as live jobs.

export type JobResultCountInput = {
  /** True when a search or filter is active (so the count reflects matches). */
  hasScopedResults: boolean;
  /** Exact total from the backend, or null when it could not be computed. */
  total: number | null;
  /** Size of the full live job pool (for the unscoped headline). */
  liveJobCount: number;
};

export type JobResultCount = {
  /** Formatted numeric count. */
  label: string;
  /** True when `label` is the precise total (no "+"). */
  isExact: boolean;
};

export function formatJobResultCount(input: JobResultCountInput): JobResultCount {
  if (!input.hasScopedResults) {
    return {
      label: input.liveJobCount.toLocaleString(),
      isExact: true,
    };
  }

  if (input.total !== null) {
    return {
      label: input.total.toLocaleString(),
      isExact: true,
    };
  }

  return {
    label: input.liveJobCount.toLocaleString(),
    isExact: false,
  };
}
