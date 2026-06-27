export type SourceIntelligenceBaselineLike = {
  generatedAt?: string;
  summary?: Record<string, unknown>;
  sourceRegistry?: {
    activeValidatedPollableCount?: unknown;
    byStatus?: Record<string, unknown>;
    byValidationState?: Record<string, unknown>;
    byPollState?: Record<string, unknown>;
    staleSourceCounts?: Record<string, unknown>;
  };
  queues?: {
    pendingCount?: unknown;
    runningCount?: unknown;
  };
  ingestion?: {
    windowTotals?: Record<string, unknown>;
  };
};

export type SourceIntelligenceMetricDelta = {
  key: string;
  before: number;
  after: number;
  delta: number;
  percentDelta: number | null;
};

export type SourceIntelligenceComparison = {
  beforeGeneratedAt: string | null;
  afterGeneratedAt: string | null;
  metrics: SourceIntelligenceMetricDelta[];
};

type MetricSpec = {
  key: string;
  path: string[];
};

const COMPARISON_METRICS: MetricSpec[] = [
  { key: "feed_live_jobs", path: ["summary", "feedIndexLiveJobCount"] },
  { key: "strict_canonical_visible_jobs", path: ["summary", "strictCanonicalVisibleJobCount"] },
  { key: "canonical_visible_status_jobs", path: ["summary", "canonicalVisibleStatusJobCount"] },
  { key: "active_validated_pollable_sources", path: ["sourceRegistry", "activeValidatedPollableCount"] },
  { key: "source_status_active", path: ["sourceRegistry", "byStatus", "ACTIVE"] },
  { key: "source_status_degraded", path: ["sourceRegistry", "byStatus", "DEGRADED"] },
  { key: "source_status_rediscover_required", path: ["sourceRegistry", "byStatus", "REDISCOVER_REQUIRED"] },
  { key: "source_validation_validated", path: ["sourceRegistry", "byValidationState", "VALIDATED"] },
  { key: "source_validation_suspect", path: ["sourceRegistry", "byValidationState", "SUSPECT"] },
  { key: "source_validation_needs_rediscovery", path: ["sourceRegistry", "byValidationState", "NEEDS_REDISCOVERY"] },
  { key: "source_poll_ready", path: ["sourceRegistry", "byPollState", "READY"] },
  { key: "source_poll_backoff", path: ["sourceRegistry", "byPollState", "BACKOFF"] },
  { key: "source_poll_quarantined", path: ["sourceRegistry", "byPollState", "QUARANTINED"] },
  { key: "source_tasks_pending", path: ["queues", "pendingCount"] },
  { key: "source_tasks_running", path: ["queues", "runningCount"] },
  { key: "ingestion_run_count_7d", path: ["ingestion", "windowTotals", "runCount"] },
  { key: "ingestion_success_count_7d", path: ["ingestion", "windowTotals", "successCount"] },
  { key: "ingestion_failed_count_7d", path: ["ingestion", "windowTotals", "failedCount"] },
  { key: "ingestion_accepted_7d", path: ["ingestion", "windowTotals", "acceptedCount"] },
  { key: "ingestion_created_7d", path: ["ingestion", "windowTotals", "canonicalCreatedCount"] },
  { key: "ingestion_created_per_minute_7d", path: ["ingestion", "windowTotals", "createdPerMinute"] },
];

function readPath(input: unknown, path: string[]) {
  let current = input;

  for (const part of path) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function percentDelta(before: number, delta: number) {
  if (before === 0) return null;
  return delta / before;
}

export function compareSourceIntelligenceBaselines(
  before: SourceIntelligenceBaselineLike,
  after: SourceIntelligenceBaselineLike
): SourceIntelligenceComparison {
  return {
    beforeGeneratedAt: before.generatedAt ?? null,
    afterGeneratedAt: after.generatedAt ?? null,
    metrics: COMPARISON_METRICS.map((metric) => {
      const beforeValue = toNumber(readPath(before, metric.path));
      const afterValue = toNumber(readPath(after, metric.path));
      const delta = afterValue - beforeValue;

      return {
        key: metric.key,
        before: beforeValue,
        after: afterValue,
        delta,
        percentDelta: percentDelta(beforeValue, delta),
      };
    }),
  };
}

export function formatSourceIntelligenceComparisonMarkdown(
  comparison: SourceIntelligenceComparison
) {
  const lines = [
    "# Source Intelligence Comparison",
    "",
    `Before: ${comparison.beforeGeneratedAt ?? "unknown"}`,
    `After: ${comparison.afterGeneratedAt ?? "unknown"}`,
    "",
    "| Metric | Before | After | Delta | Delta % |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...comparison.metrics.map((metric) =>
      [
        metric.key,
        formatNumber(metric.before),
        formatNumber(metric.after),
        formatSignedNumber(metric.delta),
        metric.percentDelta == null
          ? "-"
          : `${formatSignedNumber(metric.percentDelta * 100, 2)}%`,
      ].join(" | ")
    ),
    "",
  ];

  return `${lines.join("\n")}\n`;
}

function formatNumber(value: number, digits = value % 1 === 0 ? 0 : 4) {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function formatSignedNumber(value: number, digits = value % 1 === 0 ? 0 : 4) {
  const formatted = formatNumber(Math.abs(value), digits);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}
