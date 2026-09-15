import assert from "node:assert/strict";
import test from "node:test";
import type { SourceConnectorJob } from "../src/lib/ingestion/types";

process.env.DATABASE_URL ??= "postgresql://unit:test@localhost:5432/unit";

function buildJob(overrides: Partial<SourceConnectorJob>): SourceConnectorJob {
  return {
    sourceId: "source:1",
    sourceUrl: "https://example.com/jobs/1",
    title: "Operations Manager",
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

test("normalization rejects excluded frontline and manual roles even when remote", async () => {
  const normalizeSourceJob = await loadNormalizeSourceJob();
  const excludedTitles = [
    "Forklift Operator II",
    "Grocery Clerk Part Time Day",
    "Salad Bar Clerk",
    "HMR Clerk Part Time Evening",
    "310T Apprentice Mechanic",
    "Retail Store Manager",
  ];

  for (const [index, title] of excludedTitles.entries()) {
    const result = normalizeSourceJob({
      job: buildJob({
        sourceId: `excluded:${index}`,
        title,
        location: "Remote - Canada",
        workMode: "REMOTE",
      }),
      fetchedAt: new Date("2026-05-28T12:00:00.000Z"),
    });

    assert.deepEqual(result, {
      kind: "rejected",
      reason: "out_of_scope_role",
    });
  }
});

test("normalization preserves white-collar GENERAL roles", async () => {
  const normalizeSourceJob = await loadNormalizeSourceJob();
  const result = normalizeSourceJob({
    job: buildJob({
      sourceId: "general:1",
      title: "People Operations Manager",
      location: "Toronto, ON, CA",
    }),
    fetchedAt: new Date("2026-05-28T12:00:00.000Z"),
  });

  assert.equal(result.kind, "accepted");
});

test("intake preserves non-clinical healthcare and public-sector administration", async () => {
  const normalizeSourceJob = await loadNormalizeSourceJob();
  for (const title of ["Pharmacy Benefits Analyst", "Dental Billing Specialist", "Police Records Clerk", "Hospital Revenue Cycle Manager"]) {
    const result = normalizeSourceJob({ job: buildJob({ title, location: "Toronto, ON, CA" }), fetchedAt: new Date() });
    assert.equal(result.kind, "accepted", title);
  }
});

test("occupation scope distinguishes professional roles from their industry", async () => {
  const { isExcludedJobTitle } = await import("../src/lib/ingestion/normalize");
  for (const title of ["SQL Server DBA", "Server Engineer", "Pharmacy Data Analyst", "Dental Office Manager", "Education Administrator", "Healthcare Administration Director", "Clinical Research Associate", "Hospitality Revenue Analyst"]) {
    assert.equal(isExcludedJobTitle(title), false, title);
  }
  for (const title of ["Registered Nurse", "Nurse Manager", "Restaurant Server", "Retail Store Manager", "Forklift Operator"]) {
    assert.equal(isExcludedJobTitle(title), true, title);
  }
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
