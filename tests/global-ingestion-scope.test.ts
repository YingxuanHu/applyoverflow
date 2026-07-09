import assert from "node:assert/strict";
import test from "node:test";
import type { SourceConnectorJob } from "../src/lib/ingestion/types";

process.env.DATABASE_URL ??= "postgresql://unit:test@localhost:5432/unit";

function buildJob(overrides: Partial<SourceConnectorJob>): SourceConnectorJob {
  return {
    sourceId: "source:1",
    sourceUrl: "https://example.com/jobs/1",
    title: "Retail Store Manager",
    company: "Example Retail",
    location: "Warsaw, Poland",
    description:
      "Job description. Responsibilities include leading store operations, hiring, scheduling, customer service, inventory management, and team development. Requirements include prior retail leadership experience.",
    applyUrl: "https://example.com/jobs/1/apply",
    postedAt: new Date("2026-05-27T12:00:00.000Z"),
    deadline: null,
    employmentType: "FULL_TIME",
    workMode: "ONSITE",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    metadata: {},
    ...overrides,
  };
}

async function loadNormalizeSourceJob() {
  const normalizeModule = await import("../src/lib/ingestion/normalize");
  return normalizeModule.normalizeSourceJob;
}

test("normalization rejects clearly non-North-American onsite jobs", async () => {
  // NA-only product scope: region-less jobs whose location explicitly names
  // a non-NA geography are rejected at intake (see
  // isClearlyNonNorthAmericanLocation in src/lib/geo-scope.ts).
  const normalizeSourceJob = await loadNormalizeSourceJob();
  const result = normalizeSourceJob({
    job: buildJob({}),
    fetchedAt: new Date("2026-05-28T12:00:00.000Z"),
  });

  assert.deepEqual(result, {
    kind: "rejected",
    reason: "out_of_scope_geography",
  });
});

test("normalization keeps ambiguous region-less locations eligible", async () => {
  const normalizeSourceJob = await loadNormalizeSourceJob();
  const result = normalizeSourceJob({
    job: buildJob({ location: "Remote", workMode: "REMOTE" }),
    fetchedAt: new Date("2026-05-28T12:00:00.000Z"),
  });

  assert.equal(result.kind, "accepted");
});

test("normalization keeps global jobs applyable while still rejecting junk URLs", async () => {
  const normalizeSourceJob = await loadNormalizeSourceJob();
  const result = normalizeSourceJob({
    job: buildJob({
      sourceId: "source:2",
      applyUrl: "not-a-url",
    }),
    fetchedAt: new Date("2026-05-28T12:00:00.000Z"),
  });

  assert.deepEqual(result, {
    kind: "rejected",
    reason: "invalid_apply_url",
  });
});

test("future normalization uses context-aware experience extraction", async () => {
  const normalizeSourceJob = await loadNormalizeSourceJob();
  const result = normalizeSourceJob({
    job: buildJob({
      sourceId: "source:3",
      sourceUrl: "https://example.com/jobs/product-manager",
      applyUrl: "https://example.com/jobs/product-manager/apply",
      title: "Product Manager",
      location: "Toronto, ON",
      description:
        "Own product discovery and roadmap delivery for a customer-facing platform. Requirements include 7+ years of product management experience, strong cross-functional execution, and no direct reports for this individual contributor role.",
    }),
    fetchedAt: new Date("2026-05-28T12:00:00.000Z"),
  });

  assert.equal(result.kind, "accepted");
  if (result.kind === "accepted") {
    assert.equal(result.job.normalizedCareerStage, "SENIOR");
    assert.equal(result.job.experienceLevelGroup, "SENIOR_LEAD_STAFF");
    assert.equal(result.job.experienceLevelSource, "years_required");
    assert.notEqual(result.job.experienceLevelGroup, "MANAGER_DIRECTOR_EXECUTIVE");
    assert.ok(Array.isArray(result.job.experienceLevelEvidenceJson));
  }
});

test("future normalization keeps account executive out of executive group", async () => {
  const normalizeSourceJob = await loadNormalizeSourceJob();
  const result = normalizeSourceJob({
    job: buildJob({
      sourceId: "source:4",
      sourceUrl: "https://example.com/jobs/account-executive",
      applyUrl: "https://example.com/jobs/account-executive/apply",
      title: "Account Executive",
      location: "Remote - Canada",
      description:
        "Manage a sales pipeline, qualify customer needs, and close new business. Requirements include 2+ years of sales experience and strong communication skills.",
    }),
    fetchedAt: new Date("2026-05-28T12:00:00.000Z"),
  });

  assert.equal(result.kind, "accepted");
  if (result.kind === "accepted") {
    assert.notEqual(result.job.normalizedCareerStage, "EXECUTIVE");
    assert.notEqual(result.job.experienceLevelGroup, "MANAGER_DIRECTOR_EXECUTIVE");
  }
});
