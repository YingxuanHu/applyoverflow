import { Prisma } from "../../src/generated/prisma/client";
import { NORMALIZED_ROLE_CATEGORY_OPTIONS, ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD } from "../../src/lib/job-metadata";
import { loadPublicFeedContract } from "./public-feed-query-contract";
import { boundedNumber, requireEvidence, validateDatabaseTarget, type Isolation } from "./launch-evidence-safety";

export type FeedQualityConfig = Isolation & {
  allowedDatabaseTarget: string;
  mode: "sample" | "census";
  sampleLimit: number;
  statementTimeoutMs: number;
  thresholds: { maxStaleSourceRate: number; minRoleCoverage: number; maxMissingEligibilityRate: number; minPublicRows: number };
};

export function validateFeedQualityConfig(config: FeedQualityConfig, connectionString: string) {
  validateDatabaseTarget(connectionString, config.allowedDatabaseTarget, config);
  requireEvidence(config.mode === "sample" || config.mode === "census", "REPORT_MODE_REQUIRED");
  requireEvidence(process.env.USE_JOB_FEED_INDEX !== "0", "FEED_INDEX_REQUIRED_FOR_THIS_REPORT");
  boundedNumber(config.sampleLimit, 1, 5000, "SAMPLE_LIMIT");
  boundedNumber(config.statementTimeoutMs, 100, 25_000, "STATEMENT_TIMEOUT_LIMIT");
  boundedNumber(config.thresholds.maxStaleSourceRate, 0, 1, "STALE_THRESHOLD_REQUIRED", false);
  boundedNumber(config.thresholds.minRoleCoverage, 0, 1, "ROLE_THRESHOLD_REQUIRED", false);
  boundedNumber(config.thresholds.maxMissingEligibilityRate, 0, 1, "ELIGIBILITY_THRESHOLD_REQUIRED", false);
  boundedNumber(config.thresholds.minPublicRows, 1, 10_000_000, "MIN_PUBLIC_ROWS_REQUIRED");
}

export function buildPublicFeedQualityQuery(config: Pick<FeedQualityConfig, "mode" | "sampleLimit">, now: Date, contract = loadPublicFeedContract()) {
  const day = 86_400_000;
  const roles = NORMALIZED_ROLE_CATEGORY_OPTIONS.map((option) => option.value).filter((value) => value !== "OTHER_UNKNOWN");
  const sourceCutoff7 = new Date(now.getTime() - 7 * day);
  const sourceCutoff14 = new Date(now.getTime() - 14 * day);
  const aliveCutoff30 = new Date(now.getTime() - 30 * day);
  const bounded = config.mode === "sample";
  return Prisma.sql`
    WITH public_pool AS MATERIALIZED (
      SELECT jfi."canonicalJobId", jfi.status::text AS "feedStatus", jc.status::text AS "canonicalStatus",
        CASE WHEN jfi.region::text IN ('US', 'CA') THEN jfi.region::text ELSE 'UNKNOWN' END AS region,
        CASE WHEN jfi.industry::text IN ('TECH', 'FINANCE', 'GENERAL') THEN jfi.industry::text ELSE 'UNKNOWN' END AS industry,
        CASE WHEN jfi."normalizedRoleCategory" IN (${Prisma.join(roles)}) THEN jfi."normalizedRoleCategory" ELSE 'OTHER_UNKNOWN' END AS role,
        COALESCE(jfi."normalizedRoleCategory" IN (${Prisma.join(roles)})
          AND jfi."normalizedRoleCategoryConfidence" >= ${ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD}
          AND jfi."classificationStatus" IN (${Prisma.join(contract.classificationStatuses)}), false) AS "roleFilterGrade",
        jc."lastSourceSeenAt", jc."lastConfirmedAliveAt", jc."postedAt",
        je."submissionCategory"::text AS eligibility,
        (NULLIF(btrim(je."reasonCode"), '') IS NOT NULL AND NULLIF(btrim(je."reasonDescription"), '') IS NOT NULL) AS "hasEligibilityReason",
        (jfi."submissionCategory" IS DISTINCT FROM je."submissionCategory") AS "eligibilityMismatch"
      FROM "JobFeedIndex" AS jfi
      INNER JOIN "JobCanonical" AS jc ON jc.id = jfi."canonicalJobId"
      LEFT JOIN "JobEligibility" AS je ON je."canonicalJobId" = jc.id
      WHERE ${contract.where(now)}
      ${bounded ? Prisma.sql`ORDER BY jfi."canonicalJobId" LIMIT ${config.sampleLimit + 1}` : Prisma.empty}
    ), measured AS (
      SELECT * FROM public_pool
      ${bounded ? Prisma.sql`ORDER BY "canonicalJobId" LIMIT ${config.sampleLimit}` : Prisma.empty}
    )
    SELECT region, industry, role, COUNT(*)::int AS total,
      (SELECT COUNT(*)::int FROM public_pool) AS "boundedPoolRows",
      COUNT(*) FILTER (WHERE "feedStatus" = 'LIVE')::int AS "feedLive",
      COUNT(*) FILTER (WHERE "canonicalStatus" = 'LIVE')::int AS "canonicalLive",
      COUNT(*) FILTER (WHERE "lastSourceSeenAt" >= ${sourceCutoff7} AND "lastSourceSeenAt" <= ${now})::int AS "source0to7d",
      COUNT(*) FILTER (WHERE "lastSourceSeenAt" >= ${sourceCutoff14} AND "lastSourceSeenAt" < ${sourceCutoff7})::int AS "source7to14d",
      COUNT(*) FILTER (WHERE "lastSourceSeenAt" < ${sourceCutoff14})::int AS "sourceOver14d",
      COUNT(*) FILTER (WHERE "lastSourceSeenAt" IS NULL)::int AS "sourceMissing",
      COUNT(*) FILTER (WHERE "lastSourceSeenAt" > ${now})::int AS "sourceFuture",
      COUNT(*) FILTER (WHERE "lastConfirmedAliveAt" > ${now})::int AS "aliveFuture",
      COUNT(*) FILTER (WHERE ("lastSourceSeenAt" IS NULL OR "lastSourceSeenAt" < ${sourceCutoff14}) AND "lastConfirmedAliveAt" >= ${aliveCutoff30})::int AS "visibleViaAliveOnly",
      COUNT(*) FILTER (WHERE "postedAt" >= ${sourceCutoff7} AND "postedAt" <= ${now})::int AS "postedWithin7d",
      COUNT(*) FILTER (WHERE "postedAt" > ${now})::int AS "postedFuture",
      COUNT(*) FILTER (WHERE "roleFilterGrade")::int AS "roleFilterGrade",
      COUNT(*) FILTER (WHERE eligibility = 'READY_TO_APPLY')::int AS "readyToApply",
      COUNT(*) FILTER (WHERE eligibility = 'REVIEW_REQUIRED')::int AS "reviewRequired",
      COUNT(*) FILTER (WHERE eligibility = 'MANUAL_ONLY')::int AS "manualOnly",
      COUNT(*) FILTER (WHERE eligibility IS NULL)::int AS "eligibilityMissing",
      COUNT(*) FILTER (WHERE NOT "hasEligibilityReason")::int AS "eligibilityReasonMissing",
      COUNT(*) FILTER (WHERE "eligibilityMismatch")::int AS "eligibilityMismatch"
    FROM measured GROUP BY region, industry, role ORDER BY region, industry, role
  `;
}

const COUNT_FIELDS = ["total", "feedLive", "canonicalLive", "source0to7d", "source7to14d", "sourceOver14d", "sourceMissing", "sourceFuture", "aliveFuture", "visibleViaAliveOnly", "postedWithin7d", "postedFuture", "roleFilterGrade", "readyToApply", "reviewRequired", "manualOnly", "eligibilityMissing", "eligibilityReasonMissing", "eligibilityMismatch"] as const;
export type QualityRow = Record<typeof COUNT_FIELDS[number] | "boundedPoolRows", number> & { region: string; industry: string; role: string };

export function summarizePublicFeed(rows: QualityRow[], config: FeedQualityConfig, now: Date, contract: ReturnType<typeof loadPublicFeedContract>, elapsedMs: number) {
  const counts = Object.fromEntries(COUNT_FIELDS.map((key) => [key, rows.reduce((sum, row) => sum + row[key], 0)])) as Record<typeof COUNT_FIELDS[number], number>;
  const truncated = config.mode === "sample" && (rows[0]?.boundedPoolRows ?? 0) > config.sampleLimit;
  const ratio = (value: number) => counts.total ? value / counts.total : null;
  const staleSourceRate = ratio(counts.sourceOver14d + counts.sourceMissing);
  const roleCoverage = ratio(counts.roleFilterGrade);
  const missingEligibilityRate = ratio(counts.eligibilityReasonMissing);
  const gates = {
    enoughRows: counts.total >= config.thresholds.minPublicRows,
    sourceRecency: staleSourceRate !== null && staleSourceRate <= config.thresholds.maxStaleSourceRate,
    roleCoverage: roleCoverage !== null && roleCoverage >= config.thresholds.minRoleCoverage,
    eligibilityCompleteness: missingEligibilityRate !== null && missingEligibilityRate <= config.thresholds.maxMissingEligibilityRate,
    eligibilityIndexAgreement: counts.eligibilityMismatch === 0,
    noFutureEvidence: counts.sourceFuture + counts.aliveFuture + counts.postedFuture === 0,
    liveStatuses: counts.total > 0 && counts.feedLive === counts.total && counts.canonicalLive === counts.total,
  };
  return {
    schemaVersion: 1, asOf: now.toISOString(), environment: config.environment, complete: true,
    scope: "anonymous_default_feed_index_public_predicate", mode: config.mode,
    selection: config.mode === "sample" ? "canonical_id_order_not_random_or_representative" : "full_isolated_database_census",
    sourceSha256: contract.sourceSha256, predicateSha256: contract.predicateSha256,
    roleConfidenceThreshold: ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD,
    thresholds: { maxStaleSourceRate: config.thresholds.maxStaleSourceRate, minRoleCoverage: config.thresholds.minRoleCoverage, maxMissingEligibilityRate: config.thresholds.maxMissingEligibilityRate, minPublicRows: config.thresholds.minPublicRows },
    elapsedMs: Math.round(elapsedMs), statementTimeoutMs: config.statementTimeoutMs,
    counts, rates: { staleOrMissingSourceRate: staleSourceRate, roleCoverage, missingEligibilityReasonRate: missingEligibilityRate },
    truncated, publicPoolCount: truncated ? null : counts.total,
    observedGates: gates, observedGatesPassed: Object.values(gates).every(Boolean),
    passed: !truncated && Object.values(gates).every(Boolean),
    independentOracle: "not_run", launchQualityEstablished: false,
    strata: rows.map(({ region, industry, role, total, roleFilterGrade }) => ({ region, industry, role, total, roleFilterGrade })),
  };
}

export async function collectPublicFeedQuality(db: Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">, config: FeedQualityConfig, now = new Date()) {
  const started = performance.now();
  const contract = loadPublicFeedContract();
  await db.$executeRaw`SET TRANSACTION READ ONLY`;
  await db.$executeRaw`SELECT set_config('statement_timeout', ${String(config.statementTimeoutMs)}, true)`;
  await db.$executeRaw`SET LOCAL lock_timeout = '500ms'`;
  await db.$executeRaw`SET LOCAL work_mem = '8MB'`;
  const rows = await db.$queryRaw<QualityRow[]>(buildPublicFeedQualityQuery(config, now, contract));
  return summarizePublicFeed(rows, config, now, contract, performance.now() - started);
}
