type SourceCandidatePriorityInput = {
  noveltyScore: number;
  coverageGapScore: number;
  potentialYieldScore: number;
  sourceQualityScore: number;
  failureCount: number;
  confidence: number;
  candidateType: string;
  status: string;
  hasAtsTenant: boolean;
};

function getExplorationCandidateTypeBonus(candidateType: string) {
  switch (candidateType) {
    case "ATS_BOARD":
      return 48;
    case "CAREER_PAGE":
      return 10;
    case "SITEMAP":
      return 8;
    case "JOB_PAGE":
      return -4;
    case "COMPANY_ROOT":
      return -8;
    case "AGGREGATOR_LEAD":
      return -12;
    default:
      return 0;
  }
}

export function computeExplorationPriorityScore(input: SourceCandidatePriorityInput) {
  const candidateTypeBonus = getExplorationCandidateTypeBonus(input.candidateType);
  const statusBonus =
    input.status === "VALIDATED" ? 6 : input.status === "STALE" ? -14 : 0;
  const atsTenantBonus = input.hasAtsTenant ? 16 : 0;

  return (
    input.noveltyScore * 1.35 +
    input.coverageGapScore * 1.2 +
    input.potentialYieldScore * 1.15 +
    input.sourceQualityScore * 0.7 +
    input.confidence * 0.5 -
    input.failureCount * 10 +
    candidateTypeBonus +
    statusBonus +
    atsTenantBonus
  );
}
