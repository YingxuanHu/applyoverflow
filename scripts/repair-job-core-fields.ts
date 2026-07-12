import "dotenv/config";

process.env.DATABASE_PROCESS_ROLE ??= "expansion_pipeline";
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ??= "10000";

import type { SourceConnectorJob } from "@/lib/ingestion/types";
import { prisma } from "@/lib/db";
import { normalizeSourceJob } from "@/lib/ingestion/normalize";
import { computeNormalizedQualityScore } from "@/lib/ingestion/quality";
import { upsertJobFeedIndex } from "@/lib/ingestion/search-index";

type CliArgs = {
  apply: boolean;
  batchSize: number;
  limit: number;
  sampleLimit: number;
};

type Sample = {
  id: string;
  before: {
    title: string;
    company: string;
  };
  after: {
    title: string;
    company: string;
  };
  applyUrl: string;
};

type CandidateRow = {
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  applyUrl: string;
  postedAt: Date;
  deadline: Date | null;
  employmentType: SourceConnectorJob["employmentType"];
  workMode: SourceConnectorJob["workMode"];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let scanned = 0;
  let changed = 0;
  let rejectedByNewNormalizer = 0;
  const rejectionReasons: Record<string, number> = {};
  const samples: Sample[] = [];

  const candidates = await findRepairCandidates(args.limit);
  for (let start = 0; start < candidates.length; start += args.batchSize) {
    const rows = candidates.slice(start, start + args.batchSize);
    for (const row of rows) {
      scanned += 1;
      const sourceJob: SourceConnectorJob = {
        sourceId: row.id,
        sourceUrl: row.applyUrl,
        title: row.title,
        company: row.company,
        location: row.location,
        description: row.description,
        applyUrl: row.applyUrl,
        postedAt: row.postedAt,
        deadline: row.deadline,
        employmentType: row.employmentType,
        workMode: row.workMode,
        salaryMin: row.salaryMin,
        salaryMax: row.salaryMax,
        salaryCurrency: row.salaryCurrency,
        metadata: {},
      };
      const normalized = normalizeSourceJob({
        job: sourceJob,
        fetchedAt: new Date(),
      });

      if (normalized.kind === "rejected") {
        rejectedByNewNormalizer += 1;
        rejectionReasons[normalized.reason] = (rejectionReasons[normalized.reason] ?? 0) + 1;
        continue;
      }

      const next = normalized.job;
      const hasCoreChange =
        row.title !== next.title ||
        row.company !== next.company ||
        row.location !== next.location ||
        row.description !== next.description ||
        row.applyUrl !== next.applyUrl;
      if (!hasCoreChange) continue;

      changed += 1;
      if (samples.length < args.sampleLimit && hasCoreChange) {
        samples.push({
          id: row.id,
          before: {
            title: row.title,
            company: row.company,
          },
          after: {
            title: next.title,
            company: next.company,
          },
          applyUrl: row.applyUrl,
        });
      }

      if (!args.apply) continue;

      await prisma.jobCanonical.update({
        where: { id: row.id },
        data: {
          title: next.title,
          company: next.company,
          companyKey: next.companyKey,
          titleKey: next.titleKey,
          titleCoreKey: next.titleCoreKey,
          descriptionFingerprint: next.descriptionFingerprint,
          location: next.location,
          locationKey: next.locationKey,
          region: next.region,
          workMode: next.workMode,
          salaryMin: next.salaryMin,
          salaryMax: next.salaryMax,
          salaryCurrency: next.salaryCurrency,
          employmentType: next.employmentType,
          experienceLevel: next.experienceLevel,
          description: next.description,
          shortSummary: next.shortSummary,
          industry: next.industry,
          roleFamily: next.roleFamily,
          normalizedEmploymentType: next.normalizedEmploymentType,
          normalizedEmploymentTypeConfidence: next.normalizedEmploymentTypeConfidence,
          normalizedCareerStage: next.normalizedCareerStage,
          normalizedCareerStageConfidence: next.normalizedCareerStageConfidence,
          normalizedIndustry: next.normalizedIndustry,
          normalizedIndustryConfidence: next.normalizedIndustryConfidence,
          normalizedRoleCategory: next.normalizedRoleCategory,
          normalizedRoleCategoryConfidence: next.normalizedRoleCategoryConfidence,
          classificationStatus: next.classificationStatus,
          applyUrl: next.applyUrl,
          applyUrlKey: next.applyUrlKey,
          postedAt: next.postedAt,
          deadline: next.deadline,
          duplicateClusterId: next.duplicateClusterId,
          qualityScore: computeNormalizedQualityScore(next),
        },
      });
      await upsertJobFeedIndex(row.id);
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? "apply" : "dry-run",
        scanned,
        changed,
        rejectedByNewNormalizer,
        rejectionReasons: sortRecord(rejectionReasons),
        samples,
      },
      null,
      2
    )
  );
}

async function findRepairCandidates(limit: number) {
  return prisma.$queryRaw<CandidateRow[]>`
    SELECT
      id,
      title,
      company,
      location,
      description,
      "applyUrl",
      "postedAt",
      deadline,
      "employmentType",
      "workMode",
      "salaryMin",
      "salaryMax",
      "salaryCurrency"
    FROM "JobCanonical"
    WHERE status IN ('LIVE', 'AGING', 'STALE')
      AND (
        LOWER(company) IN (
          'adp',
          'ashbyhq',
          'bamboohr',
          'greenhouse',
          'hcshiring',
          'icims',
          'jobappnetwork',
          'jobvite',
          'lever',
          'myworkdayjobs',
          'oraclecloud',
          'paylocity',
          'rippling',
          'smartrecruiters',
          'successfactors',
          'taleo',
          'teamtailor',
          'typeform',
          'workable',
          'workstream'
        )
        OR LOWER(title) = LOWER(company)
        OR title ~* '^(redirect|apply|req#?[0-9]+|requisition #?[0-9]+|job #?[0-9]+)$'
        OR title ~* '^(remote|hybrid|onsite|on-site|apac|emea|latam|europe|asia|africa|middle east|united kingdom|uk|india|australia)$'
      )
    ORDER BY
      CASE
        WHEN "applyUrl" ~* '(jobs\\.ashbyhq\\.com/[^/]+/|(?:boards|job-boards)\\.greenhouse\\.io/[^/]+/|jobs\\.lever\\.co/[^/]+/|jobs\\.smartrecruiters\\.com/[^/]+/|apply\\.workable\\.com/[^/]+/|jobs\\.jobvite\\.com/[^/]+/|[^/]+\\.teamtailor\\.com/)'
        THEN 0
        ELSE 1
      END,
      "lastSeenAt" DESC NULLS LAST,
      "updatedAt" DESC
    LIMIT ${limit}
  `;
}

function sortRecord(record: Record<string, number>) {
  return Object.entries(record)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ key, count }));
}

function parseArgs(argv: string[]): CliArgs {
  return {
    apply: argv.includes("--apply"),
    batchSize: readNumberArg(argv, "--batch-size", 1000),
    limit: readNumberArg(argv, "--limit", 25_000),
    sampleLimit: readNumberArg(argv, "--sample-limit", 25),
  };
}

function readNumberArg(argv: string[], key: string, fallback: number) {
  const prefix = `${key}=`;
  const indexed = argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const keyIndex = argv.findIndex((arg) => arg === key);
  const raw = indexed ?? (keyIndex >= 0 ? argv[keyIndex + 1] : undefined);
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

main()
  .catch((error) => {
    console.error("Failed to repair job core fields:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
