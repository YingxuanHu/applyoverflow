import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildEligibilityDraft } from "../src/lib/ingestion/classify";
import type { NormalizedJobInput } from "../src/lib/ingestion/types";

function makeJob(overrides: Partial<NormalizedJobInput> = {}): NormalizedJobInput {
  return {
    title: "Software Engineer",
    company: "Example Co",
    companyKey: "example-co",
    titleKey: "software-engineer",
    titleCoreKey: "software-engineer",
    descriptionFingerprint: "fingerprint",
    location: "Toronto, Ontario, Canada",
    locationKey: "toronto-ontario-canada",
    region: "CA",
    workMode: "HYBRID",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    employmentType: "FULL_TIME",
    experienceLevel: "MID",
    description: "Build product features with TypeScript and React.",
    shortSummary: "Build product features with TypeScript and React.",
    industry: "TECH",
    roleFamily: "SWE",
    applyUrl: "https://boards.greenhouse.io/example/jobs/123",
    applyUrlKey: "boards.greenhouse.io/example/jobs/123",
    postedAt: new Date("2026-05-26T12:00:00Z"),
    deadline: null,
    duplicateClusterId: "cluster",
    ...overrides,
  };
}

test("eligibility only marks implemented ATS fillers as auto-submit ready", () => {
  const greenhouse = buildEligibilityDraft({
    sourceName: "Greenhouse:Example",
    job: makeJob(),
  });
  assert.equal(greenhouse.submissionCategory, "AUTO_SUBMIT_READY");

  const workday = buildEligibilityDraft({
    sourceName: "Workday:Example",
    job: makeJob({
      applyUrl: "https://example.wd1.myworkdayjobs.com/en-US/jobs/job/Toronto/Engineer_JR123",
      applyUrlKey: "example.wd1.myworkdayjobs.com/en-us/jobs/job/toronto/engineer_jr123",
    }),
  });
  assert.equal(workday.submissionCategory, "MANUAL_ONLY");
  assert.match(workday.reasonDescription, /manual/i);
});

test("auto-apply API only exposes real submit mode and syncs successful submissions to Applications", () => {
  const routeSource = readFileSync(
    new URL("../src/app/api/jobs/[id]/auto-apply/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(routeSource, /VALID_MODES:[\s\S]*\["fill_and_submit"\]/);
  assert.doesNotMatch(routeSource, /"fill_only",\s*"fill_and_submit"/);
  assert.match(routeSource, /syncTrackedApplicationFromSubmission\(jobId\)/);
  assert.match(routeSource, /saveJob\(jobId,\s*"APPLIED"\)/);
});
