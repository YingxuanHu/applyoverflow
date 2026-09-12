import type { NaturalLanguageJobSearchResult } from "./natural-language-search";

const PICKS_FILTERS = new Set(["titleSearch", "companySearch", "locationSearch", "location", "workMode", "careerStage", "experienceLevel", "searchScope"]);

/** Never navigate to results that silently discard part of an AI request. */
export function getUnsupportedSearchConstraints(result: NaturalLanguageJobSearchResult, path: "/jobs" | "/jobs/top-picks") {
  if (result.exclusions.length) {
    return "Exclusions are not supported yet. Describe the roles and options you want to include.";
  }
  if (path === "/jobs/top-picks" && Object.entries(result.params).some(([key, value]) => value && !PICKS_FILTERS.has(key))) {
    return "This search includes filters unavailable for Picks for you. Run it in the Jobs tab to apply all filters.";
  }
  if (result.warnings.length || result.softPreferences.length) {
    return [...result.warnings, ...(result.softPreferences.length ? ["Some preferences cannot be applied as filters. Use specific roles, locations, experience levels or work modes."] : [])].join(" ");
  }
  return null;
}
