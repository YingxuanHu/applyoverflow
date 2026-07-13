import type { AtsPlatform } from "@/generated/prisma/client";
import {
  detectAtsTenantFromUrl,
  detectDirectSourceFromUrl,
} from "@/lib/ingestion/discovery/ats-tenant-detector";

export type PromotionCandidateStatus =
  | "NEW"
  | "VALIDATED"
  | "PROMOTED"
  | "REJECTED"
  | "STALE";

export type PromotionCandidateType =
  | "AGGREGATOR_LEAD"
  | "ATS_BOARD"
  | "CAREER_PAGE"
  | "COMPANY_ROOT"
  | "JOB_PAGE"
  | "SITEMAP";

export type PromotionCandidateCompany = {
  id: string;
  name: string;
  companyKey: string;
  domain: string | null;
  careersUrl: string | null;
};

export type PromotionCandidate = {
  id: string;
  companyId: string | null;
  company: PromotionCandidateCompany | null;
  atsTenantId: string | null;
  candidateType: PromotionCandidateType;
  status: PromotionCandidateStatus;
  candidateUrl: string;
  rootDomain: string | null;
  companyNameHint: string | null;
  atsPlatform: AtsPlatform | null;
  atsTenantKey: string | null;
  confidence: number;
  noveltyScore: number;
  coverageGapScore: number;
  potentialYieldScore: number;
  sourceQualityScore: number;
  failureCount: number;
  lastValidatedAt: Date | null;
  repairMissingSource?: boolean;
};

export type ExistingPromotionSource = {
  id: string;
  companyId: string;
  connectorName: string;
  token: string;
  sourceName: string;
  boardUrl: string;
  status: string;
};

export type CandidateDetectedSource = {
  connectorName: string;
  token: string;
  sourceName: string;
  boardUrl: string;
  atsPlatform: AtsPlatform | null;
};

export type CandidateOwnership = {
  score: number;
  reasons: string[];
};

export type SourceCandidatePromotionActionKind =
  | "PROMOTE_ATS_SOURCE"
  | "PROMOTE_COMPANY_SITE_SOURCE"
  | "VALIDATE_ATS_SOURCE"
  | "VALIDATE_COMPANY_SITE"
  | "MANUAL_REVIEW"
  | "SKIP_DUPLICATE"
  | "SKIP_CONFLICT"
  | "REJECT_LOW_QUALITY";

export type SourceCandidatePromotionAction = {
  kind: SourceCandidatePromotionActionKind;
  priorityScore: number;
  candidateId: string;
  candidateStatus: PromotionCandidateStatus;
  validationTaskKey: string;
  companyId: string | null;
  companyName: string | null;
  candidateUrl: string;
  detectedSource: CandidateDetectedSource | null;
  ownership: CandidateOwnership;
  reason: string;
  evidence: string[];
  existingSourceId?: string;
  canApply: boolean;
};

export type SourceCandidatePromotionPlanOptions = {
  limit?: number;
  minAutoPromoteScore?: number;
  minValidationScore?: number;
};

export type SourceCandidatePromotionPlanInput = {
  candidates: PromotionCandidate[];
  existingSources: ExistingPromotionSource[];
  options?: SourceCandidatePromotionPlanOptions;
};

export type PromotionValidationSelectionOptions = {
  limit: number;
  atsShare?: number;
};

type PromotionSourceIdentity = Pick<CandidateDetectedSource, "connectorName" | "token">;

const DEFAULT_LIMIT = 200;
const DEFAULT_MIN_AUTO_PROMOTE_SCORE = 82;
const DEFAULT_MIN_VALIDATION_SCORE = 62;
const AUTO_PROMOTION_VALIDATION_MAX_AGE_DAYS = 14;

const ATS_PLATFORM_CONNECTOR: Partial<Record<AtsPlatform, string>> = {
  ASHBY: "ashby",
  BAMBOOHR: "bamboohr",
  EIGHTFOLD: "eightfold",
  GENERIC: "generic",
  GREENHOUSE: "greenhouse",
  ICIMS: "icims",
  JOBVITE: "jobvite",
  LEVER: "lever",
  PARADOX: "paradox",
  PHENOM: "phenom",
  RECRUITEE: "recruitee",
  RIPPLING: "rippling",
  SMARTRECRUITERS: "smartrecruiters",
  SUCCESSFACTORS: "successfactors",
  TALEO: "taleo",
  TEAMTAILOR: "teamtailor",
  WORKABLE: "workable",
  WORKDAY: "workday",
};

const SOURCE_NAME_PREFIX: Record<string, string> = {
  ashby: "Ashby",
  bamboohr: "BambooHR",
  eightfold: "Eightfold",
  generic: "Generic",
  greenhouse: "Greenhouse",
  icims: "iCIMS",
  jobvite: "Jobvite",
  lever: "Lever",
  paradox: "Paradox",
  phenom: "Phenom",
  recruitee: "Recruitee",
  rippling: "Rippling",
  smartrecruiters: "SmartRecruiters",
  successfactors: "SuccessFactors",
  taleo: "Taleo",
  teamtailor: "Teamtailor",
  workable: "Workable",
  workday: "Workday",
};

const UNSAFE_AUTO_PROMOTE_CONNECTORS = new Set([
  "bamboohr",
  "eightfold",
  "generic",
  "paradox",
  "phenom",
]);

const GENERIC_CANDIDATE_RE =
  /(?:^|[./_-])(career|careers|jobs|job|search|apply|join|openings|opportunities|talent)(?:$|[./_-])/i;
const GENERIC_TOKEN_SEGMENTS = new Set([
  "career",
  "careers",
  "job",
  "jobs",
  "search",
  "apply",
  "join",
  "openings",
  "opportunities",
  "talent",
  "performancemanager",
]);

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function compact(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function hostname(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function rootDomain(value: string | null | undefined) {
  const host = hostname(value) ?? value?.replace(/^www\./i, "").toLowerCase() ?? null;
  if (!host) return null;
  const parts = host.split(".").filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join(".") : host;
}

function platformToConnector(platform: AtsPlatform) {
  return ATS_PLATFORM_CONNECTOR[platform] ?? null;
}

function buildSourceName(connectorName: string, token: string) {
  if (connectorName === "oraclecloud") {
    const [tenant] = token.trim().toLowerCase().split("|");
    return `OracleCloud:${(tenant ?? token).replace(/\.oraclecloud\.com$/i, "")}`;
  }

  return `${SOURCE_NAME_PREFIX[connectorName] ?? connectorName}:${token.trim().toLowerCase()}`;
}

export function detectPromotionCandidateSource(
  candidate: Pick<PromotionCandidate, "candidateUrl" | "atsPlatform" | "atsTenantKey">
): CandidateDetectedSource | null {
  const detected = detectAtsTenantFromUrl(candidate.candidateUrl);
  const directSource = detected ? null : detectDirectSourceFromUrl(candidate.candidateUrl);
  if (directSource) {
    return {
      connectorName: directSource.connectorName,
      token: directSource.tenantKey.trim().toLowerCase(),
      sourceName: buildSourceName(directSource.connectorName, directSource.tenantKey),
      boardUrl: directSource.normalizedBoardUrl,
      atsPlatform: null,
    };
  }

  const atsPlatform = detected?.platform ?? candidate.atsPlatform;
  const token = detected?.tenantKey ?? candidate.atsTenantKey;
  const boardUrl = detected?.normalizedBoardUrl ?? candidate.candidateUrl;
  if (!atsPlatform || !token) return null;

  const connectorName = platformToConnector(atsPlatform);
  if (!connectorName) return null;

  return {
    connectorName,
    token: token.trim().toLowerCase(),
    sourceName: buildSourceName(connectorName, token),
    boardUrl,
    atsPlatform,
  };
}

export function scoreCandidateOwnership(candidate: PromotionCandidate) {
  const reasons: string[] = [];
  const company = candidate.company;
  const candidateRootDomain = rootDomain(candidate.candidateUrl) ?? candidate.rootDomain;
  const companyDomain = rootDomain(company?.domain);
  const companyCareersDomain = rootDomain(company?.careersUrl);
  const companyName = compact(company?.name);
  const companyKey = compact(company?.companyKey);
  const companyNameHint = compact(candidate.companyNameHint);
  const urlText = compact(candidate.candidateUrl);
  const detected = detectPromotionCandidateSource(candidate);
  const tokenText = compact(detected?.token);

  let score = 0;
  if (candidate.companyId && company) {
    score += 0.2;
    reasons.push("candidate-linked-to-company");
  }

  if (candidateRootDomain && companyDomain && candidateRootDomain === companyDomain) {
    score += 0.28;
    reasons.push("candidate-domain-matches-company-domain");
  } else if (
    candidateRootDomain &&
    companyCareersDomain &&
    candidateRootDomain === companyCareersDomain
  ) {
    score += 0.22;
    reasons.push("candidate-domain-matches-careers-domain");
  }

  if (company?.careersUrl && candidate.candidateUrl.startsWith(company.careersUrl)) {
    score += 0.22;
    reasons.push("candidate-url-starts-with-company-careers-url");
  }

  if (companyNameHint && companyName && companyNameHint === companyName) {
    score += 0.18;
    reasons.push("company-name-hint-exact-match");
  }

  if (tokenText && companyKey && tokenText.includes(companyKey)) {
    score += 0.18;
    reasons.push("ats-token-contains-company-key");
  } else if (tokenText && companyName && tokenText.includes(companyName)) {
    score += 0.15;
    reasons.push("ats-token-contains-company-name");
  } else if (urlText && companyName && urlText.includes(companyName)) {
    score += 0.12;
    reasons.push("candidate-url-contains-company-name");
  }

  if (candidate.atsTenantId) {
    score += 0.12;
    reasons.push("candidate-linked-to-ats-tenant");
  }

  // A promoted tenant without a CompanySource is a registry repair candidate,
  // not an unverified cross-company lead. It still validates before promotion
  // unless its validation is fresh, but must not be trapped below the generic
  // ownership threshold solely because the ATS hostname differs from the
  // employer domain.
  if (candidate.repairMissingSource && candidate.atsTenantId && candidate.companyId) {
    score += 0.1;
    reasons.push("promoted-tenant-needs-source-repair");
  }

  return {
    score: round(clamp(score, 0, 1)),
    reasons,
  } satisfies CandidateOwnership;
}

function isLowQualityCandidate(candidate: PromotionCandidate) {
  return (
    candidate.failureCount >= 5 &&
    candidate.confidence < 0.72 &&
    candidate.potentialYieldScore < 0.45
  );
}

function isCompanySiteCandidate(candidate: PromotionCandidate) {
  return candidate.candidateType === "CAREER_PAGE" || candidate.candidateType === "COMPANY_ROOT";
}

function isSafeCompanySiteAutoPromotionCandidate(
  candidate: PromotionCandidate,
  ownership: CandidateOwnership,
  baseScore: number,
  options: Required<SourceCandidatePromotionPlanOptions>
) {
  if (candidate.candidateType !== "CAREER_PAGE") return false;
  if (!hasRecentSourceCandidateValidation(candidate)) return false;
  if (baseScore < options.minAutoPromoteScore) return false;
  if (ownership.score < 0.5) return false;

  return (
    candidate.confidence >= 0.8 &&
    candidate.potentialYieldScore >= 0.7 &&
    candidate.sourceQualityScore >= 0.65
  );
}

function candidateBaseScore(candidate: PromotionCandidate, ownership: CandidateOwnership) {
  return clamp(
    18 +
      candidate.confidence * 24 +
      candidate.sourceQualityScore * 18 +
      candidate.potentialYieldScore * 20 +
      candidate.coverageGapScore * 14 +
      candidate.noveltyScore * 6 +
      ownership.score * 22 -
      candidate.failureCount * 4,
    0,
    100
  );
}

function hasRecentSourceCandidateValidation(candidate: PromotionCandidate) {
  if (
    (candidate.status !== "VALIDATED" && !candidate.repairMissingSource) ||
    !candidate.lastValidatedAt
  ) {
    return false;
  }

  const validationAgeMs = Date.now() - candidate.lastValidatedAt.getTime();
  const maxAgeMs = AUTO_PROMOTION_VALIDATION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return validationAgeMs >= 0 && validationAgeMs <= maxAgeMs;
}

function buildValidationTaskKey(candidate: PromotionCandidate) {
  const validationEpoch = candidate.lastValidatedAt?.toISOString() ?? "unvalidated";
  const intent = candidate.repairMissingSource ? "repair" : "standard";

  // A candidate can be valid again after a source was removed or enough time has passed.
  // The epoch keeps that retry bounded while avoiding a permanent block from an old task.
  return `${candidate.id}:candidate-validation:${intent}:${validationEpoch}`;
}

function buildAction(input: {
  kind: SourceCandidatePromotionActionKind;
  candidate: PromotionCandidate;
  detectedSource: CandidateDetectedSource | null;
  ownership: CandidateOwnership;
  priorityScore: number;
  reason: string;
  evidence: string[];
  canApply?: boolean;
  existingSourceId?: string;
}): SourceCandidatePromotionAction {
  return {
    kind: input.kind,
    priorityScore: round(input.priorityScore),
    candidateId: input.candidate.id,
    candidateStatus: input.candidate.status,
    validationTaskKey: buildValidationTaskKey(input.candidate),
    companyId: input.candidate.companyId,
    companyName: input.candidate.company?.name ?? input.candidate.companyNameHint,
    candidateUrl: input.candidate.candidateUrl,
    detectedSource: input.detectedSource,
    ownership: input.ownership,
    reason: input.reason,
    evidence: input.evidence,
    canApply: input.canApply ?? false,
    ...(input.existingSourceId ? { existingSourceId: input.existingSourceId } : {}),
  };
}

export function promotionSourceIdentity(source: PromotionSourceIdentity) {
  return `${source.connectorName.trim().toLowerCase()}:${source.token.trim().toLowerCase()}`;
}

function sourceIdentity(source: ExistingPromotionSource) {
  return promotionSourceIdentity(source);
}

function detectedIdentity(source: CandidateDetectedSource) {
  return promotionSourceIdentity(source);
}

function isGenericTokenSegment(value: string) {
  const normalized = value.toLowerCase().replace(/\d+$/g, "");
  return GENERIC_TOKEN_SEGMENTS.has(normalized);
}

function isGenericDetectedSource(source: CandidateDetectedSource) {
  const tokenParts = source.token.split(/[|/_-]+/).filter(Boolean);
  if (tokenParts.length > 0 && tokenParts.every(isGenericTokenSegment)) return true;

  return GENERIC_CANDIDATE_RE.test(source.token);
}

function hasStrongEnoughAutoPromotionOwnership(
  source: CandidateDetectedSource,
  ownership: CandidateOwnership
) {
  if (source.connectorName === "successfactors") {
    return ownership.score >= 0.7;
  }

  return ownership.score >= 0.38;
}

function planCandidate(
  candidate: PromotionCandidate,
  existingByIdentity: Map<string, ExistingPromotionSource>,
  options: Required<SourceCandidatePromotionPlanOptions>
) {
  const detectedSource = detectPromotionCandidateSource(candidate);
  const ownership = scoreCandidateOwnership(candidate);
  const baseScore = candidateBaseScore(candidate, ownership);
  const evidence = [
    `type=${candidate.candidateType}`,
    `status=${candidate.status}`,
    `confidence=${round(candidate.confidence)}`,
    `sourceQuality=${round(candidate.sourceQualityScore)}`,
    `potentialYield=${round(candidate.potentialYieldScore)}`,
    `coverageGap=${round(candidate.coverageGapScore)}`,
    `ownership=${ownership.score}`,
    `lastValidatedAt=${candidate.lastValidatedAt?.toISOString() ?? "never"}`,
  ];

  if (candidate.status === "PROMOTED" && !candidate.repairMissingSource) {
    return buildAction({
      kind: "SKIP_DUPLICATE",
      candidate,
      detectedSource,
      ownership,
      priorityScore: 0,
      reason: "Candidate has already been promoted.",
      evidence,
    });
  }

  if (candidate.repairMissingSource) {
    evidence.push("repair-missing-company-source");
  }

  if (candidate.status === "REJECTED" || isLowQualityCandidate(candidate)) {
    return buildAction({
      kind: "REJECT_LOW_QUALITY",
      candidate,
      detectedSource,
      ownership,
      priorityScore: baseScore,
      reason: "Candidate has low confidence, low yield, or repeated failures.",
      evidence,
    });
  }

  if (!candidate.companyId || !candidate.company) {
    return buildAction({
      kind: "MANUAL_REVIEW",
      candidate,
      detectedSource,
      ownership,
      priorityScore: Math.max(baseScore, 45),
      reason: "Candidate needs a company owner before promotion.",
      evidence: [...evidence, "missing-company-owner"],
    });
  }

  if (detectedSource) {
    const existing = existingByIdentity.get(detectedIdentity(detectedSource));
    if (existing) {
      return buildAction({
        kind: existing.companyId === candidate.companyId ? "SKIP_DUPLICATE" : "SKIP_CONFLICT",
        candidate,
        detectedSource,
        ownership,
        priorityScore: existing.companyId === candidate.companyId ? 20 : 75,
        reason:
          existing.companyId === candidate.companyId
            ? "The ATS tenant already exists for this company."
            : "The ATS tenant is already owned by another company and needs review.",
        evidence: [
          ...evidence,
          `existingSource=${existing.sourceName}`,
          `existingStatus=${existing.status}`,
        ],
        existingSourceId: existing.id,
      });
    }

    if (ownership.score < 0.38) {
      return buildAction({
        kind: "MANUAL_REVIEW",
        candidate,
        detectedSource,
        ownership,
        priorityScore: Math.max(baseScore, 55),
        reason: "Candidate has an ATS route, but company ownership is too weak.",
        evidence: [...evidence, "weak-company-ownership"],
      });
    }

    if (
      !UNSAFE_AUTO_PROMOTE_CONNECTORS.has(detectedSource.connectorName) &&
      !isGenericDetectedSource(detectedSource) &&
      hasStrongEnoughAutoPromotionOwnership(detectedSource, ownership) &&
      baseScore >= options.minAutoPromoteScore &&
      hasRecentSourceCandidateValidation(candidate)
    ) {
      return buildAction({
        kind: "PROMOTE_ATS_SOURCE",
        candidate,
        detectedSource,
        ownership,
        priorityScore: baseScore,
        reason: "Candidate is a high-confidence owned ATS source that can be promoted.",
        evidence: [
          ...evidence,
          `connector=${detectedSource.connectorName}`,
          `sourceName=${detectedSource.sourceName}`,
        ],
        canApply: true,
      });
    }

    if (baseScore >= options.minValidationScore) {
      return buildAction({
        kind: "VALIDATE_ATS_SOURCE",
        candidate,
        detectedSource,
        ownership,
        priorityScore: baseScore,
        reason: "Candidate has an ATS route but needs validation before promotion.",
        evidence: [
          ...evidence,
          `connector=${detectedSource.connectorName}`,
          `sourceName=${detectedSource.sourceName}`,
        ],
      });
    }
  }

  if (isCompanySiteCandidate(candidate) && baseScore >= options.minValidationScore) {
    if (isSafeCompanySiteAutoPromotionCandidate(candidate, ownership, baseScore, options)) {
      return buildAction({
        kind: "PROMOTE_COMPANY_SITE_SOURCE",
        candidate,
        detectedSource: null,
        ownership,
        priorityScore: baseScore,
        reason: "Candidate is a recently validated, high-confidence owned company career page.",
        evidence,
        canApply: true,
      });
    }

    return buildAction({
      kind: "VALIDATE_COMPANY_SITE",
      candidate,
      detectedSource: null,
      ownership,
      priorityScore: baseScore,
      reason: "Company career page candidate should be route-inspected before promotion.",
      evidence,
    });
  }

  return buildAction({
    kind: "MANUAL_REVIEW",
    candidate,
    detectedSource,
    ownership,
    priorityScore: Math.max(baseScore, 35),
    reason: "Candidate is not safe enough for automated promotion.",
    evidence,
  });
}

export function buildSourceCandidatePromotionPlan(
  input: SourceCandidatePromotionPlanInput
) {
  const options = {
    limit: input.options?.limit ?? DEFAULT_LIMIT,
    minAutoPromoteScore:
      input.options?.minAutoPromoteScore ?? DEFAULT_MIN_AUTO_PROMOTE_SCORE,
    minValidationScore: input.options?.minValidationScore ?? DEFAULT_MIN_VALIDATION_SCORE,
  };
  const existingByIdentity = new Map(
    input.existingSources.map((source) => [sourceIdentity(source), source])
  );

  const actionTier = (action: SourceCandidatePromotionAction) => {
    if (
      action.kind === "PROMOTE_ATS_SOURCE" ||
      action.kind === "PROMOTE_COMPANY_SITE_SOURCE"
    ) {
      return 0;
    }

    if (
      action.kind === "VALIDATE_ATS_SOURCE" ||
      action.kind === "VALIDATE_COMPANY_SITE"
    ) {
      return 1;
    }

    if (action.kind === "MANUAL_REVIEW") return 2;
    if (action.kind === "SKIP_CONFLICT") return 3;
    if (action.kind === "SKIP_DUPLICATE") return 4;
    return 5;
  };

  const rankedActions = input.candidates
    .map((candidate) => planCandidate(candidate, existingByIdentity, options))
    .sort((left, right) => {
      if (left.canApply !== right.canApply) return left.canApply ? -1 : 1;

      // The bounded production plan must spend its window on candidates that
      // can advance automatically. Otherwise high-scoring ownerless leads
      // consume the whole plan as MANUAL_REVIEW and starve valid ATS boards.
      const tierDifference = actionTier(left) - actionTier(right);
      if (tierDifference !== 0) return tierDifference;

      if (right.priorityScore !== left.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }
      return left.kind.localeCompare(right.kind);
    });

  const seenDetectedSources = new Set<string>();
  const dedupedActions = rankedActions.map((action) => {
    if (!action.detectedSource) return action;
    const identity = detectedIdentity(action.detectedSource);
    if (!seenDetectedSources.has(identity)) {
      seenDetectedSources.add(identity);
      return action;
    }

    if (
      action.kind === "PROMOTE_ATS_SOURCE" ||
      action.kind === "PROMOTE_COMPANY_SITE_SOURCE" ||
      action.kind === "VALIDATE_ATS_SOURCE" ||
      action.kind === "VALIDATE_COMPANY_SITE" ||
      action.kind === "MANUAL_REVIEW"
    ) {
      return {
        ...action,
        kind: "SKIP_DUPLICATE" as const,
        priorityScore: Math.min(action.priorityScore, 25),
        reason: "Another candidate in this plan points to the same ATS tenant.",
        evidence: [...action.evidence, `duplicateDetectedSource=${identity}`],
        canApply: false,
      };
    }

    return action;
  });

  return dedupedActions.slice(0, options.limit);
}

export function selectPromotionValidationActions(
  actions: SourceCandidatePromotionAction[],
  options: PromotionValidationSelectionOptions
) {
  const limit = Math.max(0, Math.floor(options.limit));
  const atsShare = Math.max(0, Math.min(1, options.atsShare ?? 0.6));
  const validationActions = actions.filter(
    (action) =>
      action.kind === "VALIDATE_ATS_SOURCE" || action.kind === "VALIDATE_COMPANY_SITE"
  );
  const atsActions = validationActions.filter(
    (action) => action.kind === "VALIDATE_ATS_SOURCE"
  );
  const companySiteActions = validationActions.filter(
    (action) => action.kind === "VALIDATE_COMPANY_SITE"
  );
  const atsLimit = Math.min(atsActions.length, Math.ceil(limit * atsShare));
  const companySiteLimit = Math.min(
    companySiteActions.length,
    Math.max(0, limit - atsLimit)
  );
  const selected = [
    ...atsActions.slice(0, atsLimit),
    ...companySiteActions.slice(0, companySiteLimit),
  ];

  if (selected.length >= limit) return selected;

  const selectedIds = new Set(selected.map((action) => action.candidateId));
  return [
    ...selected,
    ...validationActions.filter((action) => !selectedIds.has(action.candidateId)),
  ].slice(0, limit);
}
