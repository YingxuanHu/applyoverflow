import {
  CAREER_STAGE_FILTER_CONFIDENCE_THRESHOLD,
  ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD,
  expandNormalizedRoleCategoryFilterValue,
  normalizeCareerStageFilterValue,
} from "@/lib/job-metadata";

function splitFilterValues(value?: string) {
  if (!value) return [];
  const seen = new Set<string>();
  const values: string[] = [];

  for (const entry of value.split(",")) {
    const trimmed = entry.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(trimmed);
  }

  return values;
}

function withoutUnknownFilterValues(values: string[], unknownValue: string) {
  return values.filter((value) => value !== unknownValue);
}

export function getActiveRoleCategoryFilters(filters: { roleCategory?: string }) {
  return withoutUnknownFilterValues(
    splitFilterValues(expandNormalizedRoleCategoryFilterValue(filters.roleCategory)),
    "OTHER_UNKNOWN"
  );
}

export function getActiveCareerStageFilters(filters: {
  careerStage?: string;
  experienceLevel?: string;
}) {
  return withoutUnknownFilterValues(
    splitFilterValues(normalizeCareerStageFilterValue(filters.careerStage ?? filters.experienceLevel)),
    "UNKNOWN"
  );
}

export type FilterContractJob = {
  id: string;
  title: string;
  company: string;
  roleFamily: string | null;
  normalizedRoleCategory?: string | null;
  normalizedRoleCategoryConfidence?: number | null;
  normalizedIndustry?: string | null;
  normalizedIndustryConfidence?: number | null;
  normalizedCareerStage?: string | null;
  normalizedCareerStageConfidence?: number | null;
  classificationStatus?: string | null;
};

export type JobFilterContractViolation = {
  id: string;
  title: string;
  company: string;
  roleFamily: string | null;
  normalizedRoleCategory: string | null;
  normalizedRoleCategoryConfidence: number | null;
  normalizedIndustry: string | null;
  normalizedIndustryConfidence: number | null;
  normalizedCareerStage: string | null;
  normalizedCareerStageConfidence: number | null;
  classificationStatus: string | null;
  activeRoleCategories: string[];
  activeCareerStages: string[];
  reason: string;
};

export function getJobFilterContractViolations(
  filters: { roleCategory?: string; careerStage?: string; experienceLevel?: string },
  jobs: FilterContractJob[]
): JobFilterContractViolation[] {
  const activeRoleCategories = getActiveRoleCategoryFilters(filters);
  const activeCareerStages = getActiveCareerStageFilters(filters);
  if (activeRoleCategories.length === 0 && activeCareerStages.length === 0) return [];

  const activeRoleCategorySet = new Set(activeRoleCategories);
  const activeCareerStageSet = new Set(activeCareerStages);
  const violations: JobFilterContractViolation[] = [];

  for (const job of jobs) {
    const normalizedRoleCategory = job.normalizedRoleCategory ?? null;
    const normalizedRoleCategoryConfidence = job.normalizedRoleCategoryConfidence ?? null;
    const normalizedCareerStage = job.normalizedCareerStage ?? null;
    const normalizedCareerStageConfidence = job.normalizedCareerStageConfidence ?? null;
    const classificationStatus = job.classificationStatus ?? null;

    let reason: string | null = null;
    if (
      activeRoleCategories.length > 0 &&
      (!normalizedRoleCategory || !activeRoleCategorySet.has(normalizedRoleCategory))
    ) {
      reason = "role_category_mismatch";
    } else if (
      activeRoleCategories.length > 0 &&
      (normalizedRoleCategoryConfidence === null ||
        normalizedRoleCategoryConfidence < ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD)
    ) {
      reason = "role_category_low_confidence";
    } else if (activeRoleCategories.length > 0 && classificationStatus === "UNKNOWN") {
      reason = "classification_status_unknown";
    } else if (
      activeCareerStages.length > 0 &&
      (!normalizedCareerStage || !activeCareerStageSet.has(normalizedCareerStage))
    ) {
      reason = "career_stage_mismatch";
    } else if (
      activeCareerStages.length > 0 &&
      (normalizedCareerStageConfidence === null ||
        normalizedCareerStageConfidence < CAREER_STAGE_FILTER_CONFIDENCE_THRESHOLD)
    ) {
      reason = "career_stage_low_confidence";
    }

    if (!reason) continue;

    violations.push({
      id: job.id,
      title: job.title,
      company: job.company,
      roleFamily: job.roleFamily,
      normalizedRoleCategory,
      normalizedRoleCategoryConfidence,
      normalizedIndustry: job.normalizedIndustry ?? null,
      normalizedIndustryConfidence: job.normalizedIndustryConfidence ?? null,
      normalizedCareerStage,
      normalizedCareerStageConfidence,
      classificationStatus,
      activeRoleCategories,
      activeCareerStages,
      reason,
    });
  }

  return violations;
}

export function assertJobFilterContract(
  filters: { roleCategory?: string; careerStage?: string; experienceLevel?: string },
  jobs: FilterContractJob[],
  source: string = "jobs"
) {
  const violations = getJobFilterContractViolations(filters, jobs);
  if (violations.length === 0) return;

  const preview = violations.slice(0, 8);
  const message = `[jobs-filter-contract] ${source} returned ${violations.length} row(s) that violate active role filters: ${JSON.stringify(preview)}`;

  if (process.env.NODE_ENV !== "production" || process.env.JOB_FILTER_ASSERTIONS === "1") {
    throw new Error(message);
  }

  console.error(message);
}
