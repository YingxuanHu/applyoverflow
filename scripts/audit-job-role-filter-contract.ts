import { prisma } from "@/lib/db";
import { getJobFilterContractViolations } from "@/lib/job-filter-contract";
import { getJobs, type JobFilterParams } from "@/lib/queries/jobs";
import {
  NORMALIZED_ROLE_CATEGORY_OPTIONS,
  ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD,
  normalizeRoleCategoryFilterValue,
} from "@/lib/job-metadata";

type CountRow = {
  label: string | null;
  count: bigint;
};

const ROLE_VALUES = new Set<string>(NORMALIZED_ROLE_CATEGORY_OPTIONS.map((option) => option.value));
const FINANCE_CONFUSION_RE =
  "(software|developer|development engineer|engineering|backend|frontend|front-end|full-stack|platform|infrastructure|data engineer|technology|technical|devops|sre|risk advisory technology)";

function getArgValue(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function parseSampleLimit() {
  const raw = getArgValue("samples");
  const parsed = raw ? Number.parseInt(raw, 10) : 10;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 50) : 10;
}

function getRequestedRoles() {
  const rawRole = getArgValue("role");
  const normalized = normalizeRoleCategoryFilterValue(rawRole);
  if (!normalized) return NORMALIZED_ROLE_CATEGORY_OPTIONS.map((option) => option.value);
  return normalized
    .split(",")
    .filter((role) => ROLE_VALUES.has(role));
}

async function countStrictRoleRows(roleCategory: string) {
  return prisma.jobCanonical.count({
    where: {
      status: "LIVE",
      normalizedRoleCategory: roleCategory,
      normalizedRoleCategoryConfidence: {
        gte: ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD,
      },
      classificationStatus: {
        in: ["CONFIDENT", "PARTIAL", "NEEDS_REVIEW"],
      },
    },
  });
}

async function countRoleDistributionForFilter(roleCategory: string) {
  return prisma.$queryRaw<CountRow[]>`
    SELECT COALESCE("normalizedRoleCategory"::text, 'NULL') AS label, COUNT(*)::bigint AS count
    FROM "JobCanonical"
    WHERE status = 'LIVE'
      AND "normalizedRoleCategory" = ${roleCategory}
      AND COALESCE("normalizedRoleCategoryConfidence", 0) >= ${ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD}
      AND "classificationStatus" IN ('CONFIDENT', 'PARTIAL', 'NEEDS_REVIEW')
    GROUP BY COALESCE("normalizedRoleCategory"::text, 'NULL')
    ORDER BY count DESC, label ASC
  `;
}

async function getSuspiciousFinanceRows(limit: number) {
  return prisma.$queryRaw<
    Array<{
      id: string;
      title: string;
      company: string;
      roleFamily: string | null;
      normalizedRoleCategory: string | null;
      normalizedRoleCategoryConfidence: number | null;
      normalizedIndustry: string | null;
      classificationStatus: string | null;
    }>
  >`
    SELECT
      id,
      title,
      company,
      "roleFamily",
      "normalizedRoleCategory",
      "normalizedRoleCategoryConfidence",
      "normalizedIndustry",
      "classificationStatus"
    FROM "JobCanonical"
    WHERE status = 'LIVE'
      AND "normalizedRoleCategory" = 'FINANCE_ACCOUNTING'
      AND COALESCE("normalizedRoleCategoryConfidence", 0) >= ${ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD}
      AND "classificationStatus" IN ('CONFIDENT', 'PARTIAL', 'NEEDS_REVIEW')
      AND title ~* ${FINANCE_CONFUSION_RE}
    ORDER BY "postedAt" DESC NULLS LAST
    LIMIT ${limit}
  `;
}

async function auditRole(roleCategory: string, sampleLimit: number) {
  const filters: JobFilterParams = {
    roleCategory,
    sortBy: "newest",
    page: 1,
  };
  const [strictDbCount, distribution, queryResult] = await Promise.all([
    countStrictRoleRows(roleCategory),
    countRoleDistributionForFilter(roleCategory),
    getJobs(filters, { viewerProfileId: null }),
  ]);

  const violations = getJobFilterContractViolations(filters, queryResult.data);
  const label =
    NORMALIZED_ROLE_CATEGORY_OPTIONS.find((option) => option.value === roleCategory)?.label ??
    roleCategory;

  console.log(`\n${label} (${roleCategory})`);
  console.log(`  strict live DB rows: ${strictDbCount.toLocaleString()}`);
  console.log(`  user-facing total: ${queryResult.total?.toLocaleString() ?? "timed out/unknown"}`);
  console.log(`  sampled page rows: ${queryResult.data.length}`);
  console.log(`  contract violations on sampled page: ${violations.length}`);
  console.log(
    `  role distribution under strict predicate: ${distribution
      .map((row) => `${row.label ?? "NULL"}=${row.count.toString()}`)
      .join(", ")}`
  );

  if (violations.length > 0) {
    for (const violation of violations.slice(0, sampleLimit)) {
      console.log(
        `    VIOLATION ${violation.id}: ${violation.title} | ${violation.company} | role=${violation.normalizedRoleCategory} | confidence=${violation.normalizedRoleCategoryConfidence} | family=${violation.roleFamily} | reason=${violation.reason}`
      );
    }
  }
}

async function main() {
  const sampleLimit = parseSampleLimit();
  const roles = getRequestedRoles();
  console.log(
    `Auditing ${roles.length} role filter(s), confidence >= ${ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD}`
  );

  for (const role of roles) {
    await auditRole(role, sampleLimit);
  }

  if (roles.includes("FINANCE_ACCOUNTING")) {
    const suspiciousFinanceRows = await getSuspiciousFinanceRows(sampleLimit);
    console.log("\nFinance / Accounting suspicious title scan");
    if (suspiciousFinanceRows.length === 0) {
      console.log("  none");
    } else {
      for (const row of suspiciousFinanceRows) {
        console.log(
          `  ${row.id}: ${row.title} | ${row.company} | role=${row.normalizedRoleCategory} | confidence=${row.normalizedRoleCategoryConfidence} | industry=${row.normalizedIndustry} | family=${row.roleFamily} | status=${row.classificationStatus}`
        );
      }
    }
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
