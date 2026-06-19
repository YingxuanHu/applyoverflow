import {
  TOP_PICK_SCORING_WEIGHTS,
  TOP_PICK_UNKNOWN_ROLE_SCORE_CAP,
} from "./config";
import {
  evaluateEligibilityGate,
  evaluateRoleGate,
  evaluateSeniorityGate,
  normalizeJobForMatching,
  type GateResult,
  type NormalizedJobMatchFields,
  type RoleGateResult,
  type SeniorityGateResult,
  type TopPickScoringJob,
} from "./gates";
import { normalizeIntentText, type UserJobIntent } from "./intent";

export type { TopPickScoringJob } from "./gates";

export type TopPickUserHistory = {
  savedJobIds: Set<string>;
  appliedJobIds: Set<string>;
  excludedJobIds: Set<string>;
  suppressedRoleCategories: Set<string>;
  suppressedLocations: Set<string>;
  suppressedWorkModes: Set<string>;
  tooSeniorRoleCategories: Set<string>;
  tooJuniorRoleCategories: Set<string>;
};

export type TopPickScoreResult = {
  jobId: string;
  score: number;
  rawScore: number;
  scoreCap: number;
  scoreBreakdown: Record<string, unknown>;
  matchReasons: string[];
  concerns: string[];
  excluded: boolean;
  exclusionReason?: string;
  roleGate?: RoleGateResult;
  seniorityGate?: SeniorityGateResult;
  eligibilityGate?: GateResult;
};

type ScoreContext = {
  candidateChannels?: string[];
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function rounded(value: number) {
  return Math.round(clamp(value));
}

function unique(values: string[], limit = 8) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeIntentText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function rejectResult(
  jobId: string,
  reason: string,
  details: Partial<TopPickScoreResult> = {}
): TopPickScoreResult {
  return {
    jobId,
    score: 0,
    rawScore: 0,
    scoreCap: 0,
    scoreBreakdown: {
      excluded: true,
      exclusionReason: reason,
      ...(details.scoreBreakdown ?? {}),
    },
    matchReasons: [],
    concerns: [],
    excluded: true,
    exclusionReason: reason,
    ...details,
  };
}

function roleScore(roleGate: RoleGateResult) {
  if (!roleGate.passed) return 0;
  if (roleGate.strength === "exact") return 100;
  if (roleGate.strength === "strong") return 92;
  if (roleGate.strength === "adjacent") return 72;
  if (roleGate.strength === "weak") return 52;
  return 0;
}

function seniorityScore(seniorityGate: SeniorityGateResult) {
  if (!seniorityGate.passed) return 0;
  if (seniorityGate.strength === "exact") return 100;
  if (seniorityGate.strength === "strong") return 90;
  if (seniorityGate.strength === "stretch") return 65;
  if (seniorityGate.strength === "weak") return 50;
  return 0;
}

function scoreSkillFit(intent: UserJobIntent, job: NormalizedJobMatchFields) {
  const skillWeights = new Map<string, number>();
  for (const skill of intent.mustHaveSkills) skillWeights.set(skill, 3);
  for (const skill of intent.strongSkills) skillWeights.set(skill, Math.max(skillWeights.get(skill) ?? 0, 2));
  for (const skill of intent.niceToHaveSkills) skillWeights.set(skill, Math.max(skillWeights.get(skill) ?? 0, 1));
  const rankedSkills = [...skillWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);
  if (rankedSkills.length === 0) return { score: 50, matched: [] as string[] };

  const text = job.jobTextSearch;
  let possible = 0;
  let matchedWeight = 0;
  const matched: string[] = [];
  for (const [skill, weight] of rankedSkills) {
    possible += weight;
    if (text.includes(skill)) {
      matchedWeight += weight;
      matched.push(skill);
    }
  }
  return {
    score: clamp((matchedWeight / Math.max(1, possible)) * 100),
    matched: matched.slice(0, 6),
  };
}

function scorePreferenceFit(intent: UserJobIntent, job: NormalizedJobMatchFields, history: TopPickUserHistory) {
  let score = 50;
  if (history.savedJobIds.has(job.jobId)) score += 18;
  if (job.roleCategory && intent.positiveSignals.likedRoleCategories.includes(job.roleCategory)) score += 14;
  if (intent.positiveSignals.likedCompanies.some((company) => job.jobTextSearch.includes(normalizeIntentText(company)))) {
    score += 8;
  }
  if (job.roleCategory && history.suppressedRoleCategories.has(job.roleCategory)) score -= 30;
  const locationText = normalizeIntentText(
    [job.locationCity, job.locationRegion, job.locationCountry].filter(Boolean).join(" ")
  );
  if ([...history.suppressedLocations].some((location) => locationText.includes(location))) score -= 22;
  if (job.workMode && history.suppressedWorkModes.has(job.workMode)) score -= 18;
  if (job.roleCategory && history.tooSeniorRoleCategories.has(job.roleCategory)) score -= 10;
  if (job.roleCategory && history.tooJuniorRoleCategories.has(job.roleCategory)) score -= 10;
  return clamp(score);
}

function scoreLocationWorkMode(intent: UserJobIntent, job: NormalizedJobMatchFields) {
  let score = 52;
  const city = normalizeIntentText(intent.preferredLocationCity);
  const region = normalizeIntentText(intent.preferredLocationRegion);
  const country = normalizeIntentText(intent.preferredLocationCountry);
  const location = normalizeIntentText(
    [job.locationCity, job.locationRegion, job.locationCountry].filter(Boolean).join(" ")
  );

  if (city && location.includes(city)) score += 28;
  else if (region && location.includes(region)) score += 18;
  else if (country && location.includes(country)) score += 12;
  else if ((city || region || country) && job.isRemote && intent.openToRemote) score += 16;
  else if (city || region || country) score -= 18;

  if (intent.preferredWorkModes.length > 0 && job.workMode) {
    if (intent.preferredWorkModes.includes(job.workMode)) score += 20;
    else if (intent.preferredWorkModes.includes("FLEXIBLE")) score += 8;
    else score -= 14;
  }
  return clamp(score);
}

function scoreSalaryFit(intent: UserJobIntent, job: NormalizedJobMatchFields) {
  if (!intent.targetSalaryMin && !intent.targetSalaryMax) return { score: 65, unknown: false };
  if (!job.salaryMin && !job.salaryMax) return { score: 52, unknown: true };

  const targetMin = intent.targetSalaryMin ?? 0;
  const targetMax = intent.targetSalaryMax ?? Number.MAX_SAFE_INTEGER;
  const jobMin = job.salaryMin ?? job.salaryMax ?? 0;
  const jobMax = job.salaryMax ?? job.salaryMin ?? Number.MAX_SAFE_INTEGER;
  const overlap = Math.max(0, Math.min(targetMax, jobMax) - Math.max(targetMin, jobMin));
  const targetWidth = Math.max(1, targetMax - targetMin);
  if (overlap > 0) return { score: clamp(74 + (overlap / targetWidth) * 26), unknown: false };
  if (jobMax >= targetMin * 0.9) return { score: 58, unknown: false };
  return { score: 30, unknown: false };
}

function scoreFreshness(job: NormalizedJobMatchFields) {
  if (!job.postedAt) return 44;
  const days = (Date.now() - job.postedAt.getTime()) / 86_400_000;
  if (days <= 7) return 100;
  if (days <= 30) return 70;
  if (days <= 60) return 48;
  return 28;
}

function scoreSourceQuality(job: NormalizedJobMatchFields) {
  return clamp(job.sourceQualityScore && job.sourceQualityScore > 0 ? job.sourceQualityScore : 52);
}

function scoreSemanticText(intent: UserJobIntent, job: NormalizedJobMatchFields) {
  const targets = unique([
    ...intent.explicitTargetTitles,
    ...intent.inferredTargetTitles,
    ...intent.mustHaveSkills,
    ...intent.strongSkills,
  ], 30);
  if (targets.length === 0) return 50;
  const matched = targets.filter((term) => job.jobTextSearch.includes(term));
  return clamp((matched.length / Math.min(targets.length, 12)) * 100);
}

function generateReasons(input: {
  intent: UserJobIntent;
  job: NormalizedJobMatchFields;
  roleGate: RoleGateResult;
  seniorityGate: SeniorityGateResult;
  skillFit: { score: number; matched: string[] };
  locationWorkModeFit: number;
  salaryFit: { score: number; unknown: boolean };
  freshness: number;
}) {
  const reasons: string[] = [];
  if (input.roleGate.strength === "exact" || input.roleGate.strength === "strong") {
    reasons.push(`Strong role match: ${input.job.roleCategory?.replaceAll("_", " ").toLowerCase()}.`);
  }
  if (input.seniorityGate.strength === "exact" || input.seniorityGate.strength === "strong") {
    reasons.push("Seniority aligns with your profile.");
  }
  if (input.skillFit.matched.length > 0) {
    reasons.push(`Skill match: ${input.skillFit.matched.slice(0, 4).join(", ")}.`);
  }
  if (input.locationWorkModeFit >= 78) {
    reasons.push("Location or work mode matches your preferences.");
  }
  if (input.salaryFit.score >= 72 && !input.salaryFit.unknown) {
    reasons.push("Salary range overlaps with your target.");
  }
  if (reasons.length < 2 && input.freshness >= 90) {
    reasons.push("Recently posted.");
  }
  if (reasons.length === 0) {
    reasons.push("Ranked from role, seniority, skills, and preference fit.");
  }
  return reasons.slice(0, 3);
}

function generateConcerns(input: {
  roleGate: RoleGateResult;
  seniorityGate: SeniorityGateResult;
  salaryUnknown: boolean;
  locationWorkModeFit: number;
  job: NormalizedJobMatchFields;
}) {
  const concerns: string[] = [];
  if (input.roleGate.strength === "adjacent") concerns.push("This role is adjacent to your target roles.");
  if (input.roleGate.strength === "weak") concerns.push("Role fit is based on title evidence, so confidence is lower.");
  if (input.seniorityGate.strength === "stretch") concerns.push("This role may be a seniority stretch.");
  if (input.seniorityGate.strength === "weak") concerns.push("Seniority is not clearly listed.");
  if (input.salaryUnknown) concerns.push("Salary is not listed, so salary fit is uncertain.");
  if (input.locationWorkModeFit < 45) concerns.push("Location or work mode may be outside your preference.");
  if (!input.job.roleCategory || input.job.roleCategoryConfidence < 0.6) {
    concerns.push("Job function classification is lower confidence.");
  }
  return concerns.slice(0, 3);
}

export function scoreJobForUser(
  intent: UserJobIntent,
  sourceJob: TopPickScoringJob,
  history: TopPickUserHistory,
  context: ScoreContext = {}
): TopPickScoreResult {
  const job = normalizeJobForMatching(sourceJob);
  const eligibilityGate = evaluateEligibilityGate(job, intent);
  if (!eligibilityGate.passed) {
    return rejectResult(job.jobId, eligibilityGate.reason ?? "eligibility_rejected", {
      eligibilityGate,
      concerns: eligibilityGate.reason ? [`Rejected: ${eligibilityGate.reason}.`] : [],
    });
  }
  if (history.excludedJobIds.has(job.jobId)) {
    return rejectResult(job.jobId, "user_feedback", {
      eligibilityGate: { passed: false, reason: "explicit_negative_feedback" },
    });
  }
  if (history.appliedJobIds.has(job.jobId)) {
    return rejectResult(job.jobId, "already_applied", {
      eligibilityGate: { passed: false, reason: "already_applied" },
    });
  }

  const roleGate = evaluateRoleGate(job, intent);
  if (!roleGate.passed) {
    return rejectResult(job.jobId, roleGate.reason ?? "role_rejected", {
      eligibilityGate,
      roleGate,
      scoreBreakdown: { roleGate },
    });
  }

  const seniorityGate = evaluateSeniorityGate(job, intent);
  if (!seniorityGate.passed) {
    return rejectResult(job.jobId, seniorityGate.reason ?? "seniority_rejected", {
      eligibilityGate,
      roleGate,
      seniorityGate,
      scoreBreakdown: { roleGate, seniorityGate },
    });
  }

  const skillFit = scoreSkillFit(intent, job);
  const semanticFit = scoreSemanticText(intent, job);
  const preferenceFit = scorePreferenceFit(intent, job, history);
  const locationWorkModeFit = scoreLocationWorkMode(intent, job);
  const salaryFit = scoreSalaryFit(intent, job);
  const freshnessFit = scoreFreshness(job);
  const sourceQualityFit = scoreSourceQuality(job);
  const feedbackFit = preferenceFit;
  const components = {
    roleFit: rounded(roleScore(roleGate)),
    seniorityFit: rounded(seniorityScore(seniorityGate)),
    skillFit: rounded(skillFit.score),
    semanticFit: rounded(semanticFit),
    preferenceFit: rounded(preferenceFit),
    locationWorkModeFit: rounded(locationWorkModeFit),
    salaryFit: rounded(salaryFit.score),
    freshnessFit: rounded(freshnessFit),
    sourceQualityFit: rounded(sourceQualityFit),
    feedbackFit: rounded(feedbackFit),
  };
  const totalWeight = Object.values(TOP_PICK_SCORING_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  const rawScore =
    (components.roleFit * TOP_PICK_SCORING_WEIGHTS.roleFit +
      components.seniorityFit * TOP_PICK_SCORING_WEIGHTS.seniorityFit +
      components.skillFit * TOP_PICK_SCORING_WEIGHTS.skillFit +
      components.semanticFit * TOP_PICK_SCORING_WEIGHTS.semanticFit +
      components.preferenceFit * TOP_PICK_SCORING_WEIGHTS.preferenceFit +
      components.locationWorkModeFit * TOP_PICK_SCORING_WEIGHTS.locationWorkModeFit +
      components.salaryFit * TOP_PICK_SCORING_WEIGHTS.salaryFit +
      components.freshnessFit * TOP_PICK_SCORING_WEIGHTS.freshnessFit +
      components.sourceQualityFit * TOP_PICK_SCORING_WEIGHTS.sourceQualityFit +
      components.feedbackFit * TOP_PICK_SCORING_WEIGHTS.feedbackFit) /
    totalWeight;

  let scoreCap = Math.min(roleGate.scoreCap, seniorityGate.scoreCap);
  const warnings: string[] = [];
  if (!job.roleCategory || job.roleCategoryConfidence < 0.6) {
    scoreCap = Math.min(scoreCap, TOP_PICK_UNKNOWN_ROLE_SCORE_CAP);
    warnings.push("low_role_confidence_cap");
  }
  if (
    job.minYearsRequired != null &&
    intent.maxRequiredYears != null &&
    job.minYearsRequired > intent.maxRequiredYears
  ) {
    scoreCap = Math.min(scoreCap, 70);
    warnings.push("years_requirement_cap");
  }
  const score = rounded(Math.min(rawScore, scoreCap));
  const concerns = generateConcerns({
    roleGate,
    seniorityGate,
    salaryUnknown: salaryFit.unknown,
    locationWorkModeFit,
    job,
  });

  return {
    jobId: job.jobId,
    score,
    rawScore: rounded(rawScore),
    scoreCap,
    scoreBreakdown: {
      version: "top-picks-v2",
      candidateChannels: context.candidateChannels ?? [],
      components,
      rawScore: rounded(rawScore),
      finalScore: score,
      scoreCap,
      roleGate,
      seniorityGate,
      eligibilityGate,
      matchedSkills: skillFit.matched,
      warnings,
      roleCategory: job.roleCategory,
      roleCategoryConfidence: job.roleCategoryConfidence,
      seniorityLevel: job.seniorityLevel,
      seniorityConfidence: job.seniorityConfidence,
      minYearsRequired: job.minYearsRequired,
    },
    matchReasons: generateReasons({
      intent,
      job,
      roleGate,
      seniorityGate,
      skillFit,
      locationWorkModeFit,
      salaryFit,
      freshness: freshnessFit,
    }),
    concerns,
    excluded: false,
    eligibilityGate,
    roleGate,
    seniorityGate,
  };
}
