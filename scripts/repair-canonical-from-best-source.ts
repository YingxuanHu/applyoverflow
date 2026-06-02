import "dotenv/config";

process.env.DATABASE_PROCESS_ROLE ??= "expansion_pipeline";
process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS ??= "10000";

import type { NormalizedJobInput } from "@/lib/ingestion/types";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { computeNormalizedQualityScore } from "@/lib/ingestion/quality";
import { normalizeSourceJob } from "@/lib/ingestion/normalize";
import {
  deriveSourceIdentitySnapshot,
  deriveSourceLifecycleSnapshot,
} from "@/lib/ingestion/source-quality";
import {
  inferFreshnessModeFromSourceName,
  parseSourceConnectorJobFromRawPayload,
} from "@/lib/ingestion/normalized-records";
import { upsertJobFeedIndex } from "@/lib/ingestion/search-index";

type Args = {
  apply: boolean;
  batchSize: number;
  limit: number;
  ids: string[];
  sampleLimit: number;
};

type Candidate = Prisma.JobCanonicalGetPayload<{
  include: {
    sourceMappings: {
      include: {
        rawJob: true;
      };
    };
  };
}>;

type BestSource = {
  mappingId: string;
  rawJobId: string;
  sourceName: string;
  score: number;
  normalizedJob: NormalizedJobInput;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let scanned = 0;
  let repaired = 0;
  let rejectedSourceCandidates = 0;
  const rejectionReasons: Record<string, number> = {};
  const samples: Array<{
    id: string;
    sourceName: string;
    before: { title: string; company: string; descriptionPreview: string };
    after: { title: string; company: string; descriptionPreview: string };
  }> = [];

  const candidates = await loadCandidates(args);

  for (let start = 0; start < candidates.length; start += args.batchSize) {
    const batch = candidates.slice(start, start + args.batchSize);

    for (const candidate of batch) {
      scanned += 1;
      if (args.apply) {
        await refreshSourceMappingQuality(candidate);
      }

      const best = findBestSource(candidate, rejectionReasons);
      rejectedSourceCandidates = Object.values(rejectionReasons).reduce(
        (sum, count) => sum + count,
        0
      );
      if (!best) continue;

      if (!shouldRepair(candidate, best)) continue;
      repaired += 1;

      if (samples.length < args.sampleLimit) {
        samples.push({
          id: candidate.id,
          sourceName: best.sourceName,
          before: {
            title: candidate.title,
            company: candidate.company,
            descriptionPreview: preview(candidate.description),
          },
          after: {
            title: best.normalizedJob.title,
            company: best.normalizedJob.company,
            descriptionPreview: preview(best.normalizedJob.description),
          },
        });
      }

      if (!args.apply) continue;

      await prisma.jobCanonical.update({
        where: { id: candidate.id },
        data: {
          title: best.normalizedJob.title,
          company: best.normalizedJob.company,
          companyKey: best.normalizedJob.companyKey,
          titleKey: best.normalizedJob.titleKey,
          titleCoreKey: best.normalizedJob.titleCoreKey,
          descriptionFingerprint: best.normalizedJob.descriptionFingerprint,
          location: best.normalizedJob.location,
          locationKey: best.normalizedJob.locationKey,
          region: best.normalizedJob.region,
          workMode: best.normalizedJob.workMode,
          salaryMin: best.normalizedJob.salaryMin,
          salaryMax: best.normalizedJob.salaryMax,
          salaryCurrency: best.normalizedJob.salaryCurrency,
          employmentType: best.normalizedJob.employmentType,
          experienceLevel: best.normalizedJob.experienceLevel,
          description: best.normalizedJob.description,
          shortSummary: best.normalizedJob.shortSummary,
          industry: best.normalizedJob.industry,
          roleFamily: best.normalizedJob.roleFamily,
          normalizedEmploymentType: best.normalizedJob.normalizedEmploymentType,
          normalizedEmploymentTypeConfidence:
            best.normalizedJob.normalizedEmploymentTypeConfidence,
          normalizedCareerStage: best.normalizedJob.normalizedCareerStage,
          normalizedCareerStageConfidence:
            best.normalizedJob.normalizedCareerStageConfidence,
          normalizedIndustry: best.normalizedJob.normalizedIndustry,
          normalizedIndustryConfidence:
            best.normalizedJob.normalizedIndustryConfidence,
          normalizedRoleCategory: best.normalizedJob.normalizedRoleCategory,
          normalizedRoleCategoryConfidence:
            best.normalizedJob.normalizedRoleCategoryConfidence,
          classificationStatus: best.normalizedJob.classificationStatus,
          applyUrl: best.normalizedJob.applyUrl,
          applyUrlKey: best.normalizedJob.applyUrlKey,
          postedAt: best.normalizedJob.postedAt,
          deadline: best.normalizedJob.deadline,
          duplicateClusterId: best.normalizedJob.duplicateClusterId,
          qualityScore: computeNormalizedQualityScore(best.normalizedJob),
        },
      });

      await refreshPrimarySourceMapping(candidate.id);
      await upsertJobFeedIndex(candidate.id);
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? "apply" : "dry-run",
        scanned,
        repaired,
        rejectedSourceCandidates,
        rejectionReasons: sortRecord(rejectionReasons),
        samples,
      },
      null,
      2
    )
  );
}

async function loadCandidates(args: Args) {
  const where: Prisma.JobCanonicalWhereInput =
    args.ids.length > 0
      ? { id: { in: args.ids } }
      : {
          status: { in: ["LIVE", "AGING", "STALE"] },
          OR: [
            { title: { startsWith: "Join the ", mode: "insensitive" } },
            { description: { contains: "Location type", mode: "insensitive" } },
            { description: { contains: "All On-site Hybrid Remote", mode: "insensitive" } },
            { description: { contains: "Widget title goes here", mode: "insensitive" } },
            { description: { contains: "Meta text goes here", mode: "insensitive" } },
          ],
        };

  return prisma.jobCanonical.findMany({
    where,
    orderBy: [{ lastSeenAt: "desc" }, { updatedAt: "desc" }],
    take: args.limit,
    include: {
      sourceMappings: {
        where: { removedAt: null },
        include: { rawJob: true },
      },
    },
  });
}

function findBestSource(
  candidate: Candidate,
  rejectionReasons: Record<string, number>
): BestSource | null {
  const bestSources = candidate.sourceMappings
    .map((mapping) => {
      try {
        const sourceJob = parseSourceConnectorJobFromRawPayload({
          sourceName: mapping.rawJob.sourceName,
          sourceId: mapping.rawJob.sourceId,
          rawPayload: mapping.rawJob.rawPayload,
        });
        const normalized = normalizeSourceJob({
          job: sourceJob,
          fetchedAt: mapping.rawJob.fetchedAt,
        });

        if (normalized.kind === "rejected") {
          rejectionReasons[normalized.reason] =
            (rejectionReasons[normalized.reason] ?? 0) + 1;
          return null;
        }

        return {
          mappingId: mapping.id,
          rawJobId: mapping.rawJob.id,
          sourceName: mapping.rawJob.sourceName,
          normalizedJob: normalized.job,
          score:
            sourceScore(mapping.rawJob.sourceName, mapping.sourceQualityRank) +
            Math.min(200, normalized.job.description.length / 20) +
            computeNormalizedQualityScore(normalized.job),
        } satisfies BestSource;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "unknown_error";
        rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
        return null;
      }
    })
    .filter((source): source is BestSource => source !== null)
    .sort((left, right) => right.score - left.score);

  return bestSources[0] ?? null;
}

function sourceScore(sourceName: string, sourceQualityRank: number) {
  const prefix = sourceName.split(":")[0] ?? sourceName;
  if (prefix === "CompanyHtml") {
    return Math.min(sourceQualityRank, 430) - 250;
  }
  return sourceQualityRank;
}

function shouldRepair(candidate: Candidate, best: BestSource) {
  if (best.sourceName.startsWith("CompanyHtml:")) {
    return false;
  }

  if (candidate.title !== best.normalizedJob.title) return true;
  if (candidate.company !== best.normalizedJob.company) return true;
  if (candidate.location !== best.normalizedJob.location) return true;
  if (candidate.applyUrl !== best.normalizedJob.applyUrl) return true;

  const currentDescription = normalizeComparable(candidate.description);
  const nextDescription = normalizeComparable(best.normalizedJob.description);
  if (currentDescription === nextDescription) return false;

  return (
    looksPolluted(candidate.description) ||
    best.normalizedJob.description.length >= Math.max(120, candidate.description.length * 1.2)
  );
}

async function refreshSourceMappingQuality(candidate: Candidate) {
  for (const mapping of candidate.sourceMappings) {
    const sourceJob = parseSourceConnectorJobFromRawPayload({
      sourceName: mapping.rawJob.sourceName,
      sourceId: mapping.rawJob.sourceId,
      rawPayload: mapping.rawJob.rawPayload,
    });
    const sourceIdentity = deriveSourceIdentitySnapshot({
      sourceName: mapping.rawJob.sourceName,
      sourceId: mapping.rawJob.sourceId,
      sourceUrl: sourceJob.sourceUrl,
      applyUrl: sourceJob.applyUrl,
      metadata: sourceJob.metadata,
    });
    const sourceLifecycle = deriveSourceLifecycleSnapshot({
      sourceName: mapping.rawJob.sourceName,
      sourceUrl: sourceJob.sourceUrl,
      applyUrl: sourceJob.applyUrl,
      freshnessMode: inferFreshnessModeFromSourceName(mapping.rawJob.sourceName),
    });

    await prisma.jobSourceMapping.update({
      where: { id: mapping.id },
      data: {
        sourceQualityKind: sourceIdentity.sourceQualityKind,
        sourceQualityRank: sourceIdentity.sourceQualityRank,
        sourceType: sourceLifecycle.sourceType,
        sourceReliability: sourceLifecycle.sourceReliability,
        isFullSnapshot: sourceLifecycle.isFullSnapshot,
        pollPattern: sourceLifecycle.pollPattern,
      },
    });
  }

  await refreshPrimarySourceMapping(candidate.id);
}

async function refreshPrimarySourceMapping(canonicalJobId: string) {
  const activeMappings = await prisma.jobSourceMapping.findMany({
    where: {
      canonicalJobId,
      removedAt: null,
    },
    select: { id: true },
    orderBy: [
      { sourceQualityRank: "desc" },
      { lastSeenAt: "desc" },
      { createdAt: "asc" },
    ],
  });

  const primaryId = activeMappings[0]?.id ?? null;
  await prisma.jobSourceMapping.updateMany({
    where: {
      canonicalJobId,
      ...(primaryId ? { id: { not: primaryId } } : {}),
    },
    data: { isPrimary: false },
  });

  if (primaryId) {
    await prisma.jobSourceMapping.update({
      where: { id: primaryId },
      data: { isPrimary: true },
    });
  }
}

function looksPolluted(description: string) {
  return /(?:location type|all on-site hybrid remote|widget title goes here|meta text goes here|search by keyword|filter by location)/i.test(
    description
  );
}

function normalizeComparable(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function preview(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

function sortRecord(record: Record<string, number>) {
  return Object.entries(record)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ key, count }));
}

function parseArgs(argv: string[]): Args {
  return {
    apply: argv.includes("--apply"),
    batchSize: readNumberArg(argv, "--batch-size", 200),
    limit: readNumberArg(argv, "--limit", 5000),
    ids: readStringListArg(argv, "--ids"),
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

function readStringListArg(argv: string[], key: string) {
  const prefix = `${key}=`;
  const indexed = argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const keyIndex = argv.findIndex((arg) => arg === key);
  const raw = indexed ?? (keyIndex >= 0 ? argv[keyIndex + 1] : undefined);
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

main()
  .catch((error) => {
    console.error("Failed to repair canonical jobs from best source:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
