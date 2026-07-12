/**
 * Show what the yield-aware adaptive budget would assign to a curated set of
 * connectors, given their recent IngestionRun history. Useful for spot-
 * checking the decision rules before / after tuning the thresholds in
 * `src/lib/ingestion/adaptive-runtime-budget.ts`.
 *
 *     DATABASE_URL='...' node --import tsx scripts/preview-adaptive-budget.ts
 *
 * Pass extra connector keys as CLI args to expand the report:
 *
 *     ... preview-adaptive-budget.ts ashby:kafene jobicy:feed
 */
import { prisma } from "@/lib/db";
import {
  computeAdaptiveBudgetMs,
  shouldEnterLowYieldCooldown,
  type RecentRun,
} from "@/lib/ingestion/adaptive-runtime-budget";

const DEFAULT_TARGETS = [
  "jooble:finance-intern-coop-cities-us",
  "jooble:banking-insurance-cities-us",
  "jooble:admin-coordination-cities-us",
  "jooble:whitecollar-na",
  "jooble:tech-intern-coop-cities-us",
  "jooble:security-cities-us-2",
  "jooble:fintech-emerging-cities-us",
  "jooble:all-na",
  "themuse:feed",
  "hiringcafe:feed",
  "remoteok:feed",
  "weworkremotely:feed",
  "remotive:feed",
  "eluta:feed",
  "jobboom:feed",
  "jobillico:feed",
  "builtin:feed",
  "adzuna:us:specialist",
  "adzuna:ca:specialist",
];

async function previewOne(key: string) {
  const rows = await prisma.ingestionRun.findMany({
    where: { connectorKey: key, status: { in: ["SUCCESS", "FAILED"] } },
    orderBy: { startedAt: "desc" },
    take: 12,
    select: {
      startedAt: true,
      endedAt: true,
      acceptedCount: true,
      canonicalCreatedCount: true,
      errorSummary: true,
    },
  });

  const recentRuns: RecentRun[] = rows.map((row) => ({
    durationMs: Math.max(
      0,
      (row.endedAt ?? row.startedAt).getTime() - row.startedAt.getTime()
    ),
    acceptedCount: row.acceptedCount,
    canonicalCreatedCount: row.canonicalCreatedCount,
    budgetAborted: /RuntimeBudget|TIME_BUDGET_EXCEEDED/i.test(
      row.errorSummary ?? ""
    ),
  }));

  const family = key.split(":")[0]?.toLowerCase();
  const defaultBudget = family === "adzuna" ? 240_000 : 180_000;
  const adaptive = computeAdaptiveBudgetMs({
    defaultBudgetMs: defaultBudget,
    recentRuns,
    minBudgetMs: 30_000,
    maxBudgetMs: 9 * 60 * 1000,
  });
  const cooldown = shouldEnterLowYieldCooldown(recentRuns);

  const aborts = recentRuns.filter((run) => run.budgetAborted).length;
  const totalNew = recentRuns.reduce(
    (sum, run) => sum + (run.canonicalCreatedCount ?? 0),
    0
  );
  const totalAccepted = recentRuns.reduce(
    (sum, run) => sum + (run.acceptedCount ?? 0),
    0
  );

  console.log(
    `${key.padEnd(45)}  runs=${recentRuns.length
      .toString()
      .padStart(2)}  aborts=${aborts
      .toString()
      .padStart(2)}  new_canon=${totalNew
      .toString()
      .padStart(5)}  accepted=${totalAccepted
      .toString()
      .padStart(5)}  default=${(defaultBudget / 1000)
      .toString()
      .padStart(3)}s  ADAPTIVE=${
      cooldown ? "COOLDOWN" : `${(adaptive / 1000).toFixed(0)}s`
    }`
  );
}

async function main() {
  const cliKeys = process.argv.slice(2);
  const targets = cliKeys.length > 0 ? cliKeys : DEFAULT_TARGETS;

  console.log(
    `Adaptive-budget preview for ${targets.length} connector(s) — last 12 runs each\n`
  );

  for (const key of targets) {
    try {
      await previewOne(key);
    } catch (error) {
      console.error(
        `[preview] ${key} failed:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
