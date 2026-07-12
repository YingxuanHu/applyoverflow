import { prisma } from "@/lib/db";
import {
  ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD,
  CAREER_STAGE_FILTER_CONFIDENCE_THRESHOLD,
} from "@/lib/job-metadata";

type CountRow = {
  label: string | null;
  count: bigint;
};

type SampleRow = {
  id: string;
  title: string;
  company: string;
  roleFamily: string;
  normalizedRoleCategory: string | null;
  normalizedRoleCategoryConfidence: number | null;
  normalizedEmploymentType: string | null;
  normalizedCareerStage: string | null;
  normalizedCareerStageConfidence: number | null;
  classificationStatus: string | null;
};

const COUNT_COLUMNS = [
  "normalizedRoleCategory",
  "normalizedIndustry",
  "normalizedEmploymentType",
  "normalizedCareerStage",
  "classificationStatus",
  "workMode",
] as const;

function parseSampleLimit(argv: string[]) {
  const raw = argv.find((arg) => arg.startsWith("--samples="))?.slice("--samples=".length);
  const parsed = raw ? Number.parseInt(raw, 10) : 8;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 25) : 8;
}

async function countByColumn(table: "JobCanonical" | "JobFeedIndex", column: (typeof COUNT_COLUMNS)[number]) {
  return prisma.$queryRawUnsafe<CountRow[]>(
    `
      SELECT COALESCE("${column}"::text, 'NULL') AS label, COUNT(*)::bigint AS count
      FROM "${table}"
      WHERE status = 'LIVE'
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

async function printSamples(title: string, whereSql: string, limit: number) {
  const rows = await prisma.$queryRawUnsafe<SampleRow[]>(
    `
      SELECT
        id,
        title,
        company,
        "roleFamily",
        "normalizedRoleCategory",
        "normalizedRoleCategoryConfidence",
        "normalizedEmploymentType",
        "normalizedCareerStage",
        "normalizedCareerStageConfidence",
        "classificationStatus"
      FROM "JobCanonical"
      WHERE status = 'LIVE'
        AND (${whereSql})
      ORDER BY "postedAt" DESC
      LIMIT $1
    `,
    limit
  );

  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log("  none");
    return;
  }

  for (const row of rows) {
    console.log(
      `  ${row.id}: ${row.title} | ${row.company} | role=${row.normalizedRoleCategory ?? "NULL"} | stage=${row.normalizedCareerStage ?? "NULL"} | type=${row.normalizedEmploymentType ?? "NULL"} | family=${row.roleFamily}`
      + ` | roleConfidence=${row.normalizedRoleCategoryConfidence ?? "NULL"} | stageConfidence=${row.normalizedCareerStageConfidence ?? "NULL"} | status=${row.classificationStatus ?? "NULL"}`
    );
  }
}

async function main() {
  const sampleLimit = parseSampleLimit(process.argv.slice(2));
  console.log(`Job filter metadata diagnostics sampleLimit=${sampleLimit}`);

  const [canonicalLive, feedLive, softwareFeedLive, confidentSoftwareFeedLive] = await Promise.all([
    prisma.jobCanonical.count({ where: { status: "LIVE" } }),
    prisma.jobFeedIndex.count({ where: { status: "LIVE" } }),
    prisma.jobFeedIndex.count({
      where: {
        status: "LIVE",
        normalizedRoleCategory: "SOFTWARE_ENGINEERING",
      },
    }),
    prisma.jobFeedIndex.count({
      where: {
        status: "LIVE",
        normalizedRoleCategory: "SOFTWARE_ENGINEERING",
        normalizedRoleCategoryConfidence: {
          gte: ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD,
        },
      },
    }),
  ]);

  console.log(`\nVisible-ish live feed rows: ${feedLive.toLocaleString()}`);
  console.log(`Canonical LIVE rows: ${canonicalLive.toLocaleString()}`);
  console.log(`Software Engineering LIVE feed rows: ${softwareFeedLive.toLocaleString()}`);
  console.log(
    `Software Engineering filter-safe rows: ${confidentSoftwareFeedLive.toLocaleString()} (confidence >= ${ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD})`
  );

  for (const column of COUNT_COLUMNS) {
    printCounts(`JobFeedIndex LIVE by ${column}`, await countByColumn("JobFeedIndex", column));
  }

  await printSamples(
    "Suspicious Software Engineering samples",
    `
      "normalizedRoleCategory" = 'SOFTWARE_ENGINEERING'
      AND COALESCE("normalizedRoleCategoryConfidence", 0) >= ${ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD}
      AND title ~* '(developer advocate|developer relations|business development|sales development|content developer|curriculum developer|real estate developer|product manager|program manager|project manager|guide$|search jobs|privacy notice|gateway time)'
    `,
    sampleLimit
  );

  await printSamples(
    "Suspicious senior/leadership rows labeled internship",
    `
      "normalizedCareerStage" = 'INTERNSHIP_COOP_STUDENT'
      AND COALESCE("normalizedCareerStageConfidence", 0) >= ${CAREER_STAGE_FILTER_CONFIDENCE_THRESHOLD}
      AND title ~* '(senior|sr\\.?|staff|principal|lead|manager|director|vp|vice president|chief|head of)'
      AND title !~* '(intern|internship|co[- ]?op|student)'
    `,
    sampleLimit
  );

  await printSamples(
    "Unknown role category samples",
    `
      COALESCE("normalizedRoleCategory", 'OTHER_UNKNOWN') = 'OTHER_UNKNOWN'
    `,
    sampleLimit
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
