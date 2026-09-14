import {
  claimTopPicksRefreshTasks,
  finishTopPicksRefreshTask,
  getTopPicksRetryDelayMs,
  readTopPicksRefreshPayload,
} from "./refresh-queue";
import { refreshTopPicksForUser } from "./service";

export type RunTopPicksRefreshQueueResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  retried: number;
  skipped: number;
  results: Array<Record<string, unknown>>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
) {
  let index = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (index < items.length) {
        const item = items[index];
        index += 1;
        await worker(item);
      }
    })
  );
}

export async function runTopPicksRefreshQueue(options: {
  limit?: number;
  concurrency?: number;
} = {}): Promise<RunTopPicksRefreshQueueResult> {
  const tasks = await claimTopPicksRefreshTasks(options.limit ?? 5);
  const summary: RunTopPicksRefreshQueueResult = {
    claimed: tasks.length,
    succeeded: 0,
    failed: 0,
    retried: 0,
    skipped: 0,
    results: [],
  };

  await runWithConcurrency(tasks, options.concurrency ?? 1, async (task) => {
    const payload = readTopPicksRefreshPayload(task);
    try {
      const result = await refreshTopPicksForUser(task.userId, {
        reason: payload.reason ?? "durable_queue",
        candidateLimit: payload.candidateLimit,
        storeLimit: payload.storeLimit,
        claim: task,
      });
      const finished = await finishTopPicksRefreshTask(task, "SUCCESS", {
        lastResult: result,
      });
      if (!finished || finished.status === "PENDING") {
        summary.skipped += 1;
        summary.results.push({ taskId: task.id, status: finished ? "FOLLOW_UP_QUEUED" : "SUPERSEDED" });
        return;
      }
      summary.succeeded += 1;
      summary.results.push({
        taskId: task.id,
        userId: task.userId,
        status: "SUCCESS",
        storedCount: result.storedCount,
        candidateCount: result.candidateCount,
        durationMs: result.durationMs,
      });
    } catch (error) {
      const message = errorMessage(error);
      const shouldRetry = task.attemptCount < task.maxAttempts;
      const retryAt = shouldRetry ? new Date(Date.now() + getTopPicksRetryDelayMs(task.attemptCount)) : null;
      const finished = await finishTopPicksRefreshTask(task, "FAILED", {
        lastError: message,
        retryAt,
      });
      if (!finished) {
        summary.skipped += 1;
        summary.results.push({ taskId: task.id, userId: task.userId, status: "SUPERSEDED" });
        return;
      }
      if (finished.status === "PENDING") {
        summary.retried += 1;
        summary.results.push({
          taskId: task.id,
          userId: task.userId,
          status: finished.requestedVersion > task.claimedVersion ? "FOLLOW_UP_QUEUED" : "RETRY",
          retryAt: finished.notBeforeAt.toISOString(),
          error: message,
        });
        return;
      }

      summary.failed += 1;
      summary.results.push({
        taskId: task.id,
        userId: task.userId,
        status: "FAILED",
        error: message,
      });
    }
  });

  return summary;
}
