import { Prisma, type TopPickRefreshTask } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export type TopPickRefreshTaskStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "SKIPPED";

export type TopPicksRefreshTaskPayload = {
  reason?: string;
  candidateLimit?: number;
  storeLimit?: number;
};

const DEFAULT_TOP_PICKS_REFRESH_MAX_ATTEMPTS = 5;
const DEFAULT_TOP_PICKS_REFRESH_LEASE_MINUTES = 20;

function readPositiveIntegerEnv(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getLeaseMinutes() {
  return readPositiveIntegerEnv(
    "TOP_PICKS_REFRESH_LEASE_MINUTES",
    DEFAULT_TOP_PICKS_REFRESH_LEASE_MINUTES
  );
}

function getMaxAttempts() {
  return readPositiveIntegerEnv(
    "TOP_PICKS_REFRESH_MAX_ATTEMPTS",
    DEFAULT_TOP_PICKS_REFRESH_MAX_ATTEMPTS
  );
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function normalizePositiveLimit(value: number | undefined) {
  return Number.isFinite(value) && value && value > 0 ? Math.round(value) : null;
}

export async function enqueueDurableTopPicksRefresh(input: {
  userId: string;
  reason?: string;
  candidateLimit?: number;
  storeLimit?: number;
  priorityScore?: number;
  notBeforeAt?: Date;
}) {
  const now = new Date();
  const existing = await prisma.topPickRefreshTask.findUnique({
    where: { userId: input.userId },
    select: {
      id: true,
      status: true,
      priorityScore: true,
      notBeforeAt: true,
      attemptCount: true,
      maxAttempts: true,
    },
  });
  const status = (existing?.status ?? "PENDING") as TopPickRefreshTaskStatus;
  const candidateLimit = normalizePositiveLimit(input.candidateLimit);
  const storeLimit = normalizePositiveLimit(input.storeLimit);
  const notBeforeAt = input.notBeforeAt ?? now;
  const maxAttempts = getMaxAttempts();

  if (!existing) {
    const task = await prisma.topPickRefreshTask.create({
      data: {
        userId: input.userId,
        status: "PENDING",
        priorityScore: input.priorityScore ?? 0,
        reason: input.reason ?? null,
        candidateLimit,
        storeLimit,
        notBeforeAt,
        maxAttempts,
      },
    });
    return { status: "queued" as const, task };
  }

  if (status === "RUNNING") {
    const task = await prisma.topPickRefreshTask.update({
      where: { userId: input.userId },
      data: {
        priorityScore: Math.max(existing.priorityScore, input.priorityScore ?? 0),
        reason: input.reason ?? "manual",
        candidateLimit,
        storeLimit,
        maxAttempts: Math.max(existing.maxAttempts, maxAttempts),
      },
    });
    return { status: "running" as const, task };
  }

  const shouldResetAttempts =
    status === "SUCCESS" ||
    status === "FAILED" ||
    status === "SKIPPED" ||
    existing.attemptCount >= existing.maxAttempts;

  const task = await prisma.topPickRefreshTask.update({
    where: { userId: input.userId },
    data: {
      status: "PENDING",
      priorityScore: Math.max(existing.priorityScore, input.priorityScore ?? 0),
      reason: input.reason ?? "manual",
      candidateLimit,
      storeLimit,
      notBeforeAt:
        notBeforeAt < existing.notBeforeAt || status !== "PENDING"
          ? notBeforeAt
          : existing.notBeforeAt,
      leaseExpiresAt: null,
      startedAt: null,
      finishedAt: null,
      lastError: null,
      attemptCount: shouldResetAttempts ? 0 : existing.attemptCount,
      maxAttempts: Math.max(existing.maxAttempts, maxAttempts),
    },
  });
  return { status: "queued" as const, task };
}

async function recoverStaleRunningTopPicksTasks(now: Date) {
  const staleCutoff = new Date(now.getTime() - getLeaseMinutes() * 60 * 1000);
  const result = await prisma.topPickRefreshTask.updateMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: staleCutoff },
    },
    data: {
      status: "PENDING",
      startedAt: null,
      finishedAt: null,
      leaseExpiresAt: null,
      notBeforeAt: now,
      lastError: `Recovered stale RUNNING top-picks refresh task after exceeding ${getLeaseMinutes()} minute lease window.`,
    },
  });
  return result.count;
}

export async function claimTopPicksRefreshTasks(
  limit: number,
  now: Date = new Date()
) {
  await recoverStaleRunningTopPicksTasks(now);
  const claimLimit = Math.max(1, Math.min(Math.round(limit), 25));
  const leaseExpiresAt = new Date(now.getTime() + getLeaseMinutes() * 60 * 1000);

  const claimed = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH next_tasks AS (
      SELECT t."id"
      FROM "TopPickRefreshTask" t
      WHERE
        t."status" = 'PENDING'
        AND t."notBeforeAt" <= ${now}
      ORDER BY t."priorityScore" DESC, t."createdAt" ASC
      LIMIT ${claimLimit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "TopPickRefreshTask" t
    SET
      "status" = 'RUNNING',
      "startedAt" = ${now},
      "leaseExpiresAt" = ${leaseExpiresAt},
      "attemptCount" = t."attemptCount" + 1,
      "updatedAt" = ${now}
    FROM next_tasks
    WHERE t."id" = next_tasks."id"
    RETURNING t."id"
  `);

  if (claimed.length === 0) return [];

  return prisma.topPickRefreshTask.findMany({
    where: { id: { in: claimed.map((task) => task.id) } },
    orderBy: [{ priorityScore: "desc" }, { createdAt: "asc" }],
  });
}

export async function finishTopPicksRefreshTask(
  taskId: string,
  status: Extract<TopPickRefreshTaskStatus, "SUCCESS" | "FAILED" | "SKIPPED">,
  options: {
    finishedAt?: Date;
    lastError?: string | null;
    lastResult?: unknown;
    retryAt?: Date | null;
  } = {}
) {
  const finishedAt = options.finishedAt ?? new Date();

  if (status === "FAILED" && options.retryAt) {
    return prisma.topPickRefreshTask.update({
      where: { id: taskId },
      data: {
        status: "PENDING",
        startedAt: null,
        finishedAt: null,
        leaseExpiresAt: null,
        notBeforeAt: options.retryAt,
        lastError: options.lastError ?? null,
      },
    });
  }

  return prisma.topPickRefreshTask.update({
    where: { id: taskId },
    data: {
      status,
      finishedAt,
      leaseExpiresAt: null,
      lastError: options.lastError ?? null,
      lastResult:
        options.lastResult !== undefined
          ? toJsonValue(options.lastResult)
          : Prisma.DbNull,
    },
  });
}

export async function getTopPicksRefreshTaskStatus(userId: string) {
  const task = await prisma.topPickRefreshTask.findUnique({
    where: { userId },
    select: {
      id: true,
      status: true,
      reason: true,
      notBeforeAt: true,
      startedAt: true,
      finishedAt: true,
      leaseExpiresAt: true,
      attemptCount: true,
      maxAttempts: true,
      lastError: true,
      lastResult: true,
      updatedAt: true,
    },
  });
  if (!task) return null;

  const status = task.status as TopPickRefreshTaskStatus;
  return {
    ...task,
    status,
    queued: status === "PENDING",
    running: status === "RUNNING",
    active: status === "PENDING" || status === "RUNNING",
  };
}

export function readTopPicksRefreshPayload(
  task: Pick<TopPickRefreshTask, "reason" | "candidateLimit" | "storeLimit">
): TopPicksRefreshTaskPayload {
  return {
    reason: task.reason ?? undefined,
    candidateLimit: task.candidateLimit ?? undefined,
    storeLimit: task.storeLimit ?? undefined,
  };
}

export function getTopPicksRetryDelayMs(attemptCount: number) {
  const baseMs = readPositiveIntegerEnv("TOP_PICKS_REFRESH_RETRY_BASE_MS", 30_000);
  const maxMs = readPositiveIntegerEnv("TOP_PICKS_REFRESH_RETRY_MAX_MS", 10 * 60_000);
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attemptCount - 1));
}
