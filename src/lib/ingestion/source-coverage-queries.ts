import { Prisma } from "@/generated/prisma/client";

export const SOURCE_COVERAGE_FRESHNESS_DAYS = 7;
export const SOURCE_PROVISIONING_GRACE_HOURS = 12;

// All callers use the cs alias. A registration or a reachable landing page
// alone is not evidence that we can actually retrieve this employer's jobs.
export function buildHealthySourceCoverageSql(now: Date) {
  const cutoff = new Date(now.getTime() - SOURCE_COVERAGE_FRESHNESS_DAYS * 86_400_000);
  return Prisma.sql`
    cs."status" IN ('ACTIVE', 'PROVISIONED', 'DEGRADED')
    AND cs."validationState" = 'VALIDATED'
    AND cs."pollState" NOT IN ('DISABLED', 'QUARANTINED')
    AND cs."lastSuccessfulPollAt" >= ${cutoff}
  `;
}

export function buildSourceCoverageRepairQuery(limit: number, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - SOURCE_COVERAGE_FRESHNESS_DAYS * 86_400_000);
  const graceCutoff = new Date(now.getTime() - SOURCE_PROVISIONING_GRACE_HOURS * 3_600_000);
  const boundedLimit = Number.isFinite(limit) ? Math.min(1_000, Math.max(1, Math.floor(limit))) : 100;
  return Prisma.sql`
    SELECT c.id, c.name, c.domain
    FROM "Company" c
    WHERE EXISTS (
      SELECT 1 FROM "CompanySource" cs WHERE cs."companyId" = c.id
        AND cs.status IN ('ACTIVE', 'PROVISIONED', 'DEGRADED', 'REDISCOVER_REQUIRED')
        AND cs."pollState" NOT IN ('DISABLED', 'ACTIVE')
        AND (cs."cooldownUntil" IS NULL OR cs."cooldownUntil" <= ${now})
        AND (
          cs.status = 'REDISCOVER_REQUIRED'
          OR cs."validationState" IN ('INVALID', 'BLOCKED', 'NEEDS_REDISCOVERY')
          OR cs."pollState" = 'QUARANTINED'
          OR cs."lastSuccessfulPollAt" < ${cutoff}
          OR (cs."lastSuccessfulPollAt" IS NULL
            AND cs."createdAt" < ${graceCutoff}
            AND (cs."lastProvisionedAt" IS NULL OR cs."lastProvisionedAt" < ${graceCutoff}))
        )
    )
    AND NOT EXISTS (
      SELECT 1 FROM "CompanySource" cs WHERE cs."companyId" = c.id
        AND ${buildHealthySourceCoverageSql(now)}
    )
    -- Let new sources and freshly discovered ATS leads finish their first poll
    -- or validation. Do not treat old PROMOTED leads as permanent coverage.
    AND NOT EXISTS (
      SELECT 1 FROM "CompanySource" cs WHERE cs."companyId" = c.id
        AND cs.status IN ('ACTIVE', 'PROVISIONED')
        AND cs."validationState" IN ('UNVALIDATED', 'VALIDATING', 'VALIDATED')
        AND cs."pollState" NOT IN ('DISABLED', 'QUARANTINED')
        AND cs."lastSuccessfulPollAt" IS NULL
        AND GREATEST(cs."createdAt", cs."lastProvisionedAt") >= ${graceCutoff}
    )
    AND NOT EXISTS (
      SELECT 1 FROM "SourceCandidate" sc WHERE sc."companyId" = c.id
        AND sc."candidateType" = 'ATS_BOARD'
        AND sc."atsPlatform" IS NOT NULL
        AND sc.status IN ('NEW', 'VALIDATED')
        AND sc."lastSeenAt" >= ${graceCutoff}
    )
    -- Avoid reselecting the same failing top slice on every repair pass.
    ORDER BY random()
    LIMIT ${boundedLimit}
  `;
}
