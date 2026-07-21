import assert from "node:assert/strict";
import test from "node:test";

import {
  hasJobsStateParamsRecord,
  normalizeJobsStateQuery,
} from "../src/lib/jobs/search-state";

test("jobs URL params are detected and normalized for restore", () => {
  assert.equal(hasJobsStateParamsRecord({ titleSearch: "backend" }), true);
  assert.equal(hasJobsStateParamsRecord({ hideApplied: "1" }), true);
  assert.equal(hasJobsStateParamsRecord({ reset: "1" }), false);
  assert.equal(hasJobsStateParamsRecord({ searchScope: "title" }), false);
  assert.equal(hasJobsStateParamsRecord({ field: "company" }), false);

  assert.equal(
    normalizeJobsStateQuery(
      "q=backend&field=title&page=3&sort=best&function=software_engineering&datePosted=7d"
    ),
    "searchScope=title&titleSearch=backend&jobFunction=software_engineering&posted=7d&page=3"
  );
  assert.equal(normalizeJobsStateQuery("hideApplied=true"), "hideApplied=1");
});

test("legacy broad search state restores as title keyword search", () => {
  assert.equal(
    normalizeJobsStateQuery("search=thank%20you&searchScope=all&page=2"),
    "searchScope=title&titleSearch=thank+you&page=2"
  );
  assert.equal(
    normalizeJobsStateQuery("q=amazon&field=all"),
    "searchScope=title&titleSearch=amazon"
  );
});

test("in-app restored jobs state omits stale page numbers", () => {
  assert.equal(
    normalizeJobsStateQuery(
      "titleSearch=engineer&jobFunction=Software%20Engineering,AI%20%2F%20Machine%20Learning&industry=Finance%20%26%20Banking&page=7&sortBy=newest",
      { includePage: false }
    ),
    "searchScope=title&titleSearch=engineer&industry=Finance+%26+Banking&jobFunction=Software+Engineering%2CAI+%2F+Machine+Learning&sortBy=newest"
  );
});

test("empty or cleared jobs state normalizes to default", () => {
  assert.equal(normalizeJobsStateQuery("", { includePage: false }), "");
  assert.equal(normalizeJobsStateQuery("reset=1", { includePage: false }), "");
});
