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

test("rejects generic careers pages even when they repeat title words", () => {
  const result = classify({
    requestedUrl: "https://iongroup.com/careers/",
    finalUrl: "https://iongroup.com/careers/",
    bodyText:
      "It starts with opportunity. Explore opportunities. Search our open positions and join our talent community.",
    title: "It starts with opportunity",
    company: "ION Group",
    redirectDepth: 0,
  });

  assert.equal(result.status, APPLY_LINK_VALIDATION_STATUS.GENERIC_APPLY_PAGE);
  assert.equal(result.isBadForFeed, true);
  assert.ok(result.contentMatch.genericUrlSignals.includes("generic_careers_path"));
});

test("rejects talent-community apply URLs that redirect to a generic careers root", () => {
  const result = classify({
    requestedUrl: "https://jobs.aecon.com/talentcommunity/apply/602588617/?locale=en_US",
    finalUrl: "https://jobs.aecon.com/",
    bodyText:
      "Position Title: Co-op Engineering Student. Engineering. Students. Search by Keyword Search by Location View All Jobs Join our Talent Community.",
    title: "Position Title: Co-op Engineering Student",
    company: "Aecon",
    redirectDepth: 1,
  });

  assert.equal(result.status, APPLY_LINK_VALIDATION_STATUS.GENERIC_APPLY_PAGE);
  assert.equal(result.isBadForFeed, true);
  assert.ok(result.contentMatch.genericUrlSignals.includes("job_specific_path_lost_after_redirect"));
});

test("rejects ATS job URLs that redirect back to a company board without the job id", () => {
  const result = classify({
    requestedUrl: "https://job-boards.greenhouse.io/stackadapt/jobs/4245432009",
    finalUrl: "https://job-boards.greenhouse.io/stackadapt?error=true",
    bodyText:
      "StackAdapt Careers Senior Software Engineer Marketing Engineer Product Designer Open roles.",
    title: "Senior Software Engineer, Creatives",
    company: "StackAdapt",
    redirectDepth: 1,
  });

  assert.equal(result.status, APPLY_LINK_VALIDATION_STATUS.GENERIC_APPLY_PAGE);
  assert.equal(result.isBadForFeed, true);
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

test("a retained job URL cannot confirm a generic page or JavaScript shell", () => {
  for (const bodyText of [
    "Welcome to ExampleCo. Sign in to your account to continue. Enable JavaScript and accept cookies to use this website.",
    '<html><head><link rel="canonical" href="https://example.com/jobs/123456/software-engineer"></head><body>Welcome to ExampleCo. Sign in to your account to continue. Enable JavaScript and accept cookies to use this website.</body></html>',
  ]) {
    const result = classify({ bodyText });
    assert.equal(result.contentMatch.jobIdMatched, false);
    assert.equal(result.status, APPLY_LINK_VALIDATION_STATUS.NEEDS_REVALIDATION);
  }
  assert.equal(classify({ bodyText: "Search by keyword. Search by location. View all jobs. Join our talent community to receive job alerts." }).status,
    APPLY_LINK_VALIDATION_STATUS.GENERIC_APPLY_PAGE);
});

test("redirect identities, tracking IDs and partial ID matches are not posting evidence", () => {
  for (const overrides of [
    { finalUrl: "https://example.com/jobs/987654", bodyText: "Requisition 987654. Accountant ExampleCo. Prepare financial reports and reconcile accounts with our team." },
    { requestedUrl: "https://example.com/roles/developer?utm_campaign=987654", bodyText: "Welcome to our website. Campaign 987654. Find career opportunities and read more about our company and products." },
    { bodyText: "Welcome to our website. Reference 1234567. Find career opportunities and read more about our company and products." },
  ]) {
    const result = classify(overrides);
    assert.equal(result.contentMatch.jobIdMatched, false);
    assert.notEqual(result.status, APPLY_LINK_VALIDATION_STATUS.ACTIVE);
  }
});

test("job-specific title content still confirms postings without a printed requisition ID", () => {
  const result = classify({ bodyText: "Software Engineer at ExampleCo. Build distributed services, maintain APIs, and collaborate with our product team." });
  assert.equal(result.contentMatch.jobIdMatched, false);
  assert.equal(result.status, APPLY_LINK_VALIDATION_STATUS.ACTIVE);
});

test("UUID posting identities must match in full", () => {
  const requestedUrl = "https://jobs.example.com/co/12345678-abcd-1234-abcd-123456789012";
  const bodyText = "Requisition 12345678-abcd-1234-abcd-123456789012. Build APIs and distributed systems with our engineering team.";
  assert.equal(classify({ requestedUrl, finalUrl: requestedUrl, bodyText }).contentMatch.jobIdMatched, true);
  assert.equal(classify({ requestedUrl, finalUrl: requestedUrl, bodyText: bodyText.replace("12345678-abcd-1234-abcd-123456789012", "12345678") }).contentMatch.jobIdMatched, false);
});

test("an unrendered embedded application is unverified, not a confirmed generic redirect", () => {
  const result = classify({
    requestedUrl: "https://example.com/careers/?gh_jid=123456",
    finalUrl: "https://example.com/careers/?gh_jid=123456",
    bodyText: "Explore our careers. Search by keyword. Search by location. View all jobs. Join our talent community.",
  });
  assert.equal(result.status, APPLY_LINK_VALIDATION_STATUS.NEEDS_REVALIDATION);
  assert.equal(result.isBadForFeed, false);
  assert.equal(result.contentMatch.jobIdMatched, false);
});
