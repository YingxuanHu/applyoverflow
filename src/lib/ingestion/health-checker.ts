import { prisma } from "@/lib/db";
import { normalizeApplyUrlKey } from "@/lib/ingestion/dedupe";
import {
  APPLY_LINK_VALIDATION_STATUS,
  classifyApplyLinkQuality,
  type ApplyLinkContentMatch,
  type ApplyLinkRedirectHop,
  type ApplyLinkValidationStatus,
} from "@/lib/ingestion/apply-link-quality";
import { detectDeadSignal } from "@/lib/ingestion/normalize";
import { reconcileCanonicalLifecycleByIds } from "@/lib/ingestion/pipeline";
import { upsertJobFeedIndexes } from "@/lib/ingestion/search-index";
import { resolveScaledInteger } from "@/lib/ingestion/capacity";
import {
  claimSourceTasks,
  finishSourceTask,
} from "@/lib/ingestion/task-queue";
import type {
  JobUrlHealthResult,
  JobUrlHealthUrlType,
  JobStatus,
  Prisma,
} from "@/generated/prisma/client";

const URL_HEALTH_TIMEOUT_MS = 10_000;
const URL_HEALTH_MAX_REDIRECTS = 8;
const URL_HEALTH_QUEUE_CONCURRENCY = resolveScaledInteger({
  base: 32,
  absoluteMax: 96,
  explicitEnvName: "INGEST_URL_HEALTH_QUEUE_CONCURRENCY",
});
const URL_HEALTH_QUEUE_DEFAULT_LIMIT = resolveScaledInteger({
  base: 3_000,
  absoluteMax: 9_000,
  explicitEnvName: "INGEST_URL_HEALTH_QUEUE_LIMIT",
});
const URL_HEALTH_ENQUEUE_DEFAULT_LIMIT = resolveScaledInteger({
  base: 6_000,
  absoluteMax: 18_000,
  explicitEnvName: "INGEST_URL_HEALTH_ENQUEUE_LIMIT",
});
const MAX_RESPONSE_SNIPPET_LENGTH = 1_200;

export type UrlHealthOutcome = {
  result: JobUrlHealthResult;
  statusCode: number | null;
  finalUrl: string | null;
  redirectDepth: number;
  redirectChain: ApplyLinkRedirectHop[];
  validationStatus: ApplyLinkValidationStatus;
  validationReason: string | null;
  contentMatch: ApplyLinkContentMatch | null;
  checkedAt: Date;
  responseTimeMs: number | null;
  closureReason: string | null;
  responseSnippet: string | null;
};

type HealthCandidate = {
  id: string;
  status: JobStatus;
  applyUrl: string;
  deadline: Date | null;
  availabilityScore: number;
  lastApplyCheckAt: Date | null;
  lastConfirmedAliveAt: Date | null;
  deadSignalAt: Date | null;
  sourcePostingUrl: string | null;
  savedCount: number;
  applicationCount: number;
};

export async function enqueuePriorityUrlHealthTasks(options: {
  limit?: number;
  now?: Date;
}) {
  const now = options.now ?? new Date();
  if (typeof options.limit === "number" && options.limit <= 0) {
    return { enqueuedCount: 0, candidateIds: [] as string[] };
  }
  const limit = options.limit ?? URL_HEALTH_ENQUEUE_DEFAULT_LIMIT;
  const candidates = await selectHealthCandidates(limit, now);

  if (candidates.length === 0) {
    return { enqueuedCount: 0, candidateIds: [] as string[] };
  }

  const candidateIds = candidates.map((c) => c.id);

  // Single query to find which candidates already have an active URL_HEALTH task —
  // avoids N+1 findFirst calls (one per candidate).
  const existingTasks = await prisma.sourceTask.findMany({
    where: {
      kind: "URL_HEALTH",
      canonicalJobId: { in: candidateIds },
      status: { in: ["PENDING", "RUNNING"] },
    },
    select: { canonicalJobId: true },
  });

  const alreadyEnqueued = new Set(
    existingTasks.map((t) => t.canonicalJobId).filter((id): id is string => id !== null)
  );

  const newCandidates = candidates.filter((c) => !alreadyEnqueued.has(c.id));

  if (newCandidates.length > 0) {
    await prisma.sourceTask.createMany({
      data: newCandidates.map((c) => ({
        kind: "URL_HEALTH" as const,
        canonicalJobId: c.id,
        priorityScore: computeHealthPriority(c, now),
        notBeforeAt: now,
      })),
      skipDuplicates: true,
    });
  }

  return {
    enqueuedCount: newCandidates.length,
    candidateIds: newCandidates.map((c) => c.id),
  };
}

export async function runUrlHealthTaskQueue(options: {
  limit?: number;
  now?: Date;
} = {}) {
  const now = options.now ?? new Date();
  if (typeof options.limit === "number" && options.limit <= 0) {
    return {
      processedCount: 0,
      checkedJobCount: 0,
    };
  }
  const maxTasks = options.limit ?? URL_HEALTH_QUEUE_DEFAULT_LIMIT;
  let processedCount = 0;
  const checkedJobIds = new Set<string>();

  // Process in concurrent batches to maximise throughput.
  // URL health checks are I/O-bound HTTP fetches — high concurrency is safe.
  while (processedCount < maxTasks) {
    const remaining = maxTasks - processedCount;
    // Use wall-clock time for claiming so tasks enqueued after cycleStart are
    // still eligible (avoids the cycleStart < notBeforeAt edge case in cycle #1).
    const claimNow = new Date();
    const tasks = await claimSourceTasks(
      "URL_HEALTH",
      Math.min(URL_HEALTH_QUEUE_CONCURRENCY, remaining),
      claimNow
    );

    if (tasks.length === 0) break;

    let cursor = 0;

    async function worker() {
      while (cursor < tasks.length) {
        const task = tasks[cursor++]!;

        try {
          if (!task.canonicalJobId) {
            await finishSourceTask(task.id, "SKIPPED", {
              finishedAt: now,
              lastError: "No canonical job attached to URL health task.",
            });
            continue;
          }

          await runJobHealthCheck(task.canonicalJobId, now);
          checkedJobIds.add(task.canonicalJobId);
          await finishSourceTask(task.id, "SUCCESS", { finishedAt: now });
        } catch (error) {
          const retryAt = new Date(now.getTime() + 30 * 60 * 1000);
          await finishSourceTask(task.id, "FAILED", {
            lastError: error instanceof Error ? error.message : String(error),
            retryAt,
          });
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(URL_HEALTH_QUEUE_CONCURRENCY, tasks.length) }, () => worker())
    );

    processedCount += tasks.length;
  }

  if (checkedJobIds.size > 0) {
    const checkedIds = [...checkedJobIds];
    await reconcileCanonicalLifecycleByIds(checkedIds, { now });
    await upsertJobFeedIndexes(checkedIds);
  }

  return {
    processedCount,
    checkedJobCount: checkedJobIds.size,
  };
}

export async function runJobHealthChecks(options: {
  limit?: number;
  now?: Date;
}) {
  const now = options.now ?? new Date();
  const candidates = await selectHealthCandidates(options.limit ?? 50, now);
  const results = [];

  for (const candidate of candidates) {
    results.push(await runJobHealthCheck(candidate.id, now));
  }

  if (results.length > 0) {
    const checkedIds = results.map((result) => result.canonicalJobId);
    await reconcileCanonicalLifecycleByIds(checkedIds, { now });
    await upsertJobFeedIndexes(checkedIds);
  }

  return results;
}

export async function runJobHealthCheck(canonicalJobId: string, now: Date = new Date()) {
  const job = await prisma.jobCanonical.findUnique({
    where: { id: canonicalJobId },
    select: {
      id: true,
      title: true,
      company: true,
      description: true,
      deadline: true,
      applyUrl: true,
      lastApplyCheckAt: true,
      lastConfirmedAliveAt: true,
      deadSignalAt: true,
      sourceMappings: {
        select: {
          sourceName: true,
          sourceUrl: true,
          isPrimary: true,
          removedAt: true,
        },
        orderBy: [
          { removedAt: "asc" },
          { isPrimary: "desc" },
          { lastSeenAt: "desc" },
        ],
        take: 8,
      },
    },
  });

  if (!job) {
    throw new Error(`Job ${canonicalJobId} not found for URL health check.`);
  }

  const primaryActiveMapping =
    job.sourceMappings.find((sourceMapping) => sourceMapping.removedAt === null && sourceMapping.isPrimary) ??
    job.sourceMappings.find((sourceMapping) => sourceMapping.removedAt === null) ??
    null;
  const detailUrl = primaryActiveMapping?.sourceUrl ?? null;
  const applyHealth = await checkUrlHealth({
    url: job.applyUrl,
    urlType: "APPLY",
    deadline: job.deadline,
    title: job.title,
    company: job.company,
    description: job.description,
    now,
  });
  const detailHealth =
    detailUrl && detailUrl !== job.applyUrl
      ? await checkUrlHealth({
          url: detailUrl,
          urlType: "DETAIL",
          deadline: job.deadline,
          title: job.title,
          company: job.company,
          description: job.description,
          now,
        })
      : null;
  const shouldPromoteDetailUrl =
    Boolean(detailUrl) &&
    detailUrl !== job.applyUrl &&
    applyHealth.validationStatus === APPLY_LINK_VALIDATION_STATUS.GENERIC_APPLY_PAGE &&
    detailHealth?.result === "ALIVE" &&
    detailHealth.validationStatus === APPLY_LINK_VALIDATION_STATUS.ACTIVE;
  const effectiveApplyHealth =
    shouldPromoteDetailUrl && detailHealth ? detailHealth : applyHealth;

  await recordHealthCheck(job.id, job.applyUrl, "APPLY", applyHealth);
  if (detailHealth && detailUrl) {
    await recordHealthCheck(job.id, detailUrl, "DETAIL", detailHealth);
  }

  const strongestDead = [effectiveApplyHealth, shouldPromoteDetailUrl ? null : detailHealth]
    .filter((entry): entry is UrlHealthOutcome => Boolean(entry))
    .find((entry) => entry.result === "DEAD");
  const aliveSignal = strongestDead
    ? null
    : [effectiveApplyHealth, detailHealth]
        .filter((entry): entry is UrlHealthOutcome => Boolean(entry))
        .find((entry) => entry.result === "ALIVE");

  await prisma.jobCanonical.update({
    where: { id: job.id },
    data: {
      applyUrl: shouldPromoteDetailUrl && detailUrl ? detailUrl : undefined,
      applyUrlKey:
        shouldPromoteDetailUrl && detailUrl ? normalizeApplyUrlKey(detailUrl) : undefined,
      lastApplyCheckAt: effectiveApplyHealth.checkedAt,
      lastConfirmedAliveAt: aliveSignal ? now : job.lastConfirmedAliveAt,
      applyUrlValidatedAt: effectiveApplyHealth.checkedAt,
      applyUrlValidationStatus: effectiveApplyHealth.validationStatus,
      applyUrlValidationReason: shouldPromoteDetailUrl
        ? "Generic apply URL replaced with the job-specific source detail URL."
        : effectiveApplyHealth.validationReason ?? effectiveApplyHealth.closureReason,
      finalResolvedApplyUrl: effectiveApplyHealth.finalUrl,
      applyUrlRedirectDepth: effectiveApplyHealth.redirectDepth,
      deadSignalAt: strongestDead ? now : aliveSignal ? null : job.deadSignalAt,
      deadSignalReason: strongestDead
        ? strongestDead.closureReason
        : aliveSignal
          ? null
          : job.deadSignalAt
            ? null
            : undefined,
    },
  });
  await recordSourceApplyQualitySignal({
    sourceNames: job.sourceMappings.map((sourceMapping) => sourceMapping.sourceName),
    outcome: applyHealth,
    checkedAt: now,
  });

  return {
    canonicalJobId: job.id,
    applyHealth,
    detailHealth,
  };
}

async function selectHealthCandidates(limit: number, now: Date) {
  // Fetch AGING and STALE jobs first (they have the highest priority and are a small
  // population). Then backfill with LIVE jobs. This avoids the in-memory sort over
  // a huge LIVE pool drowning out the critical AGING/STALE candidates.
  const [agingStale, live] = await Promise.all([
    prisma.jobCanonical.findMany({
      where: {
        status: { in: ["AGING", "STALE"] },
      },
      // Cap to limit rows — prevents loading all 32k AGING rows into memory.
      // Ordered by lastApplyCheckAt asc so we get the most overdue candidates.
      take: Math.max(limit, 2_000),
      select: {
        id: true,
        status: true,
        applyUrl: true,
        deadline: true,
        availabilityScore: true,
        lastApplyCheckAt: true,
        lastConfirmedAliveAt: true,
        deadSignalAt: true,
        sourceMappings: {
          where: { removedAt: null, isPrimary: true },
          select: { sourceUrl: true },
          take: 1,
        },
        _count: { select: { savedJobs: true, applicationSubmissions: true } },
      },
      orderBy: { lastApplyCheckAt: "asc" },
    }),
    prisma.jobCanonical.findMany({
      where: {
        status: "LIVE",
        OR: [{ deadSignalAt: null }],
      },
      select: {
        id: true,
        status: true,
        applyUrl: true,
        deadline: true,
        availabilityScore: true,
        lastApplyCheckAt: true,
        lastConfirmedAliveAt: true,
        deadSignalAt: true,
        sourceMappings: {
          where: { removedAt: null, isPrimary: true },
          select: { sourceUrl: true },
          take: 1,
        },
        _count: { select: { savedJobs: true, applicationSubmissions: true } },
      },
      orderBy: { lastApplyCheckAt: "asc" },
      take: Math.max(limit, 500),
    }),
  ]);

  const toCandidate = (job: typeof agingStale[number]) => ({
    id: job.id,
    status: job.status as "LIVE" | "AGING" | "STALE",
    applyUrl: job.applyUrl,
    deadline: job.deadline,
    availabilityScore: job.availabilityScore,
    lastApplyCheckAt: job.lastApplyCheckAt,
    lastConfirmedAliveAt: job.lastConfirmedAliveAt,
    deadSignalAt: job.deadSignalAt,
    sourcePostingUrl: job.sourceMappings[0]?.sourceUrl ?? null,
    savedCount: job._count.savedJobs,
    applicationCount: job._count.applicationSubmissions,
  });

  return [...agingStale.map(toCandidate), ...live.map(toCandidate)]
    .sort((left, right) => computeHealthPriority(right, now) - computeHealthPriority(left, now))
    .slice(0, limit);
}

function computeHealthPriority(job: HealthCandidate, now: Date) {
  const hoursSinceCheck = job.lastApplyCheckAt
    ? (now.getTime() - job.lastApplyCheckAt.getTime()) / 3_600_000
    : 999;
  const daysSinceAlive = job.lastConfirmedAliveAt
    ? (now.getTime() - job.lastConfirmedAliveAt.getTime()) / 86_400_000
    : 999;
  const daysUntilDeadline = job.deadline
    ? (job.deadline.getTime() - now.getTime()) / 86_400_000
    : Number.POSITIVE_INFINITY;

  let score = 0;
  if (job.status === "AGING") score += 45;
  if (job.status === "STALE") score += 35;
  if (job.status === "LIVE") score += 8;
  score += Math.max(0, 70 - job.availabilityScore);
  score += Math.min(24, Math.floor(hoursSinceCheck / 8));
  score += Math.min(18, Math.floor(daysSinceAlive * 3));
  score += job.savedCount * 6 + job.applicationCount * 8;
  if (Number.isFinite(daysUntilDeadline) && daysUntilDeadline <= 7) score += 20;
  if (!/^https?:\/\//i.test(job.applyUrl)) score -= 25;
  if (job.deadSignalAt) score -= 40;
  return score;
}

async function recordHealthCheck(
  canonicalJobId: string,
  url: string,
  urlType: JobUrlHealthUrlType,
  outcome: UrlHealthOutcome
) {
  return prisma.jobUrlHealthCheck.create({
    data: {
      canonicalJobId,
      url,
      urlType,
      result: outcome.result,
      statusCode: outcome.statusCode,
      finalUrl: outcome.finalUrl,
      checkedAt: outcome.checkedAt,
      responseTimeMs: outcome.responseTimeMs,
      closureReason: outcome.closureReason,
      responseSnippet: outcome.responseSnippet,
      metadataJson: {
        validationStatus: outcome.validationStatus,
        validationReason: outcome.validationReason,
        redirectDepth: outcome.redirectDepth,
        redirectChain: outcome.redirectChain,
        contentMatch: outcome.contentMatch,
      } satisfies Prisma.InputJsonValue,
    },
  });
}

export async function checkUrlHealth(input: {
  url: string;
  urlType: JobUrlHealthUrlType;
  deadline: Date | null;
  title: string;
  company: string;
  description: string;
  now: Date;
}): Promise<UrlHealthOutcome> {
  const checkedAt = input.now;

  if (!input.url || !/^https?:\/\//i.test(input.url)) {
    return {
      result: "DEAD",
      statusCode: null,
      finalUrl: null,
      checkedAt,
      responseTimeMs: null,
      redirectDepth: 0,
      redirectChain: [],
      validationStatus: APPLY_LINK_VALIDATION_STATUS.BROKEN_APPLY_LINK,
      validationReason: "URL is missing or not absolute.",
      contentMatch: null,
      closureReason: "URL is missing or not absolute.",
      responseSnippet: null,
    };
  }

  const controller = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), URL_HEALTH_TIMEOUT_MS);

  try {
    const redirectResult = await fetchWithRedirectChain(input.url, controller.signal);
    const responseTimeMs = Date.now() - startedAt;
    const response = redirectResult.response;

    if (!response) {
      const finalUrl = redirectResult.finalUrl ?? input.url;
      const quality = classifyApplyLinkQuality({
        requestedUrl: input.url,
        finalUrl,
        statusCode: redirectResult.statusCode,
        bodyText: "",
        title: input.title,
        company: input.company,
        redirectDepth: redirectResult.redirectChain.length,
        maxRedirectsReached: true,
      });
      return {
        result: "DEAD",
        statusCode: redirectResult.statusCode,
        finalUrl,
        checkedAt,
        responseTimeMs,
        redirectDepth: redirectResult.redirectChain.length,
        redirectChain: redirectResult.redirectChain,
        validationStatus: quality.status,
        validationReason: quality.reason,
        contentMatch: quality.contentMatch,
        closureReason: quality.reason,
        responseSnippet: null,
      };
    }

    const bodyText = await maybeReadText(response);
    const snippet = sanitizeSnippet(bodyText);
    const quality = classifyApplyLinkQuality({
      requestedUrl: input.url,
      finalUrl: redirectResult.finalUrl,
      statusCode: response.status,
      bodyText,
      title: input.title,
      company: input.company,
      redirectDepth: redirectResult.redirectDepth,
      maxRedirectsReached: false,
    });

    const deadSignal = detectDeadSignal({
      title: input.title,
      description: `${input.description}\n${bodyText}`,
      deadline: input.deadline,
      fetchedAt: input.now,
    });

    if ([404, 410, 451].includes(response.status) || deadSignal.detected || quality.isBadForFeed) {
      return {
        result: "DEAD",
        statusCode: response.status,
        finalUrl: redirectResult.finalUrl,
        checkedAt,
        responseTimeMs,
        redirectDepth: redirectResult.redirectDepth,
        redirectChain: redirectResult.redirectChain,
        validationStatus: quality.status,
        validationReason: quality.reason,
        contentMatch: quality.contentMatch,
        closureReason:
          deadSignal.reason ?? quality.reason ?? `URL returned terminal dead status ${response.status}.`,
        responseSnippet: snippet,
      };
    }

    if ([401, 403, 429].includes(response.status)) {
      return {
        result: "BLOCKED",
        statusCode: response.status,
        finalUrl: redirectResult.finalUrl,
        checkedAt,
        responseTimeMs,
        redirectDepth: redirectResult.redirectDepth,
        redirectChain: redirectResult.redirectChain,
        validationStatus: quality.status,
        validationReason: quality.reason,
        contentMatch: quality.contentMatch,
        closureReason: `URL returned blocking status ${response.status}.`,
        responseSnippet: snippet,
      };
    }

    if (response.status >= 500) {
      return {
        result: "ERROR",
        statusCode: response.status,
        finalUrl: redirectResult.finalUrl,
        checkedAt,
        responseTimeMs,
        redirectDepth: redirectResult.redirectDepth,
        redirectChain: redirectResult.redirectChain,
        validationStatus: quality.status,
        validationReason: quality.reason,
        contentMatch: quality.contentMatch,
        closureReason: `URL returned server error ${response.status}.`,
        responseSnippet: snippet,
      };
    }

    if (!response.ok) {
      return {
        result: "SUSPECT",
        statusCode: response.status,
        finalUrl: redirectResult.finalUrl,
        checkedAt,
        responseTimeMs,
        redirectDepth: redirectResult.redirectDepth,
        redirectChain: redirectResult.redirectChain,
        validationStatus: quality.status,
        validationReason: quality.reason,
        contentMatch: quality.contentMatch,
        closureReason: `URL returned unexpected status ${response.status}.`,
        responseSnippet: snippet,
      };
    }

    if (!snippet || snippet.length < 80 || quality.status === APPLY_LINK_VALIDATION_STATUS.NEEDS_REVALIDATION) {
      return {
        result: "SUSPECT",
        statusCode: response.status,
        finalUrl: redirectResult.finalUrl,
        checkedAt,
        responseTimeMs,
        redirectDepth: redirectResult.redirectDepth,
        redirectChain: redirectResult.redirectChain,
        validationStatus: quality.status,
        validationReason: quality.reason,
        contentMatch: quality.contentMatch,
        closureReason:
          quality.reason || "Response body was too small to confirm a live posting.",
        responseSnippet: snippet,
      };
    }

    return {
      result: "ALIVE",
      statusCode: response.status,
      finalUrl: redirectResult.finalUrl,
      checkedAt,
      responseTimeMs,
      redirectDepth: redirectResult.redirectDepth,
      redirectChain: redirectResult.redirectChain,
      validationStatus: quality.status,
      validationReason: quality.reason,
      contentMatch: quality.contentMatch,
      closureReason: null,
      responseSnippet: snippet,
    };
  } catch (error) {
    return {
      result: "ERROR",
      statusCode: null,
      finalUrl: input.url,
      checkedAt,
      responseTimeMs: Date.now() - startedAt,
      redirectDepth: 0,
      redirectChain: [],
      validationStatus: APPLY_LINK_VALIDATION_STATUS.NEEDS_REVALIDATION,
      validationReason: error instanceof Error ? error.message : String(error),
      contentMatch: null,
      closureReason: error instanceof Error ? error.message : String(error),
      responseSnippet: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRedirectChain(url: string, signal: AbortSignal) {
  let currentUrl = url;
  let statusCode: number | null = null;
  const redirectChain: ApplyLinkRedirectHop[] = [];

  for (let redirectDepth = 0; redirectDepth <= URL_HEALTH_MAX_REDIRECTS; redirectDepth += 1) {
    const response = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; applyoverflow-health-check/1.0)",
      },
    });
    statusCode = response.status;
    const location = response.headers.get("location");

    redirectChain.push({
      url: currentUrl,
      statusCode,
      location,
    });

    if (response.status >= 300 && response.status < 400 && location) {
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return {
      response,
      finalUrl: currentUrl,
      statusCode,
      redirectDepth,
      redirectChain,
    };
  }

  return {
    response: null,
    finalUrl: currentUrl,
    statusCode,
    redirectDepth: redirectChain.length,
    redirectChain,
  };
}

async function recordSourceApplyQualitySignal(input: {
  sourceNames: string[];
  outcome: UrlHealthOutcome;
  checkedAt: Date;
}) {
  const sourceNames = Array.from(new Set(input.sourceNames.filter(Boolean))).slice(0, 8);
  if (sourceNames.length === 0) return;

  const sources = await prisma.companySource.findMany({
    where: { sourceName: { in: sourceNames } },
    select: {
      id: true,
      metadataJson: true,
      sourceQualityScore: true,
    },
  });

  for (const source of sources) {
    const metadata =
      source.metadataJson && typeof source.metadataJson === "object" && !Array.isArray(source.metadataJson)
        ? ({ ...(source.metadataJson as Record<string, Prisma.JsonValue>) } as Record<
            string,
            Prisma.JsonValue
          >)
        : {};
    const previous =
      metadata.applyLinkQuality &&
      typeof metadata.applyLinkQuality === "object" &&
      !Array.isArray(metadata.applyLinkQuality)
        ? (metadata.applyLinkQuality as Record<string, Prisma.JsonValue>)
        : {};
    const checkedCount = asNumber(previous.checkedCount) + 1;
    const badCount = asNumber(previous.badCount) + (input.outcome.result === "DEAD" ? 1 : 0);
    const genericRedirectCount =
      asNumber(previous.genericRedirectCount) +
      (input.outcome.validationStatus === APPLY_LINK_VALIDATION_STATUS.GENERIC_APPLY_PAGE ? 1 : 0);
    const brokenApplyLinkCount =
      asNumber(previous.brokenApplyLinkCount) +
      (input.outcome.validationStatus === APPLY_LINK_VALIDATION_STATUS.BROKEN_APPLY_LINK ? 1 : 0);
    const expiredApplyLinkCount =
      asNumber(previous.expiredApplyLinkCount) +
      (input.outcome.validationStatus === APPLY_LINK_VALIDATION_STATUS.EXPIRED ? 1 : 0);
    const suspectCount =
      asNumber(previous.suspectCount) + (input.outcome.result === "SUSPECT" ? 1 : 0);
    const validCount =
      asNumber(previous.validCount) + (input.outcome.result === "ALIVE" ? 1 : 0);
    const badRate = checkedCount > 0 ? badCount / checkedCount : 0;
    const adjustedQualityScore = Math.max(
      0,
      Math.min(
        100,
        input.outcome.result === "ALIVE"
          ? source.sourceQualityScore + 0.2
          : source.sourceQualityScore - Math.min(3, 0.5 + badRate * 2)
      )
    );

    metadata.applyLinkQuality = {
      ...previous,
      checkedCount,
      validCount,
      suspectCount,
      badCount,
      genericRedirectCount,
      brokenApplyLinkCount,
      expiredApplyLinkCount,
      badRate,
      lastValidationStatus: input.outcome.validationStatus,
      lastValidationReason: input.outcome.validationReason ?? input.outcome.closureReason,
      lastFinalUrl: input.outcome.finalUrl,
      lastCheckedAt: input.checkedAt.toISOString(),
    };

    await prisma.companySource.update({
      where: { id: source.id },
      data: {
        metadataJson: metadata as Prisma.InputJsonValue,
        sourceQualityScore: adjustedQualityScore,
        lastValidatedAt: input.checkedAt,
        validationMessage:
          input.outcome.result === "ALIVE"
            ? null
            : input.outcome.validationReason ?? input.outcome.closureReason,
      },
    });
  }
}

function asNumber(value: Prisma.JsonValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function maybeReadText(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text") && !contentType.includes("json") && !contentType.includes("html")) {
    return "";
  }

  try {
    return await response.text();
  } catch {
    return "";
  }
}

function sanitizeSnippet(text: string) {
  const normalized = text
    .replace(/\s+/g, " ")
    .replace(/[^\S\r\n]+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, MAX_RESPONSE_SNIPPET_LENGTH) : null;
}
