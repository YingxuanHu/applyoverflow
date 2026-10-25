import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "../src/generated/prisma/client";
import { buildPublicFeedQualityQuery, collectPublicFeedQuality, summarizePublicFeed, validateFeedQualityConfig, type FeedQualityConfig, type QualityRow } from "../scripts/lib/public-feed-quality";
import { loadPublicFeedContract } from "../scripts/lib/public-feed-query-contract";

const now = new Date("2026-10-25T12:00:00.000Z");
const config: FeedQualityConfig = {
  environment: "local", isolatedSyntheticData: true, noProductionInfrastructure: true,
  allowedDatabaseTarget: "postgresql://127.0.0.1:5439/launch_evidence_fixture_test",
  mode: "census", sampleLimit: 100, statementTimeoutMs: 1000,
  thresholds: { maxStaleSourceRate: 0.15, minRoleCoverage: 0.9, maxMissingEligibilityRate: 0, minPublicRows: 1 },
};
const contract = loadPublicFeedContract();

test("adapter consumes the production query declarations and fails on missing dependencies", () => {
  const source = readFileSync(new URL("../src/lib/queries/jobs.ts", import.meta.url), "utf8");
  assert.match(source, /WHERE \$\{buildRawDefaultPublicFeedWhere\(now, viewerProfileId\)\}/);
  assert.match(source, /normalizedRoleCategoryConfidence: \{ gte: ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD \},\s*classificationStatus: \{ in: \[\.\.\.FILTERABLE_CLASSIFICATION_STATUSES\] \}/);
  assert.throws(() => loadPublicFeedContract(source.replace("function buildRawDefaultPublicFeedWhere", "function renamedPredicate")), /PUBLIC_QUERY_CONTRACT_CHANGED/);
  assert.throws(() => loadPublicFeedContract(source.replaceAll("${buildRawDefaultPublicFeedWhere(now, viewerProfileId)}", "${someOtherPredicate(now, viewerProfileId)}")), /PUBLIC_QUERY_CONSUMER_CHANGED/);
  const changed = loadPublicFeedContract(source.replace("const recentSourceCutoff = new Date(now.getTime() - 14", "const recentSourceCutoff = new Date(now.getTime() - 13"));
  assert.notDeepEqual(changed.where(now).values, contract.where(now).values);
  assert.notEqual(changed.predicateSha256, contract.predicateSha256);
  assert.equal(contract.sourceSha256.length, 64);
});

test("feed config bounds, dedicated target and no empty denominator success", () => {
  const url = "postgresql://fixture:secret@127.0.0.1:5439/launch_evidence_fixture_test";
  validateFeedQualityConfig(config, url);
  assert.throws(() => validateFeedQualityConfig({ ...config, sampleLimit: 5001 }, url));
  assert.throws(() => validateFeedQualityConfig({ ...config, statementTimeoutMs: 25_001 }, url));
  const empty = summarizePublicFeed([], config, now, contract, 1);
  assert.equal(empty.publicPoolCount, 0);
  assert.equal(empty.passed, false);
  assert.equal(empty.rates.roleCoverage, null);
});

test("read-only and query timeouts precede the only report query; failures propagate", async () => {
  const calls: string[] = [];
  const db = {
    async $executeRaw(strings: TemplateStringsArray) { calls.push(strings.join("?")); return 0; },
    async $queryRaw() { calls.push("query"); return []; },
  } as unknown as Pick<Prisma.TransactionClient, "$executeRaw" | "$queryRaw">;
  await collectPublicFeedQuality(db, config, now);
  assert.deepEqual(calls.map((value) => value.split(" ")[0]), ["SET", "SELECT", "SET", "SET", "query"]);
  assert.match(calls[0], /READ ONLY/);
  assert.match(calls[1], /statement_timeout/);
  assert.match(calls[2], /lock_timeout/);
  await assert.rejects(collectPublicFeedQuality({ ...db, $queryRaw: () => { throw new Error("timeout"); } } as typeof db, config, now), /timeout/);
});

test("independent PostgreSQL fixture verifies public denominator, boundaries, labels and status", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TYPE "JobStatus" AS ENUM ('LIVE', 'EXPIRED', 'REMOVED');
      CREATE TABLE "JobCanonical" (
        id text PRIMARY KEY, company text DEFAULT 'Synthetic Company', "applyUrl" text DEFAULT 'https://example.test/job',
        status "JobStatus" DEFAULT 'LIVE', "availabilityScore" float DEFAULT 60,
        "deadSignalAt" timestamp, "applyUrlValidationStatus" text, deadline timestamp,
        "lastSourceSeenAt" timestamp DEFAULT '2026-10-25 12:00:00', "lastConfirmedAliveAt" timestamp,
        "postedAt" timestamp DEFAULT '2026-10-24 12:00:00'
      );
      CREATE TABLE "JobFeedIndex" (
        "canonicalJobId" text PRIMARY KEY, status "JobStatus" DEFAULT 'LIVE', company text DEFAULT 'Synthetic Company',
        "applyUrl" text DEFAULT 'https://example.test/job', region text DEFAULT 'US', industry text DEFAULT 'TECH',
        "normalizedRoleCategory" text DEFAULT 'SOFTWARE_ENGINEERING', "normalizedRoleCategoryConfidence" float DEFAULT 0.75,
        "classificationStatus" text DEFAULT 'CONFIDENT', "submissionCategory" text DEFAULT 'READY_TO_APPLY'
      );
      CREATE TABLE "JobEligibility" ("canonicalJobId" text PRIMARY KEY, "submissionCategory" text DEFAULT 'READY_TO_APPLY', "reasonCode" text DEFAULT 'SYNTHETIC', "reasonDescription" text DEFAULT 'Synthetic reason');
      INSERT INTO "JobCanonical" (id) VALUES ('a-tech'), ('b-finance-alive'), ('c-general-alive'), ('d-low-role'), ('e-bad-classification'), ('f-unknown-role'),
        ('hidden-dead'), ('hidden-expired'), ('hidden-index'), ('hidden-company'), ('hidden-index-company'), ('hidden-generic'), ('hidden-gated'), ('hidden-broken'), ('hidden-deadline'), ('hidden-stale'), ('hidden-availability'), ('hidden-url'), ('hidden-null-evidence');
      INSERT INTO "JobFeedIndex" ("canonicalJobId") SELECT id FROM "JobCanonical";
      INSERT INTO "JobEligibility" ("canonicalJobId") SELECT id FROM "JobCanonical" WHERE id <> 'f-unknown-role';
      UPDATE "JobCanonical" SET "lastSourceSeenAt" = '2026-10-05 12:00:00', "lastConfirmedAliveAt" = '2026-09-25 12:00:00' WHERE id = 'b-finance-alive';
      UPDATE "JobCanonical" SET "lastSourceSeenAt" = NULL, "lastConfirmedAliveAt" = '2026-10-24 12:00:00' WHERE id = 'c-general-alive';
      UPDATE "JobCanonical" SET "lastSourceSeenAt" = '2026-10-11 12:00:00', deadline = '2026-10-25 12:00:00' WHERE id = 'd-low-role';
      UPDATE "JobCanonical" SET "lastSourceSeenAt" = '2026-10-18 12:00:00' WHERE id = 'e-bad-classification';
      UPDATE "JobFeedIndex" SET industry = 'FINANCE', "normalizedRoleCategory" = 'FINANCE_ACCOUNTING', "submissionCategory" = 'REVIEW_REQUIRED' WHERE "canonicalJobId" = 'b-finance-alive';
      UPDATE "JobEligibility" SET "submissionCategory" = 'REVIEW_REQUIRED' WHERE "canonicalJobId" = 'b-finance-alive';
      UPDATE "JobFeedIndex" SET region = 'CA', industry = 'GENERAL', "normalizedRoleCategory" = 'MARKETING', "submissionCategory" = 'MANUAL_ONLY' WHERE "canonicalJobId" = 'c-general-alive';
      UPDATE "JobEligibility" SET "submissionCategory" = 'MANUAL_ONLY' WHERE "canonicalJobId" = 'c-general-alive';
      UPDATE "JobFeedIndex" SET "normalizedRoleCategoryConfidence" = 0.749, "submissionCategory" = 'REVIEW_REQUIRED' WHERE "canonicalJobId" = 'd-low-role';
      UPDATE "JobFeedIndex" SET "classificationStatus" = 'FAILED' WHERE "canonicalJobId" = 'e-bad-classification';
      UPDATE "JobEligibility" SET "reasonDescription" = ' ' WHERE "canonicalJobId" = 'e-bad-classification';
      UPDATE "JobFeedIndex" SET "normalizedRoleCategory" = 'OTHER_UNKNOWN' WHERE "canonicalJobId" = 'f-unknown-role';
      UPDATE "JobCanonical" SET "deadSignalAt" = '2026-10-24' WHERE id = 'hidden-dead';
      UPDATE "JobCanonical" SET status = 'EXPIRED' WHERE id = 'hidden-expired';
      UPDATE "JobFeedIndex" SET status = 'REMOVED' WHERE "canonicalJobId" = 'hidden-index';
      UPDATE "JobCanonical" SET company = 'Unknown Company' WHERE id = 'hidden-company';
      UPDATE "JobFeedIndex" SET company = 'unknown' WHERE "canonicalJobId" = 'hidden-index-company';
      UPDATE "JobCanonical" SET company = 'lever', "applyUrl" = 'https://jobs.lever.co/company' WHERE id = 'hidden-generic';
      UPDATE "JobCanonical" SET "applyUrl" = 'https://weworkremotely.com/job/test' WHERE id = 'hidden-gated';
      UPDATE "JobCanonical" SET "applyUrlValidationStatus" = 'BROKEN_APPLY_LINK' WHERE id = 'hidden-broken';
      UPDATE "JobCanonical" SET deadline = '2026-10-25 11:59:59.999' WHERE id = 'hidden-deadline';
      UPDATE "JobCanonical" SET "lastSourceSeenAt" = '2026-10-11 11:59:59.999', "lastConfirmedAliveAt" = '2026-09-25 11:59:59.999' WHERE id = 'hidden-stale';
      UPDATE "JobCanonical" SET "availabilityScore" = 59.999 WHERE id = 'hidden-availability';
      UPDATE "JobCanonical" SET "applyUrl" = 'javascript:alert(1)' WHERE id = 'hidden-url';
      UPDATE "JobCanonical" SET "lastSourceSeenAt" = NULL WHERE id = 'hidden-null-evidence';
    `);
    const query = Prisma.sql`SELECT jc.id FROM "JobFeedIndex" jfi JOIN "JobCanonical" jc ON jc.id = jfi."canonicalJobId" WHERE ${contract.where(now)} ORDER BY jc.id`;
    const visible = await db.query<{ id: string }>(query.text, query.values);
    assert.deepEqual(visible.rows.map((row) => row.id), ["a-tech", "b-finance-alive", "c-general-alive", "d-low-role", "e-bad-classification", "f-unknown-role"]);
    const aggregate = buildPublicFeedQualityQuery(config, now, contract);
    const rows = (await db.query<QualityRow>(aggregate.text, aggregate.values)).rows;
    const report = summarizePublicFeed(rows, config, now, contract, 1);
    assert.equal(report.publicPoolCount, 6);
    assert.equal(report.counts.source0to7d, 3);
    assert.equal(report.counts.source7to14d, 1);
    assert.equal(report.counts.sourceOver14d, 1);
    assert.equal(report.counts.sourceMissing, 1);
    assert.equal(report.counts.visibleViaAliveOnly, 2);
    assert.equal(report.counts.roleFilterGrade, 3);
    assert.equal(report.counts.readyToApply, 3);
    assert.equal(report.counts.reviewRequired, 1);
    assert.equal(report.counts.manualOnly, 1);
    assert.equal(report.counts.eligibilityMissing, 1);
    assert.equal(report.counts.eligibilityReasonMissing, 2);
    assert.equal(report.counts.eligibilityMismatch, 2);
    assert.equal(report.counts.feedLive, 6);
    assert.equal(report.counts.canonicalLive, 6);
    assert.equal(report.passed, false);
    assert.equal(report.launchQualityEstablished, false);
    assert.ok(!JSON.stringify(report).includes("example.test"));
    const sampled = { ...config, mode: "sample" as const, sampleLimit: 2 };
    const sampleSql = buildPublicFeedQualityQuery(sampled, now, contract);
    const sample = summarizePublicFeed((await db.query<QualityRow>(sampleSql.text, sampleSql.values)).rows, sampled, now, contract, 1);
    assert.equal(sample.counts.total, 2);
    assert.equal(sample.truncated, true);
    assert.equal(sample.publicPoolCount, null);
    assert.equal(sample.passed, false);
    const greenPrefixConfig = { ...sampled, sampleLimit: 1 };
    const greenPrefixSql = buildPublicFeedQualityQuery(greenPrefixConfig, now, contract);
    const greenPrefix = summarizePublicFeed((await db.query<QualityRow>(greenPrefixSql.text, greenPrefixSql.values)).rows, greenPrefixConfig, now, contract, 1);
    assert.equal(greenPrefix.observedGatesPassed, true);
    assert.equal(greenPrefix.passed, false, "a healthy prefix is still not a healthy full pool");
    const exhaustedSql = buildPublicFeedQualityQuery({ ...sampled, sampleLimit: 6 }, now, contract);
    const exhausted = summarizePublicFeed((await db.query<QualityRow>(exhaustedSql.text, exhaustedSql.values)).rows, { ...sampled, sampleLimit: 6 }, now, contract, 1);
    assert.equal(exhausted.truncated, false);
    assert.equal(exhausted.publicPoolCount, 6);
    await db.exec(`UPDATE "JobCanonical" SET "lastSourceSeenAt" = '2026-10-26', "lastConfirmedAliveAt" = '2026-10-26', "postedAt" = '2026-10-26' WHERE id = 'a-tech'`);
    const future = summarizePublicFeed((await db.query<QualityRow>(aggregate.text, aggregate.values)).rows, config, now, contract, 1);
    assert.equal(future.counts.sourceFuture, 1);
    assert.equal(future.counts.aliveFuture, 1);
    assert.equal(future.counts.postedFuture, 1);
    assert.equal(future.observedGates.noFutureEvidence, false);
  } finally { await db.close(); }
});
