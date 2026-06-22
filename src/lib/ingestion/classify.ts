import type { EligibilityDraft, NormalizedJobInput } from "@/lib/ingestion/types";

type BuildEligibilityOptions = {
  job: NormalizedJobInput;
  sourceName: string;
};

// ─── Portal classification ───────────────────────────────────────────────────

type PortalTier = "structured" | "semi_structured" | "aggregator" | "unknown";

/**
 * Classify the application portal tier based on source name and apply URL.
 *
 * - **structured**: ATS or career portals with predictable job-specific pages
 *   and clear application flow.
 * - **semi_structured**: Corporate portals that have forms but may vary
 *   (SuccessFactors, Taleo, company career pages)
 * - **aggregator**: Job boards that link out to external application pages
 *   (Adzuna, Himalayas, TheMuse, RemoteOK, Remotive, Jobicy, USAJobs, Job Bank)
 * - **unknown**: Source not recognized
 */
function classifyPortal(sourceName: string, applyUrl: string): PortalTier {
  const src = normalizeText(sourceName);
  const url = normalizeText(applyUrl);

  // Tier 1: Structured ATS portals with standardized application flows
  if (
    src.includes("greenhouse") || url.includes("greenhouse.io") ||
    src.includes("lever") || url.includes("lever.co") || url.includes("jobs.lever.co") ||
    src.includes("ashby") || url.includes("ashbyhq.com")
  ) {
    return "structured";
  }

  // Known ATS portals that are ingestible but vary enough that users should
  // review the employer page directly.
  if (
    src.includes("workday") || url.includes("myworkdayjobs.com") ||
    src.includes("smartrecruiters") || url.includes("smartrecruiters.com") ||
    src.includes("icims") || url.includes("icims.com") ||
    src.includes("workable") || url.includes("apply.workable.com") ||
    src.includes("rippling") || url.includes("ats.rippling.com") ||
    src.includes("recruitee") || url.includes("recruitee.com")
  ) {
    return "semi_structured";
  }

  // Tier 2: Semi-structured portals (have forms but less standardized)
  if (
    src.includes("successfactors") || url.includes("successfactors.com") ||
    src.includes("taleo") || url.includes("taleo.net") ||
    src.includes("usajobs") || url.includes("usajobs.gov")
  ) {
    return "semi_structured";
  }

  // Tier 3: Aggregators that link out to external apply pages
  if (
    src.includes("adzuna") ||
    src.includes("himalayas") ||
    src.includes("themuse") ||
    src.includes("remoteok") ||
    src.includes("remotive") ||
    src.includes("jobicy") ||
    src.includes("jobbank")
  ) {
    return "aggregator";
  }

  return "unknown";
}

// ─── Main classifier ─────────────────────────────────────────────────────────

export function buildEligibilityDraft({
  job,
  sourceName,
}: BuildEligibilityOptions): EligibilityDraft {
  const evaluationTime = new Date();
  const lowerDescription = normalizeText(job.description);
  const portalTier = classifyPortal(sourceName, job.applyUrl);

  // ─── Signal detection ──────────────────────────────────────────────
  const requiresCustomWriting =
    /cover letter|essay|statement of interest|why do you want|why are you interested|additional question|writing sample/.test(
      lowerDescription
    );

  const higherTouchRole =
    job.normalizedCareerStage === "SENIOR" ||
    job.normalizedCareerStage === "STAFF_PRINCIPAL" ||
    job.normalizedCareerStage === "MANAGER" ||
    job.normalizedCareerStage === "DIRECTOR" ||
    job.normalizedCareerStage === "EXECUTIVE" ||
    job.experienceLevel === "LEAD" ||
    job.experienceLevel === "EXECUTIVE" ||
    /\b(manager|director|principal|staff\s+engineer|distinguished|fellow|chief|cto|cfo|coo|vp\b|vice president|head of)\b/i.test(job.title);

  const nonStandardEmployment =
    job.normalizedEmploymentType !== "FULL_TIME" ||
    job.employmentType !== "FULL_TIME";

  const isInternship =
    job.normalizedCareerStage === "INTERNSHIP_COOP_STUDENT" ||
    job.normalizedEmploymentType === "INTERNSHIP" ||
    job.normalizedEmploymentType === "CO_OP" ||
    job.roleFamily === "Internship" ||
    /\b(intern|co-op|coop|internship|stagiaire)\b/i.test(job.title);

  // Aggregator jobs often link to external sites with less predictable quality.
  const hasExternalRedirect =
    portalTier === "aggregator" &&
    !job.applyUrl.includes("greenhouse") &&
    !job.applyUrl.includes("lever.co") &&
    !job.applyUrl.includes("ashbyhq.com") &&
    !job.applyUrl.includes("myworkdayjobs.com") &&
    !job.applyUrl.includes("smartrecruiters.com") &&
    !job.applyUrl.includes("icims.com");

  // ─── Classification logic ──────────────────────────────────────────

  // Unknown portals → manual
  if (portalTier === "unknown") {
    return makeManual(
      "unknown_source_portal",
      "Source portal is not yet recognized. Manual application required.",
      evaluationTime,
      { jobValidity: 0.6, applicationFlow: 0.15, packageFit: 0.5, submissionQuality: 0.4 }
    );
  }

  // Aggregators with external redirects → manual/review because the destination
  // may not be a job-specific application page.
  if (hasExternalRedirect) {
    return makeManual(
      "aggregator_external_redirect",
      "This job was found via an aggregator and links to an external application page we haven't mapped yet.",
      evaluationTime,
      { jobValidity: 0.82, applicationFlow: 0.2, packageFit: 0.65, submissionQuality: 0.5 }
    );
  }

  // Aggregators linking to known ATS → classify as if structured
  // (the apply URL points to a known structured portal)
  const effectiveTier = portalTier === "aggregator" ? "semi_structured" : portalTier;

  // Semi-structured portals → manual because the employer flow varies.
  if (effectiveTier === "semi_structured") {
    return makeManual(
      "variable_employer_portal",
      "This employer portal varies by company. Open the posting and apply manually.",
      evaluationTime,
      { jobValidity: 0.86, applicationFlow: 0.2, packageFit: 0.72, submissionQuality: 0.65 }
    );
  }

  // ─── Structured portals ────────────────────────────────────────────

  // Custom writing → review
  if (requiresCustomWriting) {
    return makeReview(
      "custom_written_response_required",
      "Structured employer flow detected, but the description suggests custom writing or extra questions. Review before applying.",
      evaluationTime,
      { jobValidity: 0.9, applicationFlow: 0.78, packageFit: 0.8, submissionQuality: 0.74 }
    );
  }

  // Senior/exec roles → review
  if (higherTouchRole) {
    return makeReview(
      "higher_touch_role_review",
      "Structured employer flow, but role seniority means materials should be reviewed before applying.",
      evaluationTime,
      { jobValidity: 0.92, applicationFlow: 0.82, packageFit: 0.75, submissionQuality: 0.72 }
    );
  }

  // Internships → review (different resume strategy needed)
  if (isInternship) {
    return makeReview(
      "internship_review",
      "Structured ATS flow for an internship/co-op. Review recommended to tailor materials for early-career role.",
      evaluationTime,
      { jobValidity: 0.9, applicationFlow: 0.85, packageFit: 0.7, submissionQuality: 0.75 }
    );
  }

  // Non-standard employment → review
  if (nonStandardEmployment) {
    return makeReview(
      "non_standard_employment_review",
      "Structured employer flow, but non-standard employment type needs review before applying.",
      evaluationTime,
      { jobValidity: 0.88, applicationFlow: 0.82, packageFit: 0.78, submissionQuality: 0.73 }
    );
  }

  // Structured + low-complexity means the posting is clean enough to prepare
  // materials and apply directly on the employer site.
  return makeReady(
    "structured_portal_ready",
    "Structured employer posting detected. Prepare materials, open the posting, and apply on the employer site.",
    evaluationTime,
    { jobValidity: 0.94, applicationFlow: 0.82, packageFit: 0.86, submissionQuality: 0.84 }
  );
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type ConfidenceScores = {
  jobValidity: number;
  applicationFlow: number;
  packageFit: number;
  submissionQuality: number;
};

function makeManual(
  reasonCode: string,
  reasonDescription: string,
  evaluatedAt: Date,
  scores: ConfidenceScores
): EligibilityDraft {
  return {
    submissionCategory: "MANUAL_ONLY",
    reasonCode,
    reasonDescription,
    jobValidityConfidence: scores.jobValidity,
    applicationFlowConfidence: scores.applicationFlow,
    packageFitConfidence: scores.packageFit,
    submissionQualityConfidence: scores.submissionQuality,
    customizationLevel: 3,
    evaluatedAt,
  };
}

function makeReview(
  reasonCode: string,
  reasonDescription: string,
  evaluatedAt: Date,
  scores: ConfidenceScores
): EligibilityDraft {
  return {
    submissionCategory: "REVIEW_REQUIRED",
    reasonCode,
    reasonDescription,
    jobValidityConfidence: scores.jobValidity,
    applicationFlowConfidence: scores.applicationFlow,
    packageFitConfidence: scores.packageFit,
    submissionQualityConfidence: scores.submissionQuality,
    customizationLevel: 2,
    evaluatedAt,
  };
}

function makeReady(
  reasonCode: string,
  reasonDescription: string,
  evaluatedAt: Date,
  scores: ConfidenceScores
): EligibilityDraft {
  return {
    submissionCategory: "READY_TO_APPLY",
    reasonCode,
    reasonDescription,
    jobValidityConfidence: scores.jobValidity,
    applicationFlowConfidence: scores.applicationFlow,
    packageFitConfidence: scores.packageFit,
    submissionQualityConfidence: scores.submissionQuality,
    customizationLevel: 1,
    evaluatedAt,
  };
}
