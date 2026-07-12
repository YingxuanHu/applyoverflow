import assert from "node:assert/strict";
import test from "node:test";

import { computeExplorationPriorityScore } from "@/lib/ingestion/source-candidate-priority";

const baseScores = {
  noveltyScore: 0.8,
  coverageGapScore: 0.8,
  potentialYieldScore: 0.75,
  sourceQualityScore: 0.75,
  failureCount: 0,
  confidence: 0.85,
};

test("ATS board candidates outrank generic validated career pages", () => {
  const ats = computeExplorationPriorityScore({
    ...baseScores,
    candidateType: "ATS_BOARD",
    status: "NEW",
    hasAtsTenant: true,
  });
  const careerPage = computeExplorationPriorityScore({
    ...baseScores,
    candidateType: "CAREER_PAGE",
    status: "VALIDATED",
    hasAtsTenant: false,
  });

  assert.ok(ats > careerPage + 20);
});

test("job pages and company roots do not crowd out structured ATS sources", () => {
  const ats = computeExplorationPriorityScore({
    ...baseScores,
    candidateType: "ATS_BOARD",
    status: "NEW",
    hasAtsTenant: true,
  });
  const jobPage = computeExplorationPriorityScore({
    ...baseScores,
    candidateType: "JOB_PAGE",
    status: "VALIDATED",
    hasAtsTenant: false,
  });
  const companyRoot = computeExplorationPriorityScore({
    ...baseScores,
    candidateType: "COMPANY_ROOT",
    status: "VALIDATED",
    hasAtsTenant: false,
  });

  assert.ok(ats > jobPage);
  assert.ok(ats > companyRoot);
});
