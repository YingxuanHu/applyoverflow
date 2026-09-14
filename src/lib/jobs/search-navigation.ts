import { normalizeJobsStateQuery } from "./search-state";
import type { JobsSearchInput } from "./search-params";

export function buildJobsSearchHref(
  current: JobsSearchInput,
  overrides: Record<string, string | undefined>,
  basePath = "/jobs",
) {
  // Resolve aliases before removing a chip so legacy parameters cannot restore it.
  const params = new URLSearchParams(normalizeJobsStateQuery(current));
  for (const [key, value] of Object.entries(overrides)) {
    const param =
      key === "roleCategory"
        ? "jobFunction"
        : key === "experienceLevel"
          ? "careerStage"
          : key === "location"
            ? "locationSearch"
            : key;
    if (param !== key && Object.hasOwn(overrides, param)) continue;
    if (value) params.set(param, value);
    else params.delete(param);
  }
  const query = normalizeJobsStateQuery(params);
  return query ? `${basePath}?${query}` : `${basePath}?reset=1`;
}
