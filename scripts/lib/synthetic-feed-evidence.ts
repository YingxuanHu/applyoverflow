import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import { Client } from "pg";
import { Prisma } from "../../src/generated/prisma/client";
import { ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD } from "../../src/lib/job-metadata";
import { buildJobFeedIndexOrderBy } from "../../src/lib/queries/job-feed-order";
import { buildFeedLocationSql } from "../../src/lib/queries/job-location-sql";
import { expectedSyntheticIds, ORACLE_WORKLOADS, SYNTHETIC_AS_OF, SYNTHETIC_CASES, SYNTHETIC_SCHEMA, SYNTHETIC_SEED_SQL, syntheticTemplates, type OracleWorkload } from "../fixtures/synthetic-public-feed";
import { percentile } from "./capacity-harness";
import { createDisposableEvidencePostgres } from "./disposable-evidence-postgres";
import { boundedNumber, requireEvidence, validateIsolation, type Isolation } from "./launch-evidence-safety";
import { buildPublicFeedQualityQuery, summarizePublicFeed, type FeedQualityConfig, type QualityRow } from "./public-feed-quality";
import { loadPublicFeedContract } from "./public-feed-query-contract";

export type SyntheticFeedConfig = Isolation & {
  allowDisposableLocalPostgres: true;
  rows: number;
  repetitions: number;
  statementTimeoutMs: number;
  thresholds: { p95Ms: number; maxErrorRate: number };
};

export function validateSyntheticFeedConfig(config: SyntheticFeedConfig) {
  validateIsolation(config);
  requireEvidence(config.environment === "local" && config.allowDisposableLocalPostgres === true, "DISPOSABLE_LOCAL_POSTGRES_OPT_IN_REQUIRED");
  requireEvidence(Object.keys(config).every((key) => ["environment", "isolatedSyntheticData", "noProductionInfrastructure", "allowDisposableLocalPostgres", "rows", "repetitions", "statementTimeoutMs", "thresholds"].includes(key)), "EXTERNAL_DATABASE_OR_UNKNOWN_OPTIONS_FORBIDDEN");
  boundedNumber(config.rows, 32, 48_000, "SYNTHETIC_ROW_LIMIT");
  requireEvidence(config.rows % 32 === 0 && SYNTHETIC_CASES.length === 32, "COMPLETE_SYNTHETIC_STRATA_REQUIRED");
  boundedNumber(config.repetitions, 3, 20, "SYNTHETIC_REPETITION_LIMIT");
  boundedNumber(config.statementTimeoutMs, 100, 5000, "STATEMENT_TIMEOUT_LIMIT");
  boundedNumber(config.thresholds.p95Ms, 1, 5000, "P95_THRESHOLD_REQUIRED");
  boundedNumber(config.thresholds.maxErrorRate, 0, 0.2, "ERROR_BUDGET_REQUIRED", false);
}

export function buildSyntheticFeedRead(workload: OracleWorkload, allIds = false, contract = loadPublicFeedContract()) {
  const clauses: Prisma.Sql[] = [contract.where(SYNTHETIC_AS_OF)];
  const location = { countryCa: "Canada", countryUs: "United States", toronto: "Toronto, ON", multiCity: "Toronto, ON;New York, NY", remoteCa: "Canada", remoteUs: "United States" }[workload as string];
  if (location) clauses.push(buildFeedLocationSql(location));
  if (workload === "remoteCa" || workload === "remoteUs") clauses.push(Prisma.sql`jfi."workMode" = 'REMOTE'::"WorkMode"`);
  const role = { tech: "SOFTWARE_ENGINEERING", finance: "FINANCE_ACCOUNTING", general: "MARKETING" }[workload as string];
  if (role) clauses.push(Prisma.sql`jfi."normalizedRoleCategory" = ${role} AND jfi."normalizedRoleCategoryConfidence" >= ${ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD} AND jfi."classificationStatus" IN (${Prisma.join(contract.classificationStatuses)})`);
  const order = buildJobFeedIndexOrderBy("relevance").flatMap((entry) => Object.entries(entry)).map(([column, direction]) => {
    requireEvidence(/^[a-zA-Z]+$/.test(column) && direction === "desc", "SYNTHETIC_ORDER_CONTRACT_CHANGED");
    return Prisma.sql`${Prisma.raw(`jfi."${column}"`)} DESC`;
  });
  return Prisma.sql`
    SELECT jfi."canonicalJobId" FROM "JobFeedIndex" jfi
    INNER JOIN "JobCanonical" jc ON jc.id = jfi."canonicalJobId"
    WHERE ${Prisma.join(clauses, " AND ")}
    ORDER BY ${allIds ? Prisma.sql`jfi."canonicalJobId" DESC` : Prisma.join(order)}
    ${allIds ? Prisma.empty : Prisma.sql`LIMIT 21`}
  `;
}

export function expectedSyntheticQualityCounts(rows: number) {
  const k = rows / 32;
  return { total: 20 * k, feedLive: 20 * k, canonicalLive: 20 * k, source0to7d: 16 * k, source7to14d: k, sourceOver14d: k, sourceMissing: k, sourceFuture: k, aliveFuture: 0, visibleViaAliveOnly: 2 * k, postedWithin7d: 20 * k, postedFuture: 0, roleFilterGrade: 17 * k, readyToApply: 18 * k, reviewRequired: k, manualOnly: k, eligibilityMissing: 0, eligibilityReasonMissing: k, eligibilityMismatch: 0 };
}

// Match Prisma's UTC date transport. node-postgres otherwise formats Dates in
// local time, whose offset PostgreSQL ignores for timestamp-without-time-zone.
export function nativeQueryParameters(values: unknown[]) {
  return values.map((value) => value instanceof Date ? value.toISOString() : value);
}

export async function runSyntheticFeedEvidence(config: SyntheticFeedConfig) {
  validateSyntheticFeedConfig(config);
  const started = performance.now();
  const cluster = await createDisposableEvidencePostgres();
  const owner = new Client({ connectionString: cluster.connectionString, password: "", ssl: false, options: "-c timezone=UTC", connectionTimeoutMillis: 2000, query_timeout: 20_000, statement_timeout: 15_000 });
  const reader = new Client({ connectionString: cluster.readerConnectionString, password: "", ssl: false, connectionTimeoutMillis: 2000, query_timeout: config.statementTimeoutMs + 1000, statement_timeout: config.statementTimeoutMs, options: "-c default_transaction_read_only=on -c timezone=UTC -c work_mem=4MB" });
  const deadline = started + 120_000;
  let aborted = false;
  const cancel = () => { aborted = true; void reader.end().catch(() => {}); void owner.end().catch(() => {}); };
  const timer = setTimeout(cancel, Math.max(1, deadline - performance.now()));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const contract = loadPublicFeedContract();
  const read = async <T extends Record<string, unknown>>(query: Prisma.Sql) => {
    requireEvidence(!aborted && performance.now() < deadline, "SYNTHETIC_WALL_TIME_LIMIT");
    return (await reader.query<T>(query.text, nativeQueryParameters(query.values))).rows;
  };
  try {
    await owner.connect();
    await owner.query(SYNTHETIC_SCHEMA);
    await owner.query(SYNTHETIC_SEED_SQL, [JSON.stringify(syntheticTemplates()), config.rows]);
    const indexSql = readFileSync(new URL("../../prisma/migrations/20260809010000_add_live_feed_relevance_index/migration.sql", import.meta.url), "utf8");
    await owner.query(indexSql);
    await owner.query('ANALYZE "JobCanonical"; ANALYZE "JobFeedIndex"; ANALYZE "JobEligibility"; CREATE ROLE evidence_reader LOGIN; GRANT CONNECT ON DATABASE launch_evidence_fixture_synthetic TO evidence_reader; GRANT USAGE ON SCHEMA public TO evidence_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO evidence_reader;');
    const setupMs = Math.round(performance.now() - started);
    await owner.end();
    await reader.connect();
    const serverVersion = (await reader.query("SHOW server_version")).rows[0].server_version as string;
    const readonly = (await reader.query("SHOW default_transaction_read_only")).rows[0].default_transaction_read_only === "on";
    requireEvidence(readonly, "READ_ONLY_SESSION_REQUIRED");
    const canWrite = (await reader.query(`SELECT has_table_privilege(current_user, '"JobCanonical"', 'INSERT, UPDATE, DELETE, TRUNCATE') AS allowed`)).rows[0].allowed === true;
    requireEvidence(!canWrite, "SELECT_ONLY_MEASUREMENT_ROLE_REQUIRED");
    const databaseBytes = Number((await reader.query("SELECT pg_database_size(current_database()) AS bytes")).rows[0].bytes);
    const oracle = [];
    const benchmarks = [];
    for (const workload of ORACLE_WORKLOADS) {
      const expected = expectedSyntheticIds(config.rows, workload);
      const allIds = (await read<{ canonicalJobId: string }>(buildSyntheticFeedRead(workload, true, contract))).map((row) => row.canonicalJobId);
      const hash = (ids: string[]) => createHash("sha256").update(JSON.stringify(ids)).digest("hex");
      const matches = hash(allIds) === hash(expected);
      oracle.push({ workload, expectedCount: expected.length, actualCount: allIds.length, matched: matches });
      requireEvidence(matches, `INDEPENDENT_ORACLE_MISMATCH_${workload}`);
      const sample = async () => {
        const start = performance.now();
        const page = await read<{ canonicalJobId: string }>(buildSyntheticFeedRead(workload, false, contract));
        requireEvidence(hash(page.map((row) => row.canonicalJobId)) === hash(expected.slice(0, 21)), `RANKED_ORACLE_MISMATCH_${workload}`);
        if (page[0]) await read(Prisma.sql`SELECT description FROM "JobCanonical" WHERE id = ${page[0].canonicalJobId}`);
        return performance.now() - start;
      };
      // Oracle scans have already warmed these tables. Never call this cold capacity.
      const firstMeasuredMs = await sample();
      const times = [];
      let errors = 0;
      for (let i = 0; i < config.repetitions; i++) {
        const start = performance.now();
        try { times.push(await sample()); }
        catch { times.push(performance.now() - start); errors++; break; }
      }
      const p95Ms = percentile(times, 0.95);
      const errorRate = times.length ? errors / times.length : 1;
      const passed = times.length === config.repetitions && p95Ms !== null && p95Ms <= config.thresholds.p95Ms && errorRate <= config.thresholds.maxErrorRate;
      benchmarks.push({ workload, firstMeasuredMs: Math.round(firstMeasuredMs * 100) / 100, requests: times.length, errors, errorRate, p50Ms: percentile(times, 0.5), p95Ms, p99Ms: percentile(times, 0.99), passed });
      if (!passed) break;
    }
    const qualityConfig: FeedQualityConfig = {
      environment: "local", isolatedSyntheticData: true, noProductionInfrastructure: true, allowedDatabaseTarget: "not_used_for_internal_disposable_connection",
      mode: "census", sampleLimit: 1000, statementTimeoutMs: config.statementTimeoutMs,
      thresholds: { minPublicRows: 1, maxStaleSourceRate: 0.15, minRoleCoverage: 0.9, maxMissingEligibilityRate: 0 },
    };
    const qualityStart = performance.now();
    const quality = summarizePublicFeed(await read<QualityRow>(buildPublicFeedQualityQuery(qualityConfig, SYNTHETIC_AS_OF, contract)), qualityConfig, SYNTHETIC_AS_OF, contract, performance.now() - qualityStart);
    const expectedCounts = expectedSyntheticQualityCounts(config.rows);
    const qualityOracleMatched = Object.entries(expectedCounts).every(([key, value]) => quality.counts[key as keyof typeof quality.counts] === value);
    requireEvidence(qualityOracleMatched && !quality.passed, "INDEPENDENT_QUALITY_ORACLE_MISMATCH");
    return {
      schemaVersion: 1, generatedAt: new Date().toISOString(), evidenceLevel: "disposable_native_postgres_synthetic_query_component",
      verificationPassed: oracle.length === ORACLE_WORKLOADS.length && oracle.every((entry) => entry.matched) && qualityOracleMatched,
      componentThresholdsPassed: benchmarks.length === ORACLE_WORKLOADS.length && benchmarks.every((entry) => entry.passed),
      capacityGate: { status: "blocked", productionCapacityEstablished: false, blockers: [
        "Projected three-table schema, not the full production schema or application HTTP path",
        "Synthetic distribution and row count, not production-scale cardinality, text or index statistics",
        "Local PostgreSQL and host differ from production; no matching release build was started",
        "Serial warm query samples only; no authenticated journeys, ingestion, backup I/O or sustained concurrency",
      ] },
      engine: serverVersion, host: { platform: process.platform, architecture: process.arch, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
      dataset: { cases: SYNTHETIC_CASES.length, canonicalRows: config.rows, expectedPublicRows: expectedCounts.total, databaseBytes, fixtureAsOf: SYNTHETIC_AS_OF.toISOString(), manifestSha256: createHash("sha256").update(JSON.stringify(SYNTHETIC_CASES)).digest("hex"), schemaSha256: createHash("sha256").update(SYNTHETIC_SCHEMA).digest("hex"), seedSha256: createHash("sha256").update(SYNTHETIC_SEED_SQL).digest("hex"), indexSha256: createHash("sha256").update(indexSql).digest("hex"), schema: "three_table_projection", index: "JobFeedIndex_live_relevance_order_idx_from_repository_migration" },
      safety: { disposableCluster: true, existingDatabaseAccessed: false, readonlyMeasurementSession: readonly, readerHasWritePrivileges: canWrite, externalRequests: 0, sharedBuffersMiB: 32, workMemMiB: 4, concurrency: 1, maxMeasurementWallMs: 120_000 },
      setupMs, elapsedMs: Math.round(performance.now() - started), cacheState: "warm_after_seed_analyze_and_oracle_scans",
      thresholds: { p95Ms: config.thresholds.p95Ms, maxErrorRate: config.thresholds.maxErrorRate, repetitions: config.repetitions },
      oracle, qualityOracleMatched, benchmarks, quality,
    };
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    await reader.end().catch(() => {});
    await owner.end().catch(() => {});
    await cluster.stop();
  }
}
