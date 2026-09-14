import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("pages, APIs and saved state share one filter parser", () => {
  for (const path of ["src/app/jobs/page.tsx", "src/app/api/jobs/route.ts", "src/lib/jobs/search-state.ts"]) {
    assert.match(read(path), /parseJobFilters/);
    assert.match(read(path), /lib\/jobs\/search-params/);
  }
  for (const path of ["src/app/jobs/top-picks/page.tsx", "src/app/api/jobs/top-picks/route.ts"]) {
    assert.match(read(path), /parseTopPicksFilters/);
  }
  assert.match(read("src/lib/jobs/search-navigation.ts"), /normalizeJobsStateQuery/);
});

test("all read models enforce shared geography and metadata confidence", () => {
  const jobs = read("src/lib/queries/jobs.ts");
  const picks = read("src/lib/queries/top-picks.ts");
  assert.match(jobs, /const buildLocationSearchWhere = buildLocationSearchPredicate/);
  assert.match(jobs, /const buildFeedIndexLocationSearchWhere = buildLocationSearchPredicate/);
  assert.match(picks, /buildLocationSearchPredicate\(locationValue\)/);
  assert.match(picks, /buildScopedTextSearchWhere/);
  for (const source of [jobs, picks]) {
    assert.match(source, /workModeConfidence.*|workModeConfidence/);
    assert.match(source, /METADATA_FIELD_FILTER_CONFIDENCE_THRESHOLD/);
    assert.match(source, /CAREER_STAGE_FILTER_CONFIDENCE_THRESHOLD/);
  }
  for (const field of ["normalizedRoleCategoryConfidence", "classificationStatus", "employmentTypeConfidence", "normalizedIndustryConfidence"]) {
    assert.ok(jobs.includes(field), field);
  }
  assert.match(jobs, /assertJobFilterContract/);
  assert.match(jobs, /const buildSalaryRangeIndexWhere = buildSalaryRangeWhere/);
  assert.match(jobs, /getSelectiveScopedSearchIds/);
  assert.match(jobs, /buildNotAppliedCanonicalWhere/);
});

test("both filter panels use the accessible shared dialog and the main date control is single-select", () => {
  const jobs = read("src/app/jobs/page.tsx");
  const picks = read("src/app/jobs/top-picks/page.tsx");
  const panel = read("src/components/jobs/jobs-filter-panel.tsx");
  for (const page of [jobs, picks]) assert.match(page, /<JobsFilterPanel/);
  assert.match(panel, /DialogTitle/);
  assert.match(panel, /DialogClose/);
  assert.match(panel, /Cancel/);
  assert.match(panel, /reportValidity/);
  assert.match(panel, /setSession/);
  assert.match(panel, /countActiveJobFilters/);
  assert.match(jobs, /single\s+name="posted"/);
  assert.match(jobs, /Minimum annual salary/);
  assert.match(jobs, /Maximum annual salary/);
  assert.match(jobs, /jobsResult.summary.liveJobCount/);
});

test("AI cancellation, search preservation and navigation feedback remain wired", () => {
  const search = read("src/components/jobs/jobs-search-form.tsx");
  assert.match(search, /mergeNaturalLanguageJobsSearch/);
  assert.match(search, /getUnsupportedSearchConstraints/);
  assert.match(search, /controller.signal.aborted/);
  assert.match(search, /showJobsLoadingPopup/);
  assert.match(search, /buildCommittedSearchHiddenFields\(committedValues\).filter/);
  assert.match(search, /field.name !== "locationSearch"/);
  assert.match(search, /form=\{filterFormId\}/);
  assert.match(search, /SpeechRecognition/);
});
