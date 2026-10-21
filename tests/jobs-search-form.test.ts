import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { JobsSearchForm } from "../src/components/jobs/jobs-search-form";
import { appendLocationSearch } from "../src/lib/location-search";

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
  assert.match(html, /name="locationSearch" value="Toronto;Montreal"/);
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

  assert.match(html, /name="locationSearch" value="Toronto;Montreal"/);
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

test("job search keeps drafts separate instead of treating a title as a location", () => {
  const source = readRepoFile("src/components/jobs/jobs-search-form.tsx");

  assert.match(source, /const \[drafts, setDrafts\]/);
  assert.match(source, /function handleScopeChange/);
  assert.match(source, /const draftValue = drafts\[scope\]/);
  assert.doesNotMatch(source, /if \(currentDraft.trim\(\)\) return currentDraft/);
  assert.match(source, /setDraftValue\(event\.target\.value\)/);
  assert.match(source, /value=\{draftValue\}/);
});

test("location is edited only in search and survives other filter submissions", () => {
  for (const path of ["src/app/jobs/page.tsx", "src/app/jobs/top-picks/page.tsx"]) {
    assert.doesNotMatch(readRepoFile(path), /JobsLocationFilter/);
  }
  const html = renderToStaticMarkup(React.createElement(JobsSearchForm, {
    filterFormId: "jobs-filter-form", hiddenFields: [], initialScope: "location",
    initialValues: { ...emptyValues, location: "Canada;Seattle, WA", title: "engineer" },
  }));
  assert.match(html, /form="jobs-filter-form"[^>]*name="locationSearch"[^>]*value="Canada;Seattle, WA"/);
  assert.match(html, /Add a city, province, state or country/);
  assert.match(html, /aria-label="Add a city, province, state or country"[^>]*value=""/);
});

test("location additions preserve qualifiers, alternatives and explicit limits", () => {
  assert.deepEqual(appendLocationSearch("Toronto, ON", "Seattle, WA"), { value: "Toronto, ON;Seattle, WA", error: null });
  assert.deepEqual(appendLocationSearch("Canada", "canada"), { value: "Canada", error: null });
  assert.deepEqual(appendLocationSearch("Canada;Seattle", ""), { value: "Canada;Seattle", error: null });
  const ten = Array.from({ length: 10 }, (_, index) => `Place ${index}`).join(";");
  assert.match(appendLocationSearch(ten, "Another").error ?? "", /up to 10/);
  assert.equal(appendLocationSearch(ten, "Place 0").error, null);
  assert.match(appendLocationSearch("x".repeat(990), "y".repeat(20)).error ?? "", /length limit/);
});

test("job search exposes AI parsing and trailing voice input in the shared search control", () => {
  const source = readRepoFile("src/components/jobs/jobs-search-form.tsx");

  assert.match(source, /\{ label: "AI search", value: "ai" \}/);
  assert.match(source, /\/api\/jobs\/natural-language-search/);
  assert.match(source, /mergeNaturalLanguageJobsSearch\(searchParams, searchResult\.params,/);
  assert.match(source, /SpeechRecognition/);
  assert.match(source, /webkitSpeechRecognition/);
  assert.match(source, /Use voice input/);
});
