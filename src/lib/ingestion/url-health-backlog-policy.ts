// URL_HEALTH tasks refresh JobCanonical.lastConfirmedAliveAt — the 30-day
// backstop that keeps jobs visible when source polls lag. The enqueue side
// re-selects the most overdue candidates every cycle, so a pending task that
// waits is pure duplication: a later cycle would rediscover the same job
// anyway. Meanwhile an enqueue limit above the drain limit grows the backlog
// without bound (observed in production: 6.5k -> 9.1k pending in one day,
// oldest task six weeks overdue). Capping the pending backlog at a ceiling
// keeps the queue a short working set instead of an ever-growing archive.
const DEFAULT_URL_HEALTH_PENDING_CEILING = 6_000;

export function resolveUrlHealthPendingCeiling(
  rawValue: string | undefined = process.env.URL_HEALTH_PENDING_CEILING
) {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_URL_HEALTH_PENDING_CEILING;
}

export function shouldEnqueueUrlHealth(pendingCount: number, ceiling: number) {
  return pendingCount < ceiling;
}

// Bounds a requested enqueue batch to the headroom left under the ceiling so
// a single large enqueue cannot overshoot it. Returns 0 when the backlog is
// already at or over the ceiling.
export function resolveUrlHealthEnqueueBudget(
  requestedLimit: number,
  pendingCount: number,
  ceiling: number
) {
  if (!shouldEnqueueUrlHealth(pendingCount, ceiling)) {
    return 0;
  }

  return Math.max(0, Math.min(requestedLimit, ceiling - pendingCount));
}
