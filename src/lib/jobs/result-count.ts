// Headline result-count label for the jobs feed.
//
// The old logic showed a fabricated "50+ matching jobs" whenever the exact
// total wasn't immediately available (e.g. an expensive count). That reads as
// an approximation even when the real total is known and small. This helper:
//  - shows the EXACT total whenever the backend resolved one (no "+"),
//  - shows the full live-pool size when nothing is scoped,
//  - falls back to an honest lower bound ("N+") ONLY when the total is genuinely
//    unknown and there is a next page, or when the match set was capped.

export type JobResultCountInput = {
  /** True when a search or filter is active (so the count reflects matches). */
  hasScopedResults: boolean;
  /** Exact total from the backend, or null when it could not be computed. */
  total: number | null;
  /** Number of rows on the current page. */
  dataLength: number;
  /** Current 1-based page. */
  page: number;
  /** Page size. */
  pageSize: number;
  /** Whether another page of results exists. */
  hasNextPage: boolean;
  /** Size of the full live job pool (for the unscoped headline). */
  liveJobCount: number;
  /** True when the backend capped the match set (honest "N+"). */
  capped?: boolean;
};

export type JobResultCount = {
  /** Formatted number, possibly suffixed with "+". */
  label: string;
  /** True when `label` is the precise total (no "+"). */
  isExact: boolean;
  /** True when `label` is an honest lower bound (carries "+"). */
  isLowerBound: boolean;
};

export function formatJobResultCount(input: JobResultCountInput): JobResultCount {
  if (!input.hasScopedResults) {
    return {
      label: input.liveJobCount.toLocaleString(),
      isExact: true,
      isLowerBound: false,
    };
  }

  if (input.total !== null) {
    if (input.capped) {
      return {
        label: `${input.total.toLocaleString()}+`,
        isExact: false,
        isLowerBound: true,
      };
    }
    return {
      label: input.total.toLocaleString(),
      isExact: true,
      isLowerBound: false,
    };
  }

  // Total unknown (count unavailable). Never invent a number — show how many we
  // can prove exist so far, as a lower bound when more pages remain.
  const floor = Math.max(
    input.dataLength,
    (input.page - 1) * input.pageSize + input.dataLength
  );
  if (input.hasNextPage) {
    return { label: `${floor.toLocaleString()}+`, isExact: false, isLowerBound: true };
  }
  return { label: floor.toLocaleString(), isExact: true, isLowerBound: false };
}
