import "dotenv/config";

import { prisma } from "../src/lib/db";
import {
  INACTIVE_JOB_RETENTION_DAYS,
  INACTIVE_JOB_STATUSES,
} from "../src/lib/ingestion/inactive-job-retention";

type ParsedArgs = {
  apply: boolean;
  setCompression: boolean;
  vacuum: boolean;
  batchSize: number;
  maxBatches: number;
  healthRetentionDays: number;
  healthKeepPerJobType: number;
  runRetentionDays: number;
  runKeepPerConnector: number;
  taskSuccessRetentionDays: number;
  taskFailedRetentionDays: number;
  inactiveCanonicalRetentionDays: number;
  unmappedRawRetentionDays: number;
  targetNames: string[];
};

type CleanupTarget = {
  name: string;
  tableName: string;
  cascadeVacuumTableNames?: string[];
  countSql: string;
  buildSql: (limit: number) => string;
};

const DEFAULTS: ParsedArgs = {
  apply: false,
  setCompression: false,
  vacuum: false,
  batchSize: 10_000,
  maxBatches: 20,
  healthRetentionDays: 14,
  healthKeepPerJobType: 1,
  runRetentionDays: 14,
  runKeepPerConnector: 10,
  taskSuccessRetentionDays: 3,
  taskFailedRetentionDays: 14,
  inactiveCanonicalRetentionDays: INACTIVE_JOB_RETENTION_DAYS,
  unmappedRawRetentionDays: 14,
  targetNames: [],
};

function parseArgs(argv: string[]): ParsedArgs {
  const args = { ...DEFAULTS };

  for (const rawArg of argv) {
    if (rawArg === "--apply") {
      args.apply = true;
      continue;
    }
    if (rawArg === "--set-compression") {
      args.setCompression = true;
      continue;
    }
    if (rawArg === "--vacuum") {
      args.vacuum = true;
      continue;
    }

    const [rawKey, rawValue] = rawArg.replace(/^--/, "").split("=");
    if (rawKey === "target") {
      const targetName = rawValue?.trim();
      if (!targetName) {
        throw new Error("--target requires a cleanup target name");
      }
      args.targetNames.push(targetName);
      continue;
    }
    if (!rawValue) continue;
    const value = readPositiveInteger(rawValue, rawKey);

    if (rawKey === "batch-size") args.batchSize = value;
    if (rawKey === "max-batches") args.maxBatches = value;
    if (rawKey === "health-retention-days") args.healthRetentionDays = value;
    if (rawKey === "health-keep-per-job-type") args.healthKeepPerJobType = value;
    if (rawKey === "run-retention-days") args.runRetentionDays = value;
    if (rawKey === "run-keep-per-connector") args.runKeepPerConnector = value;
    if (rawKey === "task-success-retention-days") {
      args.taskSuccessRetentionDays = value;
    }
    if (rawKey === "task-failed-retention-days") args.taskFailedRetentionDays = value;
    if (rawKey === "inactive-canonical-retention-days") {
      args.inactiveCanonicalRetentionDays = value;
    }
    if (rawKey === "unmapped-raw-retention-days") {
      args.unmappedRawRetentionDays = value;
    }
  }

  return args;
}

function readPositiveInteger(value: string, key: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${key} value "${value}"`);
  }
  return parsed;
}

function intSql(value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Unsafe SQL integer value: ${value}`);
  }
  return String(value);
}

async function getTableSizes() {
  return prisma.$queryRawUnsafe<
    Array<{
      table_name: string;
      total_size: string;
      table_size: string;
      indexes_toast_size: string;
      est_live_rows: bigint;
      est_dead_rows: bigint;
    }>
  >(`
    select
      c.relname as table_name,
      pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
      pg_size_pretty(pg_relation_size(c.oid)) as table_size,
      pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) as indexes_toast_size,
      coalesce(s.n_live_tup, 0)::bigint as est_live_rows,
      coalesce(s.n_dead_tup, 0)::bigint as est_dead_rows
    from pg_class c
    left join pg_stat_user_tables s on s.relid = c.oid
    where c.relkind = 'r'
      and c.relname in (
        'JobRaw',
        'NormalizedJobRecord',
        'JobCanonical',
        'JobFeedIndex',
        'JobSourceMapping',
        'JobUrlHealthCheck',
        'IngestionRun',
        'SourceTask'
      )
    order by pg_total_relation_size(c.oid) desc
  `);
}

async function countRows(sql: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(sql);
  return Number(rows[0]?.count ?? 0);
}

async function executeDelete(sql: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ deleted_count: bigint }>>(sql);
  return Number(rows[0]?.deleted_count ?? 0);
}

function buildTargets(args: ParsedArgs): CleanupTarget[] {
  const healthRetention = intSql(args.healthRetentionDays);
  const healthKeep = intSql(args.healthKeepPerJobType);
  const runRetention = intSql(args.runRetentionDays);
  const runKeep = intSql(args.runKeepPerConnector);
  const taskSuccessRetention = intSql(args.taskSuccessRetentionDays);
  const taskFailedRetention = intSql(args.taskFailedRetentionDays);
  const inactiveCanonicalRetention = intSql(args.inactiveCanonicalRetentionDays);
  const rawRetention = intSql(args.unmappedRawRetentionDays);
  const inactiveStatuses = INACTIVE_JOB_STATUSES.map((status) => `'${status}'`).join(", ");

  return [
    {
      name: "old-unreferenced-inactive-canonical-jobs",
      tableName: "JobCanonical",
      cascadeVacuumTableNames: [
        "JobFeedIndex",
        "JobSourceMapping",
        "JobUrlHealthCheck",
        "JobEligibility",
        "NormalizedJobRecord",
        "SourceTask",
        "IngestionRun",
        "UserTopPick",
        "UserJobPreferenceFeedback",
      ],
      countSql: `
        select count(*)::bigint as count
        from "JobCanonical" job
        where job.status in (${inactiveStatuses})
          and coalesce(job."removedAt", job."expiredAt", job."updatedAt")
            < now() - interval '${inactiveCanonicalRetention} days'
          -- Preserve user-saved jobs and submitted application material.
          and not exists (
            select 1 from "SavedJob" saved where saved."canonicalJobId" = job.id
          )
          and not exists (
            select 1 from "ApplicationSubmission" submission where submission."canonicalJobId" = job.id
          )
          and not exists (
            select 1 from "ApplicationPackage" package where package."canonicalJobId" = job.id
          )
      `,
      buildSql: (limit) => `
        with doomed as (
          select job.id
          from "JobCanonical" job
          where job.status in (${inactiveStatuses})
            and coalesce(job."removedAt", job."expiredAt", job."updatedAt")
              < now() - interval '${inactiveCanonicalRetention} days'
            -- A tracker record is safe to retain because its canonical FK is
            -- SET NULL and it stores its own company/title snapshot.
            and not exists (
              select 1 from "SavedJob" saved where saved."canonicalJobId" = job.id
            )
            and not exists (
              select 1 from "ApplicationSubmission" submission where submission."canonicalJobId" = job.id
            )
            and not exists (
              select 1 from "ApplicationPackage" package where package."canonicalJobId" = job.id
            )
          order by coalesce(job."removedAt", job."expiredAt", job."updatedAt") asc
          limit ${intSql(limit)}
        ),
        deleted as (
          delete from "JobCanonical"
          where id in (select id from doomed)
          returning 1
        )
        select count(*)::bigint as deleted_count from deleted
      `,
    },
    {
      name: "old-url-health-checks",
      tableName: "JobUrlHealthCheck",
      countSql: `
        with ranked as (
          select
            id,
            row_number() over (
              partition by "canonicalJobId", "urlType"
              order by "checkedAt" desc
            ) as rn
          from "JobUrlHealthCheck"
          where "checkedAt" < now() - interval '${healthRetention} days'
        )
        select count(*)::bigint as count
        from ranked
        where rn > ${healthKeep}
      `,
      buildSql: (limit) => `
        with ranked as (
          select
            id,
            row_number() over (
              partition by "canonicalJobId", "urlType"
              order by "checkedAt" desc
            ) as rn
          from "JobUrlHealthCheck"
          where "checkedAt" < now() - interval '${healthRetention} days'
        ),
        doomed as (
          select id
          from ranked
          where rn > ${healthKeep}
          limit ${intSql(limit)}
        ),
        deleted as (
          delete from "JobUrlHealthCheck"
          where id in (select id from doomed)
          returning 1
        )
        select count(*)::bigint as deleted_count from deleted
      `,
    },
    {
      name: "old-ingestion-runs",
      tableName: "IngestionRun",
      countSql: `
        with ranked as (
          select
            id,
            row_number() over (
              partition by "connectorKey"
              order by "startedAt" desc
            ) as rn
          from "IngestionRun"
          where status <> 'RUNNING'
        )
        select count(*)::bigint as count
        from "IngestionRun" run
        join ranked on ranked.id = run.id
        where ranked.rn > ${runKeep}
          and run."startedAt" < now() - interval '${runRetention} days'
      `,
      buildSql: (limit) => `
        with ranked as (
          select
            id,
            row_number() over (
              partition by "connectorKey"
              order by "startedAt" desc
            ) as rn
          from "IngestionRun"
          where status <> 'RUNNING'
        ),
        doomed as (
          select run.id
          from "IngestionRun" run
          join ranked on ranked.id = run.id
          where ranked.rn > ${runKeep}
            and run."startedAt" < now() - interval '${runRetention} days'
          limit ${intSql(limit)}
        ),
        deleted as (
          delete from "IngestionRun"
          where id in (select id from doomed)
          returning 1
        )
        select count(*)::bigint as deleted_count from deleted
      `,
    },
    {
      name: "old-success-source-tasks",
      tableName: "SourceTask",
      countSql: `
        select count(*)::bigint as count
        from "SourceTask"
        where status in ('SUCCESS', 'SKIPPED')
          and coalesce("finishedAt", "updatedAt") < now() - interval '${taskSuccessRetention} days'
      `,
      buildSql: (limit) => `
        with doomed as (
          select id
          from "SourceTask"
          where status in ('SUCCESS', 'SKIPPED')
            and coalesce("finishedAt", "updatedAt") < now() - interval '${taskSuccessRetention} days'
          limit ${intSql(limit)}
        ),
        deleted as (
          delete from "SourceTask"
          where id in (select id from doomed)
          returning 1
        )
        select count(*)::bigint as deleted_count from deleted
      `,
    },
    {
      name: "old-failed-source-tasks",
      tableName: "SourceTask",
      countSql: `
        select count(*)::bigint as count
        from "SourceTask"
        where status = 'FAILED'
          and coalesce("finishedAt", "updatedAt") < now() - interval '${taskFailedRetention} days'
      `,
      buildSql: (limit) => `
        with doomed as (
          select id
          from "SourceTask"
          where status = 'FAILED'
            and coalesce("finishedAt", "updatedAt") < now() - interval '${taskFailedRetention} days'
          limit ${intSql(limit)}
        ),
        deleted as (
          delete from "SourceTask"
          where id in (select id from doomed)
          returning 1
        )
        select count(*)::bigint as deleted_count from deleted
      `,
    },
    {
      name: "old-unmapped-raw-jobs",
      tableName: "JobRaw",
      cascadeVacuumTableNames: ["NormalizedJobRecord"],
      countSql: `
        select count(*)::bigint as count
        from "JobRaw" raw
        left join "JobSourceMapping" mapping on mapping."rawJobId" = raw.id
        left join "NormalizedJobRecord" record on record."rawJobId" = raw.id
        where mapping.id is null
          and raw."fetchedAt" < now() - interval '${rawRetention} days'
          and (record.id is null or record."canonicalJobId" is null)
      `,
      buildSql: (limit) => `
        with doomed as (
          select raw.id
          from "JobRaw" raw
          left join "JobSourceMapping" mapping on mapping."rawJobId" = raw.id
          left join "NormalizedJobRecord" record on record."rawJobId" = raw.id
          where mapping.id is null
            and raw."fetchedAt" < now() - interval '${rawRetention} days'
            and (record.id is null or record."canonicalJobId" is null)
          limit ${intSql(limit)}
        ),
        deleted as (
          delete from "JobRaw"
          where id in (select id from doomed)
          returning 1
        )
        select count(*)::bigint as deleted_count from deleted
      `,
    },
  ];
}

async function applyCompressionSettings() {
  const statements = [
    `alter table "JobRaw" alter column "rawPayload" set compression lz4`,
    `alter table "NormalizedJobRecord" alter column "description" set compression lz4`,
    `alter table "NormalizedJobRecord" alter column "metadataJson" set compression lz4`,
    `alter table "NormalizedJobRecord" alter column "warningsJson" set compression lz4`,
    `alter table "JobCanonical" alter column "description" set compression lz4`,
    `alter table "JobCanonical" alter column "shortSummary" set compression lz4`,
    `alter table "JobFeedIndex" alter column "searchText" set compression lz4`,
    `alter table "JobFeedIndex" alter column "metadataJson" set compression lz4`,
    `alter table "JobUrlHealthCheck" alter column "responseSnippet" set compression lz4`,
    `alter table "JobUrlHealthCheck" alter column "metadataJson" set compression lz4`,
    `alter table "IngestionRun" alter column "skippedReasons" set compression lz4`,
    `alter table "IngestionRun" alter column "runOptions" set compression lz4`,
    `alter table "IngestionRun" alter column "errorSummary" set compression lz4`,
    `alter table "SourceTask" alter column "payloadJson" set compression lz4`,
    `alter table "SourceTask" alter column "lastError" set compression lz4`,
  ];

  for (const statement of statements) {
    try {
      await prisma.$executeRawUnsafe(statement);
      console.log(`[compression] applied: ${statement}`);
    } catch (error) {
      console.log(
        `[compression] skipped: ${statement} (${error instanceof Error ? error.message : String(error)})`
      );
    }
  }
}

async function runVacuum(tableNames: string[]) {
  for (const tableName of [...new Set(tableNames)]) {
    await prisma.$executeRawUnsafe(`vacuum (analyze) "${tableName}"`);
    console.log(`[vacuum] analyzed ${tableName}`);
  }
}

function printSizes(label: string, rows: Awaited<ReturnType<typeof getTableSizes>>) {
  console.log(`\n[storage-lifecycle] ${label}`);
  for (const row of rows) {
    console.log(
      [
        row.table_name.padEnd(22),
        `total=${row.total_size}`.padEnd(16),
        `table=${row.table_size}`.padEnd(16),
        `idx+toast=${row.indexes_toast_size}`.padEnd(20),
        `live~=${row.est_live_rows}`,
        `dead~=${row.est_dead_rows}`,
      ].join(" ")
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targets = buildTargets(args);
  const selectedTargets =
    args.targetNames.length === 0
      ? targets
      : targets.filter((target) => args.targetNames.includes(target.name));
  const unknownTargetNames = args.targetNames.filter(
    (targetName) => !targets.some((target) => target.name === targetName)
  );
  if (unknownTargetNames.length > 0) {
    throw new Error(`Unknown cleanup target(s): ${unknownTargetNames.join(", ")}`);
  }

  console.log(
    `[storage-lifecycle] mode=${args.apply ? "apply" : "dry-run"} batchSize=${args.batchSize} maxBatches=${args.maxBatches} targets=${selectedTargets.map((target) => target.name).join(",")}`
  );

  printSizes("before", await getTableSizes());

  if (args.setCompression && args.apply) {
    await applyCompressionSettings();
  } else if (args.setCompression) {
    console.log("[compression] dry-run; pass --apply to alter column compression settings");
  }

  const touchedTables = new Set<string>();
  for (const target of selectedTargets) {
    if (!args.apply) {
      const count = await countRows(target.countSql);
      console.log(`[${target.name}] dry-run candidates=${count}`);
      continue;
    }

    let totalDeleted = 0;
    for (let batch = 1; batch <= args.maxBatches; batch += 1) {
      const deleted = await executeDelete(target.buildSql(args.batchSize));
      totalDeleted += deleted;
      if (deleted > 0) {
        touchedTables.add(target.tableName);
        for (const cascadeTableName of target.cascadeVacuumTableNames ?? []) {
          touchedTables.add(cascadeTableName);
        }
      }
      console.log(`[${target.name}] batch=${batch} deleted=${deleted} total=${totalDeleted}`);
      if (deleted < args.batchSize) break;
    }
  }

  if (args.apply && args.vacuum && touchedTables.size > 0) {
    await runVacuum([...touchedTables]);
  }

  printSizes("after", await getTableSizes());
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
