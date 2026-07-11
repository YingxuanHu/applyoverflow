import { DEMO_SOURCE_NAMES } from "@/lib/job-links";

import {
  TOP_PICK_ADJACENT_ROLE_SCORE_CAP,
  TOP_PICK_ROLE_CONFIDENCE_THRESHOLD,
  TOP_PICK_STRETCH_SENIORITY_SCORE_CAP,
  TOP_PICK_UNKNOWN_ROLE_SCORE_CAP,
  TOP_PICK_WEAK_ROLE_SCORE_CAP,
  TOP_PICK_WEAK_SENIORITY_SCORE_CAP,
} from "./config";
import {
  getAllowedRoleCategories,
  normalizeIntentText,
  stageRank,
  type UserJobIntent,
} from "./intent";

export type TopPickScoringJob = {
  id: string;
  title: string;
  company: string;
  location: string;
  workMode: string | null;
  status: string | null;
  normalizedRoleCategory: string | null;
  normalizedRoleCategoryConfidence: number | null;
  normalizedRoleCategoryStatus?: string | null;
  normalizedCareerStage: string | null;
  normalizedCareerStageConfidence: number | null;
  experienceLevelGroup: string | null;
  experienceLevelEvidenceJson?: unknown;
  employmentTypeGroup?: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  shortSummary: string | null;
  description?: string | null;
  postedAt: Date | string | null;
  deadline?: Date | string | null;
  applyUrl?: string | null;
  applyUrlValidationStatus?: string | null;
  availabilityScore?: number | null;
  qualityScore: number | null;
  trustScore: number | null;
  freshnessScore: number | null;
  deadSignalAt?: Date | string | null;
  sourceNames?: string[];
};

export type NormalizedJobMatchFields = {
  jobId: string;
  normalizedTitle: string;
  titleTokens: string[];
  roleCategory: string | null;
  roleCategoryConfidence: number;
  roleFamily: string | null;
  roleFamilyConfidence: number;
  seniorityLevel: string | null;
  seniorityConfidence: number;
  minYearsRequired: number | null;
  maxYearsRequired: number | null;
  employmentType: string | null;
  workMode: string | null;
  locationCity?: string;
  locationRegion?: string;
  locationCountry?: string;
  isRemote?: boolean;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  normalizedSkills: string[];
  requiredSkills: string[];
  preferredSkills: string[];
  sourceQualityScore?: number;
  availabilityScore?: number;
  postedAt?: Date | null;
  validThrough?: Date | null;
  jobTextSearch: string;
  applyUrl?: string | null;
  status?: string | null;
  deadSignalAt?: Date | string | null;
  applyUrlValidationStatus?: string | null;
  sourceNames?: string[];
};

export type GateResult = {
  passed: boolean;
  reason?: string;
  details?: Record<string, unknown>;
};

export type RoleGateResult = {
  passed: boolean;
  strength: "exact" | "strong" | "adjacent" | "weak" | "rejected";
  scoreCap: number;
  reason?: string;
  evidence: string[];
};

export type SeniorityGateResult = {
  passed: boolean;
  strength: "exact" | "strong" | "stretch" | "weak" | "rejected";
  scoreCap: number;
  reason?: string;
  evidence: string[];
};

const BAD_APPLY_URL_STATUSES = new Set([
  "BROKEN",
  "BROKEN_APPLY_LINK",
  "GENERIC_APPLY_PAGE",
  "EXPIRED",
  "SOURCE_STALE",
  "HIDDEN_LOW_QUALITY",
  "NOT_FOUND",
  "INVALID",
  "FAILED",
]);
const DEMO_SOURCE_NAME_SET = new Set<string>(DEMO_SOURCE_NAMES);

const ROLE_ADJACENCY: Record<string, string[]> = {
  SOFTWARE_ENGINEERING: [
    "AI_MACHINE_LEARNING",
    "IT_SYSTEMS_DEVOPS",
    "CYBERSECURITY",
  ],
  AI_MACHINE_LEARNING: ["SOFTWARE_ENGINEERING", "DATA_ANALYTICS", "RESEARCH_SCIENCE"],
  DATA_ANALYTICS: ["AI_MACHINE_LEARNING"],
  IT_SYSTEMS_DEVOPS: ["SOFTWARE_ENGINEERING", "CYBERSECURITY"],
  CYBERSECURITY: ["IT_SYSTEMS_DEVOPS", "SOFTWARE_ENGINEERING"],
  PRODUCT_MANAGEMENT: ["PROJECT_PROGRAM_MANAGEMENT", "CONSULTING", "OPERATIONS"],
  DESIGN_UX: ["PRODUCT_MANAGEMENT", "MEDIA_CONTENT_COMMUNICATIONS"],
  FINANCE_ACCOUNTING: ["INVESTMENT_BANKING"],
  INVESTMENT_BANKING: ["FINANCE_ACCOUNTING", "CONSULTING"],
  SALES: ["BUSINESS_DEVELOPMENT", "CUSTOMER_SUCCESS_SUPPORT", "MARKETING"],
  MARKETING: ["SALES", "MEDIA_CONTENT_COMMUNICATIONS", "BUSINESS_DEVELOPMENT"],
  OPERATIONS: ["SUPPLY_CHAIN_LOGISTICS", "PROJECT_PROGRAM_MANAGEMENT", "CONSULTING"],
  SUPPLY_CHAIN_LOGISTICS: ["OPERATIONS"],
  CUSTOMER_SUCCESS_SUPPORT: ["SALES", "IT_SYSTEMS_DEVOPS"],
  HUMAN_RESOURCES_RECRUITING: ["ADMINISTRATIVE", "CONSULTING"],
  LEGAL_COMPLIANCE: ["FINANCE_ACCOUNTING", "CONSULTING"],
  ENGINEERING_HARDWARE: ["RESEARCH_SCIENCE", "MANUFACTURING_TRADES"],
  RESEARCH_SCIENCE: ["AI_MACHINE_LEARNING", "DATA_ANALYTICS", "ENGINEERING_HARDWARE"],
  MEDIA_CONTENT_COMMUNICATIONS: ["MARKETING", "DESIGN_UX"],
};

const TITLE_SKILL_PATTERNS = [
  { skill: "typescript", pattern: /\btypescript|javascript|node|react|next\.?js\b/i },
  { skill: "python", pattern: /\bpython|django|flask|fastapi\b/i },
  { skill: "java", pattern: /\bjava|spring\b/i },
  { skill: "sql", pattern: /\bsql|postgres|mysql|snowflake|database\b/i },
  { skill: "aws", pattern: /\baws|amazon web services|cloud\b/i },
  { skill: "kubernetes", pattern: /\bkubernetes|k8s|docker|terraform\b/i },
  { skill: "figma", pattern: /\bfigma|design system|prototype\b/i },
  { skill: "excel", pattern: /\bexcel|financial modeling|fp&a\b/i },
  { skill: "salesforce", pattern: /\bsalesforce|crm\b/i },
  { skill: "tableau", pattern: /\btableau|power bi|looker|dashboard\b/i },
];

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function tokenize(value: string | null | undefined) {
  return normalizeIntentText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .slice(0, 80);
}

function parseLocation(location: string) {
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  return {
    city: parts[0] || undefined,
    region: parts.length >= 2 ? parts[1] : undefined,
    country: parts.length >= 3 ? parts[parts.length - 1] : undefined,
  };
}

export function extractYearsRequired(text: string | null | undefined) {
  const normalized = normalizeIntentText(text);
  const candidates: number[] = [];
  for (const match of normalized.matchAll(/\b(\d{1,2})\s*\+\s*years?\b/g)) {
    const value = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(value)) candidates.push(value);
  }
  for (const match of normalized.matchAll(/\b(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s+years?\b/g)) {
    const value = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(value)) candidates.push(value);
  }
  if (/\b(no|0)\s+(?:years?\s+of\s+)?experience\b/.test(normalized)) candidates.push(0);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

function normalizeStage(value?: string | null) {
  if (!value || value === "UNKNOWN") return null;
  const normalized = value.toUpperCase();
  if (normalized === "INTERNSHIP_COOP_STUDENT") return "STUDENT_INTERN";
  if (normalized === "ENTRY_LEVEL_NEW_GRAD" || normalized === "ASSOCIATE_JUNIOR") return "ENTRY_JUNIOR";
  if (normalized === "MID_LEVEL") return "MID_EXPERIENCED";
  if (normalized === "SENIOR" || normalized === "STAFF_PRINCIPAL") return "SENIOR_LEAD_STAFF";
  if (["MANAGER", "DIRECTOR", "EXECUTIVE"].includes(normalized)) return "MANAGER_DIRECTOR_EXECUTIVE";
  return normalized;
}

function inferSeniorityFromTitle(title: string) {
  const normalized = normalizeIntentText(title);
  if (/\b(intern|co[-\s]?op|student|new grad)\b/.test(normalized)) return "STUDENT_INTERN";
  if (/\b(entry[-\s]?level|junior|jr\.?|associate)\b/.test(normalized)) return "ENTRY_JUNIOR";
  if (/\b(mid[-\s]?level|intermediate)\b/.test(normalized)) return "MID_EXPERIENCED";
  if (/\b(staff|principal|senior|sr\.?|lead)\b/.test(normalized)) return "SENIOR_LEAD_STAFF";
  if (/\b(manager|director|avp|vp|vice president|head of|executive)\b/.test(normalized)) {
    return "MANAGER_DIRECTOR_EXECUTIVE";
  }
  return null;
}

function extractSkillsFromText(text: string) {
  return TITLE_SKILL_PATTERNS
    .filter((item) => item.pattern.test(text))
    .map((item) => item.skill);
}

export function normalizeJobForMatching(job: TopPickScoringJob): NormalizedJobMatchFields {
  const title = normalizeIntentText(job.title);
  const summary = normalizeIntentText(job.shortSummary);
  const description = normalizeIntentText(job.description);
  const evidenceText = Array.isArray(job.experienceLevelEvidenceJson)
    ? job.experienceLevelEvidenceJson.filter((entry) => typeof entry === "string").join(" ")
    : "";
  const allText = [title, job.company, job.location, summary, description, evidenceText]
    .filter(Boolean)
    .join(" ");
  const location = parseLocation(job.location);
  const minYearsRequired = extractYearsRequired(`${title} ${summary} ${description} ${evidenceText}`);
  const structuredSeniority =
    normalizeStage(job.normalizedCareerStage) ??
    normalizeStage(job.experienceLevelGroup);
  const titleSeniority = inferSeniorityFromTitle(job.title);
  const structuredRank = stageRank(structuredSeniority);
  const titleRank = stageRank(titleSeniority);
  const seniorityLevel =
    titleSeniority && titleRank != null && structuredRank != null && titleRank > structuredRank
      ? titleSeniority
      : structuredSeniority ?? titleSeniority;

  return {
    jobId: job.id,
    normalizedTitle: title,
    titleTokens: tokenize(title),
    roleCategory: job.normalizedRoleCategory && job.normalizedRoleCategory !== "OTHER_UNKNOWN"
      ? job.normalizedRoleCategory
      : null,
    roleCategoryConfidence: job.normalizedRoleCategoryConfidence ?? 0,
    roleFamily: job.normalizedRoleCategory ?? null,
    roleFamilyConfidence: job.normalizedRoleCategoryConfidence ?? 0,
    seniorityLevel,
    seniorityConfidence: job.normalizedCareerStageConfidence ?? (seniorityLevel ? 0.56 : 0),
    minYearsRequired,
    maxYearsRequired: minYearsRequired,
    employmentType: job.employmentTypeGroup ?? null,
    workMode: job.workMode,
    locationCity: location.city,
    locationRegion: location.region,
    locationCountry: location.country,
    isRemote: job.workMode === "REMOTE" || /\bremote\b/i.test(job.location),
    salaryMin: job.salaryMin ?? undefined,
    salaryMax: job.salaryMax ?? undefined,
    salaryCurrency: job.salaryCurrency ?? undefined,
    normalizedSkills: extractSkillsFromText(allText),
    requiredSkills: extractSkillsFromText(summary),
    preferredSkills: extractSkillsFromText(description || summary),
    sourceQualityScore: Math.max(job.qualityScore ?? 0, job.trustScore ?? 0, job.freshnessScore ?? 0),
    availabilityScore: job.availabilityScore ?? undefined,
    postedAt: toDate(job.postedAt),
    validThrough: toDate(job.deadline),
    jobTextSearch: normalizeIntentText(allText),
    applyUrl: job.applyUrl,
    status: job.status,
    deadSignalAt: job.deadSignalAt,
    applyUrlValidationStatus: job.applyUrlValidationStatus,
    sourceNames: job.sourceNames,
  };
}

export function evaluateEligibilityGate(
  job: NormalizedJobMatchFields,
  intent: UserJobIntent
): GateResult {
  if (job.status !== "LIVE") return { passed: false, reason: "not_live" };
  if (job.deadSignalAt) return { passed: false, reason: "dead_signal" };
  if (job.validThrough && job.validThrough.getTime() < Date.now()) {
    return { passed: false, reason: "expired_deadline" };
  }
  if ((job.availabilityScore ?? 100) < 60) {
    return { passed: false, reason: "low_availability", details: { availabilityScore: job.availabilityScore } };
  }
  if (!job.applyUrl || !/^https?:\/\//i.test(job.applyUrl)) {
    return { passed: false, reason: "invalid_apply_url" };
  }
  if (job.applyUrlValidationStatus && BAD_APPLY_URL_STATUSES.has(job.applyUrlValidationStatus)) {
    return {
      passed: false,
      reason: "invalid_apply_url",
      details: { applyUrlValidationStatus: job.applyUrlValidationStatus },
    };
  }
  if (
    job.sourceNames &&
    job.sourceNames.length > 0 &&
    job.sourceNames.every((sourceName) => DEMO_SOURCE_NAME_SET.has(sourceName))
  ) {
    return { passed: false, reason: "demo_source" };
  }
  if (intent.negativeSignals.rejectedJobIds.includes(job.jobId)) {
    return { passed: false, reason: "explicit_negative_feedback" };
  }
  return { passed: true };
}

function titleSimilarity(title: string, targets: string[]) {
  const titleTokens = new Set(tokenize(title));
  let best = 0;
  for (const target of targets) {
    const targetTokens = tokenize(target);
    if (targetTokens.length === 0) continue;
    const overlap = targetTokens.filter((token) => titleTokens.has(token)).length;
    best = Math.max(best, overlap / Math.min(targetTokens.length, 5));
  }
  return best;
}

function isAdjacentRole(jobCategory: string, targetCategories: string[]) {
  return targetCategories.some((target) =>
    (ROLE_ADJACENCY[target] ?? []).includes(jobCategory) ||
    (ROLE_ADJACENCY[jobCategory] ?? []).includes(target)
  );
}

export function evaluateRoleGate(
  job: NormalizedJobMatchFields,
  intent: UserJobIntent
): RoleGateResult {
  const allowed = getAllowedRoleCategories(intent);
  const titleTargets = [...intent.explicitTargetTitles, ...intent.inferredTargetTitles];
  const titleMatch = titleSimilarity(job.normalizedTitle, titleTargets);

  if (job.roleCategory && intent.excludedRoleCategories.includes(job.roleCategory)) {
    return {
      passed: false,
      strength: "rejected",
      scoreCap: 0,
      reason: "excluded_role_category",
      evidence: [job.roleCategory],
    };
  }
  if (
    job.roleCategory &&
    intent.negativeSignals.dislikedRoleCategories.includes(job.roleCategory) &&
    // A single WRONG_ROLE downvote must not hard-reject an entire category the
    // user explicitly targets (it would silently empty their whole feed). The
    // negative signal still lowers the score via scorePreferenceFit; it just no
    // longer overrides an explicit target.
    !intent.explicitTargetRoleCategories.includes(job.roleCategory)
  ) {
    return {
      passed: false,
      strength: "rejected",
      scoreCap: 0,
      reason: "wrong_role_feedback",
      evidence: [job.roleCategory],
    };
  }
  if (allowed.length === 0 && titleTargets.length === 0) {
    return {
      passed: true,
      strength: "weak",
      scoreCap: TOP_PICK_WEAK_ROLE_SCORE_CAP,
      reason: "low_role_intent",
      evidence: [],
    };
  }
  if (
    job.roleCategory &&
    allowed.includes(job.roleCategory) &&
    job.roleCategoryConfidence >= TOP_PICK_ROLE_CONFIDENCE_THRESHOLD
  ) {
    const explicit = intent.explicitTargetRoleCategories.includes(job.roleCategory);
    return {
      passed: true,
      strength: explicit ? "exact" : "strong",
      scoreCap: 100,
      evidence: [job.roleCategory],
    };
  }
  if (!job.roleCategory || job.roleCategoryConfidence < 0.6) {
    if (titleMatch >= 0.85) {
      return {
        passed: true,
        strength: "weak",
        scoreCap: TOP_PICK_UNKNOWN_ROLE_SCORE_CAP,
        reason: "strong_title_match_unknown_role",
        evidence: titleTargets.slice(0, 3),
      };
    }
    return {
      passed: false,
      strength: "rejected",
      scoreCap: 0,
      reason: "unknown_or_low_confidence_role",
      evidence: [job.roleCategory ?? "unknown"],
    };
  }
  if (job.roleCategory && isAdjacentRole(job.roleCategory, allowed) && intent.confidence.roleIntent >= 0.65) {
    return {
      passed: true,
      strength: "adjacent",
      scoreCap: TOP_PICK_ADJACENT_ROLE_SCORE_CAP,
      reason: "adjacent_role",
      evidence: [job.roleCategory, ...allowed.slice(0, 3)],
    };
  }
  if (titleMatch >= 0.9) {
    return {
      passed: true,
      strength: "weak",
      scoreCap: TOP_PICK_UNKNOWN_ROLE_SCORE_CAP,
      reason: "strong_title_match_role_conflict",
      evidence: titleTargets.slice(0, 3),
    };
  }
  return {
    passed: false,
    strength: "rejected",
    scoreCap: 0,
    reason: "unrelated_role",
    evidence: [job.roleCategory, ...allowed.slice(0, 4)].filter((entry): entry is string => Boolean(entry)),
  };
}

export function evaluateSeniorityGate(
  job: NormalizedJobMatchFields,
  intent: UserJobIntent
): SeniorityGateResult {
  const userStages = intent.targetCareerStages.length > 0 ? intent.targetCareerStages : ["ENTRY_JUNIOR"];
  const userMinRank = stageRank(intent.minAcceptableCareerStage) ?? Math.min(...userStages.map((stage) => stageRank(stage) ?? 1));
  const userMaxRank = stageRank(intent.maxAcceptableCareerStage) ?? Math.max(...userStages.map((stage) => stageRank(stage) ?? 1));
  const jobRank = stageRank(job.seniorityLevel);
  const explicitStages = new Set(intent.targetCareerStages);
  const evidence = [
    job.seniorityLevel,
    job.minYearsRequired != null ? `${job.minYearsRequired}+ years` : null,
  ].filter((entry): entry is string => Boolean(entry));

  if (
    intent.maxRequiredYears != null &&
    job.minYearsRequired != null &&
    job.minYearsRequired >= 5 &&
    job.minYearsRequired > intent.maxRequiredYears
  ) {
    return {
      passed: false,
      strength: "rejected",
      scoreCap: 0,
      reason: "requires_too_many_years",
      evidence,
    };
  }
  if (job.seniorityLevel === "MANAGER_DIRECTOR_EXECUTIVE" && userMaxRank < 4) {
    return {
      passed: false,
      strength: "rejected",
      scoreCap: 0,
      reason: "management_or_director_mismatch",
      evidence,
    };
  }
  if (userMaxRank <= 1 && jobRank != null && jobRank >= 3) {
    return {
      passed: false,
      strength: "rejected",
      scoreCap: 0,
      reason: "too_senior_for_entry_profile",
      evidence,
    };
  }
  if (userMinRank >= 3 && jobRank === 0 && !explicitStages.has("STUDENT_INTERN")) {
    return {
      passed: false,
      strength: "rejected",
      scoreCap: 0,
      reason: "too_junior_for_senior_profile",
      evidence,
    };
  }
  if (jobRank == null || job.seniorityConfidence < 0.55) {
    return {
      passed: true,
      strength: "weak",
      scoreCap: TOP_PICK_WEAK_SENIORITY_SCORE_CAP,
      reason: "unknown_seniority",
      evidence,
    };
  }
  if (jobRank >= userMinRank && jobRank <= userMaxRank) {
    return {
      passed: true,
      strength: explicitStages.has(job.seniorityLevel ?? "") ? "exact" : "strong",
      scoreCap: 100,
      evidence,
    };
  }
  if (job.minYearsRequired != null && intent.maxRequiredYears != null && job.minYearsRequired > intent.maxRequiredYears) {
    return {
      passed: true,
      strength: "stretch",
      scoreCap: TOP_PICK_STRETCH_SENIORITY_SCORE_CAP,
      reason: "years_requirement_stretch",
      evidence,
    };
  }
  const distance = jobRank > userMaxRank ? jobRank - userMaxRank : userMinRank - jobRank;
  if (distance === 1) {
    return {
      passed: true,
      strength: "stretch",
      scoreCap: TOP_PICK_STRETCH_SENIORITY_SCORE_CAP,
      reason: "seniority_stretch",
      evidence,
    };
  }
  return {
    passed: false,
    strength: "rejected",
    scoreCap: 0,
    reason: jobRank > userMaxRank ? "too_senior" : "too_junior",
    evidence,
  };
}
