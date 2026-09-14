import type { JobFilterParams, JobSearchScope } from "@/lib/queries/jobs";
import { normalizeSalaryCurrency } from "@/lib/currency-conversion";
import { normalizeTextParam, splitFilterValues } from "@/lib/filter-values";
import { normalizeLocationSearch } from "@/lib/location-search";
import {
  normalizeEmploymentTypeGroupFilterValue,
  normalizeExperienceLevelGroupFilterValue,
  normalizeIndustryFilterValue,
  normalizeRoleCategoryFilterValue,
} from "@/lib/job-metadata";

export type JobsSearchParams = Record<string, string | string[] | undefined>;
export type JobsSearchInput = JobsSearchParams | URLSearchParams | string;

export function toJobsSearchParams(input: JobsSearchInput): URLSearchParams {
  if (typeof input === "string") return new URLSearchParams(input);
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (entry !== undefined) params.append(key, entry);
    }
  }
  return params;
}

export function parseJobFilters(
  input: JobsSearchInput,
  defaultSalaryCurrency?: JobFilterParams["salaryCurrency"],
): JobFilterParams {
  const params = toJobsSearchParams(input);
  const first = (key: string) => params.get(key) ?? undefined;
  const many = (key: string) => params.getAll(key).join(",") || undefined;
  const enumList = (key: string, allowed: string[]) =>
    splitFilterValues(many(key)?.toUpperCase())
      .filter((value) => allowed.includes(value))
      .join(",") || undefined;
  const flag = (key: string) =>
    ["1", "true", "on"].includes(first(key)?.toLowerCase() ?? "");
  const scope = first("searchScope") ?? first("field");
  const selectedScope = ["title", "company", "location"].includes(scope ?? "")
    ? (scope as JobSearchScope)
    : undefined;
  const legacyText = normalizeTextParam(first("search") ?? first("q"));
  const titleSearch = normalizeTextParam(
    first("titleSearch") ??
      (!selectedScope || selectedScope === "title" ? legacyText : undefined),
  );
  const companySearch = normalizeTextParam(
    first("companySearch") ??
      (selectedScope === "company" ? legacyText : undefined),
  );
  const locationSearch = normalizeLocationSearch(
    params.has("locationSearch")
      ? many("locationSearch")
      : ((selectedScope === "location" ? legacyText : undefined) ??
          many("location")),
  );
  let salaryMin = positiveNumber(first("salaryMin"));
  let salaryMax = positiveNumber(first("salaryMax"));
  if (salaryMin && salaryMax && salaryMin > salaryMax)
    [salaryMin, salaryMax] = [salaryMax, salaryMin];
  const sort = first("sortBy") ?? first("sort");
  // Legacy multi-select date URLs mean the union of their time windows.
  const posted = splitFilterValues(many("posted") ?? many("datePosted"))
    .filter((value) => ["1d", "3d", "7d", "14d", "30d"].includes(value))
    .sort((a, b) => Number.parseInt(b) - Number.parseInt(a))[0];
  const status = enumList("status", [
    "AGING",
    "STALE",
    "EXPIRED",
    "REMOVED",
    "LIVE",
  ]);
  return {
    searchScope:
      selectedScope ??
      (titleSearch
        ? "title"
        : companySearch
          ? "company"
          : locationSearch
            ? "location"
            : "title"),
    titleSearch,
    companySearch,
    locationSearch,
    source: normalizeTextParam(first("source")),
    region: enumList("region", ["US", "CA"]),
    workMode: enumList("workMode", ["REMOTE", "HYBRID", "ONSITE", "FLEXIBLE"]),
    employmentType: normalizeEmploymentTypeGroupFilterValue(
      many("employmentType"),
    ),
    industry: normalizeIndustryFilterValue(many("industry")),
    roleCategory: normalizeRoleCategoryFilterValue(
      many("jobFunction") ?? many("function") ?? many("roleCategory"),
    ),
    roleFamily: normalizeTextParam(many("roleFamily")),
    careerStage: normalizeExperienceLevelGroupFilterValue(
      many("careerStage") ?? many("experienceLevel"),
    ),
    salaryMin,
    salaryMax,
    salaryCurrency:
      normalizeSalaryCurrency(first("salaryCurrency")) ?? defaultSalaryCurrency,
    includeUnknownSalary: Boolean(
      (salaryMin || salaryMax) && flag("includeUnknownSalary"),
    ),
    hideApplied: flag("hideApplied"),
    expiry: first("expiry") === "soon" ? "soon" : undefined,
    posted,
    status:
      status && status !== "LIVE" && !status.includes(",") ? status : undefined,
    submissionCategory: enumList("submissionCategory", [
      "READY_TO_APPLY",
      "REVIEW_REQUIRED",
      "MANUAL_ONLY",
    ]),
    sortBy:
      sort === "newest" || sort === "deadline" || sort === "company"
        ? sort
        : undefined,
    page: Math.min(1000, positiveInteger(first("page")) ?? 1),
    discoveredSince: parseDiscoveredSince(first("discoveredSince")),
    debugFilters: first("debugFilters") === "1",
  };
}

export function parseTopPicksFilters(input: JobsSearchInput) {
  const filters = parseJobFilters(input);
  return {
    searchScope: filters.searchScope ?? "title",
    titleSearch: filters.titleSearch,
    companySearch: filters.companySearch,
    locationSearch: filters.locationSearch ?? filters.location,
    workMode: filters.workMode,
    experienceLevel: filters.careerStage,
  };
}

export function countActiveJobFilters(filters: JobFilterParams) {
  return [
    filters.locationSearch || filters.location,
    filters.source,
    filters.region,
    filters.workMode,
    filters.employmentType,
    filters.industry,
    filters.roleCategory,
    filters.roleFamily,
    filters.careerStage || filters.experienceLevel,
    filters.expiry,
    filters.posted,
    filters.status,
    filters.submissionCategory,
    filters.hideApplied,
    filters.salaryMin || filters.salaryMax,
  ].filter(Boolean).length;
}

export function parseDiscoveredSince(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() <= Date.now()
    ? date.toISOString()
    : undefined;
}

function positiveNumber(value?: string) {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) return undefined;
  const number = Number(value);
  return number > 0 && number <= 100_000_000 ? number : undefined;
}

function positiveInteger(value?: string) {
  return value && /^\d+$/.test(value) ? positiveNumber(value) : undefined;
}
