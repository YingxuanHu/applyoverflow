import assert from "node:assert/strict";
import test from "node:test";

import {
  hasJobsStateParamsRecord,
  jobsPreferenceValueFromQueryString,
  normalizeJobsStateQuery,
  queryStringFromJobsPreferenceValue,
  resolveJobsStateSource,
} from "../src/lib/jobs/search-state";

test("jobs URL params are detected and normalized for restore", () => {
  assert.equal(hasJobsStateParamsRecord({ titleSearch: "backend" }), true);
  assert.equal(hasJobsStateParamsRecord({ reset: "1" }), false);

  assert.equal(
    normalizeJobsStateQuery(
      "q=backend&field=title&page=3&sort=best&function=software_engineering&datePosted=7d"
    ),
    "searchScope=title&titleSearch=backend&jobFunction=software_engineering&posted=7d&page=3"
  );
});

test("URL state wins over session and saved preferences", () => {
  const saved = jobsPreferenceValueFromQueryString("companySearch=Amazon&sortBy=company");
  const resolved = resolveJobsStateSource({
    savedPreferenceValue: saved,
    sessionQuery: "locationSearch=Toronto&page=2",
    urlParams: { titleSearch: "backend", page: "4" },
  });

  assert.equal(resolved.source, "url");
  assert.equal(resolved.query, "searchScope=title&titleSearch=backend&page=4");
});

test("session state restores before saved preferences when URL is empty", () => {
  const saved = jobsPreferenceValueFromQueryString("companySearch=Amazon&sortBy=company");
  const resolved = resolveJobsStateSource({
    savedPreferenceValue: saved,
    sessionQuery: "locationSearch=Toronto&page=2",
    urlParams: {},
  });

  assert.equal(resolved.source, "session");
  assert.equal(resolved.query, "searchScope=location&locationSearch=Toronto&page=2");
});

test("saved jobs preference restores without old page number", () => {
  const saved = jobsPreferenceValueFromQueryString(
    "titleSearch=engineer&jobFunction=Software%20Engineering,AI%20%2F%20Machine%20Learning&industry=Finance%20%26%20Banking&page=7&sortBy=newest"
  );
  const resolved = resolveJobsStateSource({
    savedPreferenceValue: saved,
    sessionQuery: "",
    urlParams: {},
  });

  assert.equal(resolved.source, "savedPreference");
  assert.equal(
    resolved.query,
    "searchScope=title&titleSearch=engineer&industry=Finance+%26+Banking&jobFunction=Software+Engineering%2CAI+%2F+Machine+Learning&sortBy=newest"
  );
  assert.equal(resolved.query.includes("page="), false);
  assert.equal(queryStringFromJobsPreferenceValue(saved), resolved.query);
});

test("empty or cleared jobs state resolves to default", () => {
  const resolved = resolveJobsStateSource({
    savedPreferenceValue: null,
    sessionQuery: "",
    urlParams: {},
  });

  assert.deepEqual(resolved, { source: "default", query: "" });
});
