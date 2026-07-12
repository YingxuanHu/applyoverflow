import {
  CAREER_STAGE_FILTER_CONFIDENCE_THRESHOLD,
  INDUSTRY_FILTER_CONFIDENCE_THRESHOLD,
  ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD,
  expandNormalizedRoleCategoryFilterValue,
  normalizeExperienceLevelGroupFilterValue,
  normalizeIndustryFilterValue,
} from "@/lib/job-metadata";
import { splitFilterValues } from "@/lib/filter-values";

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
    splitFilterValues(
      normalizeExperienceLevelGroupFilterValue(filters.careerStage ?? filters.experienceLevel)
    ),
    "UNKNOWN"
  );
}

export function getActiveIndustryFilters(filters: { industry?: string }) {
  return withoutUnknownFilterValues(
    splitFilterValues(normalizeIndustryFilterValue(filters.industry)),
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
  normalizedIndustries?: string[] | null;
  normalizedIndustryConfidence?: number | null;
  normalizedCareerStage?: string | null;
  experienceLevelGroup?: string | null;
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
  normalizedIndustries: string[];
  normalizedIndustryConfidence: number | null;
  normalizedCareerStage: string | null;
  experienceLevelGroup: string | null;
  normalizedCareerStageConfidence: number | null;
  classificationStatus: string | null;
  activeRoleCategories: string[];
  activeIndustries: string[];
  activeCareerStages: string[];
  reason: string;
};

export function getJobFilterContractViolations(
  filters: { roleCategory?: string; industry?: string; careerStage?: string; experienceLevel?: string },
  jobs: FilterContractJob[]
): JobFilterContractViolation[] {
  const activeRoleCategories = getActiveRoleCategoryFilters(filters);
  const activeIndustries = getActiveIndustryFilters(filters);
  const activeCareerStages = getActiveCareerStageFilters(filters);
  if (
    activeRoleCategories.length === 0 &&
    activeIndustries.length === 0 &&
    activeCareerStages.length === 0
  ) return [];

  const activeRoleCategorySet = new Set(activeRoleCategories);
  const activeIndustrySet = new Set(activeIndustries);
  const activeCareerStageSet = new Set(activeCareerStages);
  const violations: JobFilterContractViolation[] = [];

  for (const job of jobs) {
    const normalizedRoleCategory = job.normalizedRoleCategory ?? null;
    const normalizedRoleCategoryConfidence = job.normalizedRoleCategoryConfidence ?? null;
    const normalizedIndustry = job.normalizedIndustry ?? null;
    const normalizedIndustries = job.normalizedIndustries ?? [];
    const normalizedIndustryConfidence = job.normalizedIndustryConfidence ?? null;
    const normalizedCareerStage = job.normalizedCareerStage ?? null;
    const experienceLevelGroup = job.experienceLevelGroup ?? null;
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
      activeIndustries.length > 0 &&
      !(
        (normalizedIndustry && activeIndustrySet.has(normalizedIndustry)) ||
        normalizedIndustries.some((industry) => activeIndustrySet.has(industry))
      )
    ) {
      reason = "company_industry_mismatch";
    } else if (
      activeIndustries.length > 0 &&
      (normalizedIndustryConfidence === null ||
        normalizedIndustryConfidence < INDUSTRY_FILTER_CONFIDENCE_THRESHOLD)
    ) {
      reason = "company_industry_low_confidence";
    } else if (
      activeCareerStages.length > 0 &&
      (!experienceLevelGroup || !activeCareerStageSet.has(experienceLevelGroup))
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
      normalizedIndustry,
      normalizedIndustries,
      normalizedIndustryConfidence,
      normalizedCareerStage,
      experienceLevelGroup,
      normalizedCareerStageConfidence,
      classificationStatus,
      activeRoleCategories,
      activeIndustries,
      activeCareerStages,
      reason,
    });
  }

  return violations;
}

export function assertJobFilterContract(
  filters: { roleCategory?: string; industry?: string; careerStage?: string; experienceLevel?: string },
  jobs: FilterContractJob[],
  source: string = "jobs"
) {
  const violations = getJobFilterContractViolations(filters, jobs);
  if (violations.length === 0) return;

  const preview = violations.slice(0, 8);
  const message = `[jobs-filter-contract] ${source} returned ${violations.length} row(s) that violate active structured filters: ${JSON.stringify(preview)}`;

  if (source === "test" || process.env.JOB_FILTER_ASSERTIONS === "1") {
    throw new Error(message);
  }

  console.error(message);
}
