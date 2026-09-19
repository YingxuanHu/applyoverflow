import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { ingestConnector } from "../../src/lib/ingestion/pipeline";
import { ConnectorFetchError } from "../../src/lib/ingestion/source-fetch-quality";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import type { SourceConnector, SourceConnectorFetchResult, SourceConnectorJob } from "../../src/lib/ingestion/types";

async function main() {
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), "local database required");
  assert.notEqual(process.env.INGEST_RUN_GLOBAL_DEDUPE_BACKFILL, "1", "no global backfill in fixture tests");
  const token = `pipeline-fixture-${randomUUID()}`;
  const company = `Pipeline Fixture ${token}`;
  const now = new Date();
  const job: SourceConnectorJob = {
    sourceId: "one", sourceUrl: `https://jobs.lever.co/${token}/one`,
    applyUrl: `https://jobs.lever.co/${token}/one`, title: "Marketing Manager", company,
    location: "Toronto, Ontario, Canada", employmentType: "FULL_TIME", workMode: "REMOTE",
    postedAt: now, deadline: null, salaryMin: 100000, salaryMax: 120000, salaryCurrency: "CAD",
    description: "Responsibilities\nLead marketing campaigns and analyze customer research. Work with the sales and product teams to plan launches and improve customer acquisition. Own the annual marketing budget, measure campaign performance, and share recommendations with business stakeholders.\n\nQualifications\nThree years of marketing experience. Strong writing, project management, and data analysis skills. Experience with campaign reporting and customer research.\n\nBenefits\nWe provide health insurance, paid vacation, and professional development support.",
    metadata: {},
  };
  const second = { ...job, sourceId: "two", title: "Customer Success Manager", applyUrl: `https://jobs.lever.co/${token}/two`, sourceUrl: `https://jobs.lever.co/${token}/two` };
  let response: SourceConnectorFetchResult = { jobs: [job, second], exhausted: true };
  let seenCheckpoint: unknown;
  let interruptFetch = false;
  const connector: SourceConnector = {
    key: `lever:${token}`, sourceName: `Lever:${token}`, sourceTier: "TIER_1", freshnessMode: "FULL_SNAPSHOT",
    fetchJobs: async (options) => {
      seenCheckpoint = options.checkpoint;
      await options.onCheckpoint?.({ offset: 999 });
      if (interruptFetch) throw new Error("fixture fetch interrupted");
      return response;
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Fixture test must not fetch a real provider"); };
  const startedAt = performance.now();
  try {
    const firstRun = await ingestConnector(connector);
    assert.equal(firstRun.canonicalCreatedCount, 2);
    const mapping = await prisma.jobSourceMapping.findFirstOrThrow({ where: { sourceName: connector.sourceName, rawJob: { sourceId: "one" } } });
    const id = mapping.canonicalJobId;
    const initialIndex = await prisma.jobFeedIndex.findUniqueOrThrow({ where: { canonicalJobId: id } });
    assert.equal(initialIndex.status, "LIVE");

    const oldEvidence = new Date(now.getTime() - 45 * 86400_000);
    await prisma.jobCanonical.update({ where: { id }, data: {
      status: "STALE", availabilityScore: 0, staleAt: oldEvidence,
      lastSeenAt: oldEvidence, lastSourceSeenAt: oldEvidence, lastConfirmedAliveAt: oldEvidence,
    } });
    await prisma.jobFeedIndex.update({ where: { canonicalJobId: id }, data: { status: "REMOVED" } });
    const refreshed = await ingestConnector(connector);
    assert.equal(refreshed.rawCreatedCount, 0);
    const revived = await prisma.jobCanonical.findUniqueOrThrow({ where: { id } });
    const refreshedIndex = await prisma.jobFeedIndex.findUniqueOrThrow({ where: { canonicalJobId: id } });
    assert.equal(revived.status, "LIVE");
    assert.equal(refreshedIndex.status, "LIVE", "unchanged source refresh immediately restores feed visibility");
    assert.ok(refreshedIndex.indexedAt >= revived.updatedAt, "index must be written after lifecycle changes");

    response = { jobs: [{ ...job, workMode: "ONSITE", employmentType: "CONTRACT" }, second], exhausted: true };
    await ingestConnector(connector);
    const edited = await prisma.jobCanonical.findUniqueOrThrow({ where: { id } });
    assert.equal(edited.workMode, "ONSITE");
    assert.equal(edited.employmentType, "CONTRACT");
    const editedIndex = await prisma.jobFeedIndex.findUniqueOrThrow({ where: { canonicalJobId: id } });
    assert.equal(editedIndex.workMode, "ONSITE");

    response = { jobs: [response.jobs[0]], exhausted: false, metadata: { error: "Detail HTTP 404", partial: true } };
    await assert.rejects(ingestConnector(connector), ConnectorFetchError);
    const failed = await prisma.ingestionRun.findFirstOrThrow({ where: { connectorKey: connector.key }, orderBy: { startedAt: "desc" } });
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.fetchedCount, 1, "partial successes are persisted despite a failed run");
    const metrics = JSON.parse(JSON.stringify(failed.runOptions)).resultMetrics;
    assert.equal(metrics.fetchFailed, true);
    assert.equal(metrics.partialFetch, true);
    assert.equal(await prisma.jobSourceMapping.count({ where: { sourceName: connector.sourceName, removedAt: null } }), 2);

    response = { jobs: [], metadata: { error: "429 Too Many Requests" } };
    await assert.rejects(ingestConnector(connector), /429/);
    assert.equal(await prisma.jobSourceMapping.count({ where: { sourceName: connector.sourceName, removedAt: null } }), 2);

    response = { jobs: [{ ...job, deadline: new Date(now.getTime() - 86400_000) }, second], exhausted: true };
    await ingestConnector(connector);
    assert.equal((await prisma.jobFeedIndex.findUniqueOrThrow({ where: { canonicalJobId: id } })).status, "REMOVED", "closed posting is removed from feed after lifecycle reconciliation");
    response = { jobs: [
      { ...job, sourceId: "three", applyUrl: `https://jobs.lever.co/${token}/three`, sourceUrl: `https://jobs.lever.co/${token}/three` },
      { ...job, sourceId: "broken", postedAt: new Date(NaN) },
    ], exhausted: true };
    await assert.rejects(ingestConnector(connector), /Invalid time value/);
    const partialProgress = await prisma.jobSourceMapping.findFirstOrThrow({ where: { sourceName: connector.sourceName, rawJob: { sourceId: "three" } } });
    assert.equal((await prisma.jobFeedIndex.findUniqueOrThrow({ where: { canonicalJobId: partialProgress.canonicalJobId } })).status, "LIVE", "later row failure must not hold back earlier usable jobs");
    response = { jobs: [job], exhausted: false, checkpoint: { offset: 20 } };
    await ingestConnector(connector);
    interruptFetch = true;
    await assert.rejects(ingestConnector(connector), /fixture fetch interrupted/);
    assert.deepEqual(seenCheckpoint, { offset: 20 });
    const interrupted = await prisma.ingestionRun.findFirstOrThrow({ where: { connectorKey: connector.key }, orderBy: { startedAt: "desc" } });
    assert.deepEqual(JSON.parse(JSON.stringify(interrupted.runOptions)).checkpoint, { offset: 20 });
    interruptFetch = false;
    response = { jobs: [job, { ...job, sourceId: "broken", postedAt: new Date(NaN) }], exhausted: false, checkpoint: { offset: 40 } };
    await assert.rejects(ingestConnector(connector), /Invalid time value/);
    response = { jobs: [job], exhausted: true };
    await ingestConnector(connector);
    assert.deepEqual(seenCheckpoint, { offset: 20 }, "failed batches replay from the last durable position");
    await ingestConnector(connector);
    assert.equal(seenCheckpoint, null, "completed cycle returns to first page");
    console.log(`PASS: ingestion -> raw -> canonical -> feed; unchanged revival, field-only edits, partial/429 safety, closure (${Math.round(performance.now() - startedAt)}ms)`);
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.jobCanonical.deleteMany({ where: { company } });
    await prisma.jobRaw.deleteMany({ where: { sourceName: connector.sourceName } });
    await prisma.ingestionRun.deleteMany({ where: { connectorKey: connector.key } });
    await prisma.company.deleteMany({ where: { name: company } });
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
