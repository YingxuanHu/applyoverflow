import assert from "node:assert/strict";
import test from "node:test";
import { resolveJobLinks } from "../src/lib/job-links";
import { classifyApplyLinkQuality } from "../src/lib/ingestion/apply-link-quality";
import { isRegistrationGatedBoardUrl } from "../src/lib/jobs/outbound-policy";

const board = "https://weworkremotely.com/remote-jobs/pinterest-data-scientist-ii-ml-infrastructure";
const employer = "https://job-boards.greenhouse.io/pinterest/jobs/1234567";
const mappings = [{ sourceName: "WeWorkRemotely:feed", sourceUrl: board, isPrimary: true }];

test("gated board is not offered as an employer application", () => {
  assert.equal(resolveJobLinks({ applyUrl: board, sourceMappings: mappings }).primaryExternalLink, null);
  const outcome = classifyApplyLinkQuality({ requestedUrl: board, finalUrl: board, statusCode: 200, bodyText: "Data Scientist II, ML Infrastructure. Build and deploy machine learning systems for Pinterest.", title: "Data Scientist II, ML Infrastructure", redirectDepth: 0 });
  assert.equal(outcome.status, "HIDDEN_LOW_QUALITY");
  assert.equal(outcome.isBadForFeed, true);
});

test("direct employer mapping beats the primary board, and ATS sign-in is allowed", () => {
  const links = resolveJobLinks({ applyUrl: board, sourceMappings: [...mappings, { sourceName: "Greenhouse:pinterest", sourceUrl: employer, isPrimary: false }] });
  assert.equal(links.primaryExternalLink?.href, employer);
  assert.equal(isRegistrationGatedBoardUrl("https://company.myworkdayjobs.com/en-US/jobs/login"), false);
  assert.equal(isRegistrationGatedBoardUrl("https://weworkremotely.com.example.test/job"), false);
  assert.equal(resolveJobLinks({ applyUrl: employer, sourceMappings: mappings }).primaryExternalLink?.href, employer);
  // A verified employer mapping supplies provenance for the direct destination.
  assert.equal(resolveJobLinks({ applyUrl: employer, sourceMappings: [{ sourceName: "Greenhouse:pinterest", sourceUrl: employer, isPrimary: true }] }).primaryExternalLink?.href, employer);
});
