import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  buildSourceCandidatePromotionPlan,
  selectPromotionValidationActions,
  type ExistingPromotionSource,
  type PromotionCandidate,
  type SourceCandidatePromotionAction,
} from "@/lib/ingestion/source-candidate-promotion-planner";

process.env.DATABASE_PROCESS_ROLE =
  process.env.SOURCE_INTELLIGENCE_DATABASE_PROCESS_ROLE ?? "expansion_pipeline";
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ??= "10000";

type Args = {
  apply: boolean;
  writeReport: boolean;
  limit: number;
  maxPromote: number;
  maxValidate: number;
  atsValidationShare: number;
  outputDir: string;
  label: string;
};

type PromotionResult = {
  action: SourceCandidatePromotionAction;
  operation: "validate" | "promote";
  promotedSourceId: string | null;
  validationPipelineTaskId: string | null;
  validationTaskId: string | null;
  pollTaskId: string | null;
  error: string | null;
};

const DEFAULT_LIMIT = 300;
const DEFAULT_MAX_PROMOTE = 25;
const DEFAULT_MAX_VALIDATE = 100;
const DEFAULT_ATS_VALIDATION_SHARE = 0.6;

function parseArgs(argv: string[]): Args {
  const today = new Date().toISOString().slice(0, 10);
  let apply = false;
  let writeReport = true;
  let limit = DEFAULT_LIMIT;
  let maxPromote = DEFAULT_MAX_PROMOTE;
  let maxValidate = DEFAULT_MAX_VALIDATE;
  let atsValidationShare = parseFraction(
    process.env.SOURCE_CANDIDATE_PROMOTION_ATS_VALIDATION_SHARE,
    DEFAULT_ATS_VALIDATION_SHARE
  );
  let outputDir = path.resolve(process.cwd(), "data/discovery");
  let label = `source-candidate-promotion-plan-${today}`;

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

    if (arg === "--no-report") {
      writeReport = false;
      continue;
    }

    if (arg === "--limit") {
      const value = inlineValue ?? next;
      if (!value) continue;
      limit = parsePositiveInt(value, limit);
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "--max-promote") {
      const value = inlineValue ?? next;
      if (!value) continue;
      maxPromote = parseNonNegativeInt(value, maxPromote);
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "--max-validate") {
      const value = inlineValue ?? next;
      if (!value) continue;
      maxValidate = parseNonNegativeInt(value, maxValidate);
      if (!inlineValue) index += 1;
      continue;
    }

    if (arg === "--ats-validation-share") {
      const value = inlineValue ?? next;
      if (!value) continue;
      atsValidationShare = parseFraction(value, atsValidationShare);
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

  return {
    apply,
    writeReport,
    limit,
    maxPromote,
    maxValidate,
    atsValidationShare,
    outputDir,
    label,
  };
}

function parsePositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseFraction(value: string | undefined, fallback: number) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
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

async function loadCandidates(
  prisma: PrismaClient,
  limit: number
): Promise<PromotionCandidate[]> {
  const staleRetryHours = Math.max(
    1,
    Number.parseInt(process.env.SOURCE_CANDIDATE_STALE_RETRY_HOURS ?? "24", 10) || 24
  );
  const maxValidationFailures = Math.max(
    3,
    Number.parseInt(process.env.SOURCE_CANDIDATE_MAX_VALIDATION_FAILURES ?? "5", 10) || 5
  );
  const staleRetryBefore = new Date(Date.now() - staleRetryHours * 60 * 60 * 1000);
  const candidateQualityWhere = {
    // Keep planner eligibility aligned with the runtime validation guard.
    failureCount: { lt: maxValidationFailures },
    OR: [
      { confidence: { gte: 0.58 } },
      { coverageGapScore: { gte: 0.55 } },
      { potentialYieldScore: { gte: 0.55 } },
      { sourceQualityScore: { gte: 0.6 } },
    ],
  } satisfies Prisma.SourceCandidateWhereInput;
  const include = {
    company: {
      select: {
        id: true,
        name: true,
        companyKey: true,
        domain: true,
        careersUrl: true,
      },
    },
  } satisfies Prisma.SourceCandidateInclude;
  const orderBy = [
    { potentialYieldScore: "desc" },
    { coverageGapScore: "desc" },
    { sourceQualityScore: "desc" },
    { confidence: "desc" },
    { lastValidatedAt: "desc" },
    { lastSeenAt: "desc" },
  ] satisfies Prisma.SourceCandidateOrderByWithRelationInput[];
  const [validatedRows, newOrStaleRows, promotedOrphanRows] = await Promise.all([
    prisma.sourceCandidate.findMany({
      where: {
        ...candidateQualityWhere,
        status: "VALIDATED",
      },
      include,
      orderBy,
      take: Math.max(limit * 2, 400),
    }),
    prisma.sourceCandidate.findMany({
      where: {
        ...candidateQualityWhere,
        OR: [
          { status: "NEW" },
          {
            status: "STALE",
            OR: [
              { lastValidatedAt: null },
              { lastValidatedAt: { lt: staleRetryBefore } },
            ],
          },
        ],
      },
      include,
      orderBy,
      take: Math.max(limit * 3, 600),
    }),
    prisma.sourceCandidate.findMany({
      where: {
        ...candidateQualityWhere,
        status: "PROMOTED",
        atsTenantId: { not: null },
        companyId: { not: null },
        atsTenant: { is: { companySource: { is: null } } },
      },
      include,
      orderBy,
      take: Math.max(limit * 2, 400),
    }),
  ]);
  const seenIds = new Set<string>();
  const orphanIds = new Set(promotedOrphanRows.map((row) => row.id));
  const rows = [...promotedOrphanRows, ...validatedRows, ...newOrStaleRows]
    .filter((row) => {
      if (seenIds.has(row.id)) return false;
      seenIds.add(row.id);
      return true;
    })
    .slice(0, Math.max(limit * 5, 1_000));

  return rows.map((row) => ({
    id: row.id,
    companyId: row.companyId,
    company: row.company,
    atsTenantId: row.atsTenantId,
    candidateType: row.candidateType,
    status: row.status,
    candidateUrl: row.candidateUrl,
    rootDomain: row.rootDomain,
    companyNameHint: row.companyNameHint,
    atsPlatform: row.atsPlatform,
    atsTenantKey: row.atsTenantKey,
    confidence: Number(row.confidence ?? 0),
    noveltyScore: Number(row.noveltyScore ?? 0),
    coverageGapScore: Number(row.coverageGapScore ?? 0),
    potentialYieldScore: Number(row.potentialYieldScore ?? 0),
    sourceQualityScore: Number(row.sourceQualityScore ?? 0),
    failureCount: Number(row.failureCount ?? 0),
    lastValidatedAt: row.lastValidatedAt,
    repairMissingSource: orphanIds.has(row.id),
  }));
}

async function loadExistingSources(
  prisma: PrismaClient
): Promise<ExistingPromotionSource[]> {
  const rows = await prisma.companySource.findMany({
    where: { status: { not: "DISABLED" } },
    select: {
      id: true,
      companyId: true,
      connectorName: true,
      token: true,
      sourceName: true,
      boardUrl: true,
      status: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    companyId: row.companyId,
    connectorName: row.connectorName,
    token: row.token,
    sourceName: row.sourceName,
    boardUrl: row.boardUrl,
    status: row.status,
  }));
}

async function applyPromotions(
  actions: SourceCandidatePromotionAction[],
  maxPromote: number,
  maxValidate: number,
  atsValidationShare: number
) {
  const [
    { promoteSourceCandidate },
    { enqueueUniqueSourceTask },
    { enqueueUniquePipelineTask },
  ] = await Promise.all([
    import("../src/lib/ingestion/discovery/source-registry"),
    import("../src/lib/ingestion/task-queue"),
    import("../src/lib/ingestion/pipeline-queue"),
  ]);
  const results: PromotionResult[] = [];

  const validationActions = selectPromotionValidationActions(actions, {
    limit: maxValidate,
    atsShare: atsValidationShare,
  });
  for (const action of validationActions) {

    try {
      const task = await enqueueUniquePipelineTask({
        queueName: "SOURCE_VALIDATION",
        mode: "EXPLORATION",
        priorityScore: action.priorityScore,
        idempotencyKey: action.validationTaskKey,
        payloadJson: {
          source: "source_candidate_promotion_plan",
          sourceCandidateId: action.candidateId,
          actionKind: action.kind,
          candidateUrl: action.candidateUrl,
          allowPromotedRepair: action.evidence.includes(
            "repair-missing-company-source"
          ),
          reason: action.reason,
          evidence: toJsonValue(action.evidence),
        },
      });

      results.push({
        action,
        operation: "validate",
        promotedSourceId: null,
        validationPipelineTaskId: task.id,
        validationTaskId: null,
        pollTaskId: null,
        error: null,
      });
    } catch (error) {
      results.push({
        action,
        operation: "validate",
        promotedSourceId: null,
        validationPipelineTaskId: null,
        validationTaskId: null,
        pollTaskId: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let promotionsAttempted = 0;
  const promotableActions = actions.filter(
    (entry) => entry.kind === "PROMOTE_ATS_SOURCE" || entry.kind === "PROMOTE_COMPANY_SITE_SOURCE"
  );

  for (const action of promotableActions) {
    if (promotionsAttempted >= maxPromote) break;
    promotionsAttempted += 1;

    const detected = action.detectedSource;
    if (action.kind === "PROMOTE_ATS_SOURCE" && !detected) continue;

    try {
      const source = await promoteSourceCandidate({
        sourceCandidateId: action.candidateId,
        connectorName: detected?.connectorName ?? "company-site",
        token: detected?.token ?? action.companyId ?? action.candidateId,
        sourceName: detected?.sourceName ?? `CompanySiteCandidate:${action.candidateId}`,
        boardUrl: detected?.boardUrl ?? action.candidateUrl,
        priorityScore: Math.max(action.priorityScore / 20, 1),
      });

      const validationTask = source
        ? await enqueueUniqueSourceTask({
            kind: "SOURCE_VALIDATION",
            companyId: source.companyId,
            companySourceId: source.id,
            priorityScore: action.priorityScore,
            payloadJson: {
              source: "source_candidate_promotion_plan",
              sourceCandidateId: action.candidateId,
              reason: action.reason,
              evidence: toJsonValue(action.evidence),
            },
          })
        : null;
      const pollTask = source
        ? await enqueueUniqueSourceTask({
            kind: "CONNECTOR_POLL",
            companyId: source.companyId,
            companySourceId: source.id,
            priorityScore: Math.max(action.priorityScore - 5, 1),
            notBeforeAt: new Date(Date.now() + 5 * 60_000),
            payloadJson: {
              source: "source_candidate_promotion_plan",
              sourceCandidateId: action.candidateId,
              afterValidation: true,
            },
          })
        : null;

      results.push({
        action,
        operation: "promote",
        promotedSourceId: source?.id ?? null,
        validationPipelineTaskId: null,
        validationTaskId: validationTask?.id ?? null,
        pollTaskId: pollTask?.id ?? null,
        error: null,
      });
    } catch (error) {
      results.push({
        action,
        operation: "promote",
        promotedSourceId: null,
        validationPipelineTaskId: null,
        validationTaskId: null,
        pollTaskId: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

function escapeMarkdownCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function buildMarkdownReport(input: {
  args: Args;
  generatedAt: string;
  candidateCount: number;
  existingSourceCount: number;
  actions: SourceCandidatePromotionAction[];
  promotions: PromotionResult[];
}) {
  const actionCounts = countBy(input.actions, (action) => action.kind);
  const connectorCounts = countBy(
    input.actions.filter(
      (action) => action.kind === "PROMOTE_ATS_SOURCE" || action.kind === "PROMOTE_COMPANY_SITE_SOURCE"
    ),
    (action) => action.detectedSource?.connectorName ?? "company-site"
  );
  const topActions = input.actions.slice(0, 60);

  const lines = [
    `# Source Candidate Promotion Plan (${input.args.label})`,
    "",
    `Generated at: ${input.generatedAt}`,
    `Mode: ${input.args.apply ? "apply" : "dry-run"}`,
    "",
    "## Inputs",
    "",
    `- Candidates loaded: ${input.candidateCount.toLocaleString()}`,
    `- Existing sources loaded: ${input.existingSourceCount.toLocaleString()}`,
    "",
    "## Action Counts",
    "",
    ...Object.entries(actionCounts).map(([kind, count]) => `- ${kind}: ${count}`),
    "",
    "## Auto-Promote Connectors",
    "",
    ...Object.entries(connectorCounts).map(([kind, count]) => `- ${kind}: ${count}`),
    "",
    "## Applied Work",
    "",
    input.args.apply
      ? `- Queued validation tasks: ${input.promotions.filter((item) => item.operation === "validate" && !item.error).length.toLocaleString()}`
      : "- Dry-run only; no validation tasks queued and no candidates promoted.",
    `- Attempted promotions: ${input.promotions.filter((item) => item.operation === "promote").length.toLocaleString()}`,
    `- Successful promotions: ${input.promotions.filter((item) => item.operation === "promote" && !item.error).length.toLocaleString()}`,
    `- Failed applied actions: ${input.promotions.filter((item) => item.error).length.toLocaleString()}`,
    "",
    "## Top Actions",
    "",
    "| Kind | Priority | Company | Connector | URL | Reason |",
    "| --- | ---: | --- | --- | --- | --- |",
    ...topActions.map((action) =>
      [
        action.kind,
        action.priorityScore.toFixed(1),
        action.companyName ?? "",
        action.detectedSource?.connectorName ?? "",
        action.candidateUrl,
        action.reason,
      ]
        .map(escapeMarkdownCell)
        .join(" | ")
    ).map((row) => `| ${row} |`),
    "",
    "## Safety Notes",
    "",
    "- Apply mode promotes high-confidence ATS candidates and recently validated high-confidence company career pages.",
    "- Apply mode queues validation tasks for VALIDATE_ATS_SOURCE and VALIDATE_COMPANY_SITE before promotion.",
    "- Unvalidated, ownerless, generic, or low-score company career pages remain validation-only or manual-review.",
    "- Duplicates and ownership conflicts are reported but not mutated.",
    "- Low-quality candidates are reported but not deleted or rejected by this script.",
  ];

  return `${lines.join("\n")}\n`;
}

async function writeReports(input: {
  args: Args;
  generatedAt: string;
  candidates: PromotionCandidate[];
  existingSources: ExistingPromotionSource[];
  actions: SourceCandidatePromotionAction[];
  promotions: PromotionResult[];
}) {
  await mkdir(input.args.outputDir, { recursive: true });
  const basePath = path.join(input.args.outputDir, input.args.label);
  const payload = {
    generatedAt: input.generatedAt,
    mode: input.args.apply ? "apply" : "dry-run",
    args: input.args,
    inputCounts: {
      candidates: input.candidates.length,
      existingSources: input.existingSources.length,
    },
    actionCounts: countBy(input.actions, (action) => action.kind),
    connectorCounts: countBy(input.actions, (action) => action.detectedSource?.connectorName),
    actions: input.actions,
    promotions: input.promotions.map((result) => ({
      operation: result.operation,
      candidateId: result.action.candidateId,
      companyName: result.action.companyName,
      detectedSource: result.action.detectedSource,
      priorityScore: result.action.priorityScore,
      promotedSourceId: result.promotedSourceId,
      validationPipelineTaskId: result.validationPipelineTaskId,
      validationTaskId: result.validationTaskId,
      pollTaskId: result.pollTaskId,
      error: result.error,
    })),
  };
  const markdown = buildMarkdownReport({
    args: input.args,
    generatedAt: input.generatedAt,
    candidateCount: input.candidates.length,
    existingSourceCount: input.existingSources.length,
    actions: input.actions,
    promotions: input.promotions,
  });

  await writeFile(`${basePath}.json`, JSON.stringify(payload, null, 2));
  await writeFile(`${basePath}.md`, markdown);

  return { jsonPath: `${basePath}.json`, markdownPath: `${basePath}.md` };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const { prisma } = await import("../src/lib/db");
  const [candidates, existingSources] = await Promise.all([
    loadCandidates(prisma, args.limit),
    loadExistingSources(prisma),
  ]);
  const actions = buildSourceCandidatePromotionPlan({
    candidates,
    existingSources,
    options: { limit: args.limit },
  });
  const promotions = args.apply
    ? await applyPromotions(
        actions,
        args.maxPromote,
        args.maxValidate,
        args.atsValidationShare
      )
    : [];
  const reportPaths = args.writeReport
    ? await writeReports({
        args,
        generatedAt,
        candidates,
        existingSources,
        actions,
        promotions,
      })
    : null;

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? "apply" : "dry-run",
        inputCounts: {
          candidates: candidates.length,
          existingSources: existingSources.length,
        },
        actionCounts: countBy(actions, (action) => action.kind),
        connectorCounts: countBy(
          actions,
          (action) => action.detectedSource?.connectorName ?? (
            action.kind === "PROMOTE_COMPANY_SITE_SOURCE" ? "company-site" : undefined
          )
        ),
        validationQueuedCount: promotions.filter(
          (result) => result.operation === "validate" && !result.error
        ).length,
        atsValidationShare: args.atsValidationShare,
        promotedCount: promotions.filter(
          (result) => result.operation === "promote" && !result.error
        ).length,
        applyErrorCount: promotions.filter((result) => result.error).length,
        reportPaths,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("[source:candidate-promotion-plan] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/db");
    await prisma.$disconnect();
  });
