import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  BAD_URL_HEALTH_RESULTS,
  buildSourceImpact,
  summarizeSourceImpacts,
  type SourceImpact,
  type SourceImpactInput,
  type SourceImpactSummary,
} from "@/lib/ingestion/source-impact-assessment";
import {
  compareSourceIntelligenceBaselines,
  formatSourceIntelligenceComparisonMarkdown,
  type SourceIntelligenceBaselineLike,
} from "@/lib/ingestion/source-intelligence-metrics";

process.env.DATABASE_PROCESS_ROLE =
  process.env.SOURCE_INTELLIGENCE_DATABASE_PROCESS_ROLE ?? "expansion_pipeline";
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ??= "10000";

type Args = {
  promotionReport: string | null;
  before: string | null;
  after: string | null;
  since: Date | null;
  outputDir: string;
  label: string;
};

type PromotionReport = {
  generatedAt?: string;
  promotions?: Array<{
    candidateId?: string;
    companyName?: string | null;
    detectedSource?: {
      connectorName?: string;
      sourceName?: string;
      boardUrl?: string;
    } | null;
    priorityScore?: number;
    promotedSourceId?: string | null;
    validationTaskId?: string | null;
    pollTaskId?: string | null;
    error?: string | null;
  }>;
};

type PromotedSourceRef = {
  sourceId: string;
  candidateId: string | null;
  companyName: string | null;
  sourceName: string | null;
  connectorName: string | null;
  priorityScore: number | null;
};

type SourceImpactRow = Omit<
  SourceImpactInput,
  | "sourceQualityScore"
  | "yieldScore"
  | "priorityScore"
  | "retainedLiveJobCount"
  | "validationSuccessCount"
  | "pollSuccessCount"
  | "recentRunCount"
  | "recentSuccessCount"
  | "recentFailedCount"
  | "recentFetchedCount"
  | "recentAcceptedCount"
  | "recentCreatedCount"
  | "recentDedupedCount"
  | "activeMappingCount"
  | "visibleFeedJobCount"
  | "urlHealthCheckedCount"
  | "urlHealthBadCount"
> & {
  companyId: string;
  sourceQualityScore: number | null;
  yieldScore: number | null;
  priorityScore: number | null;
  retainedLiveJobCount: number | null;
  validationSuccessCount: number | null;
  pollSuccessCount: number | null;
  recentRunCount: bigint | number;
  recentSuccessCount: bigint | number;
  recentFailedCount: bigint | number;
  recentFetchedCount: bigint | number;
  recentAcceptedCount: bigint | number;
  recentCreatedCount: bigint | number;
  recentDedupedCount: bigint | number;
  activeMappingCount: bigint | number;
  visibleFeedJobCount: bigint | number;
  urlHealthCheckedCount: bigint | number;
  urlHealthBadCount: bigint | number;
};

type TaskStatusRow = {
  companySourceId: string;
  kind: string;
  status: string;
  count: bigint | number;
};

const DEFAULT_LABEL = `source-impact-assessment-${new Date().toISOString().slice(0, 10)}`;

function parseArgs(argv: string[]): Args {
  let promotionReport: string | null = null;
  let before: string | null = null;
  let after: string | null = null;
  let since: Date | null = null;
  let outputDir = path.resolve(process.cwd(), "data/discovery");
  let label = DEFAULT_LABEL;

  for (let index = 0; index < argv.length; index += 1) {
    const rawArg = argv[index];
    const equalsIndex = rawArg.indexOf("=");
    const arg = equalsIndex >= 0 ? rawArg.slice(0, equalsIndex) : rawArg;
    const inlineValue = equalsIndex >= 0 ? rawArg.slice(equalsIndex + 1) : undefined;
    const next = argv[index + 1];

    if (arg === "--promotion-report") {
      const value = inlineValue ?? next;
      if (!value) continue;
      promotionReport = path.resolve(process.cwd(), value);
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "--before") {
      const value = inlineValue ?? next;
      if (!value) continue;
      before = path.resolve(process.cwd(), value);
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "--after") {
      const value = inlineValue ?? next;
      if (!value) continue;
      after = path.resolve(process.cwd(), value);
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "--since") {
      const value = inlineValue ?? next;
      if (!value) continue;
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) since = parsed;
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "--output-dir") {
      const value = inlineValue ?? next;
      if (!value) continue;
      outputDir = path.resolve(process.cwd(), value);
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "--label") {
      const value = inlineValue ?? next;
      if (!value) continue;
      label = value.replace(/[^a-zA-Z0-9._-]/g, "-");
      if (!inlineValue) index += 1;
    }
  }

  return { promotionReport, before, after, since, outputDir, label };
}

function toInt(value: bigint | number | null | undefined) {
  if (typeof value === "bigint") return Number(value);
  return value ?? 0;
}

async function readJson<T>(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function promotedSourceRefs(report: PromotionReport): PromotedSourceRef[] {
  const refs = new Map<string, PromotedSourceRef>();

  for (const promotion of report.promotions ?? []) {
    if (!promotion.promotedSourceId || promotion.error) continue;
    refs.set(promotion.promotedSourceId, {
      sourceId: promotion.promotedSourceId,
      candidateId: promotion.candidateId ?? null,
      companyName: promotion.companyName ?? null,
      sourceName: promotion.detectedSource?.sourceName ?? null,
      connectorName: promotion.detectedSource?.connectorName ?? null,
      priorityScore:
        typeof promotion.priorityScore === "number" ? promotion.priorityScore : null,
    });
  }

  return [...refs.values()];
}

async function loadSourceImpacts(
  prisma: PrismaClient,
  sourceIds: string[],
  since: Date
) {
  if (sourceIds.length === 0) return [];

  return prisma.$queryRaw<SourceImpactRow[]>(Prisma.sql`
    WITH selected_sources AS (
      SELECT unnest(${sourceIds}::text[]) AS "sourceId"
    ),
    recent_runs AS (
      SELECT
        ir."sourceName",
        COUNT(*)::bigint AS "recentRunCount",
        COUNT(*) FILTER (WHERE ir."status" = 'SUCCESS')::bigint AS "recentSuccessCount",
        COUNT(*) FILTER (WHERE ir."status" = 'FAILED')::bigint AS "recentFailedCount",
        COALESCE(SUM(ir."fetchedCount"), 0)::bigint AS "recentFetchedCount",
        COALESCE(SUM(ir."acceptedCount"), 0)::bigint AS "recentAcceptedCount",
        COALESCE(SUM(ir."canonicalCreatedCount"), 0)::bigint AS "recentCreatedCount",
        COALESCE(SUM(ir."dedupedCount"), 0)::bigint AS "recentDedupedCount"
      FROM "IngestionRun" ir
      WHERE ir."startedAt" >= ${since}
      GROUP BY ir."sourceName"
    ),
    mapping_rollup AS (
      SELECT
        jsm."sourceName",
        COUNT(*) FILTER (WHERE jsm."removedAt" IS NULL)::bigint AS "activeMappingCount",
        COUNT(DISTINCT jfi."canonicalJobId") FILTER (
          WHERE jsm."removedAt" IS NULL
            AND jfi."status" IN ('LIVE', 'AGING', 'STALE')
        )::bigint AS "visibleFeedJobCount"
      FROM "JobSourceMapping" jsm
      LEFT JOIN "JobFeedIndex" jfi ON jfi."canonicalJobId" = jsm."canonicalJobId"
      WHERE jsm."sourceName" IN (
        SELECT cs."sourceName"
        FROM "CompanySource" cs
        JOIN selected_sources ss ON ss."sourceId" = cs."id"
      )
      GROUP BY jsm."sourceName"
    ),
    health_rollup AS (
      SELECT
        jsm."sourceName",
        COUNT(DISTINCT jhc."id")::bigint AS "urlHealthCheckedCount",
        COUNT(DISTINCT jhc."id") FILTER (
          WHERE jhc."result"::text IN (${Prisma.join([...BAD_URL_HEALTH_RESULTS])})
        )::bigint AS "urlHealthBadCount"
      FROM "JobSourceMapping" jsm
      JOIN "JobUrlHealthCheck" jhc ON jhc."canonicalJobId" = jsm."canonicalJobId"
      WHERE
        jsm."removedAt" IS NULL
        AND jhc."checkedAt" >= ${since}
        AND jsm."sourceName" IN (
          SELECT cs."sourceName"
          FROM "CompanySource" cs
          JOIN selected_sources ss ON ss."sourceId" = cs."id"
        )
      GROUP BY jsm."sourceName"
    )
    SELECT
      cs."id" AS "sourceId",
      cs."companyId",
      c."name" AS "companyName",
      cs."sourceName",
      cs."connectorName",
      cs."boardUrl",
      cs."status"::text AS "status",
      cs."validationState"::text AS "validationState",
      cs."pollState"::text AS "pollState",
      cs."sourceQualityScore",
      cs."yieldScore",
      cs."priorityScore",
      cs."retainedLiveJobCount",
      cs."validationSuccessCount",
      cs."pollSuccessCount",
      COALESCE(rr."recentRunCount", 0)::bigint AS "recentRunCount",
      COALESCE(rr."recentSuccessCount", 0)::bigint AS "recentSuccessCount",
      COALESCE(rr."recentFailedCount", 0)::bigint AS "recentFailedCount",
      COALESCE(rr."recentFetchedCount", 0)::bigint AS "recentFetchedCount",
      COALESCE(rr."recentAcceptedCount", 0)::bigint AS "recentAcceptedCount",
      COALESCE(rr."recentCreatedCount", 0)::bigint AS "recentCreatedCount",
      COALESCE(rr."recentDedupedCount", 0)::bigint AS "recentDedupedCount",
      COALESCE(mr."activeMappingCount", 0)::bigint AS "activeMappingCount",
      COALESCE(mr."visibleFeedJobCount", 0)::bigint AS "visibleFeedJobCount",
      COALESCE(hr."urlHealthCheckedCount", 0)::bigint AS "urlHealthCheckedCount",
      COALESCE(hr."urlHealthBadCount", 0)::bigint AS "urlHealthBadCount"
    FROM selected_sources ss
    JOIN "CompanySource" cs ON cs."id" = ss."sourceId"
    JOIN "Company" c ON c."id" = cs."companyId"
    LEFT JOIN recent_runs rr ON rr."sourceName" = cs."sourceName"
    LEFT JOIN mapping_rollup mr ON mr."sourceName" = cs."sourceName"
    LEFT JOIN health_rollup hr ON hr."sourceName" = cs."sourceName"
    ORDER BY cs."sourceName" ASC
  `);
}

async function loadTaskStatus(
  prisma: PrismaClient,
  sourceIds: string[]
): Promise<TaskStatusRow[]> {
  if (sourceIds.length === 0) return [];

  return prisma.$queryRaw<TaskStatusRow[]>(Prisma.sql`
    SELECT
      "companySourceId",
      "kind"::text AS "kind",
      "status"::text AS "status",
      COUNT(*)::bigint AS "count"
    FROM "SourceTask"
    WHERE "companySourceId" IN (${Prisma.join(sourceIds)})
    GROUP BY "companySourceId", "kind", "status"
  `);
}

function taskCounts(taskRows: TaskStatusRow[]) {
  return taskRows.reduce<Record<string, number>>((record, task) => {
    const key = `${task.kind}:${task.status}`;
    record[key] = (record[key] ?? 0) + toInt(task.count);
    return record;
  }, {});
}

function impactInputFromRow(row: SourceImpactRow): SourceImpactInput {
  return {
    sourceId: row.sourceId,
    companyName: row.companyName,
    sourceName: row.sourceName,
    connectorName: row.connectorName,
    boardUrl: row.boardUrl,
    status: row.status,
    validationState: row.validationState,
    pollState: row.pollState,
    sourceQualityScore: Number(row.sourceQualityScore ?? 0),
    yieldScore: Number(row.yieldScore ?? 0),
    priorityScore: Number(row.priorityScore ?? 0),
    retainedLiveJobCount: Number(row.retainedLiveJobCount ?? 0),
    validationSuccessCount: Number(row.validationSuccessCount ?? 0),
    pollSuccessCount: Number(row.pollSuccessCount ?? 0),
    recentRunCount: toInt(row.recentRunCount),
    recentSuccessCount: toInt(row.recentSuccessCount),
    recentFailedCount: toInt(row.recentFailedCount),
    recentFetchedCount: toInt(row.recentFetchedCount),
    recentAcceptedCount: toInt(row.recentAcceptedCount),
    recentCreatedCount: toInt(row.recentCreatedCount),
    recentDedupedCount: toInt(row.recentDedupedCount),
    activeMappingCount: toInt(row.activeMappingCount),
    visibleFeedJobCount: toInt(row.visibleFeedJobCount),
    urlHealthCheckedCount: toInt(row.urlHealthCheckedCount),
    urlHealthBadCount: toInt(row.urlHealthBadCount),
  };
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function buildMarkdownReport(input: {
  generatedAt: string;
  since: Date;
  promotionReportPath: string | null;
  sourceSummary: SourceImpactSummary;
  impacts: SourceImpact[];
  baselineComparison: ReturnType<typeof compareSourceIntelligenceBaselines> | null;
}) {
  const lines = [
    "# Source Impact Assessment",
    "",
    `Generated at: ${input.generatedAt}`,
    `Since: ${input.since.toISOString()}`,
    input.promotionReportPath ? `Promotion report: ${input.promotionReportPath}` : null,
    "",
    "## Promoted Source Impact",
    "",
    `- Sources assessed: ${input.sourceSummary.totalSources}`,
    `- Recent runs: ${input.sourceSummary.recentRuns}`,
    `- Recent fetched: ${input.sourceSummary.recentFetched}`,
    `- Recent accepted: ${input.sourceSummary.recentAccepted}`,
    `- Recent created: ${input.sourceSummary.recentCreated}`,
    `- Retained live on assessed sources: ${input.sourceSummary.retainedLive}`,
    `- Visible feed jobs on assessed sources: ${input.sourceSummary.visibleFeed}`,
    `- Acceptance rate: ${input.sourceSummary.acceptanceRate}`,
    `- Novelty rate: ${input.sourceSummary.noveltyRate}`,
    `- Bad URL rate from checked URLs: ${input.sourceSummary.badUrlRate}`,
    "",
    "## Verdict Counts",
    "",
    ...Object.entries(input.sourceSummary.verdictCounts).map(
      ([verdict, count]) => `- ${verdict}: ${count}`
    ),
    "",
    "## Source Details",
    "",
    "| Verdict | Company | Source | Connector | Runs | Fetched | Accepted | Created | Retained Live | Feed Live | Validation | Poll | Tasks |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |",
    ...input.impacts.map((impact) =>
      [
        impact.verdict,
        impact.companyName,
        impact.sourceName,
        impact.connectorName,
        String(impact.recentRunCount),
        String(impact.recentFetchedCount),
        String(impact.recentAcceptedCount),
        String(impact.recentCreatedCount),
        String(impact.retainedLiveJobCount),
        String(impact.visibleFeedJobCount),
        impact.validationState,
        impact.pollState,
        Object.entries(impact.tasks)
          .map(([key, count]) => `${key}=${count}`)
          .join(", "),
      ]
        .map(escapeMarkdownCell)
        .join(" | ")
    ).map((row) => `| ${row} |`),
    "",
  ].filter((line): line is string => line !== null);

  if (input.baselineComparison) {
    lines.push(
      "## Overall Baseline Comparison",
      "",
      formatSourceIntelligenceComparisonMarkdown(input.baselineComparison)
    );
  }

  return `${lines.join("\n")}\n`;
}

async function writeReports(input: {
  args: Args;
  generatedAt: string;
  since: Date;
  promotedRefs: PromotedSourceRef[];
  sourceSummary: SourceImpactSummary;
  impacts: SourceImpact[];
  baselineComparison: ReturnType<typeof compareSourceIntelligenceBaselines> | null;
}) {
  await mkdir(input.args.outputDir, { recursive: true });
  const basePath = path.join(input.args.outputDir, input.args.label);
  const payload = {
    generatedAt: input.generatedAt,
    since: input.since.toISOString(),
    promotionReport: input.args.promotionReport,
    promotedRefs: input.promotedRefs,
    sourceSummary: input.sourceSummary,
    impacts: input.impacts,
    baselineComparison: input.baselineComparison,
  };
  const markdown = buildMarkdownReport({
    generatedAt: input.generatedAt,
    since: input.since,
    promotionReportPath: input.args.promotionReport,
    sourceSummary: input.sourceSummary,
    impacts: input.impacts,
    baselineComparison: input.baselineComparison,
  });

  await writeFile(`${basePath}.json`, JSON.stringify(payload, null, 2));
  await writeFile(`${basePath}.md`, markdown);

  return { jsonPath: `${basePath}.json`, markdownPath: `${basePath}.md` };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const promotionReport = args.promotionReport
    ? await readJson<PromotionReport>(args.promotionReport)
    : null;
  const since =
    args.since ??
    (promotionReport?.generatedAt ? new Date(promotionReport.generatedAt) : null) ??
    new Date(Date.now() - 24 * 60 * 60 * 1000);
  const promotedRefs = promotionReport ? promotedSourceRefs(promotionReport) : [];
  const { prisma } = await import("../src/lib/db");
  const sourceIds = promotedRefs.map((ref) => ref.sourceId);
  const [sourceRows, sourceTaskRows] = await Promise.all([
    loadSourceImpacts(prisma, sourceIds, since),
    loadTaskStatus(prisma, sourceIds),
  ]);
  const tasksBySource = new Map<string, TaskStatusRow[]>();

  for (const task of sourceTaskRows) {
    const existing = tasksBySource.get(task.companySourceId) ?? [];
    existing.push(task);
    tasksBySource.set(task.companySourceId, existing);
  }

  const impacts = sourceRows.map((row) =>
    buildSourceImpact(impactInputFromRow(row), taskCounts(tasksBySource.get(row.sourceId) ?? []))
  );
  const sourceSummary = summarizeSourceImpacts(impacts);
  const baselineComparison =
    args.before && args.after
      ? compareSourceIntelligenceBaselines(
          await readJson<SourceIntelligenceBaselineLike>(args.before),
          await readJson<SourceIntelligenceBaselineLike>(args.after)
        )
      : null;
  const reportPaths = await writeReports({
    args,
    generatedAt,
    since,
    promotedRefs,
    sourceSummary,
    impacts,
    baselineComparison,
  });

  console.log(
    JSON.stringify(
      {
        generatedAt,
        since: since.toISOString(),
        sourceSummary,
        reportPaths,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("[source:impact-assessment] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  });
