import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import {
  classifyJobMetadata,
  hasRoleLevelInternshipTitleEvidence,
  hasStrongInternshipEvidence,
  type JobMetadataClassification,
} from "@/lib/job-metadata";

type Args = {
  batchSize: number;
  limit: number | null;
  dryRun: boolean;
  onlyMissing: boolean;
  status: "AGING" | "LIVE" | "EXPIRED" | "REMOVED" | "STALE" | null;
};

type CanonicalJobForBackfill = {
  id: string;
  title: string;
  company: string;
  description: string;
  location: string;
  workMode: "REMOTE" | "HYBRID" | "ONSITE" | "FLEXIBLE" | "UNKNOWN";
  employmentType: "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERNSHIP" | "UNKNOWN";
  industry: "TECH" | "FINANCE" | "GENERAL" | null;
  roleFamily: string;
  normalizedEmploymentType: string | null;
  normalizedEmploymentTypeConfidence: number | null;
  normalizedCareerStage: string | null;
  normalizedCareerStageConfidence: number | null;
  normalizedIndustry: string | null;
  normalizedIndustryConfidence: number | null;
  normalizedRoleCategory: string | null;
  normalizedRoleCategoryConfidence: number | null;
  classificationStatus: string | null;
};

type CountRow = {
  label: string | null;
  count: bigint;
};

type ClassifiedUpdate = {
  id: string;
  normalizedEmploymentType: string;
  normalizedEmploymentTypeConfidence: number;
  normalizedCareerStage: string;
  normalizedCareerStageConfidence: number;
  normalizedIndustry: string;
  normalizedIndustryConfidence: number;
  normalizedRoleCategory: string;
  normalizedRoleCategoryConfidence: number;
  classificationStatus: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    batchSize: 500,
    limit: null,
    dryRun: false,
    onlyMissing: false,
    status: null,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--only-missing") {
      args.onlyMissing = true;
    } else if (arg.startsWith("--batch-size=")) {
      args.batchSize = Math.max(1, Number.parseInt(arg.slice("--batch-size=".length), 10));
    } else if (arg.startsWith("--limit=")) {
      args.limit = Math.max(1, Number.parseInt(arg.slice("--limit=".length), 10));
    } else if (arg.startsWith("--status=")) {
      const status = arg.slice("--status=".length).toUpperCase();
      if (status === "AGING" || status === "LIVE" || status === "EXPIRED" || status === "REMOVED" || status === "STALE") {
        args.status = status;
      }
    }
  }

  return args;
}

function buildBackfillWhere(args: Args): Prisma.JobCanonicalWhereInput | undefined {
  const where: Prisma.JobCanonicalWhereInput = {};

  if (args.status) where.status = args.status;
  if (args.onlyMissing) {
    where.OR = [
      { normalizedEmploymentType: null },
      { normalizedEmploymentTypeConfidence: null },
      { normalizedCareerStage: null },
      { normalizedCareerStageConfidence: null },
      { normalizedIndustry: null },
      { normalizedIndustryConfidence: null },
      { normalizedRoleCategory: null },
      { normalizedRoleCategoryConfidence: null },
      { classificationStatus: null },
    ];
  }

  return Object.keys(where).length > 0 ? where : undefined;
}

function classify(job: CanonicalJobForBackfill) {
  // Existing canonical employmentType may already be polluted by description-only
  // "intern" matches, so backfill treats it as legacy inferred data, not trusted
  // structured source truth.
  return classifyJobMetadata({
    title: job.title,
    company: job.company,
    description: job.description,
    location: job.location,
    roleFamily: job.roleFamily,
    legacyIndustry: job.industry,
    inferredEmploymentType: job.employmentType,
    sourceEmploymentType: null,
    workMode: job.workMode,
  });
}

function needsUpdate(job: CanonicalJobForBackfill, metadata: JobMetadataClassification) {
  return (
    job.normalizedEmploymentType !== metadata.normalizedEmploymentType ||
    job.normalizedEmploymentTypeConfidence !== metadata.confidence.employmentType ||
    job.normalizedCareerStage !== metadata.normalizedCareerStage ||
    job.normalizedCareerStageConfidence !== metadata.confidence.careerStage ||
    job.normalizedIndustry !== metadata.normalizedIndustry ||
    job.normalizedIndustryConfidence !== metadata.confidence.industry ||
    job.normalizedRoleCategory !== metadata.normalizedRoleCategory ||
    job.normalizedRoleCategoryConfidence !== metadata.confidence.roleCategory ||
    job.classificationStatus !== metadata.classificationStatus
  );
}

async function countByJobCanonicalColumn(column: string) {
  return prisma.$queryRawUnsafe<CountRow[]>(
    `
      SELECT COALESCE("${column}", 'NULL') AS label, COUNT(*)::bigint AS count
      FROM "JobCanonical"
      GROUP BY COALESCE("${column}", 'NULL')
      ORDER BY count DESC, label ASC
    `
  );
}

async function countByEnumColumn(column: string) {
  return prisma.$queryRawUnsafe<CountRow[]>(
    `
      SELECT COALESCE("${column}"::text, 'NULL') AS label, COUNT(*)::bigint AS count
      FROM "JobCanonical"
      GROUP BY COALESCE("${column}"::text, 'NULL')
      ORDER BY count DESC, label ASC
    `
  );
}

function printCounts(title: string, rows: CountRow[]) {
  console.log(`\n${title}`);
  for (const row of rows) {
    console.log(`  ${row.label ?? "NULL"}: ${row.count.toString()}`);
  }
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableWriteError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("deadlock detected") ||
    message.includes("could not serialize access") ||
    message.includes("canceling statement due to lock timeout")
  );
}

function printMap(title: string, map: Map<string, number>) {
  console.log(`\n${title}`);
  for (const [key, count] of [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`  ${key}: ${count}`);
  }
}

function isSuspiciousSeniorIntern(job: CanonicalJobForBackfill, metadata: JobMetadataClassification) {
  if (metadata.normalizedCareerStage !== "INTERNSHIP_COOP_STUDENT") return false;
  const leadershipTitle = /\b(senior|sr\.?|staff|principal|lead|manager|director|vp\b|vice president|chief|head of)\b/i.test(
    job.title
  );
  return leadershipTitle && !hasRoleLevelInternshipTitleEvidence(job.title);
}

function isLegacyInternshipFalsePositive(job: CanonicalJobForBackfill, metadata: JobMetadataClassification) {
  return (
    job.employmentType === "INTERNSHIP" &&
    metadata.normalizedCareerStage !== "INTERNSHIP_COOP_STUDENT" &&
    !hasStrongInternshipEvidence({
      title: job.title,
      description: job.description,
      sourceEmploymentType: null,
    })
  );
}

async function writeMetadataBatch(updates: ClassifiedUpdate[]) {
  if (updates.length === 0) return;

  const rows = updates.map((update) =>
    Prisma.sql`(
      ${update.id},
      ${update.normalizedEmploymentType},
      ${update.normalizedEmploymentTypeConfidence}::double precision,
      ${update.normalizedCareerStage},
      ${update.normalizedCareerStageConfidence}::double precision,
      ${update.normalizedIndustry},
      ${update.normalizedIndustryConfidence}::double precision,
      ${update.normalizedRoleCategory},
      ${update.normalizedRoleCategoryConfidence}::double precision,
      ${update.classificationStatus}
    )`
  );

  await prisma.$executeRaw`
    UPDATE "JobCanonical" AS job
    SET
      "normalizedEmploymentType" = values.normalized_employment_type,
      "normalizedEmploymentTypeConfidence" = values.normalized_employment_type_confidence,
      "normalizedCareerStage" = values.normalized_career_stage,
      "normalizedCareerStageConfidence" = values.normalized_career_stage_confidence,
      "normalizedIndustry" = values.normalized_industry,
      "normalizedIndustryConfidence" = values.normalized_industry_confidence,
      "normalizedRoleCategory" = values.normalized_role_category,
      "normalizedRoleCategoryConfidence" = values.normalized_role_category_confidence,
      "classificationStatus" = values.classification_status
    FROM (VALUES ${Prisma.join(rows)}) AS values(
      id,
      normalized_employment_type,
      normalized_employment_type_confidence,
      normalized_career_stage,
      normalized_career_stage_confidence,
      normalized_industry,
      normalized_industry_confidence,
      normalized_role_category,
      normalized_role_category_confidence,
      classification_status
    )
    WHERE job.id = values.id
  `;

  await prisma.$executeRaw`
    UPDATE "JobFeedIndex" AS feed
    SET
      "normalizedEmploymentType" = values.normalized_employment_type,
      "normalizedEmploymentTypeConfidence" = values.normalized_employment_type_confidence,
      "normalizedCareerStage" = values.normalized_career_stage,
      "normalizedCareerStageConfidence" = values.normalized_career_stage_confidence,
      "normalizedIndustry" = values.normalized_industry,
      "normalizedIndustryConfidence" = values.normalized_industry_confidence,
      "normalizedRoleCategory" = values.normalized_role_category,
      "normalizedRoleCategoryConfidence" = values.normalized_role_category_confidence,
      "classificationStatus" = values.classification_status
    FROM (VALUES ${Prisma.join(rows)}) AS values(
      id,
      normalized_employment_type,
      normalized_employment_type_confidence,
      normalized_career_stage,
      normalized_career_stage_confidence,
      normalized_industry,
      normalized_industry_confidence,
      normalized_role_category,
      normalized_role_category_confidence,
      classification_status
    )
    WHERE feed."canonicalJobId" = values.id
  `;

  await prisma.$executeRaw`
    UPDATE "NormalizedJobRecord" AS record
    SET
      "normalizedEmploymentType" = values.normalized_employment_type,
      "normalizedEmploymentTypeConfidence" = values.normalized_employment_type_confidence,
      "normalizedCareerStage" = values.normalized_career_stage,
      "normalizedCareerStageConfidence" = values.normalized_career_stage_confidence,
      "normalizedIndustry" = values.normalized_industry,
      "normalizedIndustryConfidence" = values.normalized_industry_confidence,
      "normalizedRoleCategory" = values.normalized_role_category,
      "normalizedRoleCategoryConfidence" = values.normalized_role_category_confidence,
      "classificationStatus" = values.classification_status
    FROM (VALUES ${Prisma.join(rows)}) AS values(
      id,
      normalized_employment_type,
      normalized_employment_type_confidence,
      normalized_career_stage,
      normalized_career_stage_confidence,
      normalized_industry,
      normalized_industry_confidence,
      normalized_role_category,
      normalized_role_category_confidence,
      classification_status
    )
    WHERE record."canonicalJobId" = values.id
  `;
}

async function writeMetadataBatchWithRetry(
  updates: ClassifiedUpdate[],
  attempt = 1
): Promise<void> {
  if (updates.length === 0) return;

  try {
    await writeMetadataBatch(updates);
    return;
  } catch (error) {
    if (!isRetryableWriteError(error)) {
      throw error;
    }

    if (updates.length > 100) {
      const midpoint = Math.ceil(updates.length / 2);
      console.warn(
        `Retryable metadata backfill write conflict on ${updates.length} rows; splitting into ${midpoint}/${updates.length - midpoint}`
      );
      await writeMetadataBatchWithRetry(updates.slice(0, midpoint), attempt + 1);
      await writeMetadataBatchWithRetry(updates.slice(midpoint), attempt + 1);
      return;
    }

    if (attempt <= 5) {
      const delayMs = 250 * attempt * attempt;
      console.warn(
        `Retryable metadata backfill write conflict on ${updates.length} rows; retry ${attempt}/5 after ${delayMs}ms`
      );
      await sleep(delayMs);
      await writeMetadataBatchWithRetry(updates, attempt + 1);
      return;
    }

    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `Backfilling normalized job metadata batchSize=${args.batchSize} limit=${args.limit ?? "all"} dryRun=${args.dryRun} onlyMissing=${args.onlyMissing} status=${args.status ?? "all"}`
  );
  const backfillWhere = buildBackfillWhere(args);

  const before = await Promise.all([
    countByEnumColumn("employmentType"),
    countByEnumColumn("experienceLevel"),
    countByJobCanonicalColumn("normalizedEmploymentType"),
    countByJobCanonicalColumn("normalizedCareerStage"),
    countByJobCanonicalColumn("normalizedIndustry"),
    countByJobCanonicalColumn("normalizedRoleCategory"),
    countByEnumColumn("workMode"),
  ]);

  printCounts("Before legacy employmentType", before[0]);
  printCounts("Before legacy experienceLevel", before[1]);
  printCounts("Before normalizedEmploymentType", before[2]);
  printCounts("Before normalizedCareerStage", before[3]);
  printCounts("Before normalizedIndustry", before[4]);
  printCounts("Before normalizedRoleCategory", before[5]);
  printCounts("Current workMode", before[6]);

  const proposedEmployment = new Map<string, number>();
  const proposedCareer = new Map<string, number>();
  const proposedIndustry = new Map<string, number>();
  const proposedRole = new Map<string, number>();
  const suspiciousSeniorInterns: CanonicalJobForBackfill[] = [];
  const legacyInternshipFalsePositives: CanonicalJobForBackfill[] = [];

  let cursor: string | undefined;
  let processed = 0;
  let changed = 0;

  while (args.limit == null || processed < args.limit) {
    const take =
      args.limit == null
        ? args.batchSize
        : Math.min(args.batchSize, args.limit - processed);
    if (take <= 0) break;

    const jobs = await prisma.jobCanonical.findMany({
      where: backfillWhere,
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take,
      select: {
        id: true,
        title: true,
        company: true,
        description: true,
        location: true,
        workMode: true,
        employmentType: true,
        industry: true,
        roleFamily: true,
        normalizedEmploymentType: true,
        normalizedEmploymentTypeConfidence: true,
        normalizedCareerStage: true,
        normalizedCareerStageConfidence: true,
        normalizedIndustry: true,
        normalizedIndustryConfidence: true,
        normalizedRoleCategory: true,
        normalizedRoleCategoryConfidence: true,
        classificationStatus: true,
      },
    });

    if (jobs.length === 0) break;

    const updates: ClassifiedUpdate[] = [];

    for (const job of jobs) {
      const metadata = classify(job);
      increment(proposedEmployment, metadata.normalizedEmploymentType);
      increment(proposedCareer, metadata.normalizedCareerStage);
      increment(proposedIndustry, metadata.normalizedIndustry);
      increment(proposedRole, metadata.normalizedRoleCategory);

      if (isSuspiciousSeniorIntern(job, metadata) && suspiciousSeniorInterns.length < 25) {
        suspiciousSeniorInterns.push(job);
      }
      if (isLegacyInternshipFalsePositive(job, metadata) && legacyInternshipFalsePositives.length < 25) {
        legacyInternshipFalsePositives.push(job);
      }

      if (!needsUpdate(job, metadata)) continue;
      changed += 1;

      if (!args.dryRun) {
        updates.push({
          id: job.id,
          normalizedEmploymentType: metadata.normalizedEmploymentType,
          normalizedEmploymentTypeConfidence: metadata.confidence.employmentType,
          normalizedCareerStage: metadata.normalizedCareerStage,
          normalizedCareerStageConfidence: metadata.confidence.careerStage,
          normalizedIndustry: metadata.normalizedIndustry,
          normalizedIndustryConfidence: metadata.confidence.industry,
          normalizedRoleCategory: metadata.normalizedRoleCategory,
          normalizedRoleCategoryConfidence: metadata.confidence.roleCategory,
          classificationStatus: metadata.classificationStatus,
        });
      }
    }

    if (!args.dryRun) await writeMetadataBatchWithRetry(updates);

    processed += jobs.length;
    cursor = jobs.at(-1)?.id;
    console.log(`Processed ${processed.toLocaleString()} jobs; changed=${changed.toLocaleString()}`);
  }

  printMap("Proposed normalizedEmploymentType counts for processed rows", proposedEmployment);
  printMap("Proposed normalizedCareerStage counts for processed rows", proposedCareer);
  printMap("Proposed normalizedIndustry counts for processed rows", proposedIndustry);
  printMap("Proposed normalizedRoleCategory counts for processed rows", proposedRole);

  if (suspiciousSeniorInterns.length > 0) {
    console.log("\nSuspicious senior-title postings classified as internship/co-op/student");
    for (const job of suspiciousSeniorInterns) {
      console.log(`  ${job.id}: ${job.title} — ${job.company}`);
    }
  }

  if (legacyInternshipFalsePositives.length > 0) {
    console.log("\nLegacy INTERNSHIP employmentType rows no longer classified as internship/co-op/student");
    for (const job of legacyInternshipFalsePositives) {
      console.log(`  ${job.id}: ${job.title} — ${job.company}`);
    }
  }

  if (!args.dryRun) {
    const after = await Promise.all([
      countByJobCanonicalColumn("normalizedEmploymentType"),
      countByJobCanonicalColumn("normalizedCareerStage"),
      countByJobCanonicalColumn("normalizedIndustry"),
      countByJobCanonicalColumn("normalizedRoleCategory"),
    ]);
    printCounts("After normalizedEmploymentType", after[0]);
    printCounts("After normalizedCareerStage", after[1]);
    printCounts("After normalizedIndustry", after[2]);
    printCounts("After normalizedRoleCategory", after[3]);
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
