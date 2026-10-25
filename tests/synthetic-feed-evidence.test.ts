import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { cleanupDisposableCluster } from "../scripts/lib/disposable-evidence-postgres";
import { buildSyntheticFeedRead, expectedSyntheticQualityCounts, nativeQueryParameters, validateSyntheticFeedConfig, type SyntheticFeedConfig } from "../scripts/lib/synthetic-feed-evidence";
import { buildPublicFeedQualityQuery, summarizePublicFeed, type FeedQualityConfig, type QualityRow } from "../scripts/lib/public-feed-quality";
import { loadPublicFeedContract } from "../scripts/lib/public-feed-query-contract";
import { expectedSyntheticIds, ORACLE_WORKLOADS, SYNTHETIC_AS_OF, SYNTHETIC_CASES, SYNTHETIC_SCHEMA, SYNTHETIC_SEED_SQL, syntheticTemplates } from "../scripts/fixtures/synthetic-public-feed";

const config: SyntheticFeedConfig = {
  environment: "local", isolatedSyntheticData: true, noProductionInfrastructure: true,
  allowDisposableLocalPostgres: true, rows: 32, repetitions: 3, statementTimeoutMs: 1000,
  thresholds: { p95Ms: 250, maxErrorRate: 0 },
};

test("synthetic runner rejects external targets, incomplete strata and unbounded work", () => {
  validateSyntheticFeedConfig(config);
  for (const change of [{ environment: "production" }, { environment: "staging" }, { rows: 0 }, { rows: 33 }, { rows: 48_032 }, { repetitions: 21 }, { statementTimeoutMs: 5001 }, { allowDisposableLocalPostgres: false }, { target: "postgresql://production" }, { isolatedSyntheticData: false }]) {
    assert.throws(() => validateSyntheticFeedConfig({ ...config, ...change } as SyntheticFeedConfig));
  }
  assert.equal(SYNTHETIC_CASES.length, 32);
});

test("native timestamp parameters preserve UTC independently of the developer timezone", () => {
  const value = new Date("2026-10-25T08:00:00-04:00");
  assert.deepEqual(nativeQueryParameters([value, null, 3, "safe"]), ["2026-10-25T12:00:00.000Z", null, 3, "safe"]);
  assert.ok(value instanceof Date);
});

test("failed stop with a running postmaster retains its owned directory", async () => {
  let removed = false;
  let stopped = false;
  await assert.rejects(cleanupDisposableCluster({
    status: async () => "running",
    stop: async () => { stopped = true; throw new Error("stop failed"); },
    removeOwnedDirectory: async () => { removed = true; },
  }), /DIRECTORY_RETAINED/);
  assert.equal(stopped, true);
  assert.equal(removed, false);
});

test("unknown cluster status before or after stop never permits deletion", async () => {
  for (const initialRunning of [false, true]) {
    let checks = 0;
    let removed = false;
    await assert.rejects(cleanupDisposableCluster({
      status: async () => { if (initialRunning && checks++ === 0) return "running"; throw new Error("status unavailable"); },
      stop: async () => {}, removeOwnedDirectory: async () => { removed = true; },
    }), /status unavailable/);
    assert.equal(removed, false);
  }
});

test("successful stop is still checked; a verified stopped cluster can be removed", async () => {
  for (const stopThrows of [false, true]) {
    let checks = 0;
    let removed = false;
    await cleanupDisposableCluster({
      status: async () => checks++ === 0 ? "running" : "stopped",
      stop: async () => { if (stopThrows) throw new Error("stop timed out after exit"); },
      removeOwnedDirectory: async () => { removed = true; },
    });
    assert.equal(checks, 2);
    assert.equal(removed, true);
  }
  let removed = false;
  await assert.rejects(cleanupDisposableCluster({ status: async () => "running", stop: async () => {}, removeOwnedDirectory: async () => { removed = true; } }), /DIRECTORY_RETAINED/);
  assert.equal(removed, false);
});

test("32 independently labeled cases verify complete sets, ranked pages and expected quality defects", async () => {
  const db = new PGlite();
  const contract = loadPublicFeedContract();
  const rows = 64;
  try {
    await db.exec(SYNTHETIC_SCHEMA);
    await db.query(SYNTHETIC_SEED_SQL, [JSON.stringify(syntheticTemplates()), rows]);
    for (const workload of ORACLE_WORKLOADS) {
      const expected = expectedSyntheticIds(rows, workload);
      for (const allIds of [true, false]) {
        const query = buildSyntheticFeedRead(workload, allIds, contract);
        const actual = (await db.query<{ canonicalJobId: string }>(query.text, nativeQueryParameters(query.values))).rows.map((row) => row.canonicalJobId);
        assert.deepEqual(actual, allIds ? expected : expected.slice(0, 21), workload);
      }
    }
    assert.ok(!expectedSyntheticIds(rows, "countryCa").includes("synthetic-000008"), "unspecified Remote is not Canada eligibility");
    assert.ok(!expectedSyntheticIds(rows, "countryUs").includes("synthetic-000007"), "Canada-only remote is not US eligibility");
    const qualityConfig: FeedQualityConfig = { ...config, allowedDatabaseTarget: "unused_in_memory", mode: "census", sampleLimit: 100, thresholds: { maxStaleSourceRate: 0.15, minRoleCoverage: 0.9, maxMissingEligibilityRate: 0, minPublicRows: 1 } };
    const query = buildPublicFeedQualityQuery(qualityConfig, SYNTHETIC_AS_OF, contract);
    const actual = (await db.query<QualityRow>(query.text, nativeQueryParameters(query.values))).rows;
    const report = summarizePublicFeed(actual, qualityConfig, SYNTHETIC_AS_OF, contract, 1);
    assert.deepEqual(report.counts, expectedSyntheticQualityCounts(rows));
    assert.equal(report.publicPoolCount, 40);
    assert.equal(report.passed, false);
    assert.equal(report.observedGates.roleCoverage, false);
    assert.equal(report.observedGates.eligibilityCompleteness, false);
    assert.equal(report.observedGates.noFutureEvidence, false);
  } finally { await db.close(); }
});
