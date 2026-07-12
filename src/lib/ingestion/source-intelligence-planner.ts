import type { SourceTaskKind } from "@/generated/prisma/client";

export type PlannerSourceStatus =
  | "DISCOVERED"
  | "PROVISIONED"
  | "ACTIVE"
  | "DEGRADED"
  | "REDISCOVER_REQUIRED"
  | "DISABLED";

export type PlannerValidationState =
  | "UNVALIDATED"
  | "VALIDATING"
  | "VALIDATED"
  | "SUSPECT"
  | "INVALID"
  | "NEEDS_REDISCOVERY"
  | "BLOCKED";

export type PlannerPollState =
  | "READY"
  | "ACTIVE"
  | "BACKOFF"
  | "QUARANTINED"
  | "DISABLED";

export type PlannerSourceCandidateStatus =
  | "NEW"
  | "VALIDATED"
  | "PROMOTED"
  | "REJECTED"
  | "STALE";

export type PlannerCompanySource = {
  id: string;
  companyId: string;
  companyName: string;
  sourceName: string;
  connectorName: string;
  sourceType: string | null;
  extractionRoute: string | null;
  boardUrl: string;
  status: PlannerSourceStatus;
  validationState: PlannerValidationState;
  pollState: PlannerPollState;
  sourceQualityScore: number;
  yieldScore: number;
  priorityScore: number;
  retainedLiveJobCount: number;
  cooldownUntil: Date | null;
  lastSuccessfulPollAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  failureStreak: number;
  pollAttemptCount: number;
  pollSuccessCount: number;
  jobsAcceptedCount: number;
  jobsCreatedCount: number;
  lastJobsAcceptedCount: number;
  lastJobsCreatedCount: number;
  recentRunCount: number;
  recentFailedRunCount: number;
  recentAcceptedCount: number;
  recentCreatedCount: number;
  recentDedupedCount: number;
  recentRuntimeMs: number;
};

export type PlannerSourceCandidate = {
  id: string;
  companyId: string | null;
  companyName: string | null;
  companyNameHint: string | null;
  candidateType: string;
  status: PlannerSourceCandidateStatus;
  candidateUrl: string;
  rootDomain: string | null;
  atsPlatform: string | null;
  confidence: number;
  noveltyScore: number;
  coverageGapScore: number;
  potentialYieldScore: number;
  sourceQualityScore: number;
  failureCount: number;
};

export type PlannerCompanyCoverageGap = {
  companyId: string;
  companyName: string;
  domain: string | null;
  careersUrl: string | null;
  sourceCount: number;
  activeSourceCount: number;
  validatedSourceCount: number;
  feedLiveJobCount: number;
  canonicalVisibleJobCount: number;
  maxSourceQualityScore: number;
  maxPriorityScore: number;
};

export type SourceIntelligenceActionKind =
  | "POLL_SOURCE"
  | "VALIDATE_SOURCE"
  | "REDISCOVER_SOURCE"
  | "REVIEW_CANDIDATE"
  | "REVIEW_COVERAGE_GAP"
  | "COOLDOWN_LOW_VALUE";

export type SourceIntelligenceAction = {
  kind: SourceIntelligenceActionKind;
  priorityScore: number;
  reason: string;
  evidence: string[];
  sourceTaskKind?: SourceTaskKind;
  companyId?: string | null;
  companySourceId?: string;
  sourceCandidateId?: string;
  sourceName?: string;
  companyName?: string | null;
  url?: string | null;
};

export type SourceIntelligencePlanOptions = {
  now?: Date;
  pollStaleAfterHours?: number;
  highYieldPollStaleAfterHours?: number;
  limit?: number;
  perKindLimit?: Partial<Record<SourceIntelligenceActionKind, number>>;
};

export type SourceIntelligencePlanInput = {
  sources: PlannerCompanySource[];
  candidates?: PlannerSourceCandidate[];
  coverageGaps?: PlannerCompanyCoverageGap[];
  options?: SourceIntelligencePlanOptions;
};

const DEFAULT_LIMIT = 300;
const DEFAULT_POLL_STALE_AFTER_HOURS = 12;
const HIGH_YIELD_POLL_STALE_AFTER_HOURS = 2;

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function hoursSince(value: Date | null, now: Date) {
  if (!value) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - value.getTime()) / 3_600_000);
}

function isFuture(value: Date | null, now: Date) {
  return Boolean(value && value.getTime() > now.getTime());
}

function ratio(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

function recentFailureRate(source: PlannerCompanySource) {
  return ratio(source.recentFailedRunCount, source.recentRunCount);
}

function recentNoveltyRate(source: PlannerCompanySource) {
  return ratio(source.recentCreatedCount, source.recentAcceptedCount);
}

function isPollEligible(source: PlannerCompanySource) {
  return (
    ["PROVISIONED", "ACTIVE", "DEGRADED"].includes(source.status) &&
    source.validationState === "VALIDATED" &&
    source.pollState !== "QUARANTINED" &&
    source.pollState !== "DISABLED"
  );
}

function isValidationEligible(source: PlannerCompanySource) {
  return (
    source.status !== "DISABLED" &&
    ["UNVALIDATED", "SUSPECT", "NEEDS_REDISCOVERY", "BLOCKED"].includes(
      source.validationState
    ) &&
    source.pollState !== "DISABLED"
  );
}

function isRediscoveryEligible(source: PlannerCompanySource) {
  return (
    source.status !== "DISABLED" &&
    source.validationState !== "INVALID" &&
    source.pollState !== "DISABLED" &&
    (source.status === "REDISCOVER_REQUIRED" ||
      source.validationState === "NEEDS_REDISCOVERY" ||
      (source.status === "DEGRADED" && source.consecutiveFailures >= 3))
  );
}

function isHighYieldSource(source: PlannerCompanySource) {
  return (
    source.retainedLiveJobCount >= 25 ||
    source.recentCreatedCount >= 10 ||
    source.lastJobsCreatedCount >= 5 ||
    source.yieldScore >= 0.25 ||
    source.sourceQualityScore >= 0.85 ||
    source.priorityScore >= 5
  );
}

function buildPollAction(
  source: PlannerCompanySource,
  now: Date
): SourceIntelligenceAction | null {
  if (!isPollEligible(source) || isFuture(source.cooldownUntil, now)) return null;

  const staleAfter = isHighYieldSource(source)
    ? HIGH_YIELD_POLL_STALE_AFTER_HOURS
    : DEFAULT_POLL_STALE_AFTER_HOURS;
  const pollAgeHours = hoursSince(source.lastSuccessfulPollAt, now);
  if (pollAgeHours < staleAfter) return null;

  const liveScore = clamp(Math.log10(source.retainedLiveJobCount + 1) * 10, 0, 30);
  const qualityScore = clamp(source.sourceQualityScore * 18, 0, 18);
  const yieldScore = clamp(source.yieldScore * 24, 0, 24);
  const noveltyScore = clamp(recentNoveltyRate(source) * 30, 0, 18);
  const freshnessDebt = clamp(pollAgeHours / 3, 0, 18);
  const reliabilityPenalty = clamp(recentFailureRate(source) * 18, 0, 18);

  const priorityScore = clamp(
    38 + liveScore + qualityScore + yieldScore + noveltyScore + freshnessDebt - reliabilityPenalty,
    0,
    100
  );

  if (priorityScore < 45) return null;

  return {
    kind: "POLL_SOURCE",
    priorityScore: round(priorityScore),
    sourceTaskKind: "CONNECTOR_POLL",
    companyId: source.companyId,
    companySourceId: source.id,
    sourceName: source.sourceName,
    companyName: source.companyName,
    url: source.boardUrl,
    reason: "Poll validated source with useful yield or stale live inventory.",
    evidence: [
      `pollAgeHours=${Number.isFinite(pollAgeHours) ? round(pollAgeHours, 1) : "never"}`,
      `retainedLive=${source.retainedLiveJobCount}`,
      `recentCreated=${source.recentCreatedCount}`,
      `yieldScore=${round(source.yieldScore)}`,
      `qualityScore=${round(source.sourceQualityScore)}`,
    ],
  } satisfies SourceIntelligenceAction;
}

function buildValidationAction(
  source: PlannerCompanySource,
  now: Date
): SourceIntelligenceAction | null {
  if (!isValidationEligible(source) || isFuture(source.cooldownUntil, now)) return null;

  const failurePressure = clamp(source.consecutiveFailures / 20, 0, 15);
  const staleValidationBoost = clamp(hoursSince(source.lastFailureAt, now) / 24, 0, 8);
  const priorityScore = clamp(
    48 +
      source.priorityScore * 4 +
      source.sourceQualityScore * 18 +
      source.yieldScore * 16 +
      failurePressure +
      staleValidationBoost,
    0,
    100
  );

  return {
    kind: "VALIDATE_SOURCE",
    priorityScore: round(priorityScore),
    sourceTaskKind: "SOURCE_VALIDATION",
    companyId: source.companyId,
    companySourceId: source.id,
    sourceName: source.sourceName,
    companyName: source.companyName,
    url: source.boardUrl,
    reason: "Validate source before polling because source state is uncertain.",
    evidence: [
      `validationState=${source.validationState}`,
      `pollState=${source.pollState}`,
      `failures=${source.consecutiveFailures}`,
      `qualityScore=${round(source.sourceQualityScore)}`,
    ],
  } satisfies SourceIntelligenceAction;
}

function buildRediscoveryAction(
  source: PlannerCompanySource,
  now: Date
): SourceIntelligenceAction | null {
  if (!isRediscoveryEligible(source) || isFuture(source.cooldownUntil, now)) return null;

  const liveLossBoost = source.retainedLiveJobCount === 0 ? 12 : 0;
  const failureBoost = clamp(source.consecutiveFailures / 80, 0, 18);
  const qualityBoost = clamp(source.sourceQualityScore * 18, 0, 18);
  const yieldBoost = clamp(source.yieldScore * 18, 0, 18);
  const priorityScore = clamp(
    58 + source.priorityScore * 5 + qualityBoost + yieldBoost + liveLossBoost + failureBoost,
    0,
    100
  );

  return {
    kind: "REDISCOVER_SOURCE",
    priorityScore: round(priorityScore),
    sourceTaskKind: "REDISCOVERY",
    companyId: source.companyId,
    companySourceId: source.id,
    sourceName: source.sourceName,
    companyName: source.companyName,
    url: source.boardUrl,
    reason: "Repair or rediscover source path because current source is degraded or stale.",
    evidence: [
      `status=${source.status}`,
      `validationState=${source.validationState}`,
      `pollState=${source.pollState}`,
      `retainedLive=${source.retainedLiveJobCount}`,
      `failures=${source.consecutiveFailures}`,
    ],
  } satisfies SourceIntelligenceAction;
}

function buildLowValueCooldownAction(
  source: PlannerCompanySource
): SourceIntelligenceAction | null {
  const hasNoYield =
    source.retainedLiveJobCount === 0 &&
    source.jobsCreatedCount === 0 &&
    source.recentCreatedCount === 0 &&
    source.lastJobsCreatedCount === 0;
  const failureHeavy = source.consecutiveFailures >= 25 || source.failureStreak >= 10;
  const lowQuality = source.sourceQualityScore < 0.25 && source.yieldScore < 0.05;

  if (!hasNoYield || !failureHeavy || !lowQuality || source.status === "DISABLED") {
    return null;
  }

  return {
    kind: "COOLDOWN_LOW_VALUE",
    priorityScore: round(clamp(45 + source.consecutiveFailures / 20, 0, 88)),
    companyId: source.companyId,
    companySourceId: source.id,
    sourceName: source.sourceName,
    companyName: source.companyName,
    url: source.boardUrl,
    reason: "Candidate for cooldown because it repeatedly fails and has produced no visible yield.",
    evidence: [
      `failures=${source.consecutiveFailures}`,
      `qualityScore=${round(source.sourceQualityScore)}`,
      `yieldScore=${round(source.yieldScore)}`,
      `created=${source.jobsCreatedCount}`,
    ],
  } satisfies SourceIntelligenceAction;
}

function sourceActions(
  source: PlannerCompanySource,
  now: Date
): SourceIntelligenceAction[] {
  const lowValueCooldownAction = buildLowValueCooldownAction(source);
  if (lowValueCooldownAction) {
    return [lowValueCooldownAction];
  }

  const actions = [
    buildRediscoveryAction(source, now),
    buildValidationAction(source, now),
    buildPollAction(source, now),
  ].filter((action): action is SourceIntelligenceAction => Boolean(action));

  return actions.sort((left, right) => {
    if (right.priorityScore !== left.priorityScore) {
      return right.priorityScore - left.priorityScore;
    }
    return left.kind.localeCompare(right.kind);
  });
}

function candidateAction(candidate: PlannerSourceCandidate): SourceIntelligenceAction | null {
  if (!["NEW", "VALIDATED", "STALE"].includes(candidate.status)) return null;
  if (candidate.failureCount >= 5 && candidate.confidence < 0.8) return null;

  const priorityScore = clamp(
    35 +
      candidate.confidence * 22 +
      candidate.coverageGapScore * 24 +
      candidate.potentialYieldScore * 24 +
      candidate.noveltyScore * 10 +
      candidate.sourceQualityScore * 12 -
      candidate.failureCount * 3,
    0,
    100
  );

  if (priorityScore < 55) return null;

  return {
    kind: "REVIEW_CANDIDATE",
    priorityScore: round(priorityScore),
    companyId: candidate.companyId,
    sourceCandidateId: candidate.id,
    companyName: candidate.companyName ?? candidate.companyNameHint,
    url: candidate.candidateUrl,
    reason: "Review or promote high-potential source candidate.",
    evidence: [
      `type=${candidate.candidateType}`,
      `status=${candidate.status}`,
      `ats=${candidate.atsPlatform ?? "unknown"}`,
      `confidence=${round(candidate.confidence)}`,
      `coverageGap=${round(candidate.coverageGapScore)}`,
      `potentialYield=${round(candidate.potentialYieldScore)}`,
    ],
  } satisfies SourceIntelligenceAction;
}

function coverageGapAction(gap: PlannerCompanyCoverageGap): SourceIntelligenceAction | null {
  const hasSourceButNoFeed = gap.sourceCount > 0 && gap.feedLiveJobCount <= 2;
  const hasGoodSourceSignals =
    gap.maxSourceQualityScore >= 0.7 || gap.maxPriorityScore >= 1 || gap.validatedSourceCount > 0;

  if (!hasSourceButNoFeed || !hasGoodSourceSignals) return null;

  const priorityScore = clamp(
    42 +
      gap.maxSourceQualityScore * 22 +
      gap.maxPriorityScore * 8 +
      Math.min(gap.sourceCount, 6) * 3 +
      (gap.feedLiveJobCount === 0 ? 12 : 4) +
      (gap.canonicalVisibleJobCount > gap.feedLiveJobCount ? 8 : 0),
    0,
    100
  );

  return {
    kind: "REVIEW_COVERAGE_GAP",
    priorityScore: round(priorityScore),
    companyId: gap.companyId,
    companyName: gap.companyName,
    url: gap.careersUrl,
    reason: "Inspect company with sources but low user-visible job coverage.",
    evidence: [
      `sources=${gap.sourceCount}`,
      `activeSources=${gap.activeSourceCount}`,
      `validatedSources=${gap.validatedSourceCount}`,
      `feedLive=${gap.feedLiveJobCount}`,
      `canonicalVisible=${gap.canonicalVisibleJobCount}`,
      `maxQuality=${round(gap.maxSourceQualityScore)}`,
    ],
  } satisfies SourceIntelligenceAction;
}

export function buildSourceIntelligencePlan(
  input: SourceIntelligencePlanInput
): SourceIntelligenceAction[] {
  const now = input.options?.now ?? new Date();
  const limit = input.options?.limit ?? DEFAULT_LIMIT;
  const perKindLimit = input.options?.perKindLimit;
  const actions: SourceIntelligenceAction[] = [];

  for (const source of input.sources) {
    actions.push(...sourceActions(source, now));
  }

  for (const candidate of input.candidates ?? []) {
    const action = candidateAction(candidate);
    if (action) actions.push(action);
  }

  for (const gap of input.coverageGaps ?? []) {
    const action = coverageGapAction(gap);
    if (action) actions.push(action);
  }

  const seen = new Set<string>();
  const kindCounts = new Map<SourceIntelligenceActionKind, number>();
  return actions
    .sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }
      return left.kind.localeCompare(right.kind);
    })
    .filter((action) => {
      const key = action.companySourceId
        ? `source:${action.companySourceId}`
        : action.sourceCandidateId
          ? `candidate:${action.sourceCandidateId}`
          : `${action.kind}:${action.companyId ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter((action) => {
      const kindLimit = perKindLimit?.[action.kind];
      if (!kindLimit) return true;

      const currentCount = kindCounts.get(action.kind) ?? 0;
      if (currentCount >= kindLimit) return false;

      kindCounts.set(action.kind, currentCount + 1);
      return true;
    })
    .slice(0, limit);
}
