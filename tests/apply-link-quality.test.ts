import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLY_LINK_VALIDATION_STATUS,
  classifyApplyLinkQuality,
  hasBadApplyLinkValidationStatus,
} from "../src/lib/ingestion/apply-link-quality";

function classify(overrides: Partial<Parameters<typeof classifyApplyLinkQuality>[0]> = {}) {
  return classifyApplyLinkQuality({
    requestedUrl: "https://example.com/jobs/123456/software-engineer",
    finalUrl: "https://example.com/jobs/123456/software-engineer",
    statusCode: 200,
    bodyText:
      "Software Engineer ExampleCo Responsibilities include building APIs and distributed systems. Job ID 123456.",
    title: "Software Engineer",
    company: "ExampleCo",
    redirectDepth: 0,
    ...overrides,
  });
}

test("accepts job-specific apply pages with title or job id evidence", () => {
  const result = classify();

  assert.equal(result.status, APPLY_LINK_VALIDATION_STATUS.ACTIVE);
  assert.equal(result.isBadForFeed, false);
  assert.equal(result.contentMatch.jobIdMatched, true);
});

test("rejects terminal HTTP statuses as broken apply links", () => {
  const result = classify({
    statusCode: 404,
    bodyText: "Not found",
  });

  assert.equal(result.status, APPLY_LINK_VALIDATION_STATUS.BROKEN_APPLY_LINK);
  assert.equal(result.isBadForFeed, true);
});

test("rejects expired job pages", () => {
  const result = classify({
    bodyText: "This job is no longer available. Search jobs to find a similar role.",
  });

  assert.equal(result.status, APPLY_LINK_VALIDATION_STATUS.EXPIRED);
  assert.equal(result.isBadForFeed, true);
});

test("rejects generic company careers pages after a job-specific URL redirects away", () => {
  const result = classify({
    requestedUrl: "https://jobs.canadalife.com/talentcommunity/apply/1388488933/?locale=en_US",
    finalUrl: "https://jobs.canadalife.com/",
    bodyText:
      "Canada Life Careers Search by Keyword Search by Location View all jobs Join our Talent Community",
    title: "Intermediate Data Analyst",
    company: "Canada Life",
    redirectDepth: 2,
  });

  assert.equal(result.status, APPLY_LINK_VALIDATION_STATUS.GENERIC_APPLY_PAGE);
  assert.equal(result.isBadForFeed, true);
  assert.ok(result.contentMatch.genericUrlSignals.includes("root_careers_url"));
});

test("rejects generic search pages with empty keyword and location parameters", () => {
  const result = classify({
    requestedUrl: "https://company.example/jobs/987654/senior-accountant",
    finalUrl: "https://company.example/search/?q=&locationsearch=",
    bodyText: "Search jobs Search by Keyword Search by Location",
    title: "Senior Accountant",
    company: "Company",
    redirectDepth: 1,
  });

  assert.equal(result.status, APPLY_LINK_VALIDATION_STATUS.GENERIC_APPLY_PAGE);
});

test("marks excessive redirects as hidden low quality", () => {
  const result = classify({
    redirectDepth: 9,
    maxRedirectsReached: true,
  });

  assert.equal(result.status, APPLY_LINK_VALIDATION_STATUS.HIDDEN_LOW_QUALITY);
  assert.equal(result.isBadForFeed, true);
});

test("does not mark generic-looking pages bad when strong job-specific evidence remains", () => {
  const result = classify({
    finalUrl: "https://example.com/jobs/search/123456",
    bodyText:
      "Search jobs Software Engineer ExampleCo Job ID 123456 Responsibilities include TypeScript APIs.",
    title: "Software Engineer",
    company: "ExampleCo",
  });

  assert.equal(result.status, APPLY_LINK_VALIDATION_STATUS.ACTIVE);
});

test("bad validation statuses are feed-exclusion statuses", () => {
  assert.equal(hasBadApplyLinkValidationStatus("GENERIC_APPLY_PAGE"), true);
  assert.equal(hasBadApplyLinkValidationStatus("BROKEN_APPLY_LINK"), true);
  assert.equal(hasBadApplyLinkValidationStatus("ACTIVE"), false);
  assert.equal(hasBadApplyLinkValidationStatus("NEEDS_REVALIDATION"), false);
});
