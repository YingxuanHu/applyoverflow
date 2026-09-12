import assert from "node:assert/strict";
import test from "node:test";
import type { SourceConnectorJob } from "../src/lib/ingestion/types";
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@localhost:5432/postgres";

test("raw replay and change detection preserve provider employment and work mode", async () => {
  const { buildRawPayload, rawPayloadsEquivalent } = await import("../src/lib/ingestion/pipeline");
  const { parseSourceConnectorJobFromRawPayload } = await import("../src/lib/ingestion/normalized-records");
  const { normalizeSourceJob } = await import("../src/lib/ingestion/normalize");
  const now = new Date("2026-09-12T12:00:00Z");
  const job: SourceConnectorJob = {
    sourceId: "fixture", title: "Marketing Manager", company: "Fixture", location: "Toronto, ON, CA",
    description: "Manage campaigns", sourceUrl: null, applyUrl: "https://example.com/jobs/fixture",
    employmentType: "FULL_TIME", workMode: "REMOTE", postedAt: now, deadline: null,
    salaryMin: null, salaryMax: null, salaryCurrency: null, metadata: {},
  };
  const connector = { sourceName: "Lever:fixture", freshnessMode: "FULL_SNAPSHOT" as const };
  const original = buildRawPayload(connector, job, now);
  const stored = JSON.parse(JSON.stringify(original));
  const replay = parseSourceConnectorJobFromRawPayload({ sourceName: connector.sourceName, sourceId: job.sourceId, rawPayload: stored });
  assert.equal(replay?.workMode, "REMOTE");
  assert.equal(replay?.employmentType, "FULL_TIME");
  const normalized = normalizeSourceJob({ job: replay, fetchedAt: now, sourceName: connector.sourceName });
  assert.equal(normalized.kind, "accepted");
  assert.deepEqual(
    normalized,
    normalizeSourceJob({ job, fetchedAt: now, sourceName: connector.sourceName }),
    "the staged record and direct ingestion must use the same normalized facts"
  );
  assert.equal(rawPayloadsEquivalent(stored, buildRawPayload(connector, job, new Date(now.getTime() + 1000))), true);
  assert.equal(rawPayloadsEquivalent(stored, buildRawPayload(connector, { ...job, workMode: "ONSITE" }, now)), false);
  assert.equal(rawPayloadsEquivalent(stored, buildRawPayload(connector, { ...job, employmentType: "CONTRACT" }, now)), false);
});
