import { prisma } from "@/lib/db";
import {
  Prisma,
  SourceTask,
  SourceTaskKind,
  SourceTaskStatus,
} from "@/generated/prisma/client";

export type SourceTaskPayload = Record<string, Prisma.InputJsonValue | null>;

function readPositiveIntegerEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const CONNECTOR_POLL_CHURN_HEAVY_REMOVED_THRESHOLD = Math.max(
  10,
  readPositiveIntegerEnv("INGEST_GROWTH_CHURN_HEAVY_REMOVED_THRESHOLD", 50)
);
const CONNECTOR_POLL_CHURN_HEAVY_RATIO_X100 = Math.max(
  100,
  readPositiveIntegerEnv(
    "INGEST_GROWTH_CHURN_HEAVY_REMOVED_TO_CREATED_RATIO_X100",
    200
  )
);
const CONNECTOR_POLL_CHURN_HEAVY_COOLDOWN_HOURS = Math.max(
  2,
  readPositiveIntegerEnv("INGEST_GROWTH_CHURN_HEAVY_COOLDOWN_HOURS", 8)
);
const CONNECTOR_POLL_ZERO_GROWTH_DEFER_HOURS = Math.max(
  1,
  readPositiveIntegerEnv("INGEST_ZERO_GROWTH_PENDING_DEFER_HOURS", 3)
);
const CONNECTOR_POLL_ZERO_GROWTH_ACCEPTED_THRESHOLD = Math.max(
  5,
  readPositiveIntegerEnv("INGEST_ZERO_GROWTH_PENDING_ACCEPTED_THRESHOLD", 25)
);
const CONNECTOR_POLL_FAMILY_CHURN_LOOKBACK_HOURS = Math.max(
  1,
  readPositiveIntegerEnv("INGEST_GROWTH_FAMILY_CHURN_LOOKBACK_HOURS", 2)
);
const CONNECTOR_POLL_FAMILY_CHURN_DEFER_HOURS = Math.max(
  1,
  readPositiveIntegerEnv("INGEST_GROWTH_FAMILY_CHURN_DEFER_HOURS", 2)
);
const CONNECTOR_POLL_FAMILY_CHURN_REMOVED_THRESHOLD = Math.max(
  CONNECTOR_POLL_CHURN_HEAVY_REMOVED_THRESHOLD,
  readPositiveIntegerEnv(
    "INGEST_GROWTH_FAMILY_CHURN_REMOVED_THRESHOLD",
    CONNECTOR_POLL_CHURN_HEAVY_REMOVED_THRESHOLD
  )
);
const CONNECTOR_POLL_FAMILY_CHURN_RATIO_X100 = Math.max(
  CONNECTOR_POLL_CHURN_HEAVY_RATIO_X100,
  readPositiveIntegerEnv(
    "INGEST_GROWTH_FAMILY_CHURN_REMOVED_TO_CREATED_RATIO_X100",
    CONNECTOR_POLL_CHURN_HEAVY_RATIO_X100
  )
);

const STALE_RUNNING_TASK_WINDOW_MINUTES: Record<SourceTaskKind, number> = {
  COMPANY_DISCOVERY: Math.max(
    30,
    readPositiveIntegerEnv("SOURCE_TASK_STALE_COMPANY_DISCOVERY_MINUTES", 60)
  ),
  REDISCOVERY: Math.max(
    30,
    readPositiveIntegerEnv("SOURCE_TASK_STALE_REDISCOVERY_MINUTES", 60)
  ),
  SOURCE_VALIDATION: Math.max(
    30,
    readPositiveIntegerEnv("SOURCE_TASK_STALE_VALIDATION_MINUTES", 60)
  ),
  CONNECTOR_POLL: Math.max(
    10,
    readPositiveIntegerEnv("SOURCE_TASK_STALE_CONNECTOR_POLL_MINUTES", 20)
  ),
  URL_HEALTH: Math.max(
    15,
    readPositiveIntegerEnv("SOURCE_TASK_STALE_URL_HEALTH_MINUTES", 45)
  ),
};

const ACTIVE_UNIQUE_SOURCE_TASK_STATUSES: SourceTaskStatus[] = [
  "PENDING",
  "RUNNING",
];

const CONNECTOR_POLL_ELIGIBLE_SOURCE_SQL = Prisma.sql`
  cs."status" IN ('PROVISIONED', 'ACTIVE', 'DEGRADED')
  AND cs."validationState" = 'VALIDATED'
  AND cs."pollState" <> 'QUARANTINED'
  AND cs."pollState" <> 'DISABLED'
`;

const REDISCOVERY_ELIGIBLE_SOURCE_SQL = Prisma.sql`
  cs."status" <> 'DISABLED'
  AND cs."validationState" <> 'INVALID'
  AND cs."pollState" <> 'DISABLED'
  AND (
    cs."status" = 'REDISCOVER_REQUIRED'
    OR cs."validationState" = 'NEEDS_REDISCOVERY'
    OR (
      cs."status" = 'DEGRADED'
      AND cs."consecutiveFailures" >= 3
    )
  )
`;

function buildSourceTaskUniquenessWhere(input: {
  kind: SourceTaskKind;
  companyId?: string | null;
  companySourceId?: string | null;
  canonicalJobId?: string | null;
}) {
  if (input.companySourceId) {
    return {
      kind: input.kind,
      companySourceId: input.companySourceId,
    } satisfies Prisma.SourceTaskWhereInput;
  }

  if (input.canonicalJobId) {
    return {
      kind: input.kind,
      canonicalJobId: input.canonicalJobId,
    } satisfies Prisma.SourceTaskWhereInput;
  }

  return {
    kind: input.kind,
    companyId: input.companyId ?? null,
    companySourceId: null,
    canonicalJobId: null,
  } satisfies Prisma.SourceTaskWhereInput;
}

function buildSourceTaskUniquenessKey(task: {
  kind: SourceTaskKind;
  companyId: string | null;
  companySourceId: string | null;
  canonicalJobId: string | null;
}) {
  if (task.companySourceId) {
    return [task.kind, "source", task.companySourceId].join("|");
  }

  if (task.canonicalJobId) {
    return [task.kind, "canonical", task.canonicalJobId].join("|");
  }

  return [task.kind, "company", task.companyId ?? "none"].join("|");
}

async function collapseDuplicatePendingSourceTasks(
  kind: SourceTaskKind,
  now: Date
) {
  const pendingTasks = await prisma.sourceTask.findMany({
    where: { kind, status: "PENDING" },
    select: {
      id: true,
      kind: true,
      companyId: true,
      companySourceId: true,
      canonicalJobId: true,
    },
    orderBy: [{ priorityScore: "desc" }, { createdAt: "asc" }],
  });

  const seen = new Set<string>();
  const duplicateIds: string[] = [];

  for (const task of pendingTasks) {
    const key = buildSourceTaskUniquenessKey(task);
    if (seen.has(key)) {
      duplicateIds.push(task.id);
      continue;
    }

    seen.add(key);
  }

  if (duplicateIds.length === 0) {
    return 0;
  }

  const result = await prisma.sourceTask.updateMany({
    where: {
      id: { in: duplicateIds },
      status: "PENDING",
    },
    data: {
      status: "SKIPPED",
      finishedAt: now,
      lastError:
        "Skipped duplicate pending source task because an equivalent task was already queued.",
    },
  });

  return result.count;
}

async function recoverStaleRunningSourceTasks(
  kind: SourceTaskKind,
  now: Date
) {
  const staleAfterMinutes = STALE_RUNNING_TASK_WINDOW_MINUTES[kind] ?? 120;
  const staleCutoff = new Date(now.getTime() - staleAfterMinutes * 60 * 1000);
  const staleTasks = await prisma.sourceTask.findMany({
    where: {
      kind,
      status: "RUNNING",
      startedAt: { lt: staleCutoff },
    },
    select: {
      id: true,
      kind: true,
      companyId: true,
      companySourceId: true,
      canonicalJobId: true,
    },
  });

  let recoveredCount = 0;

  for (const task of staleTasks) {
    const activeDuplicate = await prisma.sourceTask.findFirst({
      where: {
        ...buildSourceTaskUniquenessWhere(task),
        id: { not: task.id },
        OR: [
          { status: "PENDING" },
          { status: "RUNNING", startedAt: { gte: staleCutoff } },
        ],
      },
      select: { id: true },
    });

    if (activeDuplicate) {
      await prisma.sourceTask.updateMany({
        where: {
          id: task.id,
          status: "RUNNING",
        },
        data: {
          status: "SKIPPED",
          finishedAt: now,
          lastError:
            "Skipped stale RUNNING task because an equivalent source task was already active.",
        },
      });
      continue;
    }

    const updated = await prisma.sourceTask.updateMany({
      where: {
        id: task.id,
        status: "RUNNING",
      },
      data: {
        status: "PENDING",
        startedAt: null,
        finishedAt: null,
        notBeforeAt: now,
        lastError: `Recovered stale RUNNING task after exceeding ${staleAfterMinutes} minute lease window.`,
      },
    });

    recoveredCount += updated.count;
  }

  return recoveredCount;
}

export async function reconcileConnectorPollTaskReadiness(now: Date = new Date()) {
  const skipped = await prisma.$executeRaw(Prisma.sql`
    UPDATE "SourceTask" st
    SET
      "status" = 'SKIPPED'::"SourceTaskStatus",
      "finishedAt" = ${now},
      "lastError" = 'Skipped connector poll because the company source is no longer eligible for polling.'
    FROM "CompanySource" cs
    WHERE
      st."kind" = 'CONNECTOR_POLL'::"SourceTaskKind"
      AND st."status" = 'PENDING'::"SourceTaskStatus"
      AND st."companySourceId" = cs."id"
      AND NOT (${CONNECTOR_POLL_ELIGIBLE_SOURCE_SQL})
  `);

  const deferred = await prisma.$executeRaw(Prisma.sql`
    UPDATE "SourceTask" st
    SET
      "notBeforeAt" = cs."cooldownUntil",
      "lastError" = 'Deferred connector poll until the company source cooldown expires.'
    FROM "CompanySource" cs
    WHERE
      st."kind" = 'CONNECTOR_POLL'::"SourceTaskKind"
      AND st."status" = 'PENDING'::"SourceTaskStatus"
      AND st."companySourceId" = cs."id"
      AND ${CONNECTOR_POLL_ELIGIBLE_SOURCE_SQL}
      AND cs."cooldownUntil" IS NOT NULL
      AND cs."cooldownUntil" > ${now}
      AND st."notBeforeAt" < cs."cooldownUntil"
  `);

  const churnCooldownUntil = new Date(
    now.getTime() + CONNECTOR_POLL_CHURN_HEAVY_COOLDOWN_HOURS * 60 * 60 * 1000
  );
  const churnDeferred = await prisma.$executeRaw(Prisma.sql`
    WITH recent_runs AS (
      SELECT
        "sourceName",
        COALESCE(SUM("canonicalCreatedCount"), 0)::bigint AS "createdCount",
        COALESCE(SUM("removedCount"), 0)::bigint AS "removedCount"
      FROM "IngestionRun"
      WHERE "startedAt" >= ${new Date(now.getTime() - 24 * 60 * 60 * 1000)}
      GROUP BY "sourceName"
    ),
    churn_sources AS (
      SELECT cs."id"
      FROM "CompanySource" cs
      JOIN recent_runs rr ON rr."sourceName" = cs."sourceName"
      WHERE
        rr."removedCount" >= ${CONNECTOR_POLL_CHURN_HEAVY_REMOVED_THRESHOLD}
        AND rr."removedCount" * 100 >
          GREATEST(rr."createdCount", cs."lastJobsCreatedCount"::bigint, 1::bigint) *
          ${CONNECTOR_POLL_CHURN_HEAVY_RATIO_X100}
    )
    UPDATE "SourceTask" st
    SET
      "notBeforeAt" = ${churnCooldownUntil},
      "lastError" = 'Deferred connector poll because the source recently removed far more jobs than it created.'
    FROM churn_sources cs
    WHERE
      st."kind" = 'CONNECTOR_POLL'::"SourceTaskKind"
      AND st."status" = 'PENDING'::"SourceTaskStatus"
      AND st."companySourceId" = cs."id"
      AND st."notBeforeAt" < ${churnCooldownUntil}
  `);

  const churnSourcesDeferred = await prisma.$executeRaw(Prisma.sql`
    WITH recent_runs AS (
      SELECT
        "sourceName",
        COALESCE(SUM("canonicalCreatedCount"), 0)::bigint AS "createdCount",
        COALESCE(SUM("removedCount"), 0)::bigint AS "removedCount"
      FROM "IngestionRun"
      WHERE "startedAt" >= ${new Date(now.getTime() - 24 * 60 * 60 * 1000)}
      GROUP BY "sourceName"
    )
    UPDATE "CompanySource" cs
    SET
      "cooldownUntil" = ${churnCooldownUntil},
      "pollState" = 'BACKOFF'::"CompanySourcePollState",
      "validationMessage" =
        'Growth mode cooldown: source recently removed far more canonical jobs than it created; refresh later without crowding out net-new source polling.'
    FROM recent_runs rr
    WHERE
      rr."sourceName" = cs."sourceName"
      AND rr."removedCount" >= ${CONNECTOR_POLL_CHURN_HEAVY_REMOVED_THRESHOLD}
      AND rr."removedCount" * 100 >
        GREATEST(rr."createdCount", cs."lastJobsCreatedCount"::bigint, 1::bigint) *
        ${CONNECTOR_POLL_CHURN_HEAVY_RATIO_X100}
      AND (cs."cooldownUntil" IS NULL OR cs."cooldownUntil" < ${churnCooldownUntil})
  `);

  const familyChurnNotBefore = new Date(
    now.getTime() + CONNECTOR_POLL_FAMILY_CHURN_DEFER_HOURS * 60 * 60 * 1000
  );
  const familyChurnDeferred = await prisma.$executeRaw(Prisma.sql`
    WITH recent_families AS (
      SELECT
        LOWER(split_part("sourceName", ':', 1)) AS "connectorName",
        COALESCE(SUM("canonicalCreatedCount"), 0)::bigint AS "createdCount",
        COALESCE(SUM("removedCount"), 0)::bigint AS "removedCount"
      FROM "IngestionRun"
      WHERE "startedAt" >= ${new Date(
        now.getTime() - CONNECTOR_POLL_FAMILY_CHURN_LOOKBACK_HOURS * 60 * 60 * 1000
      )}
      GROUP BY 1
    ),
    churn_families AS (
      SELECT "connectorName"
      FROM recent_families
      WHERE
        "removedCount" >= ${CONNECTOR_POLL_FAMILY_CHURN_REMOVED_THRESHOLD}
        AND "removedCount" * 100 >
          GREATEST("createdCount", 1::bigint) *
          ${CONNECTOR_POLL_FAMILY_CHURN_RATIO_X100}
    ),
    recent_sources AS (
      SELECT
        "sourceName",
        COALESCE(SUM("canonicalCreatedCount"), 0)::bigint AS "createdCount",
        COALESCE(SUM("removedCount"), 0)::bigint AS "removedCount"
      FROM "IngestionRun"
      WHERE "startedAt" >= ${new Date(
        now.getTime() - CONNECTOR_POLL_FAMILY_CHURN_LOOKBACK_HOURS * 60 * 60 * 1000
      )}
      GROUP BY "sourceName"
    )
    UPDATE "SourceTask" st
    SET
      "notBeforeAt" = ${familyChurnNotBefore},
      "lastError" =
        'Deferred connector poll because this connector family is currently removing far more jobs than it creates.'
    FROM "CompanySource" cs
    JOIN churn_families cf ON cf."connectorName" = LOWER(cs."connectorName")
    LEFT JOIN recent_sources rs ON rs."sourceName" = cs."sourceName"
    WHERE
      st."kind" = 'CONNECTOR_POLL'::"SourceTaskKind"
      AND st."status" = 'PENDING'::"SourceTaskStatus"
      AND st."companySourceId" = cs."id"
      AND st."notBeforeAt" < ${familyChurnNotBefore}
      AND NOT (
        COALESCE(rs."createdCount", 0) > 0
        AND COALESCE(rs."createdCount", 0) >= COALESCE(rs."removedCount", 0)
      )
      AND NOT (
        cs."lastJobsCreatedCount" > 0
        AND cs."jobsCreatedCount" >= 25
      )
  `);

  const zeroGrowthNotBefore = new Date(
    now.getTime() + CONNECTOR_POLL_ZERO_GROWTH_DEFER_HOURS * 60 * 60 * 1000
  );
  const zeroGrowthDeferred = await prisma.$executeRaw(Prisma.sql`
    WITH recent_runs AS (
      SELECT
        "sourceName",
        COALESCE(SUM("canonicalCreatedCount"), 0)::bigint AS "createdCount",
        COALESCE(SUM("acceptedCount"), 0)::bigint AS "acceptedCount"
      FROM "IngestionRun"
      WHERE "startedAt" >= ${new Date(now.getTime() - 24 * 60 * 60 * 1000)}
      GROUP BY "sourceName"
    )
    UPDATE "SourceTask" st
    SET
      "notBeforeAt" = ${zeroGrowthNotBefore},
      "lastError" = 'Deferred connector poll because the source has refreshed recently without creating new jobs.'
    FROM "CompanySource" cs
    LEFT JOIN recent_runs rr ON rr."sourceName" = cs."sourceName"
    WHERE
      st."kind" = 'CONNECTOR_POLL'::"SourceTaskKind"
      AND st."status" = 'PENDING'::"SourceTaskStatus"
      AND st."companySourceId" = cs."id"
      AND st."notBeforeAt" <= ${new Date(now.getTime() + 30 * 60 * 1000)}
      AND cs."pollAttemptCount" >= 2
      AND cs."lastJobsCreatedCount" = 0
      AND COALESCE(rr."createdCount", 0) = 0
      AND (
        COALESCE(rr."acceptedCount", 0) >= ${CONNECTOR_POLL_ZERO_GROWTH_ACCEPTED_THRESHOLD}
        OR cs."jobsCreatedCount" <= 10
      )
      AND st."notBeforeAt" < ${zeroGrowthNotBefore}
  `);

  return {
    skipped,
    deferred: deferred + churnDeferred + familyChurnDeferred + zeroGrowthDeferred,
    churnDeferred,
    churnSourcesDeferred,
    familyChurnDeferred,
    zeroGrowthDeferred,
  };
}

export async function reconcileRediscoveryTaskReadiness(now: Date = new Date()) {
  const skipped = await prisma.$executeRaw(Prisma.sql`
    UPDATE "SourceTask" st
    SET
      "status" = 'SKIPPED'::"SourceTaskStatus",
      "finishedAt" = ${now},
      "lastError" = 'Skipped rediscovery because the company source no longer needs rediscovery or is no longer repairable.'
    FROM "CompanySource" cs
    WHERE
      st."kind" = 'REDISCOVERY'::"SourceTaskKind"
      AND st."status" = 'PENDING'::"SourceTaskStatus"
      AND st."companySourceId" = cs."id"
      AND NOT (${REDISCOVERY_ELIGIBLE_SOURCE_SQL})
  `);

  const orphaned = await prisma.sourceTask.updateMany({
    where: {
      kind: "REDISCOVERY",
      status: "PENDING",
      companySourceId: null,
    },
    data: {
      status: "SKIPPED",
      finishedAt: now,
      lastError:
        "Skipped rediscovery because no company source is attached to the task.",
    },
  });

  const deferred = await prisma.$executeRaw(Prisma.sql`
    UPDATE "SourceTask" st
    SET
      "notBeforeAt" = cs."cooldownUntil",
      "lastError" = 'Deferred rediscovery until the company source cooldown expires.'
    FROM "CompanySource" cs
    WHERE
      st."kind" = 'REDISCOVERY'::"SourceTaskKind"
      AND st."status" = 'PENDING'::"SourceTaskStatus"
      AND st."companySourceId" = cs."id"
      AND ${REDISCOVERY_ELIGIBLE_SOURCE_SQL}
      AND cs."cooldownUntil" IS NOT NULL
      AND cs."cooldownUntil" > ${now}
      AND st."notBeforeAt" < cs."cooldownUntil"
  `);

  return {
    skipped: skipped + orphaned.count,
    deferred,
  };
}

export async function countDueSourceTasks(
  kind: SourceTaskKind,
  now: Date = new Date()
) {
  if (kind !== "CONNECTOR_POLL" && kind !== "REDISCOVERY") {
    return prisma.sourceTask.count({
      where: {
        kind,
        status: "PENDING",
        notBeforeAt: { lte: now },
      },
    });
  }

  if (kind === "REDISCOVERY") {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "SourceTask" st
      JOIN "CompanySource" cs ON cs."id" = st."companySourceId"
      WHERE
        st."kind" = 'REDISCOVERY'::"SourceTaskKind"
        AND st."status" = 'PENDING'::"SourceTaskStatus"
        AND st."notBeforeAt" <= ${now}
        AND ${REDISCOVERY_ELIGIBLE_SOURCE_SQL}
        AND (cs."cooldownUntil" IS NULL OR cs."cooldownUntil" <= ${now})
    `);

    return Number(rows[0]?.count ?? 0);
  }

  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM "SourceTask" st
    LEFT JOIN "CompanySource" cs ON cs."id" = st."companySourceId"
    WHERE
      st."kind" = 'CONNECTOR_POLL'::"SourceTaskKind"
      AND st."status" = 'PENDING'::"SourceTaskStatus"
      AND st."notBeforeAt" <= ${now}
      AND (
        st."companySourceId" IS NULL
        OR (
          ${CONNECTOR_POLL_ELIGIBLE_SOURCE_SQL}
          AND (cs."cooldownUntil" IS NULL OR cs."cooldownUntil" <= ${now})
        )
      )
  `);

  return Number(rows[0]?.count ?? 0);
}

export async function enqueueSourceTask(input: {
  kind: SourceTaskKind;
  priorityScore?: number;
  notBeforeAt?: Date;
  companyId?: string | null;
  companySourceId?: string | null;
  canonicalJobId?: string | null;
  payloadJson?: SourceTaskPayload | null;
}) {
  return prisma.sourceTask.create({
    data: {
      kind: input.kind,
      priorityScore: input.priorityScore ?? 0,
      notBeforeAt: input.notBeforeAt ?? new Date(),
      companyId: input.companyId ?? null,
      companySourceId: input.companySourceId ?? null,
      canonicalJobId: input.canonicalJobId ?? null,
      payloadJson:
        input.payloadJson != null
          ? (input.payloadJson as Prisma.InputJsonValue)
          : Prisma.DbNull,
    },
  });
}

export async function enqueueUniqueSourceTask(input: {
  kind: SourceTaskKind;
  companyId?: string | null;
  companySourceId?: string | null;
  canonicalJobId?: string | null;
  priorityScore?: number;
  notBeforeAt?: Date;
  payloadJson?: SourceTaskPayload | null;
}) {
  const existing = await prisma.sourceTask.findFirst({
    where: {
      ...buildSourceTaskUniquenessWhere(input),
      status: { in: ACTIVE_UNIQUE_SOURCE_TASK_STATUSES },
    },
    orderBy: [{ priorityScore: "desc" }, { createdAt: "asc" }],
  });

  if (existing) {
    if (existing.status === "RUNNING") {
      return existing;
    }

    return prisma.sourceTask.update({
      where: { id: existing.id },
      data: {
        priorityScore: Math.max(existing.priorityScore, input.priorityScore ?? 0),
        notBeforeAt:
          input.notBeforeAt && input.notBeforeAt < existing.notBeforeAt
            ? input.notBeforeAt
            : existing.notBeforeAt,
        payloadJson:
          input.payloadJson != null
            ? (input.payloadJson as Prisma.InputJsonValue)
            : existing.payloadJson != null
              ? (existing.payloadJson as Prisma.InputJsonValue)
              : Prisma.DbNull,
      },
    });
  }

  return enqueueSourceTask(input);
}

export async function claimSourceTasks(
  kind: SourceTaskKind,
  limit: number,
  now: Date = new Date(),
  filters: {
    companySourceIds?: string[];
    excludedConnectorNames?: string[];
  } = {}
) {
  const companySourceIds =
    filters.companySourceIds?.filter((value) => value.trim().length > 0) ?? [];
  if (companySourceIds.length === 0 && filters.companySourceIds) {
    return [];
  }
  const excludedConnectorNames =
    filters.excludedConnectorNames?.filter((value) => value.trim().length > 0) ?? [];

  await recoverStaleRunningSourceTasks(kind, now);
  if (kind === "CONNECTOR_POLL") {
    await reconcileConnectorPollTaskReadiness(now);
  } else if (kind === "REDISCOVERY") {
    await reconcileRediscoveryTaskReadiness(now);
  } else {
    await collapseDuplicatePendingSourceTasks(kind, now);
  }

  const companySourceFilter =
    companySourceIds.length > 0
      ? Prisma.sql`AND st."companySourceId" IN (${Prisma.join(companySourceIds)})`
      : Prisma.empty;
  const excludedConnectorFilter =
    kind === "CONNECTOR_POLL" && excludedConnectorNames.length > 0
      ? Prisma.sql`
        AND NOT EXISTS (
          SELECT 1
          FROM "CompanySource" cs
          WHERE
            cs."id" = st."companySourceId"
            AND cs."connectorName" IN (${Prisma.join(excludedConnectorNames)})
        )
      `
      : Prisma.empty;
  const connectorPollSourceReadinessFilter =
    kind === "CONNECTOR_POLL"
      ? Prisma.sql`
        AND (
          st."companySourceId" IS NULL
          OR EXISTS (
            SELECT 1
            FROM "CompanySource" cs
            WHERE
              cs."id" = st."companySourceId"
              AND ${CONNECTOR_POLL_ELIGIBLE_SOURCE_SQL}
              AND (cs."cooldownUntil" IS NULL OR cs."cooldownUntil" <= ${now})
          )
        )
      `
      : Prisma.empty;
  const rediscoverySourceReadinessFilter =
    kind === "REDISCOVERY"
      ? Prisma.sql`
        AND EXISTS (
          SELECT 1
          FROM "CompanySource" cs
          WHERE
            cs."id" = st."companySourceId"
            AND ${REDISCOVERY_ELIGIBLE_SOURCE_SQL}
            AND (cs."cooldownUntil" IS NULL OR cs."cooldownUntil" <= ${now})
        )
      `
      : Prisma.empty;

  const claimCandidates = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH next_tasks AS (
      SELECT st."id"
      FROM "SourceTask" st
      WHERE
        st."kind" = ${kind}::"SourceTaskKind"
        AND st."status" = 'PENDING'::"SourceTaskStatus"
        AND st."notBeforeAt" <= ${now}
        ${companySourceFilter}
        ${excludedConnectorFilter}
        ${connectorPollSourceReadinessFilter}
        ${rediscoverySourceReadinessFilter}
      ORDER BY st."priorityScore" DESC, st."createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "SourceTask" st
    SET
      "status" = 'RUNNING'::"SourceTaskStatus",
      "startedAt" = ${now},
      "attemptCount" = st."attemptCount" + 1
    FROM next_tasks
    WHERE st."id" = next_tasks."id"
    RETURNING st."id"
  `);

  if (claimCandidates.length === 0) {
    return [];
  }

  const tasks = await prisma.sourceTask.findMany({
    where: {
      id: { in: claimCandidates.map((task) => task.id) },
    },
    orderBy: [{ priorityScore: "desc" }, { createdAt: "asc" }],
  });

  const claimed: SourceTask[] = [];
  const claimedKeys = new Set<string>();
  for (const task of tasks) {
    const taskKey = buildSourceTaskUniquenessKey(task);
    if (claimedKeys.has(taskKey)) {
      await prisma.sourceTask.updateMany({
        where: {
          id: task.id,
          status: "RUNNING",
          startedAt: now,
        },
        data: {
          status: "SKIPPED",
          finishedAt: now,
          lastError:
            "Skipped duplicate source task because an equivalent task was already claimed in this batch.",
        },
      });
      continue;
    }

    const runningDuplicate = await prisma.sourceTask.findFirst({
      where: {
        ...buildSourceTaskUniquenessWhere(task),
        id: { not: task.id },
        status: "RUNNING",
        startedAt: {
          gte: new Date(
            now.getTime() -
              (STALE_RUNNING_TASK_WINDOW_MINUTES[kind] ?? 120) * 60 * 1000
          ),
        },
      },
      select: { id: true },
    });

    if (runningDuplicate) {
      await prisma.sourceTask.updateMany({
        where: {
          id: task.id,
          status: "RUNNING",
          startedAt: now,
        },
        data: {
          status: "SKIPPED",
          finishedAt: now,
          lastError:
            "Skipped duplicate source task because an equivalent task is already running.",
        },
      });
      continue;
    }

    const updated = await prisma.sourceTask.updateMany({
      where: {
        id: task.id,
        status: "RUNNING",
        startedAt: now,
      },
      data: {
        status: "RUNNING",
      },
    });

    if (updated.count === 1) {
      claimed.push(task);
      claimedKeys.add(taskKey);
    }
  }

  return claimed;
}

export async function finishSourceTask(
  taskId: string,
  status: Extract<SourceTaskStatus, "SUCCESS" | "FAILED" | "SKIPPED">,
  options: {
    finishedAt?: Date;
    lastError?: string | null;
    retryAt?: Date | null;
  } = {}
) {
  const finishedAt = options.finishedAt ?? new Date();

  if (status === "FAILED" && options.retryAt) {
    return prisma.sourceTask.update({
      where: { id: taskId },
      data: {
        status: "PENDING",
        startedAt: null,
        finishedAt: null,
        notBeforeAt: options.retryAt,
        lastError: options.lastError ?? null,
      },
    });
  }

  return prisma.sourceTask.update({
    where: { id: taskId },
    data: {
      status,
      finishedAt,
      lastError: options.lastError ?? null,
    },
  });
}
