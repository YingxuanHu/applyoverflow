import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { hasDescriptionPollution } from "@/lib/ingestion/html-description";
import { buildEligibilityDraft } from "@/lib/ingestion/classify";
import { classifyNonJobPosting } from "@/lib/job-integrity";
import type { NormalizedJobInput } from "@/lib/ingestion/types";
import {
  coerceNormalizedCareerStage,
  coerceNormalizedEmploymentType,
  coerceNormalizedIndustry,
  coerceNormalizedRoleCategory,
} from "@/lib/job-metadata";

process.env.DATABASE_PROCESS_ROLE ??= "expansion_pipeline";
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ??= "10000";

type CliArgs = {
  days: number;
  families: string[];
  limitPerFamily: number;
  out: string;
};

type FamilyRow = {
  family: string;
  count: bigint | number;
};

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    days: 14,
    families: [],
    limitPerFamily: 100,
    out: "data/ops/source-family-classifier-audit.json",
  };

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=", 2);
    const key = rawKey.trim();
    const value = rawValue?.trim();
    if (!key || !value) continue;

    if (key === "days") {
      const numeric = Number.parseInt(value, 10);
      if (Number.isFinite(numeric) && numeric > 0) parsed.days = numeric;
      continue;
    }

    if (key === "families") {
      parsed.families = value
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
      continue;
    }

    if (key === "limit-per-family") {
      const numeric = Number.parseInt(value, 10);
      if (Number.isFinite(numeric) && numeric > 0) parsed.limitPerFamily = numeric;
      continue;
    }

    if (key === "out") {
      parsed.out = value;
    }
  }

  return parsed;
}

function buildNormalizedJob(record: {
  title: string;
  company: string;
  companyKey: string;
  titleKey: string;
  titleCoreKey: string;
  descriptionFingerprint: string;
  location: string;
  locationKey: string;
  region: NormalizedJobInput["region"];
  workMode: NormalizedJobInput["workMode"];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  employmentType: NormalizedJobInput["employmentType"];
  experienceLevel: NormalizedJobInput["experienceLevel"] | null;
  description: string;
  shortSummary: string;
  industry: NormalizedJobInput["industry"];
  roleFamily: string;
  normalizedEmploymentType: string | null;
  normalizedEmploymentTypeConfidence?: number | null;
  normalizedCareerStage: string | null;
  normalizedCareerStageConfidence?: number | null;
  normalizedIndustry: string | null;
  normalizedIndustryConfidence?: number | null;
  normalizedRoleCategory: string | null;
  normalizedRoleCategoryConfidence?: number | null;
  classificationStatus?: string | null;
  applyUrl: string;
  applyUrlKey: string | null;
  postedAt: Date;
  deadline: Date | null;
  duplicateClusterId: string;
}): NormalizedJobInput {
  return {
    title: record.title,
    company: record.company,
    companyKey: record.companyKey,
    titleKey: record.titleKey,
    titleCoreKey: record.titleCoreKey,
    descriptionFingerprint: record.descriptionFingerprint,
    location: record.location,
    locationKey: record.locationKey,
    region: record.region,
    workMode: record.workMode,
    salaryMin: record.salaryMin,
    salaryMax: record.salaryMax,
    salaryCurrency: record.salaryCurrency,
    employmentType: record.employmentType,
    experienceLevel: record.experienceLevel ?? "UNKNOWN",
    description: record.description,
    shortSummary: record.shortSummary,
    industry: record.industry,
    roleFamily: record.roleFamily,
    normalizedEmploymentType: coerceNormalizedEmploymentType(record.normalizedEmploymentType),
    normalizedEmploymentTypeConfidence: record.normalizedEmploymentTypeConfidence ?? 0.2,
    normalizedCareerStage: coerceNormalizedCareerStage(record.normalizedCareerStage),
    normalizedCareerStageConfidence: record.normalizedCareerStageConfidence ?? 0.2,
    normalizedIndustry: coerceNormalizedIndustry(record.normalizedIndustry),
    normalizedIndustryConfidence: record.normalizedIndustryConfidence ?? 0.2,
    normalizedRoleCategory: coerceNormalizedRoleCategory(record.normalizedRoleCategory),
    normalizedRoleCategoryConfidence: record.normalizedRoleCategoryConfidence ?? 0.2,
    classificationStatus:
      (record.classificationStatus as NormalizedJobInput["classificationStatus"] | null) ??
      "UNKNOWN",
    applyUrl: record.applyUrl,
    applyUrlKey: record.applyUrlKey,
    postedAt: record.postedAt,
    deadline: record.deadline,
    duplicateClusterId: record.duplicateClusterId,
  };
}

async function resolveFamilies(cutoff: Date, requestedFamilies: string[]) {
  if (requestedFamilies.length > 0) {
    return requestedFamilies;
  }

  const rows = await prisma.$queryRaw<FamilyRow[]>`
    SELECT
      LOWER(split_part("sourceName", ':', 1)) AS family,
      COUNT(*) AS count
    FROM "JobRaw"
    WHERE "fetchedAt" >= ${cutoff}
    GROUP BY 1
    ORDER BY COUNT(*) DESC, 1 ASC
    LIMIT 8
  `;

  return rows.map((row) => row.family);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cutoff = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
  const families = await resolveFamilies(cutoff, args.families);
  const familyReports = [];

  for (const family of families) {
    const records = await prisma.normalizedJobRecord.findMany({
      where: {
        rawJob: {
          fetchedAt: { gte: cutoff },
          sourceName: {
            startsWith: `${family}:`,
            mode: "insensitive",
          },
        },
      },
      orderBy: {
        rawJob: {
          fetchedAt: "desc",
        },
      },
      take: args.limitPerFamily,
      select: {
        id: true,
        status: true,
        rejectionReason: true,
        title: true,
        company: true,
        companyKey: true,
        titleKey: true,
        titleCoreKey: true,
        descriptionFingerprint: true,
        location: true,
        locationKey: true,
        region: true,
        workMode: true,
        salaryMin: true,
        salaryMax: true,
        salaryCurrency: true,
        employmentType: true,
        experienceLevel: true,
        description: true,
        shortSummary: true,
        industry: true,
        roleFamily: true,
        normalizedEmploymentType: true,
        normalizedCareerStage: true,
        normalizedIndustry: true,
        normalizedRoleCategory: true,
        applyUrl: true,
        applyUrlKey: true,
        postedAt: true,
        deadline: true,
        duplicateClusterId: true,
        rawJob: {
          select: {
            sourceName: true,
          },
        },
      },
    });

    const suspiciousValidated: Array<Record<string, unknown>> = [];
    const recoverableRejected: Array<Record<string, unknown>> = [];
    const eligibilityCounts: Record<string, number> = {};
    let pollutedDescriptions = 0;
    let detectedNonJobs = 0;
    let validatedCount = 0;
    let rejectedCount = 0;

    for (const record of records) {
      const nonJob = classifyNonJobPosting({
        title: record.title,
        description: record.description,
        applyUrl: record.applyUrl,
      });
      const polluted = hasDescriptionPollution(record.description);
      const job = buildNormalizedJob(record);

      if (polluted) pollutedDescriptions += 1;
      if (nonJob.detected) detectedNonJobs += 1;

      if (record.status === "VALIDATED") {
        validatedCount += 1;
        const eligibility = buildEligibilityDraft({
          job,
          sourceName: record.rawJob.sourceName,
        });
        eligibilityCounts[eligibility.submissionCategory] =
          (eligibilityCounts[eligibility.submissionCategory] ?? 0) + 1;

        if (polluted || nonJob.detected) {
          suspiciousValidated.push({
            id: record.id,
            title: record.title,
            company: record.company,
            reason: nonJob.reason ?? (polluted ? "description_pollution" : "unknown"),
            negativeHits: nonJob.negativeHits,
            positiveHits: nonJob.positiveHits,
            eligibility: eligibility.submissionCategory,
            applyUrl: record.applyUrl,
          });
        }
      } else if (record.status === "REJECTED") {
        rejectedCount += 1;
        if (
          record.rejectionReason === "obvious_junk" &&
          !nonJob.detected &&
          nonJob.positiveHits >= 2
        ) {
          recoverableRejected.push({
            id: record.id,
            title: record.title,
            company: record.company,
            rejectionReason: record.rejectionReason,
            negativeHits: nonJob.negativeHits,
            positiveHits: nonJob.positiveHits,
            applyUrl: record.applyUrl,
          });
        }
      }
    }

    familyReports.push({
      family,
      sampleCount: records.length,
      validatedCount,
      rejectedCount,
      pollutedDescriptions,
      detectedNonJobs,
      suspiciousValidatedCount: suspiciousValidated.length,
      recoverableRejectedCount: recoverableRejected.length,
      eligibilityCounts,
      suspiciousValidated: suspiciousValidated.slice(0, 10),
      recoverableRejected: recoverableRejected.slice(0, 10),
    });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    windowDays: args.days,
    limitPerFamily: args.limitPerFamily,
    families,
    reports: familyReports,
    summary: {
      familyCount: familyReports.length,
      sampleCount: familyReports.reduce((sum, report) => sum + report.sampleCount, 0),
      suspiciousValidatedCount: familyReports.reduce(
        (sum, report) => sum + report.suspiciousValidatedCount,
        0
      ),
      recoverableRejectedCount: familyReports.reduce(
        (sum, report) => sum + report.recoverableRejectedCount,
        0
      ),
      pollutedDescriptions: familyReports.reduce(
        (sum, report) => sum + report.pollutedDescriptions,
        0
      ),
    },
  };

  const outputPath = path.resolve(args.out);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((error) => {
    console.error(
      "[classifier:audit] failed:",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
