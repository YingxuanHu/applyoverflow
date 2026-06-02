import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { JobsSearchForm } from "../src/components/jobs/jobs-search-form";

const emptyValues = {
  all: "",
  title: "",
  company: "",
  location: "",
};

test("scoped job search does not preserve stale everything-search terms", () => {
  const html = renderToStaticMarkup(
    React.createElement(JobsSearchForm, {
      hiddenFields: [],
      initialScope: "title",
      initialValues: {
        ...emptyValues,
        all: "amazon",
        title: "engineer",
      },
    })
  );

  assert.match(html, /name="titleSearch"/);
  assert.doesNotMatch(html, /name="search" value="amazon"/);
});

test("submitting a scoped job search does not carry stale other scoped searches", () => {
  const html = renderToStaticMarkup(
    React.createElement(JobsSearchForm, {
      hiddenFields: [],
      initialScope: "title",
      initialValues: {
        all: "ignored global text",
        title: "engineer",
        company: "Amazon",
        location: "Toronto,toronto,Montreal",
      },
    })
  );

  assert.match(html, /name="titleSearch"/);
  assert.doesNotMatch(html, /name="companySearch" value="Amazon"/);
  assert.doesNotMatch(html, /name="locationSearch" value="Toronto,Montreal"/);
  assert.doesNotMatch(html, /name="search" value="ignored global text"/);
});

test("location search keeps location OR additions without duplicate values", () => {
  const html = renderToStaticMarkup(
    React.createElement(JobsSearchForm, {
      hiddenFields: [],
      initialScope: "location",
      initialValues: {
        ...emptyValues,
        location: "Toronto,toronto,Montreal",
      },
    })
  );

  assert.match(html, /name="locationSearch" value="Toronto,Montreal"/);
  assert.match(html, /name="searchScope" value="location"/);
});

test("legacy all scope is rendered as title keyword search", () => {
  const html = renderToStaticMarkup(
    React.createElement(JobsSearchForm, {
      hiddenFields: [],
      initialScope: "all",
      initialValues: {
        all: "amazon",
        title: "engineer",
        company: "",
        location: "",
      },
    })
  );

  assert.match(html, /name="titleSearch"/);
  assert.match(html, /Search job title by keyword/);
  assert.doesNotMatch(html, />All</);
  assert.doesNotMatch(html, /name="search" value="amazon"/);
  assert.doesNotMatch(html, /name="companySearch"/);
  assert.doesNotMatch(html, /name="locationSearch"/);
});
