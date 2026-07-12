import "dotenv/config";

import type { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { buildEligibilityDraft } from "../src/lib/ingestion/classify";
import { normalizeSourceJob } from "../src/lib/ingestion/normalize";
import { computeNormalizedQualityScore } from "../src/lib/ingestion/quality";
import { upsertJobFeedIndexes } from "../src/lib/ingestion/search-index";
import type { NormalizedJobInput, SourceConnectorJob } from "../src/lib/ingestion/types";

type CandidateRow = {
  mappingId: string;
  canonicalJobId: string;
  rawJobId: string;
  sourceName: string;
  sourceUrl: string | null;
  canonicalTitle: string;
  companyId: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastSourceSeenAt: Date | null;
  lastApplyCheckAt: Date | null;
  lastConfirmedAliveAt: Date | null;
  availabilityScore: number;
  rawPayload: Prisma.JsonValue;
};

type CliArgs = {
  apply: boolean;
  limit: number;
};

const DEFAULT_LIMIT = 5_000;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();

  const candidates = await prisma.$queryRaw<CandidateRow[]>`
    select
      m.id as "mappingId",
      m."canonicalJobId",
      m."rawJobId",
      m."sourceName",
      m."sourceUrl",
      j.title as "canonicalTitle",
      j."companyId",
      j."firstSeenAt",
      j."lastSeenAt",
      j."lastSourceSeenAt",
      j."lastApplyCheckAt",
      j."lastConfirmedAliveAt",
      j."availabilityScore",
      r."rawPayload"
    from "JobSourceMapping" m
    join "JobCanonical" j on j.id = m."canonicalJobId"
    join "JobRaw" r on r.id = m."rawJobId"
    where m."removedAt" is null
      and j.status in ('LIVE', 'AGING', 'STALE')
      and m."sourceName" not like 'Jooble%'
      and m."sourceName" not like 'Adzuna%'
      and r."rawPayload"->>'title' is not null
      and r."rawPayload"->>'title' <> ''
      and (
        r."rawPayload"->>'title' ~ '\\s[-–—|/]\\s'
        or j.title in ('AI Trainer', 'AI Tutor', 'INTERN OR CO-OP')
      )
    order by j."lastSeenAt" desc
    limit ${args.limit}
  `;

  const planned = [];
  for (const candidate of candidates) {
    const sourceJob = sourceConnectorJobFromRaw(candidate);
    const normalized = normalizeSourceJob({ job: sourceJob, fetchedAt: now });
    if (normalized.kind !== "accepted") continue;
    if (normalized.job.title === candidate.canonicalTitle) continue;
    if (normalized.job.roleFamily === "Unknown") continue;
    if (normalized.job.title.split(/\s+/).length < 2) continue;

    planned.push({
      candidate,
      normalizedJob: normalized.job,
    });
  }

  const countsBySource = planned.reduce<Record<string, number>>((acc, item) => {
    acc[item.candidate.sourceName] = (acc[item.candidate.sourceName] ?? 0) + 1;
    return acc;
  }, {});

  if (!args.apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          scanned: candidates.length,
          mappingsToMove: planned.length,
          affectedCanonicalCount: new Set(
            planned.map((item) => item.candidate.canonicalJobId)
          ).size,
          countsBySource,
          samples: planned.slice(0, 25).map((item) => ({
            mappingId: item.candidate.mappingId,
            canonicalJobId: item.candidate.canonicalJobId,
            sourceName: item.candidate.sourceName,
            fromTitle: item.candidate.canonicalTitle,
            toTitle: item.normalizedJob.title,
            applyUrl: item.normalizedJob.applyUrl,
          })),
        },
        null,
        2
      )
    );
    return;
  }

  const touchedCanonicalIds = new Set<string>();
  let moved = 0;
  let created = 0;
  let reused = 0;

  for (const item of planned) {
    const target = await findOrCreateCanonicalForSplit(item, now);
    if (target.created) created += 1;
    else reused += 1;

    await prisma.jobSourceMapping.update({
      where: { id: item.candidate.mappingId },
      data: {
        canonicalJobId: target.id,
        isPrimary: false,
      },
    });

    await prisma.normalizedJobRecord.updateMany({
      where: { rawJobId: item.candidate.rawJobId },
      data: {
        canonicalJobId: target.id,
        status: "CANONICALIZED",
        ...normalizedRecordFields(item.normalizedJob),
        qualityScore: computeNormalizedQualityScore(item.normalizedJob),
      },
    });

    const eligibilityDraft = buildEligibilityDraft({
      job: item.normalizedJob,
      sourceName: item.candidate.sourceName,
    });
    await prisma.jobEligibility.upsert({
      where: { canonicalJobId: target.id },
      create: { canonicalJobId: target.id, ...eligibilityDraft },
      update: eligibilityDraft,
    });

    touchedCanonicalIds.add(item.candidate.canonicalJobId);
    touchedCanonicalIds.add(target.id);
    moved += 1;
  }

  for (const canonicalId of touchedCanonicalIds) {
    await refreshPrimarySourceMapping(canonicalId);
  }
  await retireEmptyCanonicals([...touchedCanonicalIds], now);
  await upsertJobFeedIndexes([...touchedCanonicalIds], { concurrency: 6 });

  console.log(
    JSON.stringify(
      {
        mode: "apply",
        scanned: candidates.length,
        moved,
        created,
        reused,
        touchedCanonicalCount: touchedCanonicalIds.size,
        countsBySource,
      },
      null,
      2
    )
  );
}

async function findOrCreateCanonicalForSplit(
  item: { candidate: CandidateRow; normalizedJob: NormalizedJobInput },
  now: Date
) {
  const existing = item.normalizedJob.applyUrlKey
    ? await prisma.jobCanonical.findFirst({
        where: {
          applyUrlKey: item.normalizedJob.applyUrlKey,
          id: { not: item.candidate.canonicalJobId },
        },
        select: { id: true },
      })
    : null;

  if (existing) {
    await prisma.jobCanonical.update({
      where: { id: existing.id },
      data: {
        ...item.normalizedJob,
        status: "LIVE",
        lastSeenAt: now,
        lastSourceSeenAt: now,
        lastConfirmedAliveAt: now,
        availabilityScore: Math.max(item.candidate.availabilityScore, 80),
        qualityScore: computeNormalizedQualityScore(item.normalizedJob),
        deadSignalAt: null,
        deadSignalReason: null,
        staleAt: null,
        expiredAt: null,
        removedAt: null,
      },
    });
    return { id: existing.id, created: false };
  }

  const created = await prisma.jobCanonical.create({
    data: {
      ...item.normalizedJob,
      companyId: item.candidate.companyId,
      status: "LIVE",
      firstSeenAt: item.candidate.firstSeenAt,
      lastSeenAt: item.candidate.lastSeenAt,
      lastSourceSeenAt: item.candidate.lastSourceSeenAt ?? now,
      lastApplyCheckAt: item.candidate.lastApplyCheckAt,
      lastConfirmedAliveAt: item.candidate.lastConfirmedAliveAt ?? now,
      availabilityScore: Math.max(item.candidate.availabilityScore, 80),
      qualityScore: computeNormalizedQualityScore(item.normalizedJob),
      deadSignalAt: null,
      deadSignalReason: null,
      staleAt: null,
      expiredAt: null,
      removedAt: null,
    },
    select: { id: true },
  });

  return { id: created.id, created: true };
}

async function refreshPrimarySourceMapping(canonicalJobId: string) {
  const primary = await prisma.jobSourceMapping.findFirst({
    where: { canonicalJobId, removedAt: null },
    orderBy: [
      { sourceQualityRank: "desc" },
      { lastSeenAt: "desc" },
      { createdAt: "asc" },
    ],
    select: { id: true },
  });

  await prisma.jobSourceMapping.updateMany({
    where: { canonicalJobId },
    data: { isPrimary: false },
  });

  if (primary) {
    await prisma.jobSourceMapping.update({
      where: { id: primary.id },
      data: { isPrimary: true },
    });
  }
}

async function retireEmptyCanonicals(canonicalJobIds: string[], now: Date) {
  const rows = await prisma.jobCanonical.findMany({
    where: { id: { in: canonicalJobIds } },
    select: {
      id: true,
      _count: {
        select: {
          sourceMappings: {
            where: { removedAt: null },
          },
        },
      },
    },
  });

  const emptyIds = rows
    .filter((row) => row._count.sourceMappings === 0)
    .map((row) => row.id);
  if (emptyIds.length === 0) return;

  await prisma.jobCanonical.updateMany({
    where: { id: { in: emptyIds } },
    data: {
      status: "REMOVED",
      availabilityScore: 0,
      removedAt: now,
      deadSignalAt: now,
      deadSignalReason: "All source mappings were split into more accurate canonical jobs.",
    },
  });
}

function normalizedRecordFields(job: NormalizedJobInput) {
  return {
    title: job.title,
    company: job.company,
    companyKey: job.companyKey,
    titleKey: job.titleKey,
    titleCoreKey: job.titleCoreKey,
    descriptionFingerprint: job.descriptionFingerprint,
    location: job.location,
    locationKey: job.locationKey,
    region: job.region,
    workMode: job.workMode,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    employmentType: job.employmentType,
    experienceLevel: job.experienceLevel,
    description: job.description,
    shortSummary: job.shortSummary,
    industry: job.industry,
    roleFamily: job.roleFamily,
    normalizedEmploymentType: job.normalizedEmploymentType,
    normalizedEmploymentTypeConfidence: job.normalizedEmploymentTypeConfidence,
    normalizedCareerStage: job.normalizedCareerStage,
    normalizedCareerStageConfidence: job.normalizedCareerStageConfidence,
    normalizedIndustry: job.normalizedIndustry,
    normalizedIndustryConfidence: job.normalizedIndustryConfidence,
    normalizedRoleCategory: job.normalizedRoleCategory,
    normalizedRoleCategoryConfidence: job.normalizedRoleCategoryConfidence,
    classificationStatus: job.classificationStatus,
    applyUrl: job.applyUrl,
    applyUrlKey: job.applyUrlKey,
    postedAt: job.postedAt,
    deadline: job.deadline,
    duplicateClusterId: job.duplicateClusterId,
  };
}

function sourceConnectorJobFromRaw(row: CandidateRow): SourceConnectorJob {
  const raw = asRecord(row.rawPayload);
  const metadata = raw.metadata ?? {};

  return {
    sourceId: asString(raw.sourceId) || row.rawJobId,
    sourceUrl: asString(raw.sourceUrl) || row.sourceUrl,
    title: asString(raw.title),
    company: asString(raw.company),
    location: asString(raw.location),
    description: asString(raw.description),
    applyUrl: asString(raw.applyUrl),
    postedAt: asDate(raw.postedAt),
    deadline: asDate(raw.deadline),
    employmentType: asEmploymentType(raw.employmentType),
    workMode: asWorkMode(raw.workMode),
    salaryMin: asNumber(raw.salaryMin),
    salaryMax: asNumber(raw.salaryMax),
    salaryCurrency: asString(raw.salaryCurrency) || null,
    metadata: metadata as Prisma.InputJsonValue,
  };
}

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asDate(value: unknown) {
  if (!value || typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asEmploymentType(value: unknown): SourceConnectorJob["employmentType"] {
  const normalized = asString(value);
  return ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP", "UNKNOWN"].includes(normalized)
    ? (normalized as NonNullable<SourceConnectorJob["employmentType"]>)
    : null;
}

function asWorkMode(value: unknown): SourceConnectorJob["workMode"] {
  const normalized = asString(value);
  return ["REMOTE", "HYBRID", "ONSITE", "FLEXIBLE", "UNKNOWN"].includes(normalized)
    ? (normalized as NonNullable<SourceConnectorJob["workMode"]>)
    : null;
}

function parseArgs(argv: string[]): CliArgs {
  const limitIndex = argv.findIndex((arg) => arg === "--limit");
  const parsedLimit =
    limitIndex >= 0 && argv[limitIndex + 1]
      ? Number.parseInt(argv[limitIndex + 1] ?? "", 10)
      : DEFAULT_LIMIT;

  return {
    apply: argv.includes("--apply"),
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_LIMIT,
  };
}

main()
  .catch((error) => {
    console.error("Failed to split overmerged canonical jobs:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
