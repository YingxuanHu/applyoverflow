// Connector-poll / rediscovery readiness reconciliation runs several heavy
// UPDATE statements (CTE aggregations over a day of IngestionRun rows). It was
// historically invoked on every claimSourceTasks call, so busy poll workers
// paid the full reconciliation cost per claim batch and serialized behind the
// advisory lock — throttling claim throughput far below poll capacity.
//
// Reconciliation is hygiene, not correctness: the claim SQL independently
// re-checks source eligibility and cooldowns, so a stale reconciliation pass
// only means some ineligible PENDING tasks linger a few minutes longer before
// being mass-skipped. This gate caps how often each reconciliation kind runs
// per process; callers that genuinely need a fresh pass (cycle boundaries,
// one-shot scripts) can force it.

const DEFAULT_MIN_INTERVAL_SECONDS = 300;

function readMinIntervalMs() {
  const parsed = Number.parseInt(
    process.env.INGEST_READINESS_RECONCILE_MIN_INTERVAL_SECONDS ?? "",
    10
  );
  const seconds =
    Number.isFinite(parsed) && parsed >= 0
      ? parsed
      : DEFAULT_MIN_INTERVAL_SECONDS;
  return seconds * 1000;
}

export type ReconcileGateOptions = {
  intervalMs?: number;
  clock?: () => number;
};

export class ReconcileGate {
  private readonly intervalMs: number;
  private readonly clock: () => number;
  private readonly lastRunAt = new Map<string, number>();

  constructor(options: ReconcileGateOptions = {}) {
    this.intervalMs = options.intervalMs ?? readMinIntervalMs();
    this.clock = options.clock ?? Date.now;
  }

  // Returns true (and records the run) when enough time has passed since the
  // last recorded run for this key, or when forced. Returns false otherwise.
  shouldRun(key: string, options: { force?: boolean } = {}): boolean {
    const now = this.clock();
    if (!options.force) {
      const last = this.lastRunAt.get(key);
      if (last !== undefined && now - last < this.intervalMs) {
        return false;
      }
    }
    this.lastRunAt.set(key, now);
    return true;
  }
}
