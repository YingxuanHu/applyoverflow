export const JOBS_SEARCH_STATE_STORAGE_KEY = "autoapplication.jobs.filters";
export const JOBS_SEARCH_STATE_COOKIE = "applyoverflow.jobs.state";
export const JOBS_SEARCH_STATE_PREFERENCE_KEY = "lastJobsSearchState";

export type JobsStateSource = "url" | "session" | "savedPreference" | "default";

const TEXT_PARAM_MAX_LENGTH = 120;
const LIST_PARAM_MAX_LENGTH = 240;

export const JOBS_STATE_PARAM_KEYS = [
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
  "careerStage",
  "experienceLevel",
  "expiry",
  "posted",
  "status",
  "sortBy",
  "page",
] as const;

type LastJobsSearchState = {
  version: 1;
  query: string;
  q: string | null;
  field: "all" | "title" | "company" | "location";
  filters: {
    jobFunction: string[];
    industry: string[];
    location: string[];
    workMode: string[];
    experienceLevel: string[];
    employmentType: string[];
    datePosted: string | null;
    salaryMin: number | null;
    salaryMax: number | null;
    company: string[];
    skills: string[];
    source: string[];
    sponsorship: string | null;
  };
  sort: string;
};

export function hasJobsStateParamsRecord(
  searchParams: Record<string, string | string[] | undefined>
) {
  return Object.entries(searchParams).some(([key, value]) => {
    if (!JOBS_STATE_PARAM_KEY_SET.has(key)) return false;
    const normalizedValue = Array.isArray(value) ? value.filter(Boolean).join(",") : value;
    return normalizeTextValue(normalizedValue) !== undefined;
  });
}

export function hasJobsStateParams(searchParams: URLSearchParams) {
  for (const key of JOBS_STATE_PARAM_KEYS) {
    if (normalizeTextValue(searchParams.get(key) ?? undefined)) return true;
  }
  return false;
}

export function normalizeJobsStateQuery(
  input: string | URLSearchParams | Record<string, string | string[] | undefined>,
  options: { includePage?: boolean } = {}
) {
  const includePage = options.includePage ?? true;
  const source = toURLSearchParams(input);
  applyAliasParams(source);
  if (!source.has("searchScope") && hasSearchValue(source)) {
    const inferredScope = inferSearchScope(source);
    if (inferredScope !== "all") source.set("searchScope", inferredScope);
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

export function resolveJobsStateSource(input: {
  urlParams: Record<string, string | string[] | undefined>;
  sessionQuery?: string | null;
  savedPreferenceValue?: string | null;
}) {
  if (hasJobsStateParamsRecord(input.urlParams)) {
    return {
      source: "url" as const,
      query: normalizeJobsStateQuery(input.urlParams),
    };
  }

  const sessionQuery = normalizeJobsStateQuery(input.sessionQuery ?? "");
  if (sessionQuery) {
    return { source: "session" as const, query: sessionQuery };
  }

  const savedPreferenceQuery = queryStringFromJobsPreferenceValue(
    input.savedPreferenceValue
  );
  if (savedPreferenceQuery) {
    return {
      source: "savedPreference" as const,
      query: savedPreferenceQuery,
    };
  }

  return { source: "default" as const, query: "" };
}

export function jobsPreferenceValueFromQueryString(query: string) {
  const normalizedQuery = normalizeJobsStateQuery(query, { includePage: false });
  const params = new URLSearchParams(normalizedQuery);
  const state: LastJobsSearchState = {
    version: 1,
    query: normalizedQuery,
    q: getPrimarySearchText(params),
    field: getPrimarySearchField(params),
    filters: {
      jobFunction: splitValues(params.get("jobFunction") ?? params.get("roleCategory")),
      industry: splitValues(params.get("industry")),
      location: splitValues(params.get("locationSearch") ?? params.get("location")),
      workMode: splitValues(params.get("workMode")),
      experienceLevel: splitValues(params.get("careerStage") ?? params.get("experienceLevel")),
      employmentType: splitValues(params.get("employmentType")),
      datePosted: params.get("posted") || null,
      salaryMin: parsePositiveInt(params.get("salaryMin")),
      salaryMax: parsePositiveInt(params.get("salaryMax")),
      company: splitValues(params.get("companySearch")),
      skills: [],
      source: splitValues(params.get("source")),
      sponsorship: null,
    },
    sort: params.get("sortBy") || "relevance",
  };

  return JSON.stringify(state);
}

export function queryStringFromJobsPreferenceValue(value?: string | null) {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as Partial<LastJobsSearchState>;
    if (typeof parsed.query === "string") {
      return normalizeJobsStateQuery(parsed.query, { includePage: false });
    }
  } catch {
    return normalizeJobsStateQuery(value, { includePage: false });
  }
  return "";
}

export function isDefaultJobsStateQuery(query: string) {
  return normalizeJobsStateQuery(query, { includePage: false }) === "";
}

function toURLSearchParams(
  input: string | URLSearchParams | Record<string, string | string[] | undefined>
) {
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  if (typeof input === "string") return new URLSearchParams(input.startsWith("?") ? input.slice(1) : input);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      const joined = value.filter(Boolean).join(",");
      if (joined) params.set(key, joined);
    } else if (value) {
      params.set(key, value);
    }
  }
  return params;
}

function applyAliasParams(params: URLSearchParams) {
  const q = normalizeTextValue(params.get("q") ?? undefined);
  if (q) {
    const field = normalizeFieldValue(params.get("field") ?? undefined);
    if (
      !params.has("search") &&
      !params.has("titleSearch") &&
      !params.has("companySearch") &&
      !params.has("locationSearch")
    ) {
      if (field === "title") {
        params.set("titleSearch", q);
      } else if (field === "company") {
        params.set("companySearch", q);
      } else if (field === "location") {
        params.set("locationSearch", q);
      } else {
        params.set("search", q);
      }
      params.set("searchScope", field);
    }
  }

  const sort = normalizeSortValue(params.get("sort") ?? undefined);
  if (sort && !params.has("sortBy")) {
    params.set("sortBy", sort);
  }

  const jobFunction = normalizeListValue(params.get("function") ?? undefined);
  if (jobFunction && !params.has("jobFunction") && !params.has("roleCategory")) {
    params.set("jobFunction", jobFunction);
  }

  const datePosted = normalizeTextValue(params.get("datePosted") ?? undefined);
  if (datePosted && !params.has("posted")) {
    params.set("posted", datePosted);
  }
}

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
  if (key === "searchScope") return normalizeFieldValue(value);
  if (key === "field") return normalizeFieldValue(value);
  if (key === "sort") return normalizeSortValue(value);
  if (key === "sortBy") return normalizeSortValue(value);
  if (key === "page") {
    const parsed = parsePositiveInt(value);
    return parsed ? String(parsed) : undefined;
  }
  if (key === "salaryMin" || key === "salaryMax") {
    const parsed = parsePositiveInt(value);
    return parsed ? String(parsed) : undefined;
  }
  if (key === "includeUnknownSalary") {
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

function parsePositiveInt(value?: string | null) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getPrimarySearchText(params: URLSearchParams) {
  return (
    params.get("search") ||
    params.get("titleSearch") ||
    params.get("companySearch") ||
    params.get("locationSearch") ||
    null
  );
}

function getPrimarySearchField(params: URLSearchParams): LastJobsSearchState["field"] {
  if (params.get("titleSearch")) return "title";
  if (params.get("companySearch")) return "company";
  if (params.get("locationSearch")) return "location";
  return "all";
}

function inferSearchScope(params: URLSearchParams) {
  if (normalizeTextValue(params.get("titleSearch") ?? undefined)) return "title";
  if (normalizeTextValue(params.get("companySearch") ?? undefined)) return "company";
  if (normalizeTextValue(params.get("locationSearch") ?? undefined)) return "location";
  return "all";
}
