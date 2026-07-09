/**
 * AI label-fallback backfill.
 *
 * Deterministic re-extraction is exhausted for a large share of live jobs, so
 * this script uses the cheap/fast OpenAI model to assign filter-grade
 * normalizedRoleCategory and career-stage labels to LIVE, feed-visible jobs
 * that still lack a filter-grade role label.
 *
 * Usage:
 *   npm run jobs:backfill-labels-ai                       (dry-run, default limit 2000)
 *   npm run jobs:backfill-labels-ai -- --limit=200        (bounded dry-run)
 *   npm run jobs:backfill-labels-ai -- --apply --limit=200
 *   npm run jobs:backfill-labels-ai -- --apply --concurrency=6 --min-role-confidence=0.65
 */
import "dotenv/config";

import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  legacyExperienceLevelForCareerStage,
  type DetailedExperienceLevel,
  type ExperienceLevelGroup,
} from "@/lib/experience-level";
import {
  AI_LABEL_MIN_CONFIDENCE,
  AI_LABEL_SOURCE,
  aiRoleLabelStatus,
  shouldPersistAiCareerStage,
  shouldPersistAiRoleLabel,
} from "@/lib/ingestion/ai-label-policy";
import {
  getJobFunctionGroup,
  type JobFunctionCategory,
} from "@/lib/ingestion/extraction/job-function-extractor";
import { upsertJobFeedIndexes } from "@/lib/ingestion/search-index";
import { ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD } from "@/lib/job-metadata";
import { getFastModel, getOpenAIClient, getOpenAIReadiness } from "@/lib/openai";

// ── Model output taxonomy ──────────────────────────────────────────────────
// The role-category enum must match the canonical taxonomy from
// src/lib/ingestion/extraction/job-function-extractor.ts exactly.

const ROLE_CATEGORY_VALUES = [
  "SOFTWARE_ENGINEERING",
  "DATA_ANALYTICS",
  "AI_MACHINE_LEARNING",
  "PRODUCT_MANAGEMENT",
  "DESIGN_UX",
  "IT_SYSTEMS_DEVOPS",
  "CYBERSECURITY",
  "FINANCE_ACCOUNTING",
  "INVESTMENT_BANKING",
  "CONSULTING",
  "SALES",
  "MARKETING",
  "OPERATIONS",
  "CUSTOMER_SUCCESS_SUPPORT",
  "HUMAN_RESOURCES_RECRUITING",
  "LEGAL_COMPLIANCE",
  "HEALTHCARE_CLINICAL",
  "RESEARCH_SCIENCE",
  "EDUCATION_TEACHING",
  "ENGINEERING_HARDWARE",
  "RETAIL_SERVICE",
  "SKILLED_TRADES_FACILITIES",
  "WAREHOUSE_DELIVERY_DRIVING",
  "MEDIA_CONTENT_COMMUNICATIONS",
  "MANUFACTURING_TRADES",
  "SUPPLY_CHAIN_LOGISTICS",
  "PROJECT_PROGRAM_MANAGEMENT",
  "ADMINISTRATIVE",
  "BUSINESS_DEVELOPMENT",
  "OTHER_UNKNOWN",
] as const satisfies readonly JobFunctionCategory[];

// Compile-time proof that the enum covers the entire canonical taxonomy.
type MissingRoleCategory = Exclude<JobFunctionCategory, (typeof ROLE_CATEGORY_VALUES)[number]>;
const roleCategoryEnumIsExhaustive: MissingRoleCategory extends never ? true : MissingRoleCategory =
  true;
void roleCategoryEnumIsExhaustive;

const CAREER_STAGE_GROUP_VALUES = [
  "STUDENT_INTERN",
  "ENTRY_JUNIOR",
  "MID_EXPERIENCED",
  "SENIOR_LEAD_STAFF",
  "MANAGER_DIRECTOR_EXECUTIVE",
  "UNKNOWN",
] as const satisfies readonly ExperienceLevelGroup[];

type MissingCareerStageGroup = Exclude<
  ExperienceLevelGroup,
  (typeof CAREER_STAGE_GROUP_VALUES)[number]
>;
const careerStageEnumIsExhaustive: MissingCareerStageGroup extends never
  ? true
  : MissingCareerStageGroup = true;
void careerStageEnumIsExhaustive;

/** Representative detailed stage persisted to normalizedCareerStage per group. */
const REPRESENTATIVE_STAGE_BY_GROUP: Record<
  Exclude<ExperienceLevelGroup, "UNKNOWN">,
  DetailedExperienceLevel
> = {
  STUDENT_INTERN: "INTERNSHIP_COOP_STUDENT",
  ENTRY_JUNIOR: "ENTRY_LEVEL_NEW_GRAD",
  MID_EXPERIENCED: "MID_LEVEL",
  SENIOR_LEAD_STAFF: "SENIOR",
  MANAGER_DIRECTOR_EXECUTIVE: "MANAGER",
};

const jobLabelSchema = z.object({
  roleCategory: z.enum(ROLE_CATEGORY_VALUES),
  roleConfidence: z.number(),
  careerStage: z.enum(CAREER_STAGE_GROUP_VALUES),
  careerStageConfidence: z.number(),
});

type JobLabelClassification = z.infer<typeof jobLabelSchema>;

const SYSTEM_PROMPT = `You classify job postings into a fixed taxonomy.

Pick the single best roleCategory for the work actually performed in the job, and the single best careerStage for its seniority:
- STUDENT_INTERN: internships, co-ops, student placements
- ENTRY_JUNIOR: entry-level, new grad, junior, associate
- MID_EXPERIENCED: mid-level individual contributors
- SENIOR_LEAD_STAFF: senior, lead, staff, principal individual contributors
- MANAGER_DIRECTOR_EXECUTIVE: people managers, directors, executives

Confidence values are between 0 and 1 and must reflect real certainty — do not inflate them. Use roleCategory OTHER_UNKNOWN or careerStage UNKNOWN when the posting is genuinely unclear.`;

// ── CLI ────────────────────────────────────────────────────────────────────

type Args = {
  apply: boolean;
  limit: number;
  concurrency: number;
  minRoleConfidence: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apply: false,
    limit: 2000,
    concurrency: 6,
    minRoleConfidence: AI_LABEL_MIN_CONFIDENCE,
  };

  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg.startsWith("--limit=")) {
      args.limit = parsePositiveInt(arg.slice("--limit=".length), "limit");
    } else if (arg.startsWith("--concurrency=")) {
      args.concurrency = parsePositiveInt(arg.slice("--concurrency=".length), "concurrency");
    } else if (arg.startsWith("--min-role-confidence=")) {
      const value = Number.parseFloat(arg.slice("--min-role-confidence=".length));
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`Invalid --min-role-confidence: ${arg}`);
      }
      args.minRoleConfidence = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${label}: ${value}`);
  }
  return parsed;
}

// ── Target selection ───────────────────────────────────────────────────────

type TargetJob = {
  id: string;
  title: string;
  company: string;
  snippet: string;
  normalizedCareerStage: string | null;
  normalizedCareerStageConfidence: number | null;
};

const DESCRIPTION_SNIPPET_CHARS = 600;
const DETAIL_FETCH_CHUNK = 200;

function buildTargetWhere(): Prisma.JobCanonicalWhereInput {
  return {
    status: "LIVE",
    feedIndex: { is: { status: "LIVE" } },
    OR: [
      { normalizedRoleCategory: null },
      { normalizedRoleCategory: "OTHER_UNKNOWN" },
      { normalizedRoleCategoryConfidence: null },
      { normalizedRoleCategoryConfidence: { lt: ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD } },
    ],
  };
}

async function fetchTargetJobs(limit: number): Promise<TargetJob[]> {
  const targetIds = await prisma.jobCanonical.findMany({
    where: buildTargetWhere(),
    orderBy: { postedAt: "desc" },
    take: limit,
    select: { id: true },
  });

  const jobs: TargetJob[] = [];
  for (let start = 0; start < targetIds.length; start += DETAIL_FETCH_CHUNK) {
    const chunkIds = targetIds.slice(start, start + DETAIL_FETCH_CHUNK).map((row) => row.id);
    const rows = await prisma.jobCanonical.findMany({
      where: { id: { in: chunkIds } },
      select: {
        id: true,
        title: true,
        displayTitle: true,
        company: true,
        description: true,
        shortSummary: true,
        normalizedCareerStage: true,
        normalizedCareerStageConfidence: true,
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of chunkIds) {
      const row = byId.get(id);
      if (!row) continue;
      const body = (row.description?.trim() ? row.description : row.shortSummary) ?? "";
      jobs.push({
        id: row.id,
        title: (row.displayTitle ?? row.title).trim(),
        company: row.company.trim(),
        snippet: body.replace(/\s+/g, " ").trim().slice(0, DESCRIPTION_SNIPPET_CHARS),
        normalizedCareerStage: row.normalizedCareerStage,
        normalizedCareerStageConfidence: row.normalizedCareerStageConfidence,
      });
    }
  }
  return jobs;
}

// ── Classification ─────────────────────────────────────────────────────────

function buildUserPrompt(job: TargetJob): string {
  return [
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Description: ${job.snippet || "(no description available)"}`,
  ].join("\n");
}

async function classifyJob(
  client: ReturnType<typeof getOpenAIClient>,
  model: string,
  job: TargetJob
): Promise<JobLabelClassification> {
  const completion = await client.chat.completions.parse({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(job) },
    ],
    response_format: zodResponseFormat(jobLabelSchema, "job_label_classification"),
  });

  const message = completion.choices[0]?.message;
  if (message?.refusal) {
    throw new Error(`model refused classification: ${message.refusal}`);
  }
  const parsed = message?.parsed;
  if (!parsed) {
    throw new Error("model returned no parsed classification");
  }
  return parsed;
}

// ── Persistence ────────────────────────────────────────────────────────────

type RolePersist = {
  category: JobFunctionCategory;
  confidence: number;
};

type StagePersist = {
  group: Exclude<ExperienceLevelGroup, "UNKNOWN">;
  stage: DetailedExperienceLevel;
  confidence: number;
};

async function persistLabels(input: {
  jobId: string;
  model: string;
  role: RolePersist | null;
  stage: StagePersist | null;
}) {
  const { jobId, model, role, stage } = input;
  const evidence = [`ai-fallback classification (${model})`];
  const data: Prisma.JobCanonicalUpdateInput = {};

  if (role) {
    const group = getJobFunctionGroup(role.category);
    Object.assign(data, {
      normalizedRoleCategory: role.category,
      normalizedRoleCategoryConfidence: role.confidence,
      normalizedRoleCategoryGroup: group,
      normalizedRoleCategoryStatus: aiRoleLabelStatus(role.confidence),
      normalizedRoleCategorySource: AI_LABEL_SOURCE,
      normalizedRoleCategoryCandidatesJson: [
        {
          category: role.category,
          group,
          confidence: role.confidence,
          source: AI_LABEL_SOURCE,
          evidence,
          reasons: ["ai_fallback_classification"],
          penalties: [],
          warnings: [],
        },
      ],
      normalizedRoleCategoryEvidenceJson: evidence,
      normalizedRoleCategoryWarningsJson: [],
    } satisfies Prisma.JobCanonicalUpdateInput);
  }

  if (stage) {
    Object.assign(data, {
      experienceLevel: legacyExperienceLevelForCareerStage(stage.stage),
      experienceLevelGroup: stage.group,
      experienceLevelSource: AI_LABEL_SOURCE,
      experienceLevelEvidenceJson: evidence,
      experienceLevelWarningsJson: [],
      normalizedCareerStage: stage.stage,
      normalizedCareerStageConfidence: stage.confidence,
    } satisfies Prisma.JobCanonicalUpdateInput);
  }

  await prisma.jobCanonical.update({ where: { id: jobId }, data });

  // Keep normalized records in sync for role-category labels, mirroring
  // scripts/backfill-job-function-labels.ts.
  if (role) {
    await prisma.normalizedJobRecord.updateMany({
      where: { canonicalJobId: jobId },
      data: {
        normalizedRoleCategory: role.category,
        normalizedRoleCategoryConfidence: role.confidence,
        normalizedRoleCategoryGroup: getJobFunctionGroup(role.category),
        normalizedRoleCategoryStatus: aiRoleLabelStatus(role.confidence),
        normalizedRoleCategorySource: AI_LABEL_SOURCE,
        normalizedRoleCategoryEvidenceJson: evidence,
        normalizedRoleCategoryWarningsJson: [],
      },
    });
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

const REINDEX_BATCH_SIZE = 50;
const PROGRESS_LOG_EVERY = 100;
const ESTIMATED_OUTPUT_TOKENS_PER_JOB = 60;

type Stats = {
  classified: number;
  persisted: number;
  skippedLowConfidence: number;
  skippedUnknown: number;
  errors: number;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const readiness = getOpenAIReadiness();
  if (!readiness.configured) {
    console.error(
      `[backfill-labels-ai] OpenAI is not configured (missing: ${readiness.missingKeys.join(", ")}). ` +
        "Set OPENAI_API_KEY and retry."
    );
    process.exit(1);
  }

  const model = getFastModel();
  const client = getOpenAIClient();

  console.log(
    `[backfill-labels-ai] mode=${args.apply ? "apply" : "dry-run"} limit=${args.limit} ` +
      `concurrency=${args.concurrency} minRoleConfidence=${args.minRoleConfidence} model=${model}`
  );

  const jobs = await fetchTargetJobs(args.limit);
  console.log(`[backfill-labels-ai] selected ${jobs.length} LIVE feed-visible jobs lacking filter-grade role labels`);
  if (jobs.length === 0) {
    console.log("[backfill-labels-ai] nothing to do");
    return;
  }

  const stats: Stats = {
    classified: 0,
    persisted: 0,
    skippedLowConfidence: 0,
    skippedUnknown: 0,
    errors: 0,
  };
  const detail = {
    rolePersisted: 0,
    stagePersisted: 0,
    stageSkippedExistingStronger: 0,
  };
  let processed = 0;
  let estimatedTokens = 0;
  const samples: string[] = [];
  const pendingReindexIds: string[] = [];
  let nextIndex = 0;

  const logProgress = () => {
    console.log(
      `[backfill-labels-ai] processed=${processed}/${jobs.length} ` +
        `classified=${stats.classified} persisted=${stats.persisted} ` +
        `skippedLowConfidence=${stats.skippedLowConfidence} skippedUnknown=${stats.skippedUnknown} ` +
        `errors=${stats.errors} estTokens=${Math.round(estimatedTokens).toLocaleString()}`
    );
  };

  const flushReindex = async (force: boolean) => {
    if (!args.apply) return;
    if (!force && pendingReindexIds.length < REINDEX_BATCH_SIZE) return;
    const batch = pendingReindexIds.splice(0, pendingReindexIds.length);
    if (batch.length === 0) return;
    await upsertJobFeedIndexes(batch);
  };

  const processJob = async (job: TargetJob) => {
    estimatedTokens +=
      Math.ceil((SYSTEM_PROMPT.length + buildUserPrompt(job).length) / 4) +
      ESTIMATED_OUTPUT_TOKENS_PER_JOB;

    const classification = await classifyJob(client, model, job);
    stats.classified += 1;

    const roleDecision = shouldPersistAiRoleLabel({
      category: classification.roleCategory,
      confidence: classification.roleConfidence,
      minConfidence: args.minRoleConfidence,
    });
    const stageDecision = shouldPersistAiCareerStage({
      careerStage: classification.careerStage,
      confidence: classification.careerStageConfidence,
      existingStage: job.normalizedCareerStage,
      existingConfidence: job.normalizedCareerStageConfidence,
    });

    if (!roleDecision.persist && roleDecision.reason === "low_confidence") {
      stats.skippedLowConfidence += 1;
    }
    if (!roleDecision.persist && roleDecision.reason === "unknown_category") {
      stats.skippedUnknown += 1;
    }
    if (!stageDecision.persist && stageDecision.reason === "existing_label_is_stronger") {
      detail.stageSkippedExistingStronger += 1;
    }

    const role: RolePersist | null = roleDecision.persist
      ? { category: classification.roleCategory, confidence: roleDecision.confidence }
      : null;
    const stage: StagePersist | null =
      stageDecision.persist && classification.careerStage !== "UNKNOWN"
        ? {
            group: classification.careerStage,
            stage: REPRESENTATIVE_STAGE_BY_GROUP[classification.careerStage],
            confidence: stageDecision.confidence,
          }
        : null;

    if (samples.length < 20) {
      samples.push(
        `${job.id} | ${job.title} | ${job.company} -> ` +
          `role=${classification.roleCategory}(${classification.roleConfidence.toFixed(2)}) ` +
          `persistRole=${roleDecision.persist ? "yes" : `no:${roleDecision.reason}`} ` +
          `stage=${classification.careerStage}(${classification.careerStageConfidence.toFixed(2)}) ` +
          `persistStage=${stageDecision.persist ? "yes" : `no:${stageDecision.reason}`}`
      );
    }

    if (role) detail.rolePersisted += 1;
    if (stage) detail.stagePersisted += 1;
    if (role || stage) {
      stats.persisted += 1;
      if (args.apply) {
        await persistLabels({ jobId: job.id, model, role, stage });
        pendingReindexIds.push(job.id);
        await flushReindex(false);
      }
    }
  };

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= jobs.length) return;
      const job = jobs[index];
      try {
        await processJob(job);
      } catch (error) {
        stats.errors += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[backfill-labels-ai] job ${job.id} failed: ${message}`);
      }
      processed += 1;
      if (processed % PROGRESS_LOG_EVERY === 0) logProgress();
    }
  };

  const workerCount = Math.max(1, Math.min(args.concurrency, jobs.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  await flushReindex(true);

  logProgress();
  if (!args.apply && samples.length > 0) {
    console.log("\n[backfill-labels-ai] sample classifications (dry-run)");
    for (const sample of samples) console.log(`  ${sample}`);
  }

  console.log(
    `\n[backfill-labels-ai] done. ${JSON.stringify({
      mode: args.apply ? "apply" : "dry-run",
      ...stats,
      ...detail,
      estimatedTokens: Math.round(estimatedTokens),
    })}`
  );

  if (stats.classified === 0 && stats.errors > 0) {
    throw new Error(
      `all ${stats.errors} classification calls failed — treating as total failure`
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
