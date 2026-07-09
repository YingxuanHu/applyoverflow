const SOURCE_CANDIDATE_STALE_RETRY_HOURS = Math.max(
  1,
  Number.parseInt(process.env.SOURCE_CANDIDATE_STALE_RETRY_HOURS ?? "24", 10) ||
    24
);
const SOURCE_CANDIDATE_MAX_VALIDATION_FAILURES = Math.max(
  3,
  Number.parseInt(process.env.SOURCE_CANDIDATE_MAX_VALIDATION_FAILURES ?? "5", 10) ||
    5
);

type SourceCandidateValidationGuardInput = {
  status: string;
  failureCount: number;
  lastValidatedAt: Date | null;
  allowPromotedRepair?: boolean;
};

export function getSourceCandidateValidationMissStatus(message: string) {
  const normalizedMessage = message.toLowerCase();
  if (
    normalizedMessage.includes("404 not found") ||
    normalizedMessage.includes("410 gone")
  ) {
    return "REJECTED" as const;
  }

  return "STALE" as const;
}

export function getSourceCandidateValidationSkipReason(
  candidate: SourceCandidateValidationGuardInput,
  now: Date = new Date()
) {
  if (
    (candidate.status === "PROMOTED" && !candidate.allowPromotedRepair) ||
    candidate.status === "REJECTED"
  ) {
    return `Skipped ${candidate.status.toLowerCase()} source candidate.`;
  }

  if (candidate.failureCount >= SOURCE_CANDIDATE_MAX_VALIDATION_FAILURES) {
    return `Skipped exhausted source candidate after ${candidate.failureCount} validation failures.`;
  }

  if (candidate.status === "STALE" && candidate.lastValidatedAt) {
    const staleRetryAt = new Date(
      candidate.lastValidatedAt.getTime() +
        SOURCE_CANDIDATE_STALE_RETRY_HOURS * 60 * 60 * 1000
    );
    if (staleRetryAt > now) {
      return `Skipped recently failed source candidate until ${staleRetryAt.toISOString()}.`;
    }
  }

  return null;
}
