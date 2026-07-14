const DEFAULT_NEWLY_VALIDATED_SOURCE_POLL_PRIORITY = 225_000;

const configuredBootstrapPriority = Number.parseInt(
  process.env.NEWLY_VALIDATED_SOURCE_POLL_PRIORITY ?? "",
  10
);

const NEWLY_VALIDATED_SOURCE_POLL_PRIORITY =
  Number.isFinite(configuredBootstrapPriority) && configuredBootstrapPriority >= 100
    ? configuredBootstrapPriority
    : DEFAULT_NEWLY_VALIDATED_SOURCE_POLL_PRIORITY;

// A source is not supply until its first poll has completed. Give this one-time
// bootstrap task precedence over routine growth refreshes, while remaining
// below the retention lane that keeps existing live jobs fresh.
export function getValidatedSourceFastTrackPollPriority(input: {
  priorityScore: number;
  pollAttemptCount: number;
  pollSuccessCount: number;
  lastSuccessfulPollAt: Date | null;
}) {
  const routinePriority = Math.max(70, Math.round(input.priorityScore * 100));
  const needsInitialPoll =
    input.pollAttemptCount === 0 &&
    input.pollSuccessCount === 0 &&
    input.lastSuccessfulPollAt === null;

  return needsInitialPoll
    ? Math.max(routinePriority, NEWLY_VALIDATED_SOURCE_POLL_PRIORITY)
    : routinePriority;
}
