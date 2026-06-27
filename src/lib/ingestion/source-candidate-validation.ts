export type SourceCandidatePreviewStats = {
  error?: string | null;
  fetchedCount: number;
  acceptedCount: number;
  previewCreatedCount?: number;
  previewUpdatedCount?: number;
  existingLiveCanonicalCount?: number;
  sampleTitles?: string[];
};

export type SourceCandidatePreviewAssessmentKind =
  | "VALIDATED"
  | "PREVIEW_ERROR"
  | "NO_YIELD"
  | "NO_ACCEPTED_JOBS";

export type SourceCandidatePreviewAssessment = {
  passed: boolean;
  kind: SourceCandidatePreviewAssessmentKind;
  message: string;
  evidence: string[];
};

export function assessSourceCandidatePreview(
  stats: SourceCandidatePreviewStats
): SourceCandidatePreviewAssessment {
  const evidence = [
    `fetched=${stats.fetchedCount}`,
    `accepted=${stats.acceptedCount}`,
    `previewCreated=${stats.previewCreatedCount ?? 0}`,
    `previewUpdated=${stats.previewUpdatedCount ?? 0}`,
    `existingLive=${stats.existingLiveCanonicalCount ?? 0}`,
  ];

  if (stats.error) {
    return {
      passed: false,
      kind: "PREVIEW_ERROR",
      message: `Preview failed: ${stats.error}`,
      evidence,
    };
  }

  if (stats.acceptedCount > 0) {
    return {
      passed: true,
      kind: "VALIDATED",
      message: `Preview accepted ${stats.acceptedCount} ${
        stats.acceptedCount === 1 ? "job" : "jobs"
      }.`,
      evidence: [
        ...evidence,
        ...(stats.sampleTitles?.slice(0, 3).map((title) => `sample=${title}`) ?? []),
      ],
    };
  }

  if (stats.fetchedCount > 0) {
    return {
      passed: false,
      kind: "NO_ACCEPTED_JOBS",
      message:
        "Preview fetched jobs, but none passed normalization and quality checks.",
      evidence,
    };
  }

  return {
    passed: false,
    kind: "NO_YIELD",
    message: "Preview returned no jobs, so this source is not ready to promote.",
    evidence,
  };
}
