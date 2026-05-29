/**
 * Yield-aware adaptive runtime budget for legacy connectors.
 *
 * Today, every legacy ATS / feed connector receives the same flat budget
 * (180s legacy, 240s Adzuna). That single number doesn't survive contact
 * with reality:
 *
 *   - High-yield aggregator shards (Jooble city+keyword shards, themuse,
 *     hiringcafe) consistently abort on the budget while creating 200–1200
 *     net-new canonical jobs per *successful* run. They have more pages to
 *     paginate than 180s allows. Bumping them converts aborts into
 *     completions and unlocks tens of thousands of jobs per week.
 *
 *   - Long-tail single-tenant ATS boards (small Ashby tenants with 1–3
 *     openings) sometimes ALSO abort on budget but only contribute 0–2
 *     jobs each. Continuing to spend 180s on them is wasted cycle time.
 *
 * `computeAdaptiveBudgetMs` is a pure function: given a connector's recent
 * IngestionRun history, decide what runtime budget to grant the next run.
 * Pure-function-only (no DB, no clock) so the scheduler can compute it
 * cheaply per connector and tests can pin every branch.
 *
 * Decision rules (in priority order):
 *
 *   1. No history → return default budget.
 *   2. Connector has recently been aborting AND median yield is high
 *      (≥ ~25 net-new canonical per run or ≥ ~80 accepted per run):
 *      bump budget by 1.5×–3× depending on how persistent the abort
 *      pattern is. Clamped at maxBudgetMs.
 *   3. Connector has recently been aborting AND median yield is negligible
 *      (≤ ~3 accepted per run, ~0 net-new): cut budget to ~0.3× of default
 *      to stop wasting cycle time on it. Clamped at minBudgetMs.
 *   4. Steady-state successful (no aborts in window): right-size the budget
 *      to p90(durationMs) × 1.3, with a floor at minBudgetMs and a cap at
 *      the default so we never *raise* a comfortably-finishing connector
 *      above the cluster-wide default unnecessarily.
 *   5. Everything else: fall back to the default budget.
 */

type RecentRun = {
  /** Run wall-clock duration in milliseconds. */
  durationMs: number;
  /** Jobs accepted into raw storage (post-filters). */
  acceptedCount: number | null | undefined;
  /** Net-new canonical rows created. */
  canonicalCreatedCount: number | null | undefined;
  /** True when this run terminated with TIME_BUDGET_EXCEEDED. */
  budgetAborted: boolean;
};

type Input = {
  defaultBudgetMs: number;
  recentRuns: RecentRun[];
  /** Lower clamp on the returned budget. Default 30_000 (30s). */
  minBudgetMs?: number;
  /** Upper clamp on the returned budget. Default 900_000 (15 min). */
  maxBudgetMs?: number;
};

const DEFAULT_MIN_BUDGET_MS = 30_000;
const DEFAULT_MAX_BUDGET_MS = 900_000;

// Yield thresholds tuned against observed production data (3-day yield
// snapshot 2026-05-26). Jooble high-yield shards averaged ~110 new canonical
// per completed run; themuse:feed averaged ~270 per run. Tiny Ashby tenants
// averaged ~1.5 new and < 5 accepted.
const HIGH_YIELD_NEW_CANONICAL = 25;
const HIGH_YIELD_ACCEPTED = 80;
const NEGLIGIBLE_YIELD_ACCEPTED = 3;
const NEGLIGIBLE_YIELD_NEW_CANONICAL = 0;

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.max(low, Math.min(high, value));
}

function safeNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx];
}

export function computeAdaptiveBudgetMs(input: Input): number {
  const minBudgetMs = input.minBudgetMs ?? DEFAULT_MIN_BUDGET_MS;
  const maxBudgetMs = input.maxBudgetMs ?? DEFAULT_MAX_BUDGET_MS;
  const defaultBudgetMs = clamp(input.defaultBudgetMs, minBudgetMs, maxBudgetMs);

  const runs = Array.isArray(input.recentRuns) ? input.recentRuns : [];
  if (runs.length === 0) {
    return defaultBudgetMs;
  }

  const aborted = runs.filter((run) => run.budgetAborted);
  const completed = runs.filter((run) => !run.budgetAborted);
  const abortRate = aborted.length / runs.length;

  const newCanonicalCounts = runs.map((run) => safeNumber(run.canonicalCreatedCount));
  const acceptedCounts = runs.map((run) => safeNumber(run.acceptedCount));
  const completedDurations = completed.map((run) => safeNumber(run.durationMs));

  const medianNewCanonical = median(newCanonicalCounts);
  const medianAccepted = median(acceptedCounts);

  // Rule 2: aborting with proven yield → expand.
  // We only require enough runs (2+) to avoid one-off jitter from a single
  // abort.
  if (runs.length >= 2 && abortRate >= 0.4) {
    const looksHighYield =
      medianNewCanonical >= HIGH_YIELD_NEW_CANONICAL ||
      medianAccepted >= HIGH_YIELD_ACCEPTED;

    if (looksHighYield) {
      // Scale multiplier between 1.5× and 3× based on how persistent the
      // aborts are. Persistent aborts (≥80%) get 3×; intermittent get 1.5×.
      const multiplier = 1.5 + (abortRate - 0.4) * 2.5;
      const bumped = defaultBudgetMs * Math.max(1.5, Math.min(3, multiplier));
      return clamp(bumped, minBudgetMs, maxBudgetMs);
    }

    const looksNegligibleYield =
      medianAccepted <= NEGLIGIBLE_YIELD_ACCEPTED &&
      medianNewCanonical <= NEGLIGIBLE_YIELD_NEW_CANONICAL;

    if (looksNegligibleYield) {
      // Rule 3: aborts + negligible yield → throttle.
      const cut = defaultBudgetMs * 0.3;
      return clamp(cut, minBudgetMs, defaultBudgetMs);
    }
  }

  // Rule 4: steady-state — right-size to observed p90 + headroom, but never
  // exceed the default. This is the place where we *reduce* over-allocated
  // budgets on small but reliable connectors so the saved cycle time can be
  // routed to bigger ones via maxConnectorRuns / maxCycleDurationMs.
  if (
    aborted.length === 0 &&
    completed.length >= 3 &&
    completedDurations.some((duration) => duration > 0)
  ) {
    const p90 = quantile(completedDurations, 0.9);
    if (p90 > 0) {
      const snug = p90 * 1.3;
      return clamp(snug, minBudgetMs, defaultBudgetMs);
    }
  }

  return defaultBudgetMs;
}

/**
 * Decide whether to *skip* this connector entirely this cycle. Returns true
 * when the connector has shown a persistent abort + zero-yield pattern, so
 * spending another budget on it is wasted cycle time. The connector will
 * still be retried after its normal cadence window opens, so a temporary
 * upstream problem won't permanently park it.
 *
 * Pulled out of the scheduler so it can be unit-tested without spinning up
 * the database.
 */
export function shouldEnterLowYieldCooldown(recentRuns: RecentRun[]): boolean {
  if (!Array.isArray(recentRuns) || recentRuns.length < 6) return false;
  const aborts = recentRuns.filter((run) => run.budgetAborted).length;
  if (aborts / recentRuns.length < 0.7) return false;
  const totalNewCanonical = recentRuns.reduce(
    (sum, run) => sum + Math.max(0, safeNumber(run.canonicalCreatedCount)),
    0
  );
  const totalAccepted = recentRuns.reduce(
    (sum, run) => sum + Math.max(0, safeNumber(run.acceptedCount)),
    0
  );
  return totalNewCanonical === 0 && totalAccepted <= 10;
}

export type { RecentRun };
