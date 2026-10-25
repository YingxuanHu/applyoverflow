import type { PrismaClient } from "../../src/generated/prisma/client";

export type StorageDeletionRetryDatabase = Pick<
  PrismaClient, "storageDeletionTask" | "resourceBudget" | "resourceLease"
>;

export const STORAGE_DELETION_RETRY_LIMIT = 50;
export const STORAGE_DELETION_RETRY_RUNTIME_MS = 120_000;
export const STORAGE_DELETION_RETRY_DELAY_MS = 15 * 60_000;
const EXPIRED_RESOURCE_LIMIT = 100;

export async function retryStorageDeletions({
  database,
  deleteFile,
  now = Date.now,
}: {
  database: StorageDeletionRetryDatabase;
  deleteFile: (storageKey: string) => Promise<void>;
  now?: () => number;
}) {
  const startedAt = now();
  const deadline = startedAt + STORAGE_DELETION_RETRY_RUNTIME_MS;
  const tasks = await database.storageDeletionTask.findMany({
    where: { nextAttemptAt: { lte: new Date(startedAt) } },
    orderBy: [{ nextAttemptAt: "asc" }, { storageKey: "asc" }],
    select: { storageKey: true },
    take: STORAGE_DELETION_RETRY_LIMIT,
  });
  const result = {
    selected: tasks.length,
    attempted: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    deferred: 0,
    prunedBudgets: 0,
    prunedLeases: 0,
    deadlineReached: false,
  };
  for (const task of tasks) {
    const claimedAt = now();
    if (claimedAt >= deadline) break;
    // Postpone atomically before I/O: another worker skips this item, and a
    // killed pass leaves a durable intent eligible again after the delay.
    const claim = await database.storageDeletionTask.updateMany({
      where: { storageKey: task.storageKey, nextAttemptAt: { lte: new Date(claimedAt) } },
      data: { nextAttemptAt: new Date(claimedAt + STORAGE_DELETION_RETRY_DELAY_MS) },
    });
    if (claim.count === 0) {
      result.skipped += 1;
      continue;
    }
    if (now() >= deadline) break;
    result.attempted += 1;
    try {
      // Reuse the reference guard, provider/local deletion and durable retry
      // accounting; never acknowledge an intent directly in the scheduler.
      await deleteFile(task.storageKey);
      result.completed += 1;
    } catch {
      result.failed += 1;
    }
  }
  result.deferred = result.selected - result.attempted - result.skipped;

  // Keep the existing quota housekeeping, but bound both scans and deletes.
  // Recheck expiration at delete time so a renewed budget/lease survives.
  if (now() < deadline) {
    const expired = { lt: new Date(startedAt - 86_400_000) };
    const budgets = await database.resourceBudget.findMany({
      where: { resetAt: expired }, orderBy: { resetAt: "asc" },
      select: { key: true }, take: EXPIRED_RESOURCE_LIMIT,
    });
    if (budgets.length && now() < deadline) {
      result.prunedBudgets = (await database.resourceBudget.deleteMany({
        where: { key: { in: budgets.map(({ key }) => key) }, resetAt: expired },
      })).count;
    }
  }
  if (now() < deadline) {
    const expired = { lt: new Date(startedAt) };
    const leases = await database.resourceLease.findMany({
      where: { expiresAt: expired }, orderBy: { expiresAt: "asc" },
      select: { id: true }, take: EXPIRED_RESOURCE_LIMIT,
    });
    if (leases.length && now() < deadline) {
      result.prunedLeases = (await database.resourceLease.deleteMany({
        where: { id: { in: leases.map(({ id }) => id) }, expiresAt: expired },
      })).count;
    }
  }
  result.deadlineReached = now() >= deadline;
  return result;
}
