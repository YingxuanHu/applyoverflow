import { parseJobFilters, toJobsSearchParams } from "@/lib/jobs/search-params";
import { normalizeLocationSearch } from "@/lib/location-search";
export const JOBS_SEARCH_STATE_STORAGE_KEY = "autoapplication.jobs.filters";

const TEXT_PARAM_MAX_LENGTH = 120;
const LIST_PARAM_MAX_LENGTH = 240;

export const JOBS_STATE_PARAM_KEYS = [
  "discoveredSince",
  "submissionCategory",
  "q",
  "field",
  "search",
  "searchScope",
  "titleSearch",
  "companySearch",
  "locationSearch",
  "location",
  "source",
  "region",
  "workMode",
  "employmentType",
  "industry",
  "function",
  "jobFunction",
  "roleCategory",
  "roleFamily",
  "salaryMin",
  "salaryMax",
  "salaryCurrency",
  "includeUnknownSalary",
  "hideApplied",
  "careerStage",
  "experienceLevel",
  "expiry",
  "datePosted",
  "posted",
  "status",
  "sortBy",
  "sort",
  "page",
] as const;

// Saved filters intentionally exclude one-off title and company queries. A
// returning user should get their preferred job pool, not an old ad-hoc search.
export const JOBS_SAVED_FILTER_PARAM_KEYS = [
  "locationSearch",
  "location",
  "source",
  "region",
  "workMode",
  "employmentType",
  "industry",
  "function",
  "jobFunction",
  "roleCategory",
  "roleFamily",
  "salaryMin",
  "salaryMax",
  "salaryCurrency",
  "includeUnknownSalary",
  "hideApplied",
  "careerStage",
  "experienceLevel",
  "expiry",
  "datePosted",
  "posted",
  "status",
  "sortBy",
  "sort",
] as const;

const JOBS_STATE_PARAM_KEY_SET = new Set<string>(JOBS_STATE_PARAM_KEYS);

const MULTI_VALUE_KEYS = new Set([
  "locationSearch",
  "region",
  "workMode",
  "employmentType",
  "industry",
  "jobFunction",
  "roleCategory",
  "roleFamily",
  "careerStage",
  "experienceLevel",
]);

const TEXT_VALUE_KEYS = new Set([
  "search",
  "titleSearch",
  "companySearch",
  "locationSearch",
  "location",
  "source",
  "roleFamily",
]);

const ORDERED_JOBS_STATE_KEYS = [
  "discoveredSince",
  "submissionCategory",
  "search",
  "searchScope",
  "titleSearch",
  "companySearch",
  "locationSearch",
  "location",
  "source",
  "region",
  "workMode",
  "employmentType",
  "industry",
  "jobFunction",
  "roleCategory",
  "roleFamily",
  "salaryMin",
  "salaryMax",
  "salaryCurrency",
  "includeUnknownSalary",
  "hideApplied",
  "careerStage",
  "experienceLevel",
  "expiry",
  "posted",
  "status",
  "sortBy",
  "page",
] as const;

export function hasJobsStateParamsRecord(searchParams: Record<string, string | string[] | undefined>) {
  return Boolean(normalizeJobsStateQuery(searchParams));
}

export function hasJobsStateParams(searchParams: URLSearchParams) {
  return Boolean(normalizeJobsStateQuery(searchParams));
}

export function normalizeJobsStateQuery(
  input: string | URLSearchParams | Record<string, string | string[] | undefined>,
  options: { includePage?: boolean } = {}
) {
  const includePage = options.includePage ?? true;
  const raw = toJobsSearchParams(input);
  const filters = parseJobFilters(raw);
  const source = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === false || key === "debugFilters") continue;
    if (key === "page" && !raw.has("page")) continue;
    const param = key === "roleCategory" ? "jobFunction" : key;
    source.set(param, value === true ? "1" : String(value));
  }
  const output = new URLSearchParams();
  for (const key of ORDERED_JOBS_STATE_KEYS) {
    if (key === "page" && !includePage) continue;
    const rawValue = source.get(key) ?? undefined;
    const normalizedValue = normalizeParamValue(key, rawValue);
    if (!normalizedValue) continue;
    if (key === "searchScope" && !hasSearchValue(source)) continue;
    if (key === "sortBy" && normalizedValue === "relevance") continue;
    if (key === "page" && normalizedValue === "1" && !source.has("page")) continue;
    output.set(key, normalizedValue);
  }

  if (!output.get("salaryMin") && !output.get("salaryMax")) {
    output.delete("salaryCurrency");
    output.delete("includeUnknownSalary");
  }

  if (!hasSearchValue(output)) {
    output.delete("searchScope");
  }

  return output.toString();
}

export function mergeNaturalLanguageJobsSearch(
  currentSearch: string | URLSearchParams,
  interpretedParams: Record<string, string | undefined>,
  options: { basePath?: "/jobs" | "/jobs/top-picks" } = {}
) {
  const current = toURLSearchParams(currentSearch);
  const interpreted = cleanInterpretedParams(interpretedParams);
  const clearedConflictGroups = new Set<string>();

  for (const [key, value] of Object.entries(interpreted)) {
    if (!value || key === "searchScope") continue;
    const conflictingKeys = getConflictingJobsStateKeys(key);
    const conflictGroup = conflictingKeys.join(":");
    if (!clearedConflictGroups.has(conflictGroup)) {
      for (const conflictingKey of conflictingKeys) {
        current.delete(conflictingKey);
      }
      clearedConflictGroups.add(conflictGroup);
    }
    current.set(key, value);
  }

  // Scope is presentation state for the keyword control. Apply it after the
  // parsed title/company search has replaced the previous search state.
  if (
    interpreted.searchScope &&
    (interpreted.titleSearch || interpreted.companySearch || interpreted.locationSearch)
  ) {
    current.set("searchScope", interpreted.searchScope);
  }

  current.delete("page");
  const normalized = normalizeJobsStateQuery(current, { includePage: false });
  const basePath = options.basePath ?? "/jobs";
  return normalized ? `${basePath}?${normalized}` : basePath;
}

function cleanInterpretedParams(input: Record<string, string | undefined>) {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!JOBS_STATE_PARAM_KEY_SET.has(key)) continue;
    const normalized = normalizeParamValue(key, value);
    if (normalized) params[key] = normalized;
  }
  return params;
}

function getConflictingJobsStateKeys(key: string) {
  switch (key) {
    case "titleSearch":
      return ["q", "field", "search", "searchScope", "titleSearch"];
    case "companySearch":
      return ["q", "field", "search", "searchScope", "companySearch"];
    case "locationSearch":
      return ["location", "locationSearch"];
    case "jobFunction":
      return ["function", "jobFunction", "roleCategory"];
    case "careerStage":
      return ["careerStage", "experienceLevel"];
    case "posted":
      return ["datePosted", "posted"];
    case "sortBy":
      return ["sort", "sortBy"];
    case "salaryMin":
    case "salaryMax":
    case "salaryCurrency":
      return ["salaryMin", "salaryMax", "salaryCurrency", "includeUnknownSalary"];
    default:
      return [key];
  }
}

const toURLSearchParams = toJobsSearchParams;

function hasSearchValue(params: URLSearchParams) {
  return Boolean(
    normalizeTextValue(params.get("search") ?? undefined) ||
      normalizeTextValue(params.get("titleSearch") ?? undefined) ||
      normalizeTextValue(params.get("companySearch") ?? undefined) ||
      normalizeTextValue(params.get("locationSearch") ?? undefined)
  );
}

function normalizeParamValue(key: string, value?: string) {
  if (!value) return undefined;
  if (key === "locationSearch" || key === "location") return normalizeLocationSearch(value);
  if (key === "status" && value === "LIVE") return undefined;
  if (key === "searchScope") return normalizeFieldValue(value);
  if (key === "field") return normalizeFieldValue(value);
  if (key === "sort") return normalizeSortValue(value);
  if (key === "sortBy") return normalizeSortValue(value);
  if (key === "page") {
    const parsed = /^\d+$/.test(value) ? Number(value) : 0;
    return parsed ? String(parsed) : undefined;
  }
  if (key === "salaryMin" || key === "salaryMax") {
    const parsed = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : 0;
    return parsed ? String(parsed) : undefined;
  }
  if (key === "includeUnknownSalary" || key === "hideApplied") {
    return value === "1" || value === "true" || value === "on" ? "1" : undefined;
  }
  if (MULTI_VALUE_KEYS.has(key)) return normalizeListValue(value);
  if (TEXT_VALUE_KEYS.has(key)) return normalizeTextValue(value);
  return normalizeTextValue(value);
}

function normalizeFieldValue(value?: string) {
  if (value === "title" || value === "company" || value === "location") return value;
  return "all";
}

function normalizeSortValue(value?: string) {
  if (value === "best" || value === "relevance") return "relevance";
  if (value === "newest" || value === "deadline" || value === "company") return value;
  return undefined;
}

function normalizeTextValue(value?: string) {
  const trimmed = String(value ?? "").replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, TEXT_PARAM_MAX_LENGTH) : undefined;
}

function normalizeListValue(value?: string) {
  const values = splitValues(value).map((entry) => entry.slice(0, LIST_PARAM_MAX_LENGTH));
  return values.length > 0 ? values.join(",") : undefined;
}

function splitValues(value?: string | null) {
  if (!value) return [];
  const seen = new Set<string>();
  const values: string[] = [];
  for (const entry of value.split(",")) {
    const normalized = normalizeTextValue(entry);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(normalized);
  }
  return values;
}
