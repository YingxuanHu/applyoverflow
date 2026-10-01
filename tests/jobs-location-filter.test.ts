import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JobsLocationFilter } from "../src/components/jobs/jobs-location-filter";

test("locations render as separately removable entries with a blank add input", () => {
  const html = renderToStaticMarkup(React.createElement(JobsLocationFilter, { defaultValue: "Toronto, ON;Seattle, WA;toronto, ON" }));
  assert.equal((html.match(/aria-label="Remove Toronto, ON"/g) ?? []).length, 1);
  assert.match(html, /aria-label="Remove Seattle, WA"/);
  assert.match(html, /aria-label="Add location"/);
  assert.match(html, /name="locationSearch" value="Toronto, ON;Seattle, WA"/);
  assert.match(html, /City, province, state or country/);
});

test("cleared locations submit an explicit empty value so old locations cannot return", () => {
  const html = renderToStaticMarkup(React.createElement(JobsLocationFilter));
  assert.match(html, /name="locationSearch" value=""/);
  assert.doesNotMatch(html, /aria-label="Remove/);
});
