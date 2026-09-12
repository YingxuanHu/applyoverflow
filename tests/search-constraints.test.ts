import assert from "node:assert/strict";
import test from "node:test";
import { getUnsupportedSearchConstraints } from "../src/lib/jobs/search-constraints";
import type { NaturalLanguageJobSearchResult } from "../src/lib/jobs/natural-language-search";

const result = (params: Record<string, string>, extra = {}) => ({ params, exclusions: [], softPreferences: [], warnings: [], ...extra } as unknown as NaturalLanguageJobSearchResult);
test("AI constraints are never silently discarded by the selected feed", () => {
  assert.equal(getUnsupportedSearchConstraints(result({ locationSearch: "Toronto", workMode: "REMOTE" }), "/jobs/top-picks"), null);
  assert.match(getUnsupportedSearchConstraints(result({ salaryMin: "120000", posted: "7d" }), "/jobs/top-picks")!, /Jobs tab/);
  assert.equal(getUnsupportedSearchConstraints(result({ salaryMin: "120000", posted: "7d" }), "/jobs"), null);
  assert.match(getUnsupportedSearchConstraints(result({}, { exclusions: [{ value: "sales" }] }), "/jobs")!, /Exclusions/);
  assert.match(getUnsupportedSearchConstraints(result({}, { warnings: ["Location is ambiguous"] }), "/jobs")!, /ambiguous/);
});
