/**
 * Tests for the yield-aware adaptive runtime budget.
 *
 * Today every legacy connector gets a flat 180s budget. That single number is
 * the chokepoint at the 271k → 400k LIVE scale:
 *   - High-yield shards (Jooble city/keyword shards, themuse, hiringcafe)
 *     consistently abort on budget while yielding 200-1200 new canonical jobs
 *     per successful run. Bumping their budget converts aborts → completions.
 *   - Long-tail single-tenant ATS boards (Ashby:tinystartup-with-3-jobs)
 *     consistently abort while yielding < 5 jobs. Cutting their budget frees
 *     cycle time for the high-yield work.
 *
 * `computeAdaptiveBudgetMs` is the pure decision function the scheduler will
 * call before each connector run.
 */
import { describe, it } from "node:test";
import { strictEqual } from "node:assert";

import {
  computeAdaptiveBudgetMs,
  shouldEnterLowYieldCooldown,
} from "../src/lib/ingestion/adaptive-runtime-budget";

const ONE_MIN = 60_000;

describe("computeAdaptiveBudgetMs", () => {
  it("returns the default for a cold connector with no history", () => {
    strictEqual(
      computeAdaptiveBudgetMs({
        defaultBudgetMs: 180_000,
        recentRuns: [],
      }),
      180_000
    );
  });

  it("clamps the result to [minBudgetMs, maxBudgetMs]", () => {
    strictEqual(
      computeAdaptiveBudgetMs({
        defaultBudgetMs: 10_000_000,
        recentRuns: [],
        minBudgetMs: 30_000,
        maxBudgetMs: 600_000,
      }),
      600_000
    );
    strictEqual(
      computeAdaptiveBudgetMs({
        defaultBudgetMs: 1,
        recentRuns: [],
        minBudgetMs: 30_000,
        maxBudgetMs: 600_000,
      }),
      30_000
    );
  });

  it("triples the budget (capped at maxBudgetMs) when the connector keeps aborting on budget with high yield", () => {
    // Simulates a Jooble shard: 10 recent runs, all aborted on budget, but
    // each accepted 200+ jobs and created 100+ new canonical rows. This is
    // the classic high-yield abort pattern we need to give more time to.
    const recentRuns = Array.from({ length: 10 }, () => ({
      durationMs: 180_000,
      acceptedCount: 220,
      canonicalCreatedCount: 110,
      budgetAborted: true,
    }));

    const budget = computeAdaptiveBudgetMs({
      defaultBudgetMs: 180_000,
      recentRuns,
      maxBudgetMs: 900_000,
    });

    // Expect at least a 2× bump.
    strictEqual(
      budget >= 360_000,
      true,
      `expected ≥ 360_000 ms, got ${budget}`
    );
    strictEqual(budget <= 900_000, true);
  });

  it("cuts the budget hard for connectors that keep aborting with negligible yield", () => {
    // Simulates a tiny Ashby tenant that keeps hitting the wall and only
    // contributes ≤2 jobs each time. Continuing to spend 180s on it is
    // wasted cycle time.
    const recentRuns = Array.from({ length: 8 }, () => ({
      durationMs: 180_000,
      acceptedCount: 2,
      canonicalCreatedCount: 0,
      budgetAborted: true,
    }));

    const budget = computeAdaptiveBudgetMs({
      defaultBudgetMs: 180_000,
      recentRuns,
      minBudgetMs: 30_000,
    });

    // Expect strictly less than half of default.
    strictEqual(
      budget < 90_000,
      true,
      `expected < 90_000 ms, got ${budget}`
    );
    strictEqual(budget >= 30_000, true);
  });

  it("keeps the budget near observed runtime when the connector finishes comfortably", () => {
    // Stable connector: 5 runs that each finished in ~30s with modest yield
    // and never aborted. We shouldn't waste 3 minutes on something that
    // reliably finishes in 30s; budget should drop to a snug envelope.
    const recentRuns = Array.from({ length: 5 }, () => ({
      durationMs: 30_000,
      acceptedCount: 10,
      canonicalCreatedCount: 3,
      budgetAborted: false,
    }));

    const budget = computeAdaptiveBudgetMs({
      defaultBudgetMs: 180_000,
      recentRuns,
      minBudgetMs: 30_000,
      maxBudgetMs: 900_000,
    });

    // Should be at least the observed runtime (with headroom), but well
    // below the default 180s.
    strictEqual(budget >= 30_000, true);
    strictEqual(budget <= 90_000, true);
  });

  it("respects a single recent successful run (no over-eager bump or cut)", () => {
    const recentRuns = [
      {
        durationMs: 45_000,
        acceptedCount: 12,
        canonicalCreatedCount: 4,
        budgetAborted: false,
      },
    ];

    const budget = computeAdaptiveBudgetMs({
      defaultBudgetMs: 180_000,
      recentRuns,
      minBudgetMs: 30_000,
      maxBudgetMs: 900_000,
    });

    // A single successful run shouldn't trigger the aggressive cut. Keep
    // within a sane band around the default and observed runtime.
    strictEqual(budget >= 45_000, true);
    strictEqual(budget <= 180_000, true);
  });

  it("ignores partial / null counts gracefully", () => {
    const recentRuns = [
      {
        durationMs: 60_000,
        acceptedCount: null,
        canonicalCreatedCount: undefined,
        budgetAborted: false,
      },
    ] as Array<{
      durationMs: number;
      acceptedCount: number | null;
      canonicalCreatedCount: number | null | undefined;
      budgetAborted: boolean;
    }>;

    const budget = computeAdaptiveBudgetMs({
      defaultBudgetMs: 180_000,
      recentRuns,
    });

    // Just confirm we don't NaN out and we land in a sane range.
    strictEqual(Number.isFinite(budget), true);
    strictEqual(budget > 0, true);
    strictEqual(budget <= 180_000, true);
  });

  it("treats aborts mixed with high yield as a strong signal to expand budget", () => {
    // Realistic noisy case: out of 10 runs, 6 aborted on budget but the
    // 4 that completed delivered hundreds of new canonical jobs each.
    // The completions prove there's real yield behind the wall; we should
    // expand budget.
    const recentRuns = [
      ...Array.from({ length: 6 }, () => ({
        durationMs: 180_000,
        acceptedCount: 150,
        canonicalCreatedCount: 60,
        budgetAborted: true,
      })),
      ...Array.from({ length: 4 }, () => ({
        durationMs: 150_000,
        acceptedCount: 240,
        canonicalCreatedCount: 120,
        budgetAborted: false,
      })),
    ];

    const budget = computeAdaptiveBudgetMs({
      defaultBudgetMs: 180_000,
      recentRuns,
      maxBudgetMs: 900_000,
    });

    strictEqual(
      budget >= 270_000,
      true,
      `expected ≥ 270_000 (1.5×), got ${budget}`
    );
  });

  it("cooldown: returns false when there is too little history", () => {
    strictEqual(shouldEnterLowYieldCooldown([]), false);
    strictEqual(
      shouldEnterLowYieldCooldown(
        Array.from({ length: 5 }, () => ({
          durationMs: 180_000,
          acceptedCount: 0,
          canonicalCreatedCount: 0,
          budgetAborted: true,
        }))
      ),
      false
    );
  });

  it("cooldown: returns true for persistent abort + zero yield", () => {
    const runs = Array.from({ length: 10 }, () => ({
      durationMs: 180_000,
      acceptedCount: 1,
      canonicalCreatedCount: 0,
      budgetAborted: true,
    }));
    strictEqual(shouldEnterLowYieldCooldown(runs), true);
  });

  it("cooldown: stays false when there is real yield even with high abort rate", () => {
    const runs = Array.from({ length: 10 }, () => ({
      durationMs: 180_000,
      acceptedCount: 120,
      canonicalCreatedCount: 80,
      budgetAborted: true,
    }));
    strictEqual(shouldEnterLowYieldCooldown(runs), false);
  });

  it("cooldown: stays false when most runs succeeded", () => {
    const runs = [
      ...Array.from({ length: 3 }, () => ({
        durationMs: 180_000,
        acceptedCount: 0,
        canonicalCreatedCount: 0,
        budgetAborted: true,
      })),
      ...Array.from({ length: 7 }, () => ({
        durationMs: 60_000,
        acceptedCount: 2,
        canonicalCreatedCount: 0,
        budgetAborted: false,
      })),
    ];
    strictEqual(shouldEnterLowYieldCooldown(runs), false);
  });

  it("multi-minute is always less than the 8-minute hard wall-clock cap", () => {
    const budget = computeAdaptiveBudgetMs({
      defaultBudgetMs: 180_000,
      recentRuns: Array.from({ length: 20 }, () => ({
        durationMs: 600_000,
        acceptedCount: 1500,
        canonicalCreatedCount: 800,
        budgetAborted: true,
      })),
      maxBudgetMs: 8 * ONE_MIN,
    });

    strictEqual(budget <= 8 * ONE_MIN, true);
  });
});
