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

test("scoped job searches can still combine title, company, and location", () => {
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
  assert.match(html, /name="companySearch" value="Amazon"/);
  assert.match(html, /name="locationSearch" value="Toronto,Montreal"/);
  assert.doesNotMatch(html, /name="search" value="ignored global text"/);
});

test("all scope submits a global search without stale scoped fields", () => {
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

  assert.match(html, /name="search"/);
  assert.match(html, />All</);
  assert.doesNotMatch(html, />Everything</);
  assert.doesNotMatch(html, /name="titleSearch"/);
  assert.doesNotMatch(html, /name="companySearch"/);
  assert.doesNotMatch(html, /name="locationSearch"/);
});
