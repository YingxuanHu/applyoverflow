// Headline result-count label for the jobs feed.
//
// The jobs headline must never turn a first page into a fabricated "50+" match
// count. Scoped queries wait for their exact total; the loading overlay makes
// that wait explicit. If an upstream query fails to provide a total, surface
// that failure rather than presenting a partial page as a count.

export type JobResultCountInput = {
  /** True when a search or filter is active (so the count reflects matches). */
  hasScopedResults: boolean;
  /** Exact total from the backend, or null when it could not be computed. */
  total: number | null;
  /** Size of the full live job pool (for the unscoped headline). */
  liveJobCount: number;
};

export type JobResultCount = {
  /** Formatted number or an explicit unavailable state. */
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
    label: "Exact count unavailable",
    isExact: false,
  };
}
