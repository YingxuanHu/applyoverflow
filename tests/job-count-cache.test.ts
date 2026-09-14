import assert from "node:assert/strict";
import test from "node:test";
import { canUseSimpleTextCount, jobCountCacheKey } from "../src/lib/queries/job-count-cache";
import { parseJobFilters } from "../src/lib/jobs/search-params";

test("exact count cache shares pages and sort but retains hard filters and viewer state", () => {
  const key = jobCountCacheKey({ titleSearch: "software", page: 1, sortBy: "newest" }, "u1", 1);
  assert.equal(key, jobCountCacheKey({ sortBy: "company", page: 4, titleSearch: "software" }, "u1", 1));
  assert.notEqual(key, jobCountCacheKey({ titleSearch: "software" }, "u2", 1));
  assert.notEqual(key, jobCountCacheKey({ titleSearch: "software" }, "u1", 2));
  assert.notEqual(key, jobCountCacheKey({ titleSearch: "software", region: "CA" }, "u1", 1));
  assert.notEqual(jobCountCacheKey({ salaryMin: 100000 }, null, 0), jobCountCacheKey({ salaryMin: 100000, includeUnknownSalary: true }, null, 0));
});

test("optimized counts never ignore additional constraints", () => {
  assert.equal(canUseSimpleTextCount({ titleSearch: "software", salaryCurrency: "USD", page: 2 }), true);
  assert.equal(canUseSimpleTextCount({ titleSearch: "software", companySearch: "acme" }), true);
  for (const constraint of [{ region: "CA" }, { hideApplied: true }, { includeUnknownSalary: true }, { salaryMin: 0 }, { status: "EXPIRED" }, { search: "test" }, { source: "Ashby" }]) {
    assert.equal(canUseSimpleTextCount({ titleSearch: "software", ...constraint }), false);
  }
  assert.equal(canUseSimpleTextCount({}), false);
});

test("parsed title and company searches retain the optimized count path", () => {
  for (const query of ["titleSearch=engineer", "companySearch=OpenAI", "locationSearch=Toronto", "titleSearch=engineer&locationSearch=Toronto", "titleSearch=engineer&companySearch=OpenAI&hideApplied=false&page=2"]) {
    assert.equal(canUseSimpleTextCount(parseJobFilters(query, "USD")), true, query);
  }
  for (const query of ["titleSearch=engineer&hideApplied=1", "titleSearch=engineer&salaryMin=100000", "companySearch=OpenAI&region=CA"]) {
    assert.equal(canUseSimpleTextCount(parseJobFilters(query, "USD")), false, query);
  }
});
