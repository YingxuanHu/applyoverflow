import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PaginationControls } from "../src/components/navigation/pagination-controls";
import { JobsSearchCountHeadline } from "../src/components/jobs/jobs-search-count";
import { JobsSectionTabs } from "../src/components/jobs/jobs-section-tabs";

const pagination = {
  ariaLabel: "Jobs pagination",
  basePath: "/jobs",
  currentPage: 1,
  getPageHref: (page: number) => `/jobs?page=${page}`,
  hasNextPage: true,
  searchParams: { titleSearch: "engineer", workMode: ["REMOTE", "HYBRID"], page: "1" },
  totalPages: null,
};

test("compact pagination keeps accessible arrows before the adjacent page form", () => {
  const html = renderToStaticMarkup(createElement(PaginationControls, pagination));
  assert.match(html, /disabled="" aria-label="Previous page"/);
  assert.match(html, /aria-label="Next page"/);
  assert.ok(html.indexOf('aria-label="Next page"') < html.indexOf('<form'));
  assert.doesNotMatch(html, />Previous<|>Next</);
  assert.match(html, /name="titleSearch" value="engineer"/);
  assert.match(html, /name="workMode" value="REMOTE"/);
  assert.match(html, /name="workMode" value="HYBRID"/);
  assert.equal((html.match(/name="page"/g) ?? []).length, 1);
});

test("page jump IDs are unique across placements and errors remain accessible", () => {
  const top = renderToStaticMarkup(createElement(PaginationControls, { ...pagination, placement: "top", totalPages: 8, pageError: "Choose a page from 1 to 8" }));
  const bottom = renderToStaticMarkup(createElement(PaginationControls, { ...pagination, placement: "bottom" }));
  assert.match(top, /id="jobs-pagination-top-page"/);
  assert.match(bottom, /id="jobs-pagination-bottom-page"/);
  assert.match(top, /max="8"/);
  assert.match(top, /aria-describedby="jobs-pagination-top-page-error"/);
  assert.match(top, /role="alert"/);
});

test("unresolved counts do not render an oversized counting/loading headline", () => {
  const html = renderToStaticMarkup(createElement(JobsSearchCountHeadline, { scoped: true, liveJobCount: 1000 }));
  assert.match(html, />Search results<\/h2>/);
  assert.doesNotMatch(html, /Counting matches|animate-spin|1,000/);
  assert.match(html, /Retry matching total/);
});

test("workspace navigation keeps both views discoverable with current-page semantics", () => {
  const html = renderToStaticMarkup(createElement(JobsSectionTabs, { active: "top-picks" }));
  assert.match(html, /href="\/jobs"/);
  assert.match(html, /href="\/jobs\/top-picks"/);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Full searchable|Ranked matches/);
});

test("icon-triggered menus size to their content rather than the trigger", () => {
  const source = readFileSync(new URL("../src/components/ui/dropdown-menu.tsx", import.meta.url), "utf8");
  assert.match(source, /w-max/);
  assert.match(source, /max-w-\[calc\(100vw-2rem\)\]/);
  assert.doesNotMatch(source, /w-\(--anchor-width\)/);
});
