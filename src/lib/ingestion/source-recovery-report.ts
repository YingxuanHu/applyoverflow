import { Prisma } from "@/generated/prisma/client";

// A bounded diagnostic shortlist, not permission to bypass source cooldowns.
export function buildSourceRecoveryReportQuery() {
  return Prisma.sql`
    WITH candidates AS MATERIALIZED (
      SELECT id, "sourceName", "connectorName", "pollState", "cooldownUntil",
        "lastSuccessfulPollAt", "lastFailureAt", "lastHttpStatus", "retainedLiveJobCount"
      FROM "CompanySource"
      WHERE status IN ('ACTIVE', 'PROVISIONED', 'DEGRADED')
        AND "retainedLiveJobCount" > 0
        AND ("lastSuccessfulPollAt" IS NULL OR "lastSuccessfulPollAt" < (NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days')
      ORDER BY "retainedLiveJobCount" DESC, id
      LIMIT 100
    )
    SELECT cs.*, pending.status AS "taskStatus", pending."notBeforeAt", pending."startedAt",
      CASE
        WHEN cs."pollState" IN ('DISABLED', 'QUARANTINED') THEN 'manual-review'
        WHEN cs."cooldownUntil" > (NOW() AT TIME ZONE 'UTC') THEN 'cooldown'
        WHEN pending.status = 'RUNNING' AND pending."startedAt" < (NOW() AT TIME ZONE 'UTC') - INTERVAL '30 minutes' THEN 'running-over-30min'
        WHEN pending.status = 'RUNNING' THEN 'running'
        WHEN pending."notBeforeAt" > (NOW() AT TIME ZONE 'UTC') THEN 'scheduled'
        WHEN pending.status IS NOT NULL THEN 'waiting-for-worker'
        WHEN cs."lastFailureAt" > COALESCE(cs."lastSuccessfulPollAt", '-infinity'::timestamp)
          AND cs."lastHttpStatus" IN (401, 403, 429) THEN 'upstream-access-review'
        ELSE 'missing-poll-task'
      END AS "recoveryReason"
    FROM candidates cs
    LEFT JOIN LATERAL (
      SELECT status, "notBeforeAt", "startedAt" FROM "SourceTask" st
      WHERE st."companySourceId" = cs.id AND st.kind = 'CONNECTOR_POLL'
        AND st.status IN ('PENDING', 'RUNNING')
      ORDER BY (status = 'RUNNING') DESC, "notBeforeAt" ASC
      LIMIT 1
    ) pending ON TRUE
    ORDER BY cs."retainedLiveJobCount" DESC, cs.id
  `;
}
