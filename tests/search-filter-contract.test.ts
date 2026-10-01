import assert from "node:assert/strict";
import test from "node:test";
import {
  parseJobFilters,
  parseTopPicksFilters,
  countActiveJobFilters,
} from "../src/lib/jobs/search-params";
import {
  normalizeJobsStateQuery,
  hasJobsStateParams,
} from "../src/lib/jobs/search-state";
import {
  buildLocationSearchPredicate,
  splitLocationSearchValues,
} from "../src/lib/location-search";
import { buildSalaryRangeWhere } from "../src/lib/jobs/salary-filter";
import { FALLBACK_SALARY_EXCHANGE_RATES } from "../src/lib/currency-conversion";
import { buildJobsSearchHref } from "../src/lib/jobs/search-navigation";

type Row = {
  location?: string;
  region?: string | null;
  workMode?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
};

test("chip removal cannot resurrect aliases and filter edits retain independent constraints", () => {
  assert.equal(
    buildJobsSearchHref("location=Toronto&locationSearch=Seattle", {
      locationSearch: undefined,
    }),
    "/jobs?reset=1",
  );
  assert.equal(parseJobFilters("location=Toronto").locationSearch, "Toronto");
  assert.equal(
    parseJobFilters("location=Toronto&locationSearch=").locationSearch,
    undefined,
  );
  assert.equal(
    parseJobFilters("location=Toronto&locationSearch=Seattle").locationSearch,
    "Seattle",
  );
  assert.equal(
    buildJobsSearchHref("q=Acme&field=company", {
      companySearch: undefined,
      page: undefined,
    }),
    "/jobs?reset=1",
  );
  assert.equal(
    buildJobsSearchHref("function=software_engineering", {
      jobFunction: undefined,
      roleCategory: undefined,
    }),
    "/jobs?reset=1",
  );
  const next = new URL(
    buildJobsSearchHref(
      "companySearch=Acme&locationSearch=Toronto&careerStage=ENTRY_LEVEL&page=3",
      { locationSearch: "Seattle, WA", page: undefined, sortBy: "newest" },
    ),
    "http://localhost",
  );
  assert.equal(next.searchParams.get("companySearch"), "Acme");
  assert.equal(next.searchParams.get("locationSearch"), "Seattle, WA");
  assert.equal(next.searchParams.get("page"), null);
  assert.equal(next.searchParams.get("careerStage"), "ENTRY_JUNIOR");
});
function matches(row: Row, predicate: unknown): boolean {
  if (!predicate) return true;
  return Object.entries(predicate as Record<string, unknown>).every(
    ([key, value]) => {
      if (key === "AND")
        return (value as unknown[]).every((child) => matches(row, child));
      if (key === "OR")
        return (value as unknown[]).some((child) => matches(row, child));
      const actual = row[key as keyof Row];
      if (value === null || typeof value !== "object") return actual === value;
      const condition = value as {
        contains?: string;
        gte?: number;
        lte?: number;
        notIn?: string[];
        in?: string[];
      };
      if (condition.contains)
        return (
          typeof actual === "string" &&
          actual.toLowerCase().includes(condition.contains.toLowerCase())
        );
      if (condition.notIn)
        return typeof actual === "string" && !condition.notIn.includes(actual);
      if (condition.in)
        return typeof actual === "string" && condition.in.some((value) => value.toLowerCase() === actual.toLowerCase());
      if (typeof actual !== "number") return false;
      return (
        (condition.gte === undefined || actual >= condition.gte) &&
        (condition.lte === undefined || actual <= condition.lte)
      );
    },
  );
}

test("SSR, repeated form fields and API URLs use the same bounded contract", () => {
  const form = new URLSearchParams(
    "workMode=remote&workMode=HYBRID&posted=1d&posted=7d&includeUnknownSalary=on&salaryMin=80000&field=company&q=Acme",
  );
  const record = {
    workMode: ["remote", "HYBRID"],
    posted: ["1d", "7d"],
    includeUnknownSalary: "on",
    salaryMin: "80000",
    field: "company",
    q: "Acme",
  };
  assert.deepEqual(parseJobFilters(form), parseJobFilters(record));
  const result = parseJobFilters(form);
  assert.equal(result.workMode, "REMOTE,HYBRID");
  assert.equal(result.posted, "7d");
  assert.equal(result.includeUnknownSalary, true);
  assert.equal(result.companySearch, "Acme");
  assert.equal(parseJobFilters("page=999999").page, 1000);
  assert.equal(parseJobFilters("page=2abc&salaryMin=12abc").page, 1);
  assert.equal(parseJobFilters("salaryMin=12abc").salaryMin, undefined);
});

test("empty, default and invalid inputs never produce phantom filters", () => {
  for (const query of [
    "",
    "status=LIVE",
    "salaryCurrency=CAD",
    "includeUnknownSalary=on",
    "workMode=bogus&careerStage=wat&posted=banana",
    "hideApplied=false&searchScope=title",
  ]) {
    assert.equal(countActiveJobFilters(parseJobFilters(query)), 0, query);
    assert.equal(normalizeJobsStateQuery(query), "", query);
    assert.equal(hasJobsStateParams(new URLSearchParams(query)), false, query);
  }
  assert.equal(
    countActiveJobFilters(
      parseJobFilters(
        "locationSearch=Toronto%2C+ON&salaryMin=50000&salaryMax=100000&includeUnknownSalary=1",
      ),
    ),
    2,
  );
});

test("URL normalization is idempotent across aliases, multi-selects and saved searches", () => {
  for (const scope of ["title", "company", "location"]) {
    for (const mode of ["remote", "REMOTE,HYBRID", "bad"]) {
      for (const salary of [
        "",
        "salaryMin=95000.50&salaryCurrency=CAD",
        "salaryMin=90000&salaryMax=50000",
      ]) {
        const query = `field=${scope}&q=Toronto&workMode=${mode}&careerStage=ENTRY_LEVEL&function=Software%20Engineering&page=3&${salary}`;
        const once = normalizeJobsStateQuery(query);
        assert.equal(normalizeJobsStateQuery(once), once);
        assert.deepEqual(parseJobFilters(once), parseJobFilters(query));
      }
    }
  }
});

test("Top Picks accepts the same supported keyword, location and experience aliases", () => {
  const input =
    "field=company&q=Acme&workMode=REMOTE&workMode=HYBRID&careerStage=ENTRY_LEVEL&locationSearch=Toronto%2C+ON";
  const jobs = parseJobFilters(input);
  const picks = parseTopPicksFilters(input);
  assert.equal(picks.companySearch, jobs.companySearch);
  assert.equal(picks.workMode, jobs.workMode);
  assert.equal(picks.locationSearch, jobs.locationSearch);
  assert.equal(picks.experienceLevel, jobs.careerStage);
});

test("qualified places use AND, alternative places use OR, and abbreviations never match inside words", () => {
  for (const value of ["ca", "Ca", "CA"]) {
    const california = buildLocationSearchPredicate(value);
    assert.equal(matches({ location: "San Francisco, CA", region: "US" }, california), true);
    assert.equal(matches({ location: "Toronto, Canada", region: "CA" }, california), false);
  }
  assert.deepEqual(
    splitLocationSearchValues("Toronto, ON; Seattle, WA; toronto, ON"),
    ["Toronto, ON", "Seattle, WA"],
  );
  assert.deepEqual(splitLocationSearchValues("Toronto,Montreal"), [
    "Toronto",
    "Montreal",
  ]);
  const where = buildLocationSearchPredicate("Toronto, ON; Seattle, WA");
  assert.equal(
    matches({ location: "Toronto, Ontario, Canada", region: "CA" }, where),
    true,
  );
  assert.equal(
    matches({ location: "Seattle, Washington, US", region: "US" }, where),
    true,
  );
  for (const row of [
    { location: "Ottawa, ON, CA", region: "CA" },
    { location: "London, England", region: "US" },
    { location: "Toronto, OH", region: "US" },
  ]) {
    assert.equal(matches(row, where), false, row.location);
  }
  assert.equal(
    matches(
      { location: "Vancouver, WA", region: "US" },
      buildLocationSearchPredicate("British Columbia"),
    ),
    false,
  );
  assert.equal(
    matches(
      { location: "Boston, MA", region: "US" },
      buildLocationSearchPredicate("ON"),
    ),
    false,
  );
});

test("separate country and city entries retain OR semantics through forms, URLs and Picks", () => {
  assert.equal(parseJobFilters("locationSearch=Canada").searchScope, "title", "a location filter does not take over the keyword input");
  assert.equal(parseJobFilters("searchScope=location&locationSearch=Canada").searchScope, "location", "explicit location search is preserved");
  for (const input of [
    "locationSearch=Canada&locationSearch=United+States",
    { locationSearch: ["Canada", "United States"] },
    "location=Canada&location=United+States",
    "locationSearch=Canada%2C+United+States",
  ]) {
    const parsed = parseJobFilters(input);
    assert.equal(parsed.locationSearch, "Canada;United States");
    assert.equal(parseJobFilters(normalizeJobsStateQuery(input)).locationSearch, parsed.locationSearch);
    assert.equal(parseTopPicksFilters(input).locationSearch, parsed.locationSearch);
  }
  assert.equal(parseJobFilters({ locationSearch: ["Toronto, ON", "Seattle, WA", "toronto, ON"] }).locationSearch, "Toronto, ON;Seattle, WA");
  assert.deepEqual(splitLocationSearchValues("Canada;Toronto;Seattle"), ["Canada", "Toronto", "Seattle"]);
  const predicate = buildLocationSearchPredicate("Canada;Seattle, WA");
  assert.equal(matches({ location: "Iqaluit, NU", region: "CA" }, predicate), true);
  assert.equal(matches({ location: "Seattle, WA", region: "US" }, predicate), true);
  assert.equal(matches({ location: "Boston, MA", region: "US" }, predicate), false);
});

test("country filters include all assigned cities and explicit eligible remote geography, not every remote job", () => {
  const canada = buildLocationSearchPredicate("canada");
  for (const row of [
    { location: "Iqaluit, NU", region: "CA", workMode: "ONSITE" },
    { location: "Toronto", region: "CA", workMode: "HYBRID" },
    { location: "Remote", region: "CA", workMode: "REMOTE" },
    { location: "Remote - Canada", region: null, workMode: "REMOTE" },
    { location: "US & Canada", region: "US", workMode: "REMOTE" },
    { location: "Remote - North America", region: null, workMode: "REMOTE" },
    { location: "Worldwide", region: null, workMode: "REMOTE" },
  ]) assert.equal(matches(row, canada), true, row.location);
  for (const row of [
    { location: "Remote - US", region: "US", workMode: "REMOTE" },
    { location: "Remote", region: null, workMode: "REMOTE" },
    { location: "London, UK", region: null, workMode: "REMOTE" },
    { location: "North America - US only", region: null, workMode: "REMOTE" },
    { location: "Worldwide", region: "US", workMode: "REMOTE" },
    { location: "North America", region: null, workMode: "ONSITE" },
  ]) assert.equal(matches(row, canada), false, row.location);
  assert.equal(matches({ location: "Remote - North America", region: null, workMode: "REMOTE" }, buildLocationSearchPredicate("United States")), true);
  assert.equal(matches({ location: "Remote - Canada", region: "CA", workMode: "REMOTE" }, buildLocationSearchPredicate("United States")), false);
  assert.equal(matches({ location: "Jerusalem", region: null, workMode: "REMOTE" }, buildLocationSearchPredicate("USA")), false);
  assert.equal(matches({ location: "Remote - US", region: null, workMode: "REMOTE" }, buildLocationSearchPredicate("United States")), true);
});

test("annual salary bounds overlap correctly without pretending unknown currencies are USD", () => {
  const where = buildSalaryRangeWhere(
    60000,
    100000,
    "USD",
    FALLBACK_SALARY_EXCHANGE_RATES,
  );
  assert.equal(
    matches(
      { salaryMin: 50000, salaryMax: 80000, salaryCurrency: "USD" },
      where,
    ),
    true,
  );
  assert.equal(
    matches(
      { salaryMin: 120000, salaryMax: 160000, salaryCurrency: "USD" },
      where,
    ),
    false,
  );
  assert.equal(
    matches(
      { salaryMin: null, salaryMax: 90000, salaryCurrency: "USD" },
      where,
    ),
    true,
  );
  assert.equal(
    matches(
      { salaryMin: 80000, salaryMax: 90000, salaryCurrency: null },
      where,
    ),
    false,
  );
  const include = buildSalaryRangeWhere(
    60000,
    100000,
    "USD",
    FALLBACK_SALARY_EXCHANGE_RATES,
    true,
  );
  assert.equal(
    matches(
      { salaryMin: null, salaryMax: null, salaryCurrency: "USD" },
      include,
    ),
    true,
  );
  assert.equal(
    matches(
      { salaryMin: 80000, salaryMax: 90000, salaryCurrency: null },
      include,
    ),
    true,
  );
  assert.equal(
    matches(
      { salaryMin: 120000, salaryMax: 160000, salaryCurrency: "USD" },
      include,
    ),
    false,
  );
});
