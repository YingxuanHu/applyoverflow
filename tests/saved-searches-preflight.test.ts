import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanSavedQuery,
  parseDiscoveredSince,
  savedSearchHref,
} from "../src/lib/jobs/saved-searches";
import { buildApplicationPreflight } from "../src/lib/jobs/application-preflight";

test("named searches retain keywords but remove page, transient state and arbitrary destinations", () => {
  const query = new URLSearchParams(
    cleanSavedQuery(
      "titleSearch=accountant&region=CA&page=8&discoveredSince=2026-01-01&redirect=https://bad.test&salaryMin=80000&salaryCurrency=CAD",
    ),
  );
  assert.equal(query.get("titleSearch"), "accountant");
  assert.equal(query.get("region"), "CA");
  assert.equal(query.get("page"), null);
  assert.equal(query.get("discoveredSince"), null);
  assert.equal(query.get("redirect"), null);
  const href = savedSearchHref(
    {
      id: "one",
      name: "test",
      query: query.toString(),
      reviewedAt: "2026-01-01T00:00:00.000Z",
    },
    true,
  );
  assert.equal(
    new URL(href, "https://local.test").searchParams.get("discoveredSince"),
    "2026-01-01T00:00:00.000Z",
  );
  assert.equal(parseDiscoveredSince("invalid"), undefined);
  assert.equal(parseDiscoveredSince("2999-01-01T00:00:00Z"), undefined);
});
test("preflight flags changed resumes, duplicate applications, and required documents without claiming verification", () => {
  const checks = buildApplicationPreflight({
    resume: {
      label: "Finance resume",
      content: "Test",
      updatedAt: new Date("2026-01-03"),
    },
    packageUpdatedAt: new Date("2026-01-01"),
    email: null,
    workAuthorization: null,
    confirmedAt: null,
    sourceSeenAt: null,
    previousApplicationId: "one",
    description: "Please attach a cover letter.",
    hasCoverLetter: false,
  });
  assert.equal(
    checks.find((check) => check.label === "Resume")?.status,
    "review",
  );
  assert.equal(
    checks.find((check) => check.label === "Previous application")?.status,
    "review",
  );
  assert.equal(
    checks.find((check) => check.label === "Cover letter")?.status,
    "missing",
  );
  assert.equal(
    checks.find((check) => check.label === "Contact email")?.status,
    "missing",
  );
  assert.equal(
    checks.find((check) => check.label === "Claims and answers")?.status,
    "review",
  );
});

test("optional cover letters are not presented as missing required documents", () => {
  for (const description of [
    "A cover letter is not required.",
    "A cover letter is optional, but a resume is required.",
    "Please do not submit a cover letter.",
  ]) {
    const checks = buildApplicationPreflight({
      resume: null,
      packageUpdatedAt: null,
      email: null,
      workAuthorization: null,
      confirmedAt: null,
      sourceSeenAt: null,
      previousApplicationId: null,
      description,
      hasCoverLetter: false,
    });
    assert.equal(
      checks.find((check) => check.label === "Cover letter")?.status,
      "review",
      description,
    );
  }
});
