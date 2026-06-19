import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import {
  classifyJobMetadata,
  coerceNormalizedIndustry,
  type JobMetadataClassification,
} from "@/lib/job-metadata";

type Args = {
  batchSize: number;
  limit: number | null;
  dryRun: boolean;
  onlyMissing: boolean;
  onlyLowConfidence: boolean;
  syncNormalizedRecords: boolean;
  status: "AGING" | "LIVE" | "EXPIRED" | "REMOVED" | "STALE" | null;
};

type JobForBackfill = {
  id: string;
  title: string;
  displayTitle: string | null;
  company: string;
  description: string;
  location: string;
  workMode: "REMOTE" | "HYBRID" | "ONSITE" | "FLEXIBLE" | "UNKNOWN";
  employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERNSHIP" | "UNKNOWN";
  industry: "TECH" | "FINANCE" | "GENERAL" | null;
  roleFamily: string;
  normalizedIndustry: string | null;
  normalizedIndustries: string[];
  normalizedRoleCategory: string | null;
  normalizedRoleCategoryConfidence: number | null;
  normalizedRoleCategoryGroup: string | null;
  normalizedRoleCategoryStatus: string | null;
  normalizedRoleCategorySource: string | null;
  companyRecord: {
    normalizedIndustry: string | null;
    normalizedIndustries: string[];
    normalizedIndustryConfidence: number | null;
  } | null;
  applyUrl: string;
};

type UpdatePayload = {
  id: string;
  category: string;
  confidence: number;
  group: string;
  status: string;
  source: string;
  candidates: Prisma.InputJsonValue;
  evidence: Prisma.InputJsonValue;
  warnings: Prisma.InputJsonValue;
  classificationStatus: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    batchSize: 500,
    limit: null,
    dryRun: true,
    onlyMissing: false,
    onlyLowConfidence: false,
    syncNormalizedRecords: true,
    status: null,
  };

  for (const arg of argv) {
    if (arg === "--apply" || arg === "--force") args.dryRun = false;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--only-missing") args.onlyMissing = true;
    else if (arg === "--only-low-confidence") args.onlyLowConfidence = true;
    else if (arg === "--skip-normalized-records") args.syncNormalizedRecords = false;
    else if (arg.startsWith("--batch-size=")) {
      args.batchSize = Math.max(1, Number.parseInt(arg.slice("--batch-size=".length), 10));
    } else if (arg.startsWith("--limit=")) {
      args.limit = Math.max(1, Number.parseInt(arg.slice("--limit=".length), 10));
    } else if (arg.startsWith("--status=")) {
      const status = arg.slice("--status=".length).toUpperCase();
      if (
        status === "AGING" ||
        status === "LIVE" ||
        status === "EXPIRED" ||
        status === "REMOVED" ||
        status === "STALE"
      ) {
        args.status = status;
      }
    }
  }

  return args;
}

function buildWhere(args: Args): Prisma.JobCanonicalWhereInput {
  const where: Prisma.JobCanonicalWhereInput = {};
  if (args.status) where.status = args.status;

  const filters: Prisma.JobCanonicalWhereInput[] = [];
  if (args.onlyMissing) {
    filters.push(
      { normalizedRoleCategory: null },
      { normalizedRoleCategoryConfidence: null },
      { normalizedRoleCategoryGroup: null },
      { normalizedRoleCategoryStatus: null },
      { normalizedRoleCategorySource: null }
    );
  }
  if (args.onlyLowConfidence) {
    filters.push(
      { normalizedRoleCategory: null },
      { normalizedRoleCategory: "OTHER_UNKNOWN" },
      { normalizedRoleCategoryConfidence: null },
      { normalizedRoleCategoryConfidence: { lt: 0.75 } }
    );
  }
  if (filters.length > 0) where.OR = filters;
  return where;
}

function companyIndustries(job: JobForBackfill) {
  const values = [
    ...(job.companyRecord?.normalizedIndustries ?? []),
    job.companyRecord?.normalizedIndustry ?? "",
    ...job.normalizedIndustries,
    job.normalizedIndustry ?? "",
  ];
  const seen = new Set<string>();
  const industries: ReturnType<typeof coerceNormalizedIndustry>[] = [];
  for (const value of values) {
    const industry = coerceNormalizedIndustry(value);
    if (industry === "UNKNOWN" || seen.has(industry)) continue;
    seen.add(industry);
    industries.push(industry);
  }
  return industries;
}

function classify(job: JobForBackfill) {
  return classifyJobMetadata({
    title: job.displayTitle ?? job.title,
    rawTitle: job.title,
    company: job.company,
    description: job.description,
    location: job.location,
    roleFamily: job.roleFamily,
    companyIndustries: companyIndustries(job),
    legacyIndustry: job.industry,
    inferredEmploymentType: job.employmentType,
    sourceEmploymentType: null,
    workMode: job.workMode,
    applyUrl: job.applyUrl,
  });
}

function needsUpdate(job: JobForBackfill, metadata: JobMetadataClassification) {
  return (
    job.normalizedRoleCategory !== metadata.normalizedRoleCategory ||
    job.normalizedRoleCategoryConfidence !== metadata.confidence.roleCategory ||
    job.normalizedRoleCategoryGroup !== metadata.normalizedRoleCategoryGroup ||
    job.normalizedRoleCategoryStatus !== metadata.normalizedRoleCategoryStatus ||
    job.normalizedRoleCategorySource !== metadata.normalizedRoleCategorySource
  );
}

function toUpdate(job: JobForBackfill, metadata: JobMetadataClassification): UpdatePayload {
  return {
    id: job.id,
    category: metadata.normalizedRoleCategory,
    confidence: metadata.confidence.roleCategory,
    group: metadata.normalizedRoleCategoryGroup,
    status: metadata.normalizedRoleCategoryStatus,
    source: metadata.normalizedRoleCategorySource,
    candidates: metadata.normalizedRoleCategoryCandidates as unknown as Prisma.InputJsonValue,
    evidence: metadata.normalizedRoleCategoryEvidence as unknown as Prisma.InputJsonValue,
    warnings: metadata.normalizedRoleCategoryWarnings as unknown as Prisma.InputJsonValue,
    classificationStatus: metadata.classificationStatus,
  };
}

async function writeBatch(updates: UpdatePayload[], args: Args) {
  if (updates.length === 0) return;

  const values = Prisma.join(
    updates.map((update) =>
      Prisma.sql`(
        ${update.id},
        ${update.category},
        ${update.confidence},
        ${update.group},
        ${update.status},
        ${update.source},
        ${JSON.stringify(update.candidates)}::jsonb,
        ${JSON.stringify(update.evidence)}::jsonb,
        ${JSON.stringify(update.warnings)}::jsonb,
        ${update.classificationStatus}
      )`
    )
  );

  await prisma.$executeRaw`
      WITH updates(
        id,
        category,
        confidence,
        category_group,
        category_status,
        category_source,
        candidates_json,
        evidence_json,
        warnings_json,
        classification_status
      ) AS (VALUES ${values})
      UPDATE "JobCanonical" AS job
      SET
        "normalizedRoleCategory" = updates.category,
        "normalizedRoleCategoryConfidence" = updates.confidence::double precision,
        "normalizedRoleCategoryGroup" = updates.category_group,
        "normalizedRoleCategoryStatus" = updates.category_status,
        "normalizedRoleCategorySource" = updates.category_source,
        "normalizedRoleCategoryCandidatesJson" = updates.candidates_json,
        "normalizedRoleCategoryEvidenceJson" = updates.evidence_json,
        "normalizedRoleCategoryWarningsJson" = updates.warnings_json,
        "classificationStatus" = updates.classification_status
      FROM updates
      WHERE job.id = updates.id
    `;

  await prisma.$executeRaw`
      WITH updates(
        id,
        category,
        confidence,
        category_group,
        category_status,
        category_source,
        candidates_json,
        evidence_json,
        warnings_json,
        classification_status
      ) AS (VALUES ${values})
      UPDATE "JobFeedIndex" AS feed
      SET
        "normalizedRoleCategory" = updates.category,
        "normalizedRoleCategoryConfidence" = updates.confidence::double precision,
        "normalizedRoleCategoryGroup" = updates.category_group,
        "normalizedRoleCategoryStatus" = updates.category_status,
        "normalizedRoleCategorySource" = updates.category_source,
        "classificationStatus" = updates.classification_status
      FROM updates
      WHERE feed."canonicalJobId" = updates.id
    `;

  if (!args.syncNormalizedRecords) return;

  await prisma.$executeRaw`
      WITH updates(
        id,
        category,
        confidence,
        category_group,
        category_status,
        category_source,
        candidates_json,
        evidence_json,
        warnings_json,
        classification_status
      ) AS (VALUES ${values})
      UPDATE "NormalizedJobRecord" AS record
      SET
        "normalizedRoleCategory" = updates.category,
        "normalizedRoleCategoryConfidence" = updates.confidence::double precision,
        "normalizedRoleCategoryGroup" = updates.category_group,
        "normalizedRoleCategoryStatus" = updates.category_status,
        "normalizedRoleCategorySource" = updates.category_source,
        "normalizedRoleCategoryCandidatesJson" = updates.candidates_json,
        "normalizedRoleCategoryEvidenceJson" = updates.evidence_json,
        "normalizedRoleCategoryWarningsJson" = updates.warnings_json,
        "classificationStatus" = updates.classification_status
      FROM updates
      WHERE record."canonicalJobId" = updates.id
    `;
}

function increment(map: Map<string, number>, key: string | null | undefined) {
  map.set(key ?? "NULL", (map.get(key ?? "NULL") ?? 0) + 1);
}

function printTop(title: string, map: Map<string, number>, limit = 30) {
  console.log(`\n${title}`);
  for (const [key, count] of [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)) {
    console.log(`  ${key}: ${count.toLocaleString()}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `Backfilling job-function labels batchSize=${args.batchSize} limit=${args.limit ?? "all"} dryRun=${args.dryRun} onlyMissing=${args.onlyMissing} onlyLowConfidence=${args.onlyLowConfidence} syncNormalizedRecords=${args.syncNormalizedRecords} status=${args.status ?? "all"}`
  );

  const before = new Map<string, number>();
  const after = new Map<string, number>();
  const groups = new Map<string, number>();
  const statuses = new Map<string, number>();
  const warnings = new Map<string, number>();
  const changedPairs = new Map<string, number>();
  const samples: string[] = [];
  const ambiguousSamples: string[] = [];
  let cursor: string | undefined;
  let processed = 0;
  let changed = 0;

  while (args.limit == null || processed < args.limit) {
    const take =
      args.limit == null ? args.batchSize : Math.min(args.batchSize, args.limit - processed);
    if (take <= 0) break;

    const jobs = await prisma.jobCanonical.findMany({
      where: buildWhere(args),
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take,
      select: {
        id: true,
        title: true,
        displayTitle: true,
        company: true,
        description: true,
        location: true,
        workMode: true,
        employmentType: true,
        industry: true,
        roleFamily: true,
        normalizedIndustry: true,
        normalizedIndustries: true,
        normalizedRoleCategory: true,
        normalizedRoleCategoryConfidence: true,
        normalizedRoleCategoryGroup: true,
        normalizedRoleCategoryStatus: true,
        normalizedRoleCategorySource: true,
        applyUrl: true,
        companyRecord: {
          select: {
            normalizedIndustry: true,
            normalizedIndustries: true,
            normalizedIndustryConfidence: true,
          },
        },
      },
    });

    if (jobs.length === 0) break;

    const updates: UpdatePayload[] = [];
    for (const job of jobs) {
      const metadata = classify(job);
      increment(before, job.normalizedRoleCategory);
      increment(after, metadata.normalizedRoleCategory);
      increment(groups, metadata.normalizedRoleCategoryGroup);
      increment(statuses, metadata.normalizedRoleCategoryStatus);
      for (const warning of metadata.normalizedRoleCategoryWarnings) increment(warnings, warning);

      if (metadata.normalizedRoleCategoryStatus === "ambiguous" && ambiguousSamples.length < 20) {
        ambiguousSamples.push(
          `${job.id}: ${job.title} | ${job.company} -> ${metadata.normalizedRoleCategory} (${metadata.confidence.roleCategory})`
        );
      }

      if (!needsUpdate(job, metadata)) continue;
      changed += 1;
      increment(changedPairs, `${job.normalizedRoleCategory ?? "NULL"} -> ${metadata.normalizedRoleCategory}`);
      if (samples.length < 30) {
        samples.push(
          `${job.id}: ${job.title} | ${job.company} | ${job.normalizedRoleCategory ?? "NULL"} -> ${metadata.normalizedRoleCategory} (${metadata.confidence.roleCategory}) evidence=${metadata.normalizedRoleCategoryEvidence.join("; ")} warnings=${metadata.normalizedRoleCategoryWarnings.join("; ")}`
        );
      }
      updates.push(toUpdate(job, metadata));
    }

    if (!args.dryRun && updates.length > 0) await writeBatch(updates, args);

    processed += jobs.length;
    cursor = jobs.at(-1)?.id;
    console.log(`Processed ${processed.toLocaleString()} jobs; changed=${changed.toLocaleString()}`);
  }

  printTop("Before categories in processed rows", before);
  printTop("After categories in processed rows", after);
  printTop("After groups in processed rows", groups);
  printTop("After role status in processed rows", statuses);
  printTop("Changed category pairs", changedPairs);
  printTop("Top warnings", warnings, 15);

  if (samples.length > 0) {
    console.log("\nSample changed jobs");
    for (const sample of samples) console.log(`  ${sample}`);
  }
  if (ambiguousSamples.length > 0) {
    console.log("\nSample ambiguous jobs");
    for (const sample of ambiguousSamples) console.log(`  ${sample}`);
  }

  console.log(`\nDone. processed=${processed} changed=${changed} dryRun=${args.dryRun}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
