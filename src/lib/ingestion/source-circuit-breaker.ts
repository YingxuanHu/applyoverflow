// Source circuit breaker: failure handling for company sources was open-loop —
// consecutiveFailures climbed unbounded (production sources reached 4k-9k
// failures) while poll/validation tasks kept being enqueued and mass-skipped,
// burning queue capacity that healthy sources needed. This policy closes the
// loop with three explicit states:
//
//   KEEP        — healthy or recently successful; normal scheduling applies.
//   REDISCOVER  — persistently failing; stop wasting polls and route the
//                 source through rediscovery + the ATS slug probe so a moved
//                 board can be found (careers URLs rot; companies migrate ATS).
//   DISABLE     — hopeless zombie (long-dead, nothing retained, rediscovery
//                 has had its chance); remove it from every scheduling path.
//                 The company remains a coverage-gap target, so the slug-probe
//                 lane keeps looking for its replacement board.

function readPositiveIntEnv(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name]?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const REDISCOVER_FAILURE_THRESHOLD = readPositiveIntEnv(
  "SOURCE_CIRCUIT_REDISCOVER_FAILURES",
  25
);
const REDISCOVER_STALE_DAYS = readPositiveIntEnv(
  "SOURCE_CIRCUIT_REDISCOVER_STALE_DAYS",
  14
);
const DISABLE_FAILURE_THRESHOLD = readPositiveIntEnv(
  "SOURCE_CIRCUIT_DISABLE_FAILURES",
  100
);
const DISABLE_STALE_DAYS = readPositiveIntEnv(
  "SOURCE_CIRCUIT_DISABLE_STALE_DAYS",
  30
);

export type SourceCircuitAction = "KEEP" | "REDISCOVER" | "DISABLE";

export type SourceCircuitInput = {
  now: Date;
  consecutiveFailures: number;
  retainedLiveJobCount: number;
  lastSuccessfulPollAt: Date | null;
  // Fallback age reference for sources that never succeeded.
  createdAt: Date;
};

export type SourceCircuitDecision = {
  action: SourceCircuitAction;
  reason: string;
  daysSinceSuccess: number;
};

export function decideSourceCircuitAction(
  input: SourceCircuitInput
): SourceCircuitDecision {
  const reference = input.lastSuccessfulPollAt ?? input.createdAt;
  const daysSinceSuccess =
    (input.now.getTime() - reference.getTime()) / (24 * 60 * 60 * 1000);

  if (
    input.consecutiveFailures >= DISABLE_FAILURE_THRESHOLD &&
    daysSinceSuccess >= DISABLE_STALE_DAYS &&
    input.retainedLiveJobCount === 0
  ) {
    return {
      action: "DISABLE",
      reason: `${input.consecutiveFailures} consecutive failures, no success in ${Math.round(daysSinceSuccess)}d, nothing retained`,
      daysSinceSuccess,
    };
  }

  if (
    input.consecutiveFailures >= REDISCOVER_FAILURE_THRESHOLD &&
    daysSinceSuccess >= REDISCOVER_STALE_DAYS
  ) {
    return {
      action: "REDISCOVER",
      reason: `${input.consecutiveFailures} consecutive failures, no success in ${Math.round(daysSinceSuccess)}d`,
      daysSinceSuccess,
    };
  }

  return { action: "KEEP", reason: "healthy or recently successful", daysSinceSuccess };
}
