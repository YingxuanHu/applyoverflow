import assert from "node:assert/strict";
import test from "node:test";

import {
  extractTitleFromWorkdayUrl,
  isLikelyLocationToken,
} from "../src/lib/ingestion/workday-title-parser";

// ─── isLikelyLocationToken ────────────────────────────────────────────────────

test("isLikelyLocationToken: recognizes the bare city names we keep seeing", () => {
  // The bug: ~200 jobs have title = these city strings (extracted from the
  // wrong URL segment). Whatever fallback we use must treat these as
  // suspect and prefer the URL's title segment instead.
  for (const city of [
    "Montreal",
    "Toronto",
    "New York",
    "Vancouver",
    "Calgary",
    "Boston",
    "Seattle",
    "Chicago",
    "Austin",
    "San Francisco",
  ]) {
    assert.equal(isLikelyLocationToken(city), true, `expected "${city}" to be a location`);
  }
});

test("isLikelyLocationToken: rejects real job titles", () => {
  for (const title of [
    "Software Engineer",
    "Senior Account Executive",
    "Customer Experience Associate",
    "Director, Credit Risk Policy",
    "Investly Business Development Associate",
  ]) {
    assert.equal(isLikelyLocationToken(title), false, `expected "${title}" to look like a title`);
  }
});

test("isLikelyLocationToken: handles the multi-word location forms in Workday URLs", () => {
  // Workday URLs often pre-format the city segment as "Montral-Qubec" or
  // "New-York-New-York" — we get these as "Montral Qubec" / "New York New
  // York" after URL-decoding. They should still trip the detector.
  assert.equal(isLikelyLocationToken("Montral Qubec"), true);
  assert.equal(isLikelyLocationToken("New York New York"), true);
  assert.equal(isLikelyLocationToken("Toronto Office"), true);
});

// ─── extractTitleFromWorkdayUrl ───────────────────────────────────────────────

test("extractTitleFromWorkdayUrl: pulls the slug after the location segment", () => {
  // Real URL from the affected pool.
  const url =
    "https://td.wd3.myworkdayjobs.com/td_bank_careers/job/Montral-Qubec/Customer-Experience-Associate----Future-opportunities----Montreal_R_1421985";
  assert.equal(
    extractTitleFromWorkdayUrl(url),
    "Customer Experience Associate Future opportunities Montreal"
  );
});

test("extractTitleFromWorkdayUrl: strips trailing requisition ID", () => {
  const url =
    "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/Santa-Clara-CA/Senior-Software-Engineer_REQ12345";
  assert.equal(extractTitleFromWorkdayUrl(url), "Senior Software Engineer");
});

test("extractTitleFromWorkdayUrl: handles FIL Toronto case from production data", () => {
  const url =
    "https://fil.wd3.myworkdayjobs.com/fidelitycanada/job/Toronto-Office/Investly-Business-Development-Associate---Toronto_J66968-1";
  assert.equal(
    extractTitleFromWorkdayUrl(url),
    "Investly Business Development Associate Toronto"
  );
});

test("extractTitleFromWorkdayUrl: returns null when URL doesn't match Workday pattern", () => {
  assert.equal(extractTitleFromWorkdayUrl("https://example.com/jobs/123"), null);
  assert.equal(extractTitleFromWorkdayUrl(""), null);
  assert.equal(extractTitleFromWorkdayUrl(null), null);
  assert.equal(extractTitleFromWorkdayUrl(undefined), null);
});

test("extractTitleFromWorkdayUrl: returns null for non-Workday URLs that have a /job/ segment", () => {
  // Real production false-positive from a backfill dry-run: Jobvite URLs
  // have a /job/<token>/apply path that previously matched our regex and
  // produced title="apply". Anchor the extractor to Workday hosts only.
  assert.equal(
    extractTitleFromWorkdayUrl("https://jobs.jobvite.com/venterra/job/o6C6zfw7/apply"),
    null
  );
  assert.equal(
    extractTitleFromWorkdayUrl("https://boards.greenhouse.io/foo/jobs/12345"),
    null
  );
});

test("extractTitleFromWorkdayUrl: tolerates URLs with query strings", () => {
  const url =
    "https://example.wd1.myworkdayjobs.com/external/job/New-York-New-York/Account-Executive--Government_REQ347140-1?source=indeed";
  assert.equal(
    extractTitleFromWorkdayUrl(url),
    "Account Executive Government"
  );
});

test("extractTitleFromWorkdayUrl: collapses repeated hyphens but preserves word boundaries", () => {
  const url =
    "https://example.wd1.myworkdayjobs.com/external/job/Toronto/Senior--Software----Engineer_R1";
  assert.equal(
    extractTitleFromWorkdayUrl(url),
    "Senior Software Engineer"
  );
});
