import type { JobFilterParams } from "./jobs";

// Counts do not depend on pagination or ordering. Keep every constraint in the
// key, including future filters, and isolate each viewer's PASS state.
export function jobCountCacheKey(filters: JobFilterParams, viewerId: string | null, version: number) {
  const constraints = Object.entries(filters)
    .filter(([key]) => !["page", "sortBy", "debugFilters"].includes(key))
    .sort(([a], [b]) => a.localeCompare(b));
  return `job-count:${JSON.stringify([viewerId, version, constraints])}`;
}

export function canUseSimpleTextCount(filters: JobFilterParams) {
  const allowed = new Set(["titleSearch", "companySearch", "page", "sortBy", "searchScope", "salaryCurrency", "debugFilters"]);
  return Boolean(filters.titleSearch || filters.companySearch) &&
    !/[%_\\]/.test(`${filters.titleSearch ?? ""}${filters.companySearch ?? ""}`) &&
    Object.entries(filters).every(([key, value]) => value === undefined || value === null || allowed.has(key));
}
