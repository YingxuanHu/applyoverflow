import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { JobsSearchForm } from "../src/components/jobs/jobs-search-form";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

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

test("submitting a scoped job search preserves other active scoped searches", () => {
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
  assert.match(html, /Search job titles by keyword/);
  assert.doesNotMatch(html, />All</);
  assert.doesNotMatch(html, /name="search" value="amazon"/);
  assert.doesNotMatch(html, /name="companySearch"/);
  assert.doesNotMatch(html, /name="locationSearch"/);
});

test("submitting a new company search keeps the existing title search as a second filter", () => {
  const html = renderToStaticMarkup(
    React.createElement(JobsSearchForm, {
      hiddenFields: [],
      initialScope: "company",
      initialValues: {
        ...emptyValues,
        title: "backend",
        company: "OpenAI",
      },
    })
  );

  assert.match(html, /name="companySearch" value="OpenAI"/);
  assert.match(html, /name="titleSearch" value="backend"/);
});

test("job search keeps the visible draft when switching search scopes", () => {
  const source = readRepoFile("src/components/jobs/jobs-search-form.tsx");

  assert.match(source, /const \[draftValue, setDraftValue\]/);
  assert.match(source, /function handleScopeChange/);
  assert.match(source, /currentDraft\.trim\(\) \? currentDraft : committedValues\[nextScope\]/);
  assert.match(source, /onChange=\{\(event\) => setDraftValue\(event\.target\.value\)\}/);
  assert.match(source, /value=\{draftValue\}/);
});
