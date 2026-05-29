import { prisma } from "@/lib/db";
import {
  computeAdaptiveBudgetMs,
  shouldEnterLowYieldCooldown,
  type RecentRun,
} from "@/lib/ingestion/adaptive-runtime-budget";
import {
  isCompanySourceManagedConnector,
  routeLegacyScheduledConnectorToCompanySource,
} from "@/lib/ingestion/legacy-source-routing";
import {
  getSourceQualitySnapshot,
  getSourceFamily,
} from "@/lib/ingestion/source-quality";
import {
  bulkSyncCanonicalStatuses,
  ingestConnector,
  recoverStaleRunningIngestionRuns,
} from "@/lib/ingestion/pipeline";
import {
  getScheduledConnectors,
  type ScheduledConnectorDefinition,
} from "@/lib/ingestion/registry";
import type { IngestionSummary } from "@/lib/ingestion/types";

export type ScheduledIngestionResult = {
  startedAt: string;
  executedRuns: IngestionSummary[];
  skippedConnectors: Array<{
    connectorKey: string;
    sourceName: string;
    reason:
      | "not_due"
      | "managed_by_company_source"
      | "cycle_budget_exhausted"
      // Adaptive cooldown: connector has been aborting on budget with
      // negligible yield, so it's parked for several cadence multiples.
      | "low_yield_cooldown"
      | "deferred_for_company_source_backlog";
    nextEligibleAt: string | null;
    lastRunStartedAt: string | null;
    origin: "legacy_registry";
    companySourceId?: string;
    taskKind?: "SOURCE_VALIDATION" | "CONNECTOR_POLL";
  }>;
  lifecycle: {
    liveCount: number;
    agingCount?: number;
    staleCount: number;
    expiredCount: number;
    removedCount: number;
    updatedCount: number;
    deferred?: boolean;
  };
};

// Per-connector soft budgets — adaptive.
//
// Originally a flat 180s for legacy / 240s for Adzuna. That single number was
// the chokepoint at 271k → 400k LIVE: high-yield aggregator shards (jooble,
// themuse, hiringcafe) consistently aborted on budget while completed runs
// produced hundreds of new canonical rows, AND tiny single-tenant ATS boards
// consistently aborted while producing ≤ 2 jobs each.
//
// Now: each connector's budget is computed from its own recent run history.
// The defaults below are the *starting point* used when there's no history
// (cold start) or when no obvious abort/yield pattern exists. See
// `computeAdaptiveBudgetMs` for the decision rules.
const DEFAULT_LEGACY_CONNECTOR_RUNTIME_BUDGET_MS = 180_000;
const DEFAULT_ADZUNA_RUNTIME_BUDGET_MS = 240_000;
// Hard upper clamp on the adaptive budget. Any single connector takes at
// most this long before the scheduler abandons it. Still well below the
// LEGACY_CONNECTOR_HARD_TIMEOUT_MS Promise.race cap so the abandon-and-move-on
// path remains intact.
const MAX_ADAPTIVE_BUDGET_MS = 9 * 60 * 1000; // 9 minutes
const MIN_ADAPTIVE_BUDGET_MS = 30 * 1000; // 30 seconds
// Hard wall-clock cap per connector: even if the internal AbortController is
// ignored (e.g. Playwright IPC hangs), this Promise.race fires and lets the
// scheduler move on. Set to MAX_ADAPTIVE_BUDGET_MS + buffer.
const LEGACY_CONNECTOR_HARD_TIMEOUT_MS = 12 * 60 * 1000; // 12 minutes absolute max
// How many recent runs to consider when deciding a connector's next budget.
// 12 ≈ 1 day at 2-hour cadence; gives a stable enough median to outvote a
// single transient abort without smearing in week-old behavior.
const ADAPTIVE_HISTORY_WINDOW = 12;
const AGGREGATOR_FAMILY_RUNTIME_ORDER_PENALTY = new Set([
  "adzuna",
  "charityvillage",
  "eluta",
  "jsearch",
  "jobicy",
  "jobillico",
  "jooble",
  "remoteok",
  "remotive",
  "themuse",
  "weworkremotely",
  "workatastartup",
]);
const LEGACY_AGGREGATOR_DEFER_FAMILIES = new Set([
  ...AGGREGATOR_FAMILY_RUNTIME_ORDER_PENALTY,
  "himalayas",
  "jobbank",
  "jobbank-live",
  "usajobs",
]);

function readPositiveIntEnv(name: string) {
  const raw = process.env[name]?.trim() ?? "";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getDefaultBudgetMs(sourceName: string) {
  const connectorFamily = sourceName.split(":")[0]?.toLowerCase();

  if (connectorFamily === "adzuna") {
    return (
      readPositiveIntEnv("ADZUNA_RUNTIME_BUDGET_MS") ??
      DEFAULT_ADZUNA_RUNTIME_BUDGET_MS
    );
  }

  return (
    readPositiveIntEnv("LEGACY_CONNECTOR_RUNTIME_BUDGET_MS") ??
    DEFAULT_LEGACY_CONNECTOR_RUNTIME_BUDGET_MS
  );
}

type RecentHistoryRow = {
  startedAt: Date;
  endedAt: Date | null;
  acceptedCount: number;
  canonicalCreatedCount: number;
  errorSummary: string | null;
};

function rowsToRecentRuns(rows: RecentHistoryRow[]): RecentRun[] {
  return rows.map((row) => {
    const ended = row.endedAt ?? row.startedAt;
    const durationMs = Math.max(0, ended.getTime() - row.startedAt.getTime());
    const budgetAborted = /RuntimeBudget|TIME_BUDGET_EXCEEDED/i.test(
      row.errorSummary ?? ""
    );
    return {
      durationMs,
      acceptedCount: row.acceptedCount,
      canonicalCreatedCount: row.canonicalCreatedCount,
      budgetAborted,
    };
  });
}

function getScheduledDefinitionPriority(definition: ScheduledConnectorDefinition) {
  const quality = getSourceQualitySnapshot({
    sourceName: definition.connector.sourceName,
    sourceUrl: null,
    applyUrl: null,
  });
  const family = getSourceFamily(definition.connector.sourceName);
  const aggregatorPenalty = AGGREGATOR_FAMILY_RUNTIME_ORDER_PENALTY.has(family)
    ? 10_000
    : 0;

  return quality.rank - aggregatorPenalty;
}

function isDeferrableLegacyAggregator(sourceName: string) {
  return LEGACY_AGGREGATOR_DEFER_FAMILIES.has(getSourceFamily(sourceName));
}

async function countDueCompanySourceBacklog(now: Date) {
  return prisma.sourceTask.count({
    where: {
      status: "PENDING",
      notBeforeAt: { lte: now },
      companySourceId: { not: null },
      kind: {
        in: ["SOURCE_VALIDATION", "CONNECTOR_POLL", "REDISCOVERY"],
      },
      companySource: {
        connectorName: {
          notIn: [
            "adzuna",
            "himalayas",
            "jobicy",
            "jooble",
            "jsearch",
            "remoteok",
            "remotive",
            "themuse",
            "usajobs",
            "weworkremotely",
            "workatastartup",
          ],
        },
      },
    },
  });
}

/**
 * Look up a connector's recent run history and compute its next runtime
 * budget. Cheap query — only the columns the decision function needs, and
 * limited to ADAPTIVE_HISTORY_WINDOW rows. Safe to call once per scheduled
 * connector per cycle.
 *
 * On failure, returns the default for that connector family — never throws.
 */
async function fetchRecentRuns(connectorKey: string): Promise<RecentRun[]> {
  try {
    const history = await prisma.ingestionRun.findMany({
      where: {
        connectorKey,
        status: { in: ["SUCCESS", "FAILED"] },
      },
      orderBy: { startedAt: "desc" },
      take: ADAPTIVE_HISTORY_WINDOW,
      select: {
        startedAt: true,
        endedAt: true,
        acceptedCount: true,
        canonicalCreatedCount: true,
        errorSummary: true,
      },
    });
    return rowsToRecentRuns(history);
  } catch (error) {
    console.warn(
      `[scheduler] Recent-run lookup failed for ${connectorKey}`,
      error instanceof Error ? error.message : error
    );
    return [];
  }
}

function resolveConnectorRuntimeBudgetMs(args: {
  sourceName: string;
  recentRuns: RecentRun[];
}): number {
  const defaultBudgetMs = getDefaultBudgetMs(args.sourceName);

  return computeAdaptiveBudgetMs({
    defaultBudgetMs,
    recentRuns: args.recentRuns,
    minBudgetMs: MIN_ADAPTIVE_BUDGET_MS,
    maxBudgetMs: MAX_ADAPTIVE_BUDGET_MS,
  });
}

async function countCanonicalStatusSnapshot() {
  const [liveCount, agingCount, staleCount, expiredCount, removedCount] = await Promise.all([
    prisma.jobCanonical.count({ where: { status: "LIVE" } }),
    prisma.jobCanonical.count({ where: { status: "AGING" } }),
    prisma.jobCanonical.count({ where: { status: "STALE" } }),
    prisma.jobCanonical.count({ where: { status: "EXPIRED" } }),
    prisma.jobCanonical.count({ where: { status: "REMOVED" } }),
  ]);

  return {
    liveCount,
    agingCount,
    staleCount,
    expiredCount,
    removedCount,
    updatedCount: 0,
    deferred: true,
  };
}

/**
 * Race a connector invocation against a hard wall-clock deadline.
 * Returns the summary on success; throws on error or timeout.
 */
function withHardTimeout<T>(
  promise: Promise<T>,
  connectorKey: string,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `[scheduler] Connector ${connectorKey} exceeded hard timeout of ${timeoutMs}ms — forcibly abandoned`
        )
      );
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function runScheduledIngestion(options: {
  now?: Date;
  force?: boolean;
  connectorKeys?: string[];
  triggerLabel?: string;
  maxCycleDurationMs?: number;
  maxConnectorRuns?: number;
  skipLifecycle?: boolean;
  lifecyclePerJobLimit?: number;
} = {}): Promise<ScheduledIngestionResult> {
  const now = options.now ?? new Date();
  const staleRunRecovery = await recoverStaleRunningIngestionRuns({
    now,
    connectorKeys: options.connectorKeys,
  });
  if (staleRunRecovery.recoveredCount > 0) {
    console.log(
      `[scheduler] Recovered ${staleRunRecovery.recoveredCount} stale RUNNING ingestion run(s): ${staleRunRecovery.connectorKeys.join(", ")}`
    );
  }
  const allDefinitions = getScheduledConnectors().filter((definition) => {
    if (!options.connectorKeys || options.connectorKeys.length === 0) return true;
    return options.connectorKeys.includes(definition.connector.key);
  });
  const dueCompanySourceBacklog =
    options.connectorKeys && options.connectorKeys.length > 0
      ? 0
      : await countDueCompanySourceBacklog(now).catch((error: unknown) => {
          console.warn(
            "[scheduler] Company-source backlog lookup failed; legacy aggregators will not be deferred.",
            error instanceof Error ? error.message : error
          );
          return 0;
        });

  // Run legacy-only connectors (aggregator feeds, job boards) FIRST.
  // There are only ~14 of these but they contribute 80k+ jobs. Without this
  // priority ordering, they never run because the 1,300+ managed ATS connectors
  // exhaust the cycle budget before the aggregator feeds get a turn.
  const scheduledDefinitions = [
    ...allDefinitions.filter(
      (d) => !isCompanySourceManagedConnector(d.connector.sourceName)
    ),
    ...allDefinitions.filter((d) =>
      isCompanySourceManagedConnector(d.connector.sourceName)
    ),
  ].sort(
    (left, right) =>
      getScheduledDefinitionPriority(right) -
        getScheduledDefinitionPriority(left) ||
      left.connector.sourceName.localeCompare(right.connector.sourceName)
  );

  const executedRuns: IngestionSummary[] = [];
  const skippedConnectors: ScheduledIngestionResult["skippedConnectors"] = [];

  for (const definition of scheduledDefinitions) {
    if (
      typeof options.maxConnectorRuns === "number" &&
      executedRuns.length >= options.maxConnectorRuns
    ) {
      skippedConnectors.push({
        connectorKey: definition.connector.key,
        sourceName: definition.connector.sourceName,
        reason: "cycle_budget_exhausted",
        nextEligibleAt: null,
        lastRunStartedAt: null,
        origin: "legacy_registry",
      });
      continue;
    }

    if (
      typeof options.maxCycleDurationMs === "number" &&
      options.maxCycleDurationMs > 0 &&
      Date.now() - now.getTime() >= options.maxCycleDurationMs
    ) {
      skippedConnectors.push({
        connectorKey: definition.connector.key,
        sourceName: definition.connector.sourceName,
        reason: "cycle_budget_exhausted",
        nextEligibleAt: null,
        lastRunStartedAt: null,
        origin: "legacy_registry",
      });
      continue;
    }

    if (
      dueCompanySourceBacklog > 0 &&
      isDeferrableLegacyAggregator(definition.connector.sourceName)
    ) {
      skippedConnectors.push({
        connectorKey: definition.connector.key,
        sourceName: definition.connector.sourceName,
        reason: "deferred_for_company_source_backlog",
        nextEligibleAt: null,
        lastRunStartedAt: null,
        origin: "legacy_registry",
      });
      continue;
    }

    if (isCompanySourceManagedConnector(definition.connector.sourceName)) {
      const promotion = await routeLegacyScheduledConnectorToCompanySource(definition, {
        now,
        origin: "legacy_registry",
      });

      if (promotion.managed) {
        skippedConnectors.push({
          connectorKey: definition.connector.key,
          sourceName: definition.connector.sourceName,
          reason: "managed_by_company_source",
          nextEligibleAt: null,
          lastRunStartedAt: null,
          origin: "legacy_registry",
          companySourceId: promotion.companySourceId,
          taskKind: promotion.taskKind,
        });
        continue;
      }
    }

    const lastTrackedRun = await prisma.ingestionRun.findFirst({
      where: {
        connectorKey: definition.connector.key,
        status: {
          in: ["RUNNING", "SUCCESS", "FAILED"],
        },
      },
      orderBy: { startedAt: "desc" },
    });

    if (!options.force && lastTrackedRun) {
      const nextEligibleAt = new Date(
        lastTrackedRun.startedAt.getTime() +
          definition.cadenceMinutes * 60 * 1000
      );

      if (now.getTime() < nextEligibleAt.getTime()) {
        skippedConnectors.push({
          connectorKey: definition.connector.key,
          sourceName: definition.connector.sourceName,
          reason: "not_due",
          nextEligibleAt: nextEligibleAt.toISOString(),
          lastRunStartedAt: lastTrackedRun.startedAt.toISOString(),
          origin: "legacy_registry",
        });
        continue;
      }
    }

    try {
      const recentRuns = await fetchRecentRuns(definition.connector.key);

      // Persistent abort + zero yield → cooldown. Skip this cycle so the
      // saved budget can go to high-yield connectors. The connector still
      // re-enters next time the cadence window opens; if upstream behavior
      // changes it will pick back up.
      if (shouldEnterLowYieldCooldown(recentRuns)) {
        skippedConnectors.push({
          connectorKey: definition.connector.key,
          sourceName: definition.connector.sourceName,
          reason: "low_yield_cooldown",
          nextEligibleAt: null,
          lastRunStartedAt: null,
          origin: "legacy_registry",
        });
        continue;
      }

      const adaptiveBudgetMs = resolveConnectorRuntimeBudgetMs({
        sourceName: definition.connector.sourceName,
        recentRuns,
      });

      const summary = await withHardTimeout(
        ingestConnector(definition.connector, {
          now,
          runMode: "SCHEDULED",
          allowOverlappingRuns: false,
          maxRuntimeMs: adaptiveBudgetMs,
          triggerLabel: options.triggerLabel ?? "schedule.route",
          scheduleCadenceMinutes: definition.cadenceMinutes,
          runMetadata: {
            origin: "legacy_registry",
            registryKey: definition.connector.key,
            sourceName: definition.connector.sourceName,
            validationState: null,
            companySourceId: null,
            adaptiveBudgetMs,
          },
        }),
        definition.connector.key,
        LEGACY_CONNECTOR_HARD_TIMEOUT_MS
      );

      executedRuns.push(summary);
    } catch (error) {
      console.error(
        `[scheduler] Connector ${definition.connector.key} failed:`,
        error instanceof Error ? error.message : error
      );
      // Continue to next connector — one failure should not stop the cycle
    }
  }

  // Use the fast bulk-sync path instead of the full per-job reconcile.
  // The full reconcile processes all 300k+ jobs with N+1 queries — far too slow
  // for a daemon cycle.  bulkSyncCanonicalStatuses does a single SQL UPDATE for
  // status and then runs the full per-job logic for only the at-risk cohort.
  const lifecycle = options.skipLifecycle
    ? await countCanonicalStatusSnapshot()
    : await bulkSyncCanonicalStatuses({
        now,
        perJobLimit: options.lifecyclePerJobLimit ?? 3_000,
      });

  return {
    startedAt: now.toISOString(),
    executedRuns,
    skippedConnectors,
    lifecycle,
  };
}
