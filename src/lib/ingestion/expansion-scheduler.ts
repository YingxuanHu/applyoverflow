import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { reconcileCanonicalLifecycleByIds } from "@/lib/ingestion/pipeline";
import {
  claimPipelineTasks,
  enqueueUniquePipelineTask,
  finishPipelineTask,
  readPipelinePayload,
} from "@/lib/ingestion/pipeline-queue";
import { upsertJobFeedIndex } from "@/lib/ingestion/search-index";
import {
  canonicalizeNormalizedJobRecord,
} from "@/lib/ingestion/staged-pipeline";
import { upsertNormalizedJobRecordFromRawJob } from "@/lib/ingestion/normalized-records";
import {
  createCompanySiteConnector,
  inspectCompanySiteRoute,
} from "@/lib/ingestion/connectors";
import {
  listSourceCandidatesForExploration,
  promoteSourceCandidate,
  rejectSourceCandidate,
} from "@/lib/ingestion/discovery/source-registry";
import {
  buildDiscoveredSourceName,
  createConnectorForCandidate,
} from "@/lib/ingestion/discovery/sources";
import { detectDirectSourceFromUrl } from "@/lib/ingestion/discovery/ats-tenant-detector";
import { assessSourceCandidatePreview } from "@/lib/ingestion/source-candidate-validation";
import {
  getSourceCandidateValidationMissStatus,
  getSourceCandidateValidationSkipReason,
} from "@/lib/ingestion/source-candidate-validation-guard";
import { computeExplorationPriorityScore } from "@/lib/ingestion/source-candidate-priority";
import { buildSourceDiscoveryCandidateUpdate } from "@/lib/ingestion/source-candidate-discovery";
import { normalizeSourceJob } from "@/lib/ingestion/normalize";
import type {
  AtsPlatform,
  CompanySource,
  DiscoveryMode,
  PipelineQueueName,
  SourceCandidateType,
} from "@/generated/prisma/client";
import type { SupportedConnectorName } from "@/lib/ingestion/registry";
import type { SourceConnector } from "@/lib/ingestion/types";

const SOURCE_CANDIDATE_PREVIEW_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.SOURCE_CANDIDATE_PREVIEW_LIMIT ?? "5", 10) || 5
);
const SOURCE_CANDIDATE_PREVIEW_TIMEOUT_MS = Math.max(
  5_000,
  Number.parseInt(process.env.SOURCE_CANDIDATE_PREVIEW_TIMEOUT_MS ?? "15000", 10) ||
    15_000
);
const SOURCE_CANDIDATE_SCHEDULER_SCAN_MULTIPLIER = Math.max(
  1,
  Number.parseInt(process.env.SOURCE_CANDIDATE_SCHEDULER_SCAN_MULTIPLIER ?? "50", 10) ||
    50
);
const SOURCE_CANDIDATE_REVALIDATE_DAYS = Math.max(
  1,
  Number.parseInt(process.env.SOURCE_CANDIDATE_REVALIDATE_DAYS ?? "14", 10) ||
    14
);

type SourceCandidateForValidation = Prisma.SourceCandidateGetPayload<{
  include: {
    atsTenant: true;
    company: true;
  };
}>;

function mapAtsPlatformToConnectorName(platform: AtsPlatform): SupportedConnectorName | null {
  switch (platform) {
    case "ASHBY":
      return "ashby";
    case "GREENHOUSE":
      return "greenhouse";
    case "ICIMS":
      return "icims";
    case "JOBVITE":
      return "jobvite";
    case "LEVER":
      return "lever";
    case "RECRUITEE":
      return "recruitee";
    case "RIPPLING":
      return "rippling";
    case "SMARTRECRUITERS":
      return "smartrecruiters";
    case "SUCCESSFACTORS":
      return "successfactors";
    case "TALEO":
      return "taleo";
    case "TEAMTAILOR":
      return "teamtailor";
    case "WORKABLE":
      return "workable";
    case "WORKDAY":
      return "workday";
    default:
      return null;
  }
}

async function markSourceCandidateValidationMiss(input: {
  candidate: SourceCandidateForValidation;
  message: string;
}) {
  const status = getSourceCandidateValidationMissStatus(input.message);
  return prisma.sourceCandidate.update({
    where: { id: input.candidate.id },
    data: {
      status,
      failureCount: { increment: 1 },
      lastError: input.message,
      lastValidatedAt: new Date(),
    },
  });
}

export function computeExploitationPriorityScore(input: Pick<
  CompanySource,
  | "priorityScore"
  | "yieldScore"
  | "sourceQualityScore"
  | "pollSuccessCount"
  | "failureStreak"
  | "retainedLiveJobCount"
  | "jobsCreatedCount"
>) {
  return (
    input.priorityScore * 0.35 +
    input.yieldScore * 0.3 +
    input.sourceQualityScore * 0.2 +
    Math.min(input.retainedLiveJobCount, 200) * 0.15 +
    Math.min(input.jobsCreatedCount, 200) * 0.2 +
    Math.min(input.pollSuccessCount, 50) * 0.25 -
    input.failureStreak * 8
  );
}

export async function scheduleExplorationPipeline(limit = 500) {
  const candidates = await listSourceCandidatesForExploration(
    Math.min(20_000, Math.max(limit, limit * SOURCE_CANDIDATE_SCHEDULER_SCAN_MULTIPLIER))
  );
  candidates.sort((a, b) => {
    const aPriority = computeExplorationPriorityScore({
      noveltyScore: a.noveltyScore,
      coverageGapScore: a.coverageGapScore,
      potentialYieldScore: a.potentialYieldScore,
      sourceQualityScore: a.sourceQualityScore,
      failureCount: a.failureCount,
      confidence: a.confidence,
      candidateType: a.candidateType,
      status: a.status,
      hasAtsTenant: Boolean(a.atsTenantId),
    });
    const bPriority = computeExplorationPriorityScore({
      noveltyScore: b.noveltyScore,
      coverageGapScore: b.coverageGapScore,
      potentialYieldScore: b.potentialYieldScore,
      sourceQualityScore: b.sourceQualityScore,
      failureCount: b.failureCount,
      confidence: b.confidence,
      candidateType: b.candidateType,
      status: b.status,
      hasAtsTenant: Boolean(b.atsTenantId),
    });
    return bPriority - aPriority;
  });
  const candidateQueueKeys = new Map<string, string>();
  const candidateIdsAndQueueKeys = new Set<string>();

  for (const candidate of candidates) {
    const directSource = detectDirectSourceFromUrl(candidate.candidateUrl);
    const validationKey = directSource
      ? `direct:${directSource.connectorName}:${directSource.tenantKey.trim().toLowerCase()}`
      : candidate.id;

    candidateQueueKeys.set(candidate.id, validationKey);
    candidateIdsAndQueueKeys.add(candidate.id);
    candidateIdsAndQueueKeys.add(validationKey);
  }

  const taskRows =
    candidates.length > 0
      ? await prisma.pipelineTask.findMany({
          where: {
            queueName: { in: ["SOURCE_DISCOVERY", "SOURCE_VALIDATION"] },
            idempotencyKey: { in: Array.from(candidateIdsAndQueueKeys) },
          },
          select: {
            queueName: true,
            status: true,
            idempotencyKey: true,
            attemptCount: true,
            maxAttempts: true,
            finishedAt: true,
          },
        })
      : [];
  const taskByCandidateAndQueue = new Map(
    taskRows.map((task) => [`${task.queueName}:${task.idempotencyKey}`, task])
  );
  const revalidateSuccessfulBefore = new Date(
    Date.now() - SOURCE_CANDIDATE_REVALIDATE_DAYS * 24 * 60 * 60 * 1000
  );

  let queued = 0;
  let skippedAlreadyProcessed = 0;
  let skippedInFlight = 0;
  let skippedExhausted = 0;

  for (const candidate of candidates) {
    const directSourceValidationKey = candidateQueueKeys.get(candidate.id) ?? candidate.id;
    const shouldDirectValidate = directSourceValidationKey !== candidate.id;
    const discoveryTask = taskByCandidateAndQueue.get(
      `SOURCE_DISCOVERY:${candidate.id}`
    );
    const validationTask = taskByCandidateAndQueue.get(
      `SOURCE_VALIDATION:${directSourceValidationKey}`
    );
    const queueName: PipelineQueueName =
      shouldDirectValidate
        ? "SOURCE_VALIDATION"
        : candidate.status === "NEW" && discoveryTask?.status !== "SUCCESS"
        ? "SOURCE_DISCOVERY"
        : "SOURCE_VALIDATION";
    const existingTask =
      queueName === "SOURCE_DISCOVERY" ? discoveryTask : validationTask;

    if (existingTask?.status === "PENDING" || existingTask?.status === "RUNNING") {
      skippedInFlight += 1;
      continue;
    }

    if (
      existingTask?.status === "FAILED" &&
      existingTask.attemptCount >= existingTask.maxAttempts
    ) {
      skippedExhausted += 1;
      continue;
    }

    const shouldRevalidateSuccessfulTask =
      existingTask?.status === "SUCCESS" &&
      existingTask.finishedAt != null &&
      existingTask.finishedAt < revalidateSuccessfulBefore;

    if (existingTask?.status === "SUCCESS" && !shouldRevalidateSuccessfulTask) {
      skippedAlreadyProcessed += 1;
      continue;
    }

    const priorityScore = computeExplorationPriorityScore({
      noveltyScore: candidate.noveltyScore,
      coverageGapScore: candidate.coverageGapScore,
      potentialYieldScore: candidate.potentialYieldScore,
      sourceQualityScore: candidate.sourceQualityScore,
      failureCount: candidate.failureCount,
      confidence: candidate.confidence,
      candidateType: candidate.candidateType,
      status: candidate.status,
      hasAtsTenant: Boolean(candidate.atsTenantId),
    });

    await enqueueUniquePipelineTask({
      queueName,
      mode: "EXPLORATION",
      priorityScore,
      idempotencyKey:
        queueName === "SOURCE_VALIDATION" ? directSourceValidationKey : candidate.id,
      reactivateOnSuccess: shouldRevalidateSuccessfulTask,
      payloadJson: {
        sourceCandidateId: candidate.id,
      },
    });
    queued += 1;

    if (queued >= limit) {
      break;
    }
  }

  return {
    considered: candidates.length,
    queued,
    skippedAlreadyProcessed,
    skippedInFlight,
    skippedExhausted,
  };
}

export async function scheduleExploitationPipeline(options: {
  rawParseLimit?: number;
  dedupeLimit?: number;
  lifecycleLimit?: number;
  searchIndexLimit?: number;
} = {}) {
  const rawParseLimit = options.rawParseLimit ?? 2_000;
  const dedupeLimit = options.dedupeLimit ?? 2_000;
  const lifecycleLimit = options.lifecycleLimit ?? 2_000;
  const searchIndexLimit = options.searchIndexLimit ?? 2_000;

  const [rawRows, normalizedRows, canonicalRows, indexRows] = await Promise.all([
    rawParseLimit > 0
      ? prisma.jobRaw.findMany({
          where: { normalizedRecord: null },
          orderBy: { fetchedAt: "desc" },
          take: rawParseLimit,
          select: { id: true },
        })
      : Promise.resolve([]),
    dedupeLimit > 0
      ? prisma.normalizedJobRecord.findMany({
          where: {
            status: { in: ["VALIDATED", "NORMALIZED"] },
            canonicalJobId: null,
          },
          orderBy: { updatedAt: "desc" },
          take: dedupeLimit,
          select: { id: true },
        })
      : Promise.resolve([]),
    lifecycleLimit > 0
      ? prisma.jobCanonical.findMany({
          where: {
            status: { in: ["LIVE", "AGING", "STALE"] },
          },
          orderBy: [{ freshnessScore: "asc" }, { updatedAt: "asc" }],
          take: lifecycleLimit,
          select: { id: true },
        })
      : Promise.resolve([]),
    searchIndexLimit > 0
      ? prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT jc.id
          FROM "JobCanonical" jc
          LEFT JOIN "JobFeedIndex" jfi
            ON jfi."canonicalJobId" = jc.id
          WHERE
            jc.status IN ('LIVE', 'AGING', 'STALE')
            AND (
              jfi."canonicalJobId" IS NULL
              OR jfi."indexedAt" < jc."updatedAt"
            )
          ORDER BY
            CASE WHEN jfi."canonicalJobId" IS NULL THEN 0 ELSE 1 END ASC,
            jc."updatedAt" DESC
          LIMIT ${searchIndexLimit}
        `)
      : Promise.resolve([]),
  ]);

  let rawQueued = 0;
  for (const row of rawRows) {
    await enqueueUniquePipelineTask({
      queueName: "RAW_PARSE",
      mode: "EXPLOITATION",
      idempotencyKey: row.id,
      priorityScore: 100,
      payloadJson: { rawJobId: row.id },
    });
    rawQueued += 1;
  }

  let dedupeQueued = 0;
  for (const row of normalizedRows) {
    await enqueueUniquePipelineTask({
      queueName: "DEDUPE",
      mode: "EXPLOITATION",
      idempotencyKey: row.id,
      priorityScore: 90,
      payloadJson: { normalizedJobRecordId: row.id },
    });
    dedupeQueued += 1;
  }

  let lifecycleQueued = 0;
  for (const row of canonicalRows) {
    await enqueueUniquePipelineTask({
      queueName: "LIFECYCLE",
      mode: "EXPLOITATION",
      idempotencyKey: row.id,
      priorityScore: 60,
      reactivateOnSuccess: true,
      payloadJson: { canonicalJobId: row.id },
    });
    lifecycleQueued += 1;
  }

  let indexQueued = 0;
  for (const row of indexRows) {
    await enqueueUniquePipelineTask({
      queueName: "SEARCH_INDEX",
      mode: "EXPLOITATION",
      idempotencyKey: row.id,
      priorityScore: 70,
      reactivateOnSuccess: true,
      payloadJson: { canonicalJobId: row.id },
    });
    indexQueued += 1;
  }

  return {
    rawQueued,
    dedupeQueued,
    lifecycleQueued,
    indexQueued,
  };
}

async function processSourceDiscoveryTask(taskId: string, sourceCandidateId: string) {
  const candidate = await prisma.sourceCandidate.update({
    where: { id: sourceCandidateId },
    data: buildSourceDiscoveryCandidateUpdate(),
  });
  const priorityScore = computeExplorationPriorityScore({
    noveltyScore: candidate.noveltyScore,
    coverageGapScore: candidate.coverageGapScore,
    potentialYieldScore: candidate.potentialYieldScore,
    sourceQualityScore: candidate.sourceQualityScore,
    failureCount: candidate.failureCount,
    confidence: candidate.confidence,
    candidateType: candidate.candidateType,
    status: candidate.status,
    hasAtsTenant: Boolean(candidate.atsTenantId),
  });

  await enqueueUniquePipelineTask({
    queueName: "SOURCE_VALIDATION",
    mode: "EXPLORATION",
    priorityScore,
    idempotencyKey: sourceCandidateId,
    payloadJson: {
      sourceCandidateId,
    },
  });
  await finishPipelineTask(taskId, "SUCCESS");
}

async function fetchConnectorPreviewStats(connector: SourceConnector) {
  const now = new Date();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(
          new Error(
            `Preview timed out after ${SOURCE_CANDIDATE_PREVIEW_TIMEOUT_MS}ms.`
          )
        );
      }, SOURCE_CANDIDATE_PREVIEW_TIMEOUT_MS);
      timeout.unref?.();
    });
    const result = await Promise.race([
      connector.fetchJobs({
        now,
        limit: SOURCE_CANDIDATE_PREVIEW_LIMIT,
        signal: controller.signal,
        maxRuntimeMs: SOURCE_CANDIDATE_PREVIEW_TIMEOUT_MS,
        deadlineAt: new Date(now.getTime() + SOURCE_CANDIDATE_PREVIEW_TIMEOUT_MS),
        log: () => {},
      }),
      timeoutPromise,
    ]);
    let acceptedCount = 0;
    const sampleTitles: string[] = [];

    for (const job of result.jobs) {
      if (sampleTitles.length < 3 && job.title.trim()) {
        sampleTitles.push(job.title.trim());
      }

      const normalized = normalizeSourceJob({
        job,
        fetchedAt: now,
        sourceName: connector.sourceName,
      });
      if (normalized.kind === "accepted") {
        acceptedCount += 1;
      }
    }

    return assessSourceCandidatePreview({
      fetchedCount: result.jobs.length,
      acceptedCount,
      sampleTitles,
    });
  } catch (error) {
    return assessSourceCandidatePreview({
      error: error instanceof Error ? error.message : String(error),
      fetchedCount: 0,
      acceptedCount: 0,
    });
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function validateAtsSourceCandidateBeforePromotion(input: {
  candidate: SourceCandidateForValidation;
  connectorName: SupportedConnectorName;
  token: string;
  sourceName: string;
  boardUrl: string;
}) {
  const connector = createConnectorForCandidate({
    input: input.candidate.candidateUrl,
    connectorName: input.connectorName,
    token: input.token,
    sourceKey: `${input.connectorName}:${input.token}`.toLowerCase(),
    sourceName: input.sourceName,
    boardUrl: input.boardUrl,
    source: "url",
  });
  return fetchConnectorPreviewStats(connector);
}

async function validateCompanySiteCandidateBeforePromotion(
  candidate: SourceCandidateForValidation
) {
  try {
    if (!candidate.company) {
      return assessSourceCandidatePreview({
        error: "Candidate has no company owner.",
        fetchedCount: 0,
        acceptedCount: 0,
      });
    }

    const inspection = await inspectCompanySiteRoute(candidate.candidateUrl);
    if (inspection.extractionRoute === "UNKNOWN") {
      return assessSourceCandidatePreview({
        error:
          "Company site did not expose a stable ATS, structured feed, sitemap, or HTML job listing route.",
        fetchedCount: 0,
        acceptedCount: 0,
      });
    }

    const connector = createCompanySiteConnector({
      sourceName: `CompanySitePreview:${candidate.company.companyKey}`,
      companyName: candidate.company.name,
      boardUrl: inspection.finalUrl,
      extractionRoute: inspection.extractionRoute,
      parserVersion: inspection.parserVersion,
    });
    return fetchConnectorPreviewStats(connector);
  } catch (error) {
    return assessSourceCandidatePreview({
      error: error instanceof Error ? error.message : String(error),
      fetchedCount: 0,
      acceptedCount: 0,
    });
  }
}

async function processSourceValidationTask(
  taskId: string,
  sourceCandidateId: string,
  options: { allowPromotedRepair?: boolean } = {}
) {
  const candidate = await prisma.sourceCandidate.findUnique({
    where: { id: sourceCandidateId },
    include: {
      atsTenant: true,
      company: true,
    },
  });

  if (!candidate) {
    await finishPipelineTask(taskId, "SKIPPED", {
      lastError: `Missing source candidate ${sourceCandidateId}`,
    });
    return;
  }

  const skipReason = getSourceCandidateValidationSkipReason({
    ...candidate,
    allowPromotedRepair: options.allowPromotedRepair,
  });
  if (skipReason) {
    await finishPipelineTask(taskId, "SKIPPED", {
      lastError: skipReason,
    });
    return;
  }

  let connectorName: SupportedConnectorName | "company-site" | null = "company-site";
  let token = candidate.rootDomain ?? candidate.id;
  let sourceName = `CompanySite:${candidate.rootDomain ?? candidate.id}`;
  let boardUrl = candidate.candidateUrl;
  const directSource = candidate.atsTenant
    ? null
    : detectDirectSourceFromUrl(candidate.candidateUrl);

  if (directSource) {
    connectorName = directSource.connectorName;
    token = directSource.tenantKey;
    sourceName = buildDiscoveredSourceName(connectorName, directSource.tenantKey);
    boardUrl = directSource.normalizedBoardUrl;
  } else if (candidate.atsTenant && candidate.atsTenantKey && candidate.atsPlatform) {
    connectorName = mapAtsPlatformToConnectorName(candidate.atsPlatform);
    if (!connectorName) {
      await rejectSourceCandidate(
        candidate.id,
        `Unsupported ATS platform for promotion: ${candidate.atsPlatform}`
      );
      await finishPipelineTask(taskId, "FAILED", {
        lastError: `Unsupported ATS platform for promotion: ${candidate.atsPlatform}`,
      });
      return;
    }

    token = candidate.atsTenant.tenantKey;
    sourceName = buildDiscoveredSourceName(
      connectorName as SupportedConnectorName,
      candidate.atsTenant.tenantKey
    );
    boardUrl = candidate.atsTenant.normalizedBoardUrl;
  }

  const validation =
    connectorName === "company-site"
      ? await validateCompanySiteCandidateBeforePromotion(candidate)
      : await validateAtsSourceCandidateBeforePromotion({
          candidate,
          connectorName,
          token,
          sourceName,
          boardUrl,
        });

  if (!validation.passed) {
    await markSourceCandidateValidationMiss({
      candidate,
      message: validation.message,
    });
    await finishPipelineTask(taskId, "SKIPPED", {
      lastError: `${validation.kind}: ${validation.message}`,
    });
    return;
  }

  await promoteSourceCandidate({
    sourceCandidateId: candidate.id,
    connectorName,
    token,
    sourceName,
    boardUrl,
    sourceType: candidate.candidateType as SourceCandidateType,
    priorityScore: candidate.potentialYieldScore,
  });
  await finishPipelineTask(taskId, "SUCCESS");
}

async function processRawParseTask(taskId: string, rawJobId: string) {
  await upsertNormalizedJobRecordFromRawJob(rawJobId);
  await finishPipelineTask(taskId, "SUCCESS");
}

async function processDedupeTask(taskId: string, normalizedJobRecordId: string) {
  await canonicalizeNormalizedJobRecord(normalizedJobRecordId);
  await finishPipelineTask(taskId, "SUCCESS");
}

async function processLifecycleTask(taskId: string, canonicalJobId: string) {
  await reconcileCanonicalLifecycleByIds([canonicalJobId]);
  await finishPipelineTask(taskId, "SUCCESS");
}

async function processSearchIndexTask(taskId: string, canonicalJobId: string) {
  await upsertJobFeedIndex(canonicalJobId);
  await finishPipelineTask(taskId, "SUCCESS");
}

export async function runPipelineWorker(options: {
  queueName: PipelineQueueName;
  limit?: number;
  mode?: DiscoveryMode | null;
  concurrency?: number;
}) {
  const concurrency = Math.max(1, options.concurrency ?? defaultQueueConcurrency(options.queueName));
  const claimed = await claimPipelineTasks(
    options.queueName,
    options.limit ?? 50,
    { mode: options.mode ?? null }
  );

  let successCount = 0;
  let failedCount = 0;

  for (let start = 0; start < claimed.length; start += concurrency) {
    const batch = claimed.slice(start, start + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (task) => {
        const payload = readPipelinePayload(task);

        try {
          switch (task.queueName) {
            case "SOURCE_DISCOVERY":
              if (typeof payload.sourceCandidateId !== "string") {
                throw new Error("Missing sourceCandidateId payload.");
              }
              await processSourceDiscoveryTask(task.id, payload.sourceCandidateId);
              break;
            case "SOURCE_VALIDATION":
              if (typeof payload.sourceCandidateId !== "string") {
                throw new Error("Missing sourceCandidateId payload.");
              }
              await processSourceValidationTask(task.id, payload.sourceCandidateId, {
                allowPromotedRepair: payload.allowPromotedRepair === true,
              });
              break;
            case "RAW_PARSE":
              if (typeof payload.rawJobId !== "string") {
                throw new Error("Missing rawJobId payload.");
              }
              await processRawParseTask(task.id, payload.rawJobId);
              break;
            case "DEDUPE":
              if (typeof payload.normalizedJobRecordId !== "string") {
                throw new Error("Missing normalizedJobRecordId payload.");
              }
              await processDedupeTask(task.id, payload.normalizedJobRecordId);
              break;
            case "LIFECYCLE":
              if (typeof payload.canonicalJobId !== "string") {
                throw new Error("Missing canonicalJobId payload.");
              }
              await processLifecycleTask(task.id, payload.canonicalJobId);
              break;
            case "SEARCH_INDEX":
              if (typeof payload.canonicalJobId !== "string") {
                throw new Error("Missing canonicalJobId payload.");
              }
              await processSearchIndexTask(task.id, payload.canonicalJobId);
              break;
            default:
              await finishPipelineTask(task.id, "SKIPPED", {
                lastError: `Queue ${task.queueName} is not handled by this worker yet.`,
              });
              break;
          }

          return { success: true } as const;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const retryAt =
            task.attemptCount < task.maxAttempts
              ? new Date(Date.now() + Math.min(60_000 * task.attemptCount, 15 * 60_000))
              : null;
          await finishPipelineTask(task.id, "FAILED", {
            lastError: message,
            retryAt,
          });
          return { success: false } as const;
        }
      })
    );

    for (const result of batchResults) {
      if (result.success) {
        successCount += 1;
      } else {
        failedCount += 1;
      }
    }
  }

  return {
    queueName: options.queueName,
    claimed: claimed.length,
    successCount,
    failedCount,
    concurrency,
  };
}

function defaultQueueConcurrency(queueName: PipelineQueueName) {
  switch (queueName) {
    case "SEARCH_INDEX":
      return 12;
    case "RAW_PARSE":
      return 8;
    case "SOURCE_DISCOVERY":
      return 8;
    case "DEDUPE":
      return 4;
    case "LIFECYCLE":
      return 6;
    case "SOURCE_VALIDATION":
      return 4;
    default:
      return 4;
  }
}
