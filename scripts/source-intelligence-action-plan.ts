import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma, type PrismaClient, type SourceTaskKind } from "@/generated/prisma/client";
import {
  buildSourceIntelligencePlan,
  type PlannerCompanyCoverageGap,
  type PlannerCompanySource,
  type PlannerSourceCandidate,
  type SourceIntelligenceAction,
} from "@/lib/ingestion/source-intelligence-planner";

process.env.DATABASE_PROCESS_ROLE =
  process.env.SOURCE_INTELLIGENCE_DATABASE_PROCESS_ROLE ?? "expansion_pipeline";
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ??= "10000";

type Args = {
  apply: boolean;
  days: number;
  limit: number;
  maxEnqueue: number;
  perKindLimit: number;
  outputDir: string;
  label: string;
};

type SourceRow = {
  id: string;
  companyId: string;
  companyName: string;
  sourceName: string;
  connectorName: string;
  sourceType: string | null;
  extractionRoute: string | null;
  boardUrl: string;
  status: PlannerCompanySource["status"];
  validationState: PlannerCompanySource["validationState"];
  pollState: PlannerCompanySource["pollState"];
  sourceQualityScore: number;
  yieldScore: number;
  priorityScore: number;
  retainedLiveJobCount: number;
  cooldownUntil: Date | null;
  lastSuccessfulPollAt: Date | null;
  lastFailureAt: Date | null;
  consecutiveFailures: number;
  failureStreak: number;
  pollAttemptCount: number;
  pollSuccessCount: number;
  jobsAcceptedCount: number;
  jobsCreatedCount: number;
  lastJobsAcceptedCount: number;
  lastJobsCreatedCount: number;
  recentRunCount: bigint | number;
  recentFailedRunCount: bigint | number;
  recentAcceptedCount: bigint | number;
  recentCreatedCount: bigint | number;
  recentDedupedCount: bigint | number;
  recentRuntimeMs: bigint | number;
};

type CandidateRow = {
  id: string;
  companyId: string | null;
  companyName: string | null;
  companyNameHint: string | null;
  candidateType: string;
  status: PlannerSourceCandidate["status"];
  candidateUrl: string;
  rootDomain: string | null;
  atsPlatform: string | null;
  confidence: number;
  noveltyScore: number;
  coverageGapScore: number;
  potentialYieldScore: number;
  sourceQualityScore: number;
  failureCount: number;
};

type CoverageGapRow = PlannerCompanyCoverageGap;

type EnqueueResult = {
  action: SourceIntelligenceAction;
  taskId: string;
  taskKind: SourceTaskKind;
};

type EnqueueUniqueSourceTask = (input: {
  kind: SourceTaskKind;
  companyId?: string | null;
  companySourceId?: string | null;
  canonicalJobId?: string | null;
  priorityScore?: number;
  notBeforeAt?: Date;
  payloadJson?: Record<string, Prisma.InputJsonValue | null> | null;
}) => Promise<{ id: string }>;

const DEFAULT_LIMIT = 300;
const DEFAULT_MAX_ENQUEUE = 100;
const DEFAULT_PER_KIND_LIMIT = 100;
const TASK_KIND_ENQUEUE_ORDER: SourceTaskKind[] = [
  "CONNECTOR_POLL",
  "REDISCOVERY",
  "SOURCE_VALIDATION",
  "COMPANY_DISCOVERY",
  "URL_HEALTH",
];

function parseArgs(argv: string[]): Args {
  const today = new Date().toISOString().slice(0, 10);
  let apply = false;
  let days = 7;
  let limit = DEFAULT_LIMIT;
  let maxEnqueue = DEFAULT_MAX_ENQUEUE;
  let perKindLimit = DEFAULT_PER_KIND_LIMIT;
  let outputDir = path.resolve(process.cwd(), "data/discovery");
  let label = `source-intelligence-action-plan-${today}`;

  for (let index = 0; index < argv.length; index += 1) {
    const rawArg = argv[index];
    const equalsIndex = rawArg.indexOf("=");
    const arg = equalsIndex >= 0 ? rawArg.slice(0, equalsIndex) : rawArg;
    const inlineValue = equalsIndex >= 0 ? rawArg.slice(equalsIndex + 1) : undefined;
    const next = argv[index + 1];

    if (arg === "--apply") {
      apply = true;
      continue;
    }

    if (arg === "--days" || arg === "-d") {
      const value = inlineValue ?? next;
      if (!value) continue;
      days = parsePositiveInt(value, days);
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "--limit") {
      const value = inlineValue ?? next;
      if (!value) continue;
      limit = parsePositiveInt(value, limit);
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "--max-enqueue") {
      const value = inlineValue ?? next;
      if (!value) continue;
      maxEnqueue = parsePositiveInt(value, maxEnqueue);
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "--per-kind-limit") {
      const value = inlineValue ?? next;
      if (!value) continue;
      perKindLimit = parsePositiveInt(value, perKindLimit);
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

  return { apply, days, limit, maxEnqueue, perKindLimit, outputDir, label };
}

function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toInt(value: bigint | number | null | undefined) {
  if (typeof value === "bigint") return Number(value);
  return value ?? 0;
}

function countBy<T>(items: T[], getKey: (item: T) => string | null | undefined) {
  return items.reduce<Record<string, number>>((record, item) => {
    const key = getKey(item) ?? "UNKNOWN";
    record[key] = (record[key] ?? 0) + 1;
    return record;
  }, {});
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function formatAction(action: SourceIntelligenceAction) {
  return [
    action.kind,
    action.sourceTaskKind ?? "no-task",
    action.priorityScore.toFixed(1),
    action.companyName ?? "",
    action.sourceName ?? "",
    action.url ?? "",
    action.reason,
  ];
}

async function loadSources(
  prisma: PrismaClient,
  cutoff: Date,
  limit: number
): Promise<PlannerCompanySource[]> {
  const rows = await prisma.$queryRaw<SourceRow[]>(Prisma.sql`
    WITH recent_runs AS (
      SELECT
        "sourceName",
        COUNT(*)::bigint AS "recentRunCount",
        COUNT(*) FILTER (WHERE status = 'FAILED')::bigint AS "recentFailedRunCount",
        COALESCE(SUM("acceptedCount"), 0)::bigint AS "recentAcceptedCount",
        COALESCE(SUM("canonicalCreatedCount"), 0)::bigint AS "recentCreatedCount",
        COALESCE(SUM("dedupedCount"), 0)::bigint AS "recentDedupedCount",
        COALESCE(SUM(EXTRACT(EPOCH FROM ("endedAt" - "startedAt")) * 1000), 0)::bigint
          AS "recentRuntimeMs"
      FROM "IngestionRun"
      WHERE "startedAt" >= ${cutoff}
      GROUP BY "sourceName"
    )
    SELECT
      cs."id",
      cs."companyId",
      c."name" AS "companyName",
      cs."sourceName",
      cs."connectorName",
      cs."sourceType",
      cs."extractionRoute"::text AS "extractionRoute",
      cs."boardUrl",
      cs."status"::text AS "status",
      cs."validationState"::text AS "validationState",
      cs."pollState"::text AS "pollState",
      cs."sourceQualityScore",
      cs."yieldScore",
      cs."priorityScore",
      cs."retainedLiveJobCount",
      cs."cooldownUntil",
      cs."lastSuccessfulPollAt",
      cs."lastFailureAt",
      cs."consecutiveFailures",
      cs."failureStreak",
      cs."pollAttemptCount",
      cs."pollSuccessCount",
      cs."jobsAcceptedCount",
      cs."jobsCreatedCount",
      cs."lastJobsAcceptedCount",
      cs."lastJobsCreatedCount",
      COALESCE(rr."recentRunCount", 0)::bigint AS "recentRunCount",
      COALESCE(rr."recentFailedRunCount", 0)::bigint AS "recentFailedRunCount",
      COALESCE(rr."recentAcceptedCount", 0)::bigint AS "recentAcceptedCount",
      COALESCE(rr."recentCreatedCount", 0)::bigint AS "recentCreatedCount",
      COALESCE(rr."recentDedupedCount", 0)::bigint AS "recentDedupedCount",
      COALESCE(rr."recentRuntimeMs", 0)::bigint AS "recentRuntimeMs"
    FROM "CompanySource" cs
    JOIN "Company" c ON c."id" = cs."companyId"
    LEFT JOIN recent_runs rr ON rr."sourceName" = cs."sourceName"
    WHERE
      cs."status" <> 'DISABLED'
      AND cs."pollState" <> 'DISABLED'
      AND (
        cs."retainedLiveJobCount" > 0
        OR cs."sourceQualityScore" >= 0.25
        OR cs."yieldScore" >= 0.05
        OR cs."validationState" IN ('UNVALIDATED', 'SUSPECT', 'NEEDS_REDISCOVERY', 'BLOCKED')
        OR cs."status" IN ('DEGRADED', 'REDISCOVER_REQUIRED')
        OR cs."consecutiveFailures" >= 10
        OR COALESCE(rr."recentCreatedCount", 0) > 0
      )
    ORDER BY
      cs."priorityScore" DESC,
      cs."retainedLiveJobCount" DESC,
      COALESCE(rr."recentCreatedCount", 0) DESC,
      cs."sourceQualityScore" DESC,
      cs."updatedAt" DESC
    LIMIT ${Math.max(limit * 100, 25_000)}
  `);

  return rows.map((row) => ({
    ...row,
    sourceQualityScore: Number(row.sourceQualityScore ?? 0),
    yieldScore: Number(row.yieldScore ?? 0),
    priorityScore: Number(row.priorityScore ?? 0),
    recentRunCount: toInt(row.recentRunCount),
    recentFailedRunCount: toInt(row.recentFailedRunCount),
    recentAcceptedCount: toInt(row.recentAcceptedCount),
    recentCreatedCount: toInt(row.recentCreatedCount),
    recentDedupedCount: toInt(row.recentDedupedCount),
    recentRuntimeMs: toInt(row.recentRuntimeMs),
  }));
}

async function loadCandidates(
  prisma: PrismaClient,
  limit: number
): Promise<PlannerSourceCandidate[]> {
  const rows = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    SELECT
      sc."id",
      sc."companyId",
      c."name" AS "companyName",
      sc."companyNameHint",
      sc."candidateType"::text AS "candidateType",
      sc."status"::text AS "status",
      sc."candidateUrl",
      sc."rootDomain",
      sc."atsPlatform"::text AS "atsPlatform",
      sc."confidence",
      sc."noveltyScore",
      sc."coverageGapScore",
      sc."potentialYieldScore",
      sc."sourceQualityScore",
      sc."failureCount"
    FROM "SourceCandidate" sc
    LEFT JOIN "Company" c ON c."id" = sc."companyId"
    WHERE
      sc."status" IN ('NEW', 'VALIDATED', 'STALE')
      AND sc."failureCount" < 8
      AND (
        sc."confidence" >= 0.6
        OR sc."coverageGapScore" >= 0.6
        OR sc."potentialYieldScore" >= 0.6
      )
    ORDER BY
      sc."coverageGapScore" DESC,
      sc."potentialYieldScore" DESC,
      sc."confidence" DESC,
      sc."lastSeenAt" DESC
    LIMIT ${Math.max(limit * 4, 500)}
  `);

  return rows.map((row) => ({
    ...row,
    confidence: Number(row.confidence ?? 0),
    noveltyScore: Number(row.noveltyScore ?? 0),
    coverageGapScore: Number(row.coverageGapScore ?? 0),
    potentialYieldScore: Number(row.potentialYieldScore ?? 0),
    sourceQualityScore: Number(row.sourceQualityScore ?? 0),
    failureCount: Number(row.failureCount ?? 0),
  }));
}

async function loadCoverageGaps(
  prisma: PrismaClient,
  limit: number
): Promise<PlannerCompanyCoverageGap[]> {
  const rows = await prisma.$queryRaw<CoverageGapRow[]>(Prisma.sql`
    WITH source_rollup AS (
      SELECT
        "companyId",
        COUNT(*)::int AS "sourceCount",
        COUNT(*) FILTER (WHERE "status" IN ('PROVISIONED', 'ACTIVE', 'DEGRADED'))::int
          AS "activeSourceCount",
        COUNT(*) FILTER (WHERE "validationState" = 'VALIDATED')::int AS "validatedSourceCount",
        MAX("sourceQualityScore") AS "maxSourceQualityScore",
        MAX("priorityScore") AS "maxPriorityScore"
      FROM "CompanySource"
      WHERE "status" <> 'DISABLED'
      GROUP BY "companyId"
    ),
    feed_rollup AS (
      SELECT
        jc."companyId",
        COUNT(*)::int AS "feedLiveJobCount"
      FROM "JobFeedIndex" jfi
      JOIN "JobCanonical" jc ON jc."id" = jfi."canonicalJobId"
      WHERE jfi."status" IN ('LIVE', 'AGING', 'STALE') AND jc."companyId" IS NOT NULL
      GROUP BY jc."companyId"
    ),
    canonical_rollup AS (
      SELECT
        "companyId",
        COUNT(*)::int AS "canonicalVisibleJobCount"
      FROM "JobCanonical"
      WHERE "status" IN ('LIVE', 'AGING', 'STALE') AND "companyId" IS NOT NULL
      GROUP BY "companyId"
    )
    SELECT
      c."id" AS "companyId",
      c."name" AS "companyName",
      c."domain",
      c."careersUrl",
      sr."sourceCount",
      sr."activeSourceCount",
      sr."validatedSourceCount",
      COALESCE(fr."feedLiveJobCount", 0)::int AS "feedLiveJobCount",
      COALESCE(cr."canonicalVisibleJobCount", 0)::int AS "canonicalVisibleJobCount",
      COALESCE(sr."maxSourceQualityScore", 0) AS "maxSourceQualityScore",
      COALESCE(sr."maxPriorityScore", 0) AS "maxPriorityScore"
    FROM source_rollup sr
    JOIN "Company" c ON c."id" = sr."companyId"
    LEFT JOIN feed_rollup fr ON fr."companyId" = c."id"
    LEFT JOIN canonical_rollup cr ON cr."companyId" = c."id"
    WHERE
      sr."sourceCount" > 0
      AND COALESCE(fr."feedLiveJobCount", 0) <= 2
      AND (
        sr."validatedSourceCount" > 0
        OR COALESCE(sr."maxSourceQualityScore", 0) >= 0.7
        OR COALESCE(sr."maxPriorityScore", 0) >= 1
      )
    ORDER BY
      sr."validatedSourceCount" DESC,
      sr."maxSourceQualityScore" DESC,
      sr."maxPriorityScore" DESC,
      sr."sourceCount" DESC,
      c."updatedAt" DESC
    LIMIT ${Math.max(limit * 2, 300)}
  `);

  return rows.map((row) => ({
    ...row,
    sourceCount: toInt(row.sourceCount),
    activeSourceCount: toInt(row.activeSourceCount),
    validatedSourceCount: toInt(row.validatedSourceCount),
    feedLiveJobCount: toInt(row.feedLiveJobCount),
    canonicalVisibleJobCount: toInt(row.canonicalVisibleJobCount),
    maxSourceQualityScore: Number(row.maxSourceQualityScore ?? 0),
    maxPriorityScore: Number(row.maxPriorityScore ?? 0),
  }));
}

async function enqueueActions(
  enqueueUniqueSourceTask: EnqueueUniqueSourceTask,
  actions: SourceIntelligenceAction[],
  maxEnqueue: number
): Promise<EnqueueResult[]> {
  const taskActions = actions
    .filter((action) => action.sourceTaskKind && action.companySourceId)
    .sort((left, right) => right.priorityScore - left.priorityScore);
  const buckets = new Map<SourceTaskKind, SourceIntelligenceAction[]>();
  for (const action of taskActions) {
    const taskKind = action.sourceTaskKind as SourceTaskKind;
    const bucket = buckets.get(taskKind) ?? [];
    bucket.push(action);
    buckets.set(taskKind, bucket);
  }
  const results: EnqueueResult[] = [];

  while (results.length < maxEnqueue) {
    let pickedAny = false;

    for (const taskKind of TASK_KIND_ENQUEUE_ORDER) {
      if (results.length >= maxEnqueue) break;

      const bucket = buckets.get(taskKind);
      const action = bucket?.shift();
      if (!action) continue;

      pickedAny = true;
      const task = await enqueueUniqueSourceTask({
        kind: taskKind,
        companyId: action.companyId ?? null,
        companySourceId: action.companySourceId ?? null,
        priorityScore: action.priorityScore,
        payloadJson: {
          source: "source_intelligence_action_plan",
          actionKind: action.kind,
          reason: action.reason,
          evidence: toJsonValue(action.evidence),
        },
      });

      results.push({ action, taskId: task.id, taskKind });
    }

    if (!pickedAny) break;
  }

  return results;
}

function buildPerKindLimit(limit: number) {
  return {
    POLL_SOURCE: limit,
    VALIDATE_SOURCE: limit,
    REDISCOVER_SOURCE: limit,
    REVIEW_CANDIDATE: limit,
    REVIEW_COVERAGE_GAP: limit,
    COOLDOWN_LOW_VALUE: limit,
  } satisfies NonNullable<Parameters<typeof buildSourceIntelligencePlan>[0]["options"]>["perKindLimit"];
}

function buildMarkdownReport(input: {
  args: Args;
  generatedAt: string;
  sourceCount: number;
  candidateCount: number;
  coverageGapCount: number;
  actions: SourceIntelligenceAction[];
  enqueued: EnqueueResult[];
}) {
  const actionCounts = countBy(input.actions, (action) => action.kind);
  const taskCounts = countBy(input.actions, (action) => action.sourceTaskKind ?? "NO_TASK");
  const enqueueCounts = countBy(input.enqueued, (result) => result.taskKind);
  const topActions = input.actions.slice(0, 50).map(formatAction);

  const lines = [
    `# Source Intelligence Action Plan (${input.args.label})`,
    "",
    `Generated at: ${input.generatedAt}`,
    `Mode: ${input.args.apply ? "apply" : "dry-run"}`,
    `Window: last ${input.args.days} days`,
    "",
    "## Inputs",
    "",
    `- Sources loaded: ${input.sourceCount.toLocaleString()}`,
    `- Source candidates loaded: ${input.candidateCount.toLocaleString()}`,
    `- Coverage gaps loaded: ${input.coverageGapCount.toLocaleString()}`,
    `- Per-kind action cap: ${input.args.perKindLimit.toLocaleString()}`,
    "",
    "## Action Counts",
    "",
    ...Object.entries(actionCounts).map(([kind, count]) => `- ${kind}: ${count}`),
    "",
    "## Task-Kind Counts",
    "",
    ...Object.entries(taskCounts).map(([kind, count]) => `- ${kind}: ${count}`),
    "",
    "## Enqueued",
    "",
    input.args.apply
      ? `- Enqueued/updated tasks: ${input.enqueued.length.toLocaleString()}`
      : "- Dry-run only; no tasks enqueued.",
    ...Object.entries(enqueueCounts).map(([kind, count]) => `- ${kind}: ${count}`),
    "",
    "## Top Actions",
    "",
    "| Kind | Task | Priority | Company | Source | URL | Reason |",
    "| --- | --- | ---: | --- | --- | --- | --- |",
    ...topActions.map((row) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`),
    "",
    "## Safety Notes",
    "",
    "- This script does not disable, mutate, or delete company sources.",
    "- Apply mode only enqueues existing source tasks through enqueueUniqueSourceTask.",
    "- COOLDOWN_LOW_VALUE, REVIEW_CANDIDATE, and REVIEW_COVERAGE_GAP are report-only actions in this phase.",
  ];

  return `${lines.join("\n")}\n`;
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

async function writeReports(input: {
  args: Args;
  generatedAt: string;
  sources: PlannerCompanySource[];
  candidates: PlannerSourceCandidate[];
  coverageGaps: PlannerCompanyCoverageGap[];
  actions: SourceIntelligenceAction[];
  enqueued: EnqueueResult[];
}) {
  await mkdir(input.args.outputDir, { recursive: true });
  const basePath = path.join(input.args.outputDir, input.args.label);
  const payload = {
    generatedAt: input.generatedAt,
    mode: input.args.apply ? "apply" : "dry-run",
    args: input.args,
    inputCounts: {
      sources: input.sources.length,
      candidates: input.candidates.length,
      coverageGaps: input.coverageGaps.length,
    },
    actionCounts: countBy(input.actions, (action) => action.kind),
    taskKindCounts: countBy(input.actions, (action) => action.sourceTaskKind ?? "NO_TASK"),
    enqueuedCounts: countBy(input.enqueued, (result) => result.taskKind),
    actions: input.actions,
    enqueued: input.enqueued.map((result) => ({
      taskId: result.taskId,
      taskKind: result.taskKind,
      actionKind: result.action.kind,
      companySourceId: result.action.companySourceId,
      companyName: result.action.companyName,
      sourceName: result.action.sourceName,
      priorityScore: result.action.priorityScore,
    })),
  };

  const markdown = buildMarkdownReport({
    args: input.args,
    generatedAt: input.generatedAt,
    sourceCount: input.sources.length,
    candidateCount: input.candidates.length,
    coverageGapCount: input.coverageGaps.length,
    actions: input.actions,
    enqueued: input.enqueued,
  });

  await writeFile(`${basePath}.json`, JSON.stringify(payload, null, 2));
  await writeFile(`${basePath}.md`, markdown);

  return { jsonPath: `${basePath}.json`, markdownPath: `${basePath}.md` };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const cutoff = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
  const [{ prisma }, { enqueueUniqueSourceTask }] = await Promise.all([
    import("../src/lib/db"),
    import("../src/lib/ingestion/task-queue"),
  ]);

  const [sources, candidates, coverageGaps] = await Promise.all([
    loadSources(prisma, cutoff, args.limit),
    loadCandidates(prisma, args.limit),
    loadCoverageGaps(prisma, args.limit),
  ]);

  const actions = buildSourceIntelligencePlan({
    sources,
    candidates,
    coverageGaps,
    options: {
      now: new Date(),
      limit: args.limit,
      perKindLimit: buildPerKindLimit(args.perKindLimit),
    },
  });
  const enqueued = args.apply
    ? await enqueueActions(enqueueUniqueSourceTask, actions, args.maxEnqueue)
    : [];
  const reportPaths = await writeReports({
    args,
    generatedAt,
    sources,
    candidates,
    coverageGaps,
    actions,
    enqueued,
  });

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? "apply" : "dry-run",
        inputCounts: {
          sources: sources.length,
          candidates: candidates.length,
          coverageGaps: coverageGaps.length,
        },
        actionCounts: countBy(actions, (action) => action.kind),
        taskKindCounts: countBy(actions, (action) => action.sourceTaskKind ?? "NO_TASK"),
        enqueuedCount: enqueued.length,
        perKindLimit: args.perKindLimit,
        reportPaths,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("[source:intelligence-plan] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  });
