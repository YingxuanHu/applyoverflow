export type BulkRecoveryCycleResult = {
  skipped?: string;
  nextDueInMs?: number;
};

const MIN_IDLE_SLEEP_MS = 1_000;

export function getBulkRecoverySleepMs({
  results,
  catchupSeconds,
  fallbackIntervalMinutes,
}: {
  results: BulkRecoveryCycleResult[] | undefined;
  catchupSeconds: number;
  fallbackIntervalMinutes: number;
}) {
  const catchupMs = catchupSeconds * 1_000;
  const fallbackMs = fallbackIntervalMinutes * 60_000;

  if (!results || results.some((result) => !result.skipped)) {
    return catchupMs;
  }

  const nextDueInMs = results.reduce<number | null>((soonest, result) => {
    if (
      typeof result.nextDueInMs !== "number" ||
      !Number.isFinite(result.nextDueInMs)
    ) {
      return soonest;
    }

    return soonest === null
      ? result.nextDueInMs
      : Math.min(soonest, result.nextDueInMs);
  }, null);

  return Math.max(
    MIN_IDLE_SLEEP_MS,
    Math.min(nextDueInMs ?? fallbackMs, fallbackMs)
  );
}
