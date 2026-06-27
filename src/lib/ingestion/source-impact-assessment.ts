export type SourceImpactVerdict =
  | "productive"
  | "validated_waiting_for_poll"
  | "pending_validation"
  | "polled_no_yield_yet"
  | "failed_or_blocked"
  | "needs_more_time";

export type SourceImpactTaskCounts = Record<string, number>;

export type SourceImpactInput = {
  sourceId: string;
  companyName: string;
  sourceName: string;
  connectorName: string;
  boardUrl: string;
  status: string;
  validationState: string;
  pollState: string;
  sourceQualityScore: number;
  yieldScore: number;
  priorityScore: number;
  retainedLiveJobCount: number;
  validationSuccessCount: number;
  pollSuccessCount: number;
  recentRunCount: number;
  recentSuccessCount: number;
  recentFailedCount: number;
  recentFetchedCount: number;
  recentAcceptedCount: number;
  recentCreatedCount: number;
  recentDedupedCount: number;
  activeMappingCount: number;
  visibleFeedJobCount: number;
  urlHealthCheckedCount: number;
  urlHealthBadCount: number;
};

export type SourceImpact = SourceImpactInput & {
  verdict: SourceImpactVerdict;
  evidence: string[];
  tasks: SourceImpactTaskCounts;
};

export type SourceImpactSummary = ReturnType<typeof summarizeSourceImpacts>;

export const BAD_URL_HEALTH_RESULTS = ["DEAD", "BLOCKED", "ERROR"] as const;

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function countBy<T>(items: T[], getKey: (item: T) => string | null | undefined) {
  return items.reduce<Record<string, number>>((record, item) => {
    const key = getKey(item) ?? "UNKNOWN";
    record[key] = (record[key] ?? 0) + 1;
    return record;
  }, {});
}

export function verdictForSourceImpact(
  source: Pick<
    SourceImpactInput,
    | "status"
    | "validationState"
    | "pollSuccessCount"
    | "recentRunCount"
    | "recentCreatedCount"
    | "retainedLiveJobCount"
    | "visibleFeedJobCount"
  >,
  taskCounts: SourceImpactTaskCounts
): SourceImpactVerdict {
  const hasPendingValidation =
    (taskCounts["SOURCE_VALIDATION:PENDING"] ?? 0) > 0 ||
    (taskCounts["SOURCE_VALIDATION:RUNNING"] ?? 0) > 0;
  const hasPendingPoll =
    (taskCounts["CONNECTOR_POLL:PENDING"] ?? 0) > 0 ||
    (taskCounts["CONNECTOR_POLL:RUNNING"] ?? 0) > 0;

  if (
    source.status === "DISABLED" ||
    source.validationState === "INVALID" ||
    source.validationState === "BLOCKED"
  ) {
    return "failed_or_blocked";
  }

  if (
    source.recentCreatedCount > 0 ||
    source.visibleFeedJobCount > 0 ||
    source.retainedLiveJobCount > 0
  ) {
    return "productive";
  }

  if (
    source.validationState === "VALIDATED" &&
    source.recentRunCount === 0 &&
    hasPendingPoll
  ) {
    return "validated_waiting_for_poll";
  }

  if (source.validationState !== "VALIDATED" && hasPendingValidation) {
    return "pending_validation";
  }

  if (source.pollSuccessCount > 0 || source.recentRunCount > 0) {
    return "polled_no_yield_yet";
  }

  return "needs_more_time";
}

export function buildSourceImpact(
  source: SourceImpactInput,
  tasks: SourceImpactTaskCounts = {}
): SourceImpact {
  const verdict = verdictForSourceImpact(source, tasks);

  return {
    ...source,
    sourceQualityScore: round(source.sourceQualityScore),
    yieldScore: round(source.yieldScore),
    priorityScore: round(source.priorityScore),
    verdict,
    evidence: [
      `validationState=${source.validationState}`,
      `pollState=${source.pollState}`,
      `recentRuns=${source.recentRunCount}`,
      `recentCreated=${source.recentCreatedCount}`,
      `retainedLive=${source.retainedLiveJobCount}`,
      `visibleFeed=${source.visibleFeedJobCount}`,
      `pendingValidation=${tasks["SOURCE_VALIDATION:PENDING"] ?? 0}`,
      `pendingPoll=${tasks["CONNECTOR_POLL:PENDING"] ?? 0}`,
    ],
    tasks,
  };
}

export function summarizeSourceImpacts(impacts: SourceImpact[]) {
  const totals = impacts.reduce(
    (sum, impact) => {
      sum.recentRuns += impact.recentRunCount;
      sum.recentFetched += impact.recentFetchedCount;
      sum.recentAccepted += impact.recentAcceptedCount;
      sum.recentCreated += impact.recentCreatedCount;
      sum.recentDeduped += impact.recentDedupedCount;
      sum.retainedLive += impact.retainedLiveJobCount;
      sum.visibleFeed += impact.visibleFeedJobCount;
      sum.urlHealthChecked += impact.urlHealthCheckedCount;
      sum.urlHealthBad += impact.urlHealthBadCount;
      return sum;
    },
    {
      recentRuns: 0,
      recentFetched: 0,
      recentAccepted: 0,
      recentCreated: 0,
      recentDeduped: 0,
      retainedLive: 0,
      visibleFeed: 0,
      urlHealthChecked: 0,
      urlHealthBad: 0,
    }
  );

  return {
    totalSources: impacts.length,
    verdictCounts: countBy(impacts, (impact) => impact.verdict),
    connectorCounts: countBy(impacts, (impact) => impact.connectorName),
    ...totals,
    acceptanceRate:
      totals.recentFetched > 0 ? round(totals.recentAccepted / totals.recentFetched) : 0,
    noveltyRate:
      totals.recentAccepted > 0 ? round(totals.recentCreated / totals.recentAccepted) : 0,
    badUrlRate:
      totals.urlHealthChecked > 0
        ? round(totals.urlHealthBad / totals.urlHealthChecked)
        : 0,
  };
}
