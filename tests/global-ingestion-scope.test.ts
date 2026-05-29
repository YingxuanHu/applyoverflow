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

test("normalization accepts legitimate non-North-American onsite jobs", async () => {
  const normalizeSourceJob = await loadNormalizeSourceJob();
  const result = normalizeSourceJob({
    job: buildJob({}),
    fetchedAt: new Date("2026-05-28T12:00:00.000Z"),
  });

  assert.equal(result.kind, "accepted");
  if (result.kind === "accepted") {
    assert.equal(result.job.location, "Warsaw, Poland");
    assert.equal(result.job.region, null);
    assert.equal(result.job.workMode, "ONSITE");
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
