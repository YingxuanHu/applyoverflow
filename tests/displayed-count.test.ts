import assert from "node:assert/strict";
import test from "node:test";

import {
  extractDisplayedJobCount,
  isJobCountCompletenessSuspect,
} from "@/lib/ingestion/extraction/displayed-count";

test("matches common job-count phrasings", () => {
  assert.equal(extractDisplayedJobCount("We have 87 open positions across teams."), 87);
  assert.equal(extractDisplayedJobCount("3 open roles"), 3);
  assert.equal(extractDisplayedJobCount("42 open jobs in engineering"), 42);
  assert.equal(extractDisplayedJobCount("12 openings"), 12);
  assert.equal(extractDisplayedJobCount("6 current openings"), 6);
  assert.equal(extractDisplayedJobCount("9 jobs available"), 9);
  assert.equal(extractDisplayedJobCount("14 positions available"), 14);
  assert.equal(extractDisplayedJobCount("View all 156 jobs"), 156);
  assert.equal(extractDisplayedJobCount("231 results"), 231);
  assert.equal(extractDisplayedJobCount("1 open position"), 1);
});

test("is case-insensitive and handles comma thousands separators", () => {
  assert.equal(extractDisplayedJobCount("87 OPEN POSITIONS"), 87);
  assert.equal(extractDisplayedJobCount("1,204 open positions"), 1204);
});

test("matches counts split across inline tags", () => {
  assert.equal(extractDisplayedJobCount("<b>87</b> open positions"), 87);
  assert.equal(
    extractDisplayedJobCount('<span class="count">1,204</span>&nbsp;open&nbsp;positions'),
    1204
  );
});

test("matches pagination totals with ascii and unicode separators", () => {
  assert.equal(extractDisplayedJobCount("Showing 1–20 of 87 jobs"), 87);
  assert.equal(extractDisplayedJobCount("Showing 1-20 of 87 positions"), 87);
  assert.equal(extractDisplayedJobCount("Showing 21&ndash;40 of 342 results"), 342);
  assert.equal(extractDisplayedJobCount("Displaying 1 to 25 of 111 roles"), 111);
});

test("finds the count inside a full page and ignores script noise", () => {
  const html = `
    <html><head><title>Careers at Acme</title>
    <script>var totals = { jobs: 9999 };</script>
    <style>.count { color: red; }</style>
    </head>
    <body>
      <header><nav><a href="/about">About</a></nav></header>
      <p>Join our team of 450 employees across 12 offices.</p>
      <h2><strong>87</strong> open positions</h2>
      <footer>© 2026 Acme Inc · 24/7 support · 401k match</footer>
    </body></html>`;
  assert.equal(extractDisplayedJobCount(html), 87);
});

test("prefers the pagination total over larger standalone phrases", () => {
  assert.equal(
    extractDisplayedJobCount("View all 500 jobs. Showing 1–10 of 87 positions"),
    87
  );
});

test("takes the largest match when only job phrases are present", () => {
  assert.equal(
    extractDisplayedJobCount("Engineering: 12 open roles. Sales: 5 open roles."),
    12
  );
});

test("ignores employee, office, and team-size counts", () => {
  assert.equal(extractDisplayedJobCount("500+ employees and growing"), null);
  assert.equal(extractDisplayedJobCount("a team of 200 builders"), null);
  assert.equal(extractDisplayedJobCount("12 offices worldwide"), null);
});

test("ignores years, benefits, salaries, and unrelated numerics", () => {
  assert.equal(extractDisplayedJobCount("© 2026 Acme Inc. All rights reserved."), null);
  assert.equal(extractDisplayedJobCount("Benefits include 401k match and healthcare"), null);
  assert.equal(extractDisplayedJobCount("$120,000 - $150,000 per year"), null);
  assert.equal(extractDisplayedJobCount("24/7 support for every customer"), null);
  assert.equal(extractDisplayedJobCount("We shipped 42 features this quarter"), null);
  assert.equal(extractDisplayedJobCount("Read our 2026 results and annual report"), null);
});

test("ignores marketing banners and approximate counts", () => {
  assert.equal(extractDisplayedJobCount("10,000+ jobs available on our platform"), null);
  assert.equal(extractDisplayedJobCount("more than 500 jobs available"), null);
  assert.equal(extractDisplayedJobCount("over 800 open positions since launch"), null);
});

test("clamps implausible counts", () => {
  assert.equal(extractDisplayedJobCount("0 open positions"), null);
  assert.equal(extractDisplayedJobCount("25,000 open positions"), null);
  assert.equal(extractDisplayedJobCount("Showing 1–20 of 25,000 results"), null);
  assert.equal(extractDisplayedJobCount("20,000 open positions"), 20000);
});

test("returns null for empty or numberless input", () => {
  assert.equal(extractDisplayedJobCount(""), null);
  assert.equal(extractDisplayedJobCount("<div>Join us! Great culture.</div>"), null);
});

test("does not join numbers to phrases across block boundaries", () => {
  assert.equal(
    extractDisplayedJobCount("<div>Best Workplace 2026</div><h2>Open positions</h2>"),
    null
  );
});

test("completeness suspicion needs a proportionally and absolutely large gap", () => {
  assert.equal(isJobCountCompletenessSuspect(null, 0), false);
  assert.equal(isJobCountCompletenessSuspect(87, 20), true);
  assert.equal(isJobCountCompletenessSuspect(5, 0), true);
  // Absolute gap below 5 never fires, even from zero fetched.
  assert.equal(isJobCountCompletenessSuspect(4, 0), false);
  // Ratio below 1.5x never fires, even with a real gap.
  assert.equal(isJobCountCompletenessSuspect(10, 8), false);
  // Exactly 1.5x but the gap of 4 is too small.
  assert.equal(isJobCountCompletenessSuspect(12, 8), false);
  assert.equal(isJobCountCompletenessSuspect(6, 1), true);
  assert.equal(isJobCountCompletenessSuspect(90, 60), true);
});
