import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { normalizeSourceJob } from "@/lib/ingestion/normalize";
import { parseSourceConnectorJobFromRawPayload } from "@/lib/ingestion/normalized-records";
import { upsertJobFeedIndex } from "@/lib/ingestion/search-index";

type Options = {
  dryRun: boolean;
  limit: number | null;
  batchSize: number;
  onlyMissing: boolean;
  force: boolean;
};

type Distribution = Map<string, number>;

const options = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const startedAt = Date.now();
  let scanned = 0;
  let updated = 0;
  let unchanged = 0;
  let skippedNoRaw = 0;
  let skippedRejected = 0;
  let cursor: string | undefined;

  const workModeCounts: Distribution = new Map();
  const employmentGroupCounts: Distribution = new Map();
  const postedStatusCounts: Distribution = new Map();
  const deadlineStatusCounts: Distribution = new Map();
  const warningCounts: Distribution = new Map();
  const examples: Array<Record<string, unknown>> = [];

  while (options.limit === null || scanned < options.limit) {
    const remaining =
      options.limit === null ? options.batchSize : Math.min(options.batchSize, options.limit - scanned);
    if (remaining <= 0) break;

    const jobs = await prisma.jobCanonical.findMany({
      where: buildWhere(options),
      orderBy: { id: "asc" },
      take: remaining,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        title: true,
        company: true,
        workMode: true,
        workModeConfidence: true,
        workModeStatus: true,
        workModeSource: true,
        employmentType: true,
        employmentTypeGroup: true,
        employmentTypeConfidence: true,
        employmentTypeStatus: true,
        employmentTypeSource: true,
        normalizedEmploymentType: true,
        normalizedEmploymentTypeConfidence: true,
        postedAt: true,
        datePostedConfidence: true,
        datePostedStatus: true,
        datePostedSource: true,
        datePostedRawText: true,
        deadline: true,
        applicationDeadlineConfidence: true,
        applicationDeadlineStatus: true,
        applicationDeadlineSource: true,
        applicationDeadlineRawText: true,
        metadataExtractionWarnings: true,
        sourceMappings: {
          where: { removedAt: null },
          orderBy: [
            { isPrimary: "desc" },
            { sourceQualityRank: "desc" },
            { lastSeenAt: "desc" },
          ],
          take: 1,
          select: {
            sourceName: true,
            sourceUrl: true,
            rawJob: {
              select: {
                sourceId: true,
                sourceName: true,
                rawPayload: true,
                fetchedAt: true,
              },
            },
          },
        },
      },
    });

    if (jobs.length === 0) break;
    cursor = jobs[jobs.length - 1]?.id;

    for (const job of jobs) {
      scanned += 1;
      const sourceMapping = job.sourceMappings[0];
      const rawJob = sourceMapping?.rawJob;
      if (!rawJob) {
        skippedNoRaw += 1;
        continue;
      }

      const sourceJob = parseSourceConnectorJobFromRawPayload({
        sourceName: rawJob.sourceName,
        sourceId: rawJob.sourceId,
        rawPayload: rawJob.rawPayload,
      });
      const normalized = normalizeSourceJob({
        job: sourceJob,
        fetchedAt: rawJob.fetchedAt,
        sourceName: rawJob.sourceName,
      });

      if (normalized.kind === "rejected") {
        skippedRejected += 1;
        increment(warningCounts, `REJECTED_${normalized.reason}`);
        continue;
      }

      const next = normalized.job;
      const nextWarnings = readStringArray(next.metadataExtractionWarnings);
      increment(workModeCounts, next.workMode);
      increment(employmentGroupCounts, next.employmentTypeGroup ?? "UNKNOWN");
      increment(postedStatusCounts, next.datePostedStatus ?? "missing");
      increment(deadlineStatusCounts, next.applicationDeadlineStatus ?? "missing");
      for (const warning of nextWarnings) increment(warningCounts, warning);

      const updateData: Prisma.JobCanonicalUpdateInput = {
        workMode: next.workMode,
        workModeConfidence: next.workModeConfidence,
        workModeStatus: next.workModeStatus,
        workModeSource: next.workModeSource,
        workModeCandidatesJson: next.workModeCandidatesJson ?? Prisma.JsonNull,
        employmentType: next.employmentType,
        employmentTypeGroup: next.employmentTypeGroup,
        employmentTypeConfidence: next.employmentTypeConfidence,
        employmentTypeStatus: next.employmentTypeStatus,
        employmentTypeSource: next.employmentTypeSource,
        employmentTypeCandidatesJson: next.employmentTypeCandidatesJson ?? Prisma.JsonNull,
        normalizedEmploymentType: next.normalizedEmploymentType,
        normalizedEmploymentTypeConfidence: next.normalizedEmploymentTypeConfidence,
        postedAt: next.postedAt,
        datePostedConfidence: next.datePostedConfidence,
        datePostedStatus: next.datePostedStatus,
        datePostedSource: next.datePostedSource,
        datePostedRawText: next.datePostedRawText,
        deadline: next.deadline,
        applicationDeadlineConfidence: next.applicationDeadlineConfidence,
        applicationDeadlineStatus: next.applicationDeadlineStatus,
        applicationDeadlineSource: next.applicationDeadlineSource,
        applicationDeadlineRawText: next.applicationDeadlineRawText,
        metadataExtractionWarnings: next.metadataExtractionWarnings ?? Prisma.JsonNull,
      };

      if (!options.force && !hasChanged(job, next)) {
        unchanged += 1;
        continue;
      }

      updated += 1;
      if (examples.length < 10) {
        examples.push({
          id: job.id,
          title: job.title,
          company: job.company,
          workMode: `${job.workMode} -> ${next.workMode}`,
          employmentTypeGroup: `${job.employmentTypeGroup ?? "NULL"} -> ${next.employmentTypeGroup ?? "NULL"}`,
          datePostedStatus: `${job.datePostedStatus ?? "NULL"} -> ${next.datePostedStatus ?? "NULL"}`,
          deadlineStatus: `${job.applicationDeadlineStatus ?? "NULL"} -> ${next.applicationDeadlineStatus ?? "NULL"}`,
          warnings: nextWarnings,
        });
      }

      if (!options.dryRun) {
        await prisma.jobCanonical.update({
          where: { id: job.id },
          data: updateData,
        });
        await upsertJobFeedIndex(job.id);
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: options.dryRun ? "dry-run" : "write",
        scanned,
        updated,
        unchanged,
        skippedNoRaw,
        skippedRejected,
        elapsedSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
        workModeDistribution: mapToObject(workModeCounts),
        employmentTypeGroupDistribution: mapToObject(employmentGroupCounts),
        datePostedStatusDistribution: mapToObject(postedStatusCounts),
        deadlineStatusDistribution: mapToObject(deadlineStatusCounts),
        topWarnings: topEntries(warningCounts, 20),
        examples,
      },
      null,
      2
    )
  );
}

function buildWhere(options: Options): Prisma.JobCanonicalWhereInput {
  if (options.force || !options.onlyMissing) return {};
  return {
    OR: [
      { workModeConfidence: null },
      { workModeStatus: null },
      { employmentTypeGroup: null },
      { employmentTypeConfidence: null },
      { employmentTypeStatus: null },
      { datePostedStatus: null },
      { datePostedConfidence: null },
      { applicationDeadlineStatus: null },
      { applicationDeadlineConfidence: null },
    ],
  };
}

function hasChanged(
  current: {
    workMode: string;
    workModeConfidence: number | null;
    workModeStatus: string | null;
    workModeSource: string | null;
    employmentType: string;
    employmentTypeGroup: string | null;
    employmentTypeConfidence: number | null;
    employmentTypeStatus: string | null;
    employmentTypeSource: string | null;
    normalizedEmploymentType: string | null;
    normalizedEmploymentTypeConfidence: number | null;
    postedAt: Date;
    datePostedConfidence: number | null;
    datePostedStatus: string | null;
    datePostedSource: string | null;
    datePostedRawText: string | null;
    deadline: Date | null;
    applicationDeadlineConfidence: number | null;
    applicationDeadlineStatus: string | null;
    applicationDeadlineSource: string | null;
    applicationDeadlineRawText: string | null;
    metadataExtractionWarnings: Prisma.JsonValue | null;
  },
  next: {
    workMode: string;
    workModeConfidence?: number | null;
    workModeStatus?: string | null;
    workModeSource?: string | null;
    employmentType: string;
    employmentTypeGroup?: string | null;
    employmentTypeConfidence?: number | null;
    employmentTypeStatus?: string | null;
    employmentTypeSource?: string | null;
    normalizedEmploymentType?: string | null;
    normalizedEmploymentTypeConfidence?: number | null;
    postedAt: Date;
    datePostedConfidence?: number | null;
    datePostedStatus?: string | null;
    datePostedSource?: string | null;
    datePostedRawText?: string | null;
    deadline?: Date | null;
    applicationDeadlineConfidence?: number | null;
    applicationDeadlineStatus?: string | null;
    applicationDeadlineSource?: string | null;
    applicationDeadlineRawText?: string | null;
    metadataExtractionWarnings?: Prisma.InputJsonValue;
  }
) {
  return [
    current.workMode !== next.workMode,
    current.workModeConfidence !== (next.workModeConfidence ?? null),
    current.workModeStatus !== (next.workModeStatus ?? null),
    current.workModeSource !== (next.workModeSource ?? null),
    current.employmentType !== next.employmentType,
    current.employmentTypeGroup !== (next.employmentTypeGroup ?? null),
    current.employmentTypeConfidence !== (next.employmentTypeConfidence ?? null),
    current.employmentTypeStatus !== (next.employmentTypeStatus ?? null),
    current.employmentTypeSource !== (next.employmentTypeSource ?? null),
    current.normalizedEmploymentType !== (next.normalizedEmploymentType ?? null),
    current.normalizedEmploymentTypeConfidence !==
      (next.normalizedEmploymentTypeConfidence ?? null),
    current.postedAt.getTime() !== next.postedAt.getTime(),
    current.datePostedConfidence !== (next.datePostedConfidence ?? null),
    current.datePostedStatus !== (next.datePostedStatus ?? null),
    current.datePostedSource !== (next.datePostedSource ?? null),
    current.datePostedRawText !== (next.datePostedRawText ?? null),
    (current.deadline?.getTime() ?? null) !== (next.deadline?.getTime() ?? null),
    current.applicationDeadlineConfidence !==
      (next.applicationDeadlineConfidence ?? null),
    current.applicationDeadlineStatus !== (next.applicationDeadlineStatus ?? null),
    current.applicationDeadlineSource !== (next.applicationDeadlineSource ?? null),
    current.applicationDeadlineRawText !== (next.applicationDeadlineRawText ?? null),
    JSON.stringify(current.metadataExtractionWarnings ?? null) !==
      JSON.stringify(next.metadataExtractionWarnings ?? null),
  ].some(Boolean);
}

function readStringArray(value: Prisma.InputJsonValue | undefined) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function parseArgs(args: string[]): Options {
  const parsed: Options = {
    dryRun: args.includes("--dry-run"),
    limit: null,
    batchSize: 500,
    onlyMissing: args.includes("--only-missing"),
    force: args.includes("--force"),
  };

  for (const arg of args) {
    if (arg.startsWith("--limit=")) {
      const limit = Number(arg.slice("--limit=".length));
      parsed.limit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null;
    } else if (arg.startsWith("--batch-size=")) {
      const batchSize = Number(arg.slice("--batch-size=".length));
      parsed.batchSize = Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : 500;
    }
  }

  if (parsed.force) parsed.onlyMissing = false;
  return parsed;
}

function increment(map: Distribution, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function mapToObject(map: Distribution) {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]));
}

function topEntries(map: Distribution, limit: number) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}
