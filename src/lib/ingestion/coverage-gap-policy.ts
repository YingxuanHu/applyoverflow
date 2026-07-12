// A "coverage gap" company is one whose jobs the feed only sees through
// aggregator boards: enough aggregator-primary visible jobs to prove real
// hiring volume, zero first-party-primary visible jobs, and no healthy
// CompanySource that could surface them directly. These are the
// highest-value discovery targets — one first-party source upgrades the
// whole company's coverage.
export const COVERAGE_GAP_MIN_AGGREGATOR_JOBS = 3;

export type CoverageGapSignals = {
  aggregatorJobs: number;
  firstPartyJobs: number;
  healthySources: number;
};

export function classifyCoverageGap({
  aggregatorJobs,
  firstPartyJobs,
  healthySources,
}: CoverageGapSignals): boolean {
  return (
    aggregatorJobs >= COVERAGE_GAP_MIN_AGGREGATOR_JOBS &&
    firstPartyJobs === 0 &&
    healthySources === 0
  );
}
