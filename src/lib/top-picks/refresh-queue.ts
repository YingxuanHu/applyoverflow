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

export type TopPicksRefreshClaim = Pick<TopPickRefreshTask, "id" | "startedAt" | "attemptCount" | "claimedVersion">;

export function topPicksClaimWhere(claim: TopPicksRefreshClaim) {
  return { id: claim.id, status: "RUNNING", startedAt: claim.startedAt, attemptCount: claim.attemptCount, claimedVersion: claim.claimedVersion };
}

export async function enqueueDurableTopPicksRefresh(input: {
  userId: string;
  reason?: string;
  candidateLimit?: number;
  storeLimit?: number;
  priorityScore?: number;
  notBeforeAt?: Date;
}) {
  return prisma.$transaction(async (tx) => {
    // Serialize first insertion and publication with the same per-profile lock.
    await tx.$queryRaw`SELECT id FROM "UserProfile" WHERE id = ${input.userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "TopPickRefreshTask" WHERE "userId" = ${input.userId} FOR UPDATE`;
    const existing = await tx.topPickRefreshTask.findUnique({ where: { userId: input.userId } });
    const now = new Date();
    const notBeforeAt = input.notBeforeAt ?? now;
    const payload = {
      reason: input.reason ?? "manual",
      candidateLimit: normalizePositiveLimit(input.candidateLimit),
      storeLimit: normalizePositiveLimit(input.storeLimit),
      priorityScore: Math.max(existing?.priorityScore ?? 0, input.priorityScore ?? 0),
      maxAttempts: getMaxAttempts(),
    };
    if (!existing) {
      const task = await tx.topPickRefreshTask.create({ data: { userId: input.userId, ...payload, notBeforeAt } });
      return { status: "queued" as const, task };
    }
    const running = existing.status === "RUNNING";
    const task = await tx.topPickRefreshTask.update({
      where: { id: existing.id },
      data: {
        ...payload,
        requestedVersion: { increment: 1 },
        ...(running ? {} : {
          status: "PENDING",
          attemptCount: 0,
          startedAt: null,
          finishedAt: null,
          leaseExpiresAt: null,
          lastError: null,
          notBeforeAt: existing.status === "PENDING" && existing.notBeforeAt < notBeforeAt ? existing.notBeforeAt : notBeforeAt,
        }),
      },
    });
    return { status: running ? "running" as const : "queued" as const, task };
  });
}

async function recoverStaleRunningTopPicksTasks(now: Date) {
  const staleCutoff = new Date(now.getTime() - getLeaseMinutes() * 60_000);
  return prisma.$executeRaw(Prisma.sql`
    UPDATE "TopPickRefreshTask"
    SET "status" = CASE WHEN "requestedVersion" > "claimedVersion" OR "attemptCount" < "maxAttempts" THEN 'PENDING' ELSE 'FAILED' END,
        "attemptCount" = CASE WHEN "requestedVersion" > "claimedVersion" THEN 0 ELSE "attemptCount" END,
        "startedAt" = NULL, "leaseExpiresAt" = NULL, "finishedAt" = ${now},
        "notBeforeAt" = ${now}, "updatedAt" = ${now},
        "lastError" = 'Refresh lease expired before completion.'
    WHERE "status" = 'RUNNING' AND (
      "leaseExpiresAt" <= ${now} OR ("leaseExpiresAt" IS NULL AND "startedAt" < ${staleCutoff})
    )
  `);
}

export async function claimTopPicksRefreshTasks(limit: number, now: Date = new Date()) {
  await recoverStaleRunningTopPicksTasks(now);
  const claimLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.round(limit), 25)) : 1;
  const leaseExpiresAt = new Date(now.getTime() + getLeaseMinutes() * 60_000);
  return prisma.$queryRaw<TopPickRefreshTask[]>(Prisma.sql`
    WITH next_tasks AS (
      SELECT t."id" FROM "TopPickRefreshTask" t
      WHERE t."status" = 'PENDING' AND t."notBeforeAt" <= ${now} AND t."attemptCount" < t."maxAttempts"
      ORDER BY t."priorityScore" DESC, t."createdAt" ASC
      LIMIT ${claimLimit} FOR UPDATE SKIP LOCKED
    )
    UPDATE "TopPickRefreshTask" t
    SET "status" = 'RUNNING', "startedAt" = ${now}, "finishedAt" = NULL,
        "leaseExpiresAt" = ${leaseExpiresAt}, "attemptCount" = t."attemptCount" + 1,
        "claimedVersion" = t."requestedVersion", "updatedAt" = ${now}
    FROM next_tasks WHERE t."id" = next_tasks."id"
    RETURNING t.*
  `);
}

export async function finishTopPicksRefreshTask(
  claim: TopPicksRefreshClaim,
  status: Extract<TopPickRefreshTaskStatus, "SUCCESS" | "FAILED" | "SKIPPED">,
  options: { finishedAt?: Date; lastError?: string | null; lastResult?: unknown; retryAt?: Date | null } = {}
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TopPickRefreshTask" WHERE id = ${claim.id} FOR UPDATE`;
    const finishedAt = options.finishedAt ?? new Date();
    const current = await tx.topPickRefreshTask.findFirst({
      where: { ...topPicksClaimWhere(claim), leaseExpiresAt: { gt: finishedAt } },
    });
    if (!current) return null; // A superseded or expired worker must not finish a newer claim.
    const followUp = current.requestedVersion > claim.claimedVersion;
    const retry = status === "FAILED" && options.retryAt && current.attemptCount < current.maxAttempts;
    return tx.topPickRefreshTask.update({
      where: { id: claim.id },
      data: {
        status: followUp || retry ? "PENDING" : status,
        attemptCount: followUp ? 0 : current.attemptCount,
        startedAt: followUp || retry ? null : current.startedAt,
        finishedAt: followUp || retry ? null : finishedAt,
        notBeforeAt: followUp ? finishedAt : retry ? options.retryAt! : current.notBeforeAt,
        leaseExpiresAt: null,
        lastError: options.lastError ?? null,
        lastResult: options.lastResult !== undefined ? toJsonValue(options.lastResult) : Prisma.DbNull,
      },
    });
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
