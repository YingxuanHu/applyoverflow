import { prisma } from "@/lib/db";
import {
  createCompanySiteConnector,
  createOfficialCompanyConnector,
  createOracleCloudConnector,
  inspectCompanySiteRoute,
  parseOfficialCompanySourceToken,
} from "@/lib/ingestion/connectors";
import {
  buildCompanyDiscoveryCorpus,
  buildCompanyKey,
  cleanCompanyName,
} from "@/lib/ingestion/discovery/company-corpus";
import {
  discoverEnterpriseCareerPageCandidates,
} from "@/lib/ingestion/discovery/career-pages";
import {
  buildDiscoveredSourceName,
  createConnectorForCandidate,
  isKnownAtsHost,
  type DiscoveredSourceCandidate,
} from "@/lib/ingestion/discovery/sources";
import {
  ENTERPRISE_DISCOVERY_COMPANIES,
  type EnterpriseCompanyRecord,
} from "@/lib/ingestion/discovery/enterprise-catalog";
import { ensureCompanyRecord, assignCanonicalJobsToCompany } from "@/lib/ingestion/company-records";
import {
  seedCompaniesFromCanonicalInventory,
  seedCompanySourcesFromExistingAts,
} from "@/lib/ingestion/company-seeder";
import { upsertCompanySourceByIdentity } from "@/lib/ingestion/company-source-upsert";
import {
  ingestConnector,
  recoverStaleRunningIngestionRuns,
} from "@/lib/ingestion/pipeline";
import { validateCompanySource } from "@/lib/ingestion/source-validator";
import {
  claimSourceTasks,
  enqueueSourceTask,
  enqueueUniqueSourceTask,
  finishSourceTask,
} from "@/lib/ingestion/task-queue";
import {
  DEFAULT_ZERO_GROWTH_ACCEPTED_THRESHOLD,
  shouldDeferZeroGrowthPollSource,
} from "@/lib/ingestion/source-poll-growth-guards";
import {
  computeRetentionPriorityBoost,
  computeRetentionUrgency,
  shouldExemptFromGrowthPenalties,
} from "@/lib/ingestion/retention-poll-policy";
import {
  readBooleanEnv,
  readNonNegativeIntegerEnv,
  resolveScaledInteger,
} from "@/lib/ingestion/capacity";
import type {
  CompanyDiscoveryStatus,
  CompanySourcePollState,
  CompanySourceStatus,
  CompanySourceValidationState,
  ExtractionRouteKind,
  Prisma,
  SourceTask,
} from "@/generated/prisma/client";
import type {
  SourceConnector,
  SourceConnectorFetchResult,
  SourceConnectorJob,
} from "@/lib/ingestion/types";

const DISCOVERY_TASK_LIMIT = 200;
const SOURCE_VALIDATION_TASK_LIMIT = 500;
// Bumped 500 → 1500. Diagnostic at 271k LIVE showed ~843 validated +
// READY+ACTIVE healthy company boards (across Greenhouse / Ashby / Lever /
// Workday) that were NOT being polled within 24h because the cycle limit
// throttled at 500. The priority scorer keeps high-yield sources fresh but
// starves the long tail. With 1500/cycle and the daemon's ~5 min cadence,
// healthy boards now refresh every cycle or two instead of every 2-3 days.
// Both env vars (legacy + new) are honored to allow ops-level overrides.
const COMPANY_SOURCE_POLL_LIMIT = (() => {
  const raw =
    process.env.INGEST_COMPANY_SOURCE_POLL_LIMIT ??
    process.env.COMPANY_SOURCE_POLL_LIMIT ??
    "";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1500;
})();
const REDISCOVERY_TASK_LIMIT = 80;
const DEFAULT_SOURCE_POLL_CADENCE_MINUTES = 180;
const MAX_CAREER_PAGE_INSPECTIONS = 6;
const MAX_CAREER_PAGE_INSPECTIONS_CSV_IMPORT = 10;
const REDISCOVERY_FAILURE_THRESHOLD = 3;
const DEFAULT_COMPANY_CATALOG_SEED_LIMIT = 1_000;
const DEFAULT_COMPANY_CORPUS_SEED_LIMIT = 5_000;
const DEFAULT_COMPANY_INVENTORY_SEED_LIMIT = 8_000;
const DEFAULT_EXISTING_ATS_SEED_LIMIT = 2_000;
const IN_RECOVERY_MODE = process.env.INGEST_RECOVERY_MODE === "1";
const GROWTH_MODE_ENABLED = readBooleanEnv("INGEST_GROWTH_MODE") === true;
const DEFAULT_FRONTIER_ONLY_POLLING = readBooleanEnv("INGEST_FRONTIER_POLL_ONLY") === true;
const SKIP_GENERIC_COMPANY_SITE_POLLS =
  readBooleanEnv("INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS") === true;
const DISCOVERY_QUEUE_CONCURRENCY = resolveScaledInteger({
  base: 24,
  absoluteMax: 72,
  explicitEnvName: "INGEST_DISCOVERY_QUEUE_CONCURRENCY",
});
const SOURCE_VALIDATION_QUEUE_CONCURRENCY = resolveScaledInteger({
  base: 32,
  absoluteMax: 96,
  explicitEnvName: "INGEST_SOURCE_VALIDATION_QUEUE_CONCURRENCY",
});
const COMPANY_SOURCE_POLL_CONCURRENCY = resolveScaledInteger({
  base: 32,
  absoluteMax: 96,
  explicitEnvName: "INGEST_SOURCE_POLL_CONCURRENCY",
});
const COMPANY_SOURCE_POLL_RECOVERY_CONCURRENCY = resolveScaledInteger({
  base: 10,
  absoluteMax: 24,
  explicitEnvName: "INGEST_SOURCE_POLL_RECOVERY_CONCURRENCY",
});
const EFFECTIVE_COMPANY_SOURCE_POLL_CONCURRENCY = IN_RECOVERY_MODE
  ? Math.min(
      COMPANY_SOURCE_POLL_CONCURRENCY,
      COMPANY_SOURCE_POLL_RECOVERY_CONCURRENCY
    )
  : COMPANY_SOURCE_POLL_CONCURRENCY;
const COMPANY_SOURCE_POLL_LOW_TIME_CONCURRENCY = Math.max(
  2,
  Math.min(
    8,
    Math.floor(EFFECTIVE_COMPANY_SOURCE_POLL_CONCURRENCY / 2)
  )
);
const COMPANY_SOURCE_POLL_CRITICAL_TIME_CONCURRENCY = Math.max(
  1,
  Math.min(
    3,
    Math.floor(EFFECTIVE_COMPANY_SOURCE_POLL_CONCURRENCY / 4)
  )
);
const HARD_FAILURE_REDISCOVERY_THRESHOLD = 2;
const WORKDAY_BLOCKED_REDISCOVERY_THRESHOLD = 2;
const WORKDAY_TIER_A_VALUE_SCORE = 60;
const WORKDAY_TIER_B_VALUE_SCORE = 20;
const EXTERNAL_FRONTIER_SEED_SOURCES = new Set([
  "companies-house",
  "opencorporates",
  "github-org",
  "sec-edgar",
]);
const INTERNAL_FRONTIER_SEED_SOURCES = new Set([
  "internal-corpus",
  "existing-corpus",
]);
// Per-cycle cap on how many sources of a given connector can be polled.
// Workday's myworkdayjobs.com infrastructure rate-limits aggressively — hitting
// many tenants simultaneously triggers Cloudflare bot detection for all of them.
// Taleo is also intentionally capped because its headless+sitemap fallback path
// is much slower than the ATS APIs and can monopolize the cycle.
function readConnectorPollCycleCapEnv(
  envName: string,
  fallback: number
) {
  const raw = process.env[envName]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getConnectorPollCycleCapEnvName(connectorName: string) {
  return `${connectorName.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_CONNECTOR_POLL_CYCLE_CAP`;
}

const RECOVERY_CONNECTOR_POLL_CYCLE_CAPS: Record<string, number> = {
  ashby: 1,
  greenhouse: 1,
  icims: 1,
  jobvite: 1,
  lever: 1,
  smartrecruiters: 1,
  successfactors: 1,
  taleo: 1,
  workable: 1,
  workday: 1,
};

const CONNECTOR_POLL_CYCLE_CAPS: Record<string, number> = {
  "company-site": readConnectorPollCycleCapEnv(
    getConnectorPollCycleCapEnvName("company-site"),
    IN_RECOVERY_MODE ? 2 : 24
  ),
  workday: readConnectorPollCycleCapEnv(
    "WORKDAY_CONNECTOR_POLL_CYCLE_CAP",
    IN_RECOVERY_MODE ? RECOVERY_CONNECTOR_POLL_CYCLE_CAPS.workday : 4
  ),
  taleo: readConnectorPollCycleCapEnv(
    "TALEO_CONNECTOR_POLL_CYCLE_CAP",
    IN_RECOVERY_MODE ? RECOVERY_CONNECTOR_POLL_CYCLE_CAPS.taleo : 2
  ),
  ashby: readConnectorPollCycleCapEnv(
    getConnectorPollCycleCapEnvName("ashby"),
    IN_RECOVERY_MODE ? RECOVERY_CONNECTOR_POLL_CYCLE_CAPS.ashby : Number.MAX_SAFE_INTEGER
  ),
  greenhouse: readConnectorPollCycleCapEnv(
    getConnectorPollCycleCapEnvName("greenhouse"),
    IN_RECOVERY_MODE
      ? RECOVERY_CONNECTOR_POLL_CYCLE_CAPS.greenhouse
      : Number.MAX_SAFE_INTEGER
  ),
  icims: readConnectorPollCycleCapEnv(
    getConnectorPollCycleCapEnvName("icims"),
    IN_RECOVERY_MODE ? RECOVERY_CONNECTOR_POLL_CYCLE_CAPS.icims : Number.MAX_SAFE_INTEGER
  ),
  jobvite: readConnectorPollCycleCapEnv(
    getConnectorPollCycleCapEnvName("jobvite"),
    IN_RECOVERY_MODE ? RECOVERY_CONNECTOR_POLL_CYCLE_CAPS.jobvite : Number.MAX_SAFE_INTEGER
  ),
  lever: readConnectorPollCycleCapEnv(
    getConnectorPollCycleCapEnvName("lever"),
    IN_RECOVERY_MODE ? RECOVERY_CONNECTOR_POLL_CYCLE_CAPS.lever : Number.MAX_SAFE_INTEGER
  ),
  smartrecruiters: readConnectorPollCycleCapEnv(
    getConnectorPollCycleCapEnvName("smartrecruiters"),
    IN_RECOVERY_MODE ? RECOVERY_CONNECTOR_POLL_CYCLE_CAPS.smartrecruiters : 2
  ),
  successfactors: readConnectorPollCycleCapEnv(
    getConnectorPollCycleCapEnvName("successfactors"),
    IN_RECOVERY_MODE
      ? RECOVERY_CONNECTOR_POLL_CYCLE_CAPS.successfactors
      : Number.MAX_SAFE_INTEGER
  ),
  workable: readConnectorPollCycleCapEnv(
    getConnectorPollCycleCapEnvName("workable"),
    IN_RECOVERY_MODE ? RECOVERY_CONNECTOR_POLL_CYCLE_CAPS.workable : 3
  ),
  recruitee: readConnectorPollCycleCapEnv(
    getConnectorPollCycleCapEnvName("recruitee"),
    IN_RECOVERY_MODE ? 1 : 8
  ),
};

const CONNECTOR_POLL_RUNTIME_CYCLE_CAPS: Record<string, number> = {
  "company-site": readConnectorPollCycleCapEnv(
    "COMPANY_SITE_CONNECTOR_POLL_RUNTIME_CYCLE_CAP",
    IN_RECOVERY_MODE ? 2 : 24
  ),
  recruitee: readConnectorPollCycleCapEnv(
    "RECRUITEE_CONNECTOR_POLL_RUNTIME_CYCLE_CAP",
    IN_RECOVERY_MODE ? 1 : 8
  ),
  taleo: readConnectorPollCycleCapEnv(
    "TALEO_CONNECTOR_POLL_RUNTIME_CYCLE_CAP",
    IN_RECOVERY_MODE ? 1 : 2
  ),
  workday: readConnectorPollCycleCapEnv(
    "WORKDAY_CONNECTOR_POLL_RUNTIME_CYCLE_CAP",
    IN_RECOVERY_MODE ? 1 : 4
  ),
  smartrecruiters: readConnectorPollCycleCapEnv(
    "SMARTRECRUITERS_CONNECTOR_POLL_RUNTIME_CYCLE_CAP",
    IN_RECOVERY_MODE ? 1 : 2
  ),
  workable: readConnectorPollCycleCapEnv(
    "WORKABLE_CONNECTOR_POLL_RUNTIME_CYCLE_CAP",
    IN_RECOVERY_MODE ? 1 : 3
  ),
};

const CONNECTOR_POLL_RUNTIME_BATCH_CAPS: Record<string, number> = {
  recruitee: readConnectorPollCycleCapEnv(
    "RECRUITEE_CONNECTOR_POLL_RUNTIME_BATCH_CAP",
    IN_RECOVERY_MODE ? 1 : 1
  ),
  workable: readConnectorPollCycleCapEnv(
    "WORKABLE_CONNECTOR_POLL_RUNTIME_BATCH_CAP",
    IN_RECOVERY_MODE ? 1 : 1
  ),
};

function getRuntimeCycleExhaustedConnectorNames(connectorCounts: Map<string, number>) {
  return Object.entries(CONNECTOR_POLL_RUNTIME_CYCLE_CAPS)
    .filter(([, cap]) => cap !== Number.MAX_SAFE_INTEGER)
    .filter(([connectorName, cap]) => (connectorCounts.get(connectorName) ?? 0) >= cap)
    .map(([connectorName]) => connectorName);
}

const CONNECTOR_POLL_BATCH_OVERFLOW_RETRY_MS = 90 * 1000;
const CONNECTOR_POLL_CYCLE_OVERFLOW_RETRY_MS = 15 * 60 * 1000;
// Per-source connector runtime cap (passed to ingestConnector).
// Kept below the stale-run recovery windows so a slow source fails within the
// same cycle instead of lingering as RUNNING into the next one.
const COMPANY_SOURCE_POLL_MAX_RUNTIME_MS = 5 * 60 * 1000;
// Wall-clock cap for the entire poll queue across all batches.
// With the daemon running every 10 minutes in dev and every 30 minutes in the
// standalone script, letting source polling consume 25+ minutes starves the
// rest of the cycle. Keep this tighter and adapt batch runtime as the queue
// approaches the deadline.
// 2026-04-18: Bumped 12min -> 30min during rebuild. Source-poll is the
// throughput bottleneck (only 118 CONNECTOR_POLL/hr across 4 workers) and the
// 12min cap was causing cycles to exit after only 4-7/38 successes. The
// surrounding cycle work (discovery/validation/rediscovery) is tiny relative
// to the 2k+ pending poll backlog, so giving source-poll the lion's share of
// cycle time is the right trade-off until the backlog burns down.
const COMPANY_SOURCE_POLL_QUEUE_WALL_CLOCK_MS = 30 * 60 * 1000;
const COMPANY_SOURCE_POLL_MIN_REMAINING_BUDGET_MS = 90 * 1000;
const COMPANY_SOURCE_POLL_BATCH_GRACE_MS = 90 * 1000;
const COMPANY_SOURCE_POLL_LATE_STAGE_WINDOW_MS = 5 * 60 * 1000;
const COMPANY_SOURCE_POLL_END_STAGE_WINDOW_MS = 2 * 60 * 1000;
const COMPANY_SOURCE_STALE_RUN_RECOVERY_INTERVAL_MS = 60 * 1000;
const COMPANY_SOURCE_POLL_ADMISSION_BUDGET_RATIO = 0.88;
const COMPANY_SOURCE_POLL_SOFT_STOP_RATIO = 0.88;
// Share of the poll admission budget reserved for the deadline-driven
// retention lane (sources whose retained live jobs are approaching the feed's
// 14-day evidence window). Ordered earliest-deadline-first, so re-confirmation
// polls cannot be starved by novelty/efficiency ordering.
const RETENTION_ADMISSION_BUDGET_RATIO = (() => {
  const parsed = Number.parseFloat(
    process.env.INGEST_RETENTION_ADMISSION_BUDGET_RATIO ?? ""
  );
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.35;
})();

const COMPANY_SOURCE_POLL_TIER_1_BUDGET_RATIO = 0.65;
const COMPANY_SOURCE_POLL_TIER_2_BUDGET_RATIO = 0.25;
const COMPANY_SOURCE_POLL_TIER_3_BUDGET_RATIO = 0.1;
const COMPANY_SOURCE_RECENT_YIELD_LOOKBACK_DAYS = 7;
const COMPANY_SOURCE_RECOVERY_ZERO_YIELD_SUCCESS_THRESHOLD = 3;
const COMPANY_SOURCE_RECOVERY_LOW_NOVELTY_RATIO = 0.08;
const COMPANY_SOURCE_RECOVERY_LOW_NOVELTY_ACCEPTED_THRESHOLD = 25;
const COMPANY_SOURCE_RECOVERY_SUPPRESSED_ATS_DEFER_MINUTES = 180;
const COMPANY_SOURCE_SLOW_LOW_YIELD_COOLDOWN_HOURS = Math.max(
  2,
  readNonNegativeIntegerEnv("INGEST_SLOW_LOW_YIELD_COOLDOWN_HOURS") ?? 12
);
const COMPANY_SOURCE_ZERO_YIELD_BACKOFF_SUCCESS_THRESHOLD = Math.max(
  3,
  readNonNegativeIntegerEnv("INGEST_ZERO_YIELD_BACKOFF_SUCCESS_THRESHOLD") ?? 5
);
const COMPANY_SOURCE_ZERO_YIELD_BACKOFF_HOURS = Math.max(
  6,
  readNonNegativeIntegerEnv("INGEST_ZERO_YIELD_BACKOFF_HOURS") ?? 24
);
const COMPANY_SOURCE_TIMEOUT_ZERO_CREATE_COOLDOWN_HOURS = Math.max(
  2,
  readNonNegativeIntegerEnv("INGEST_TIMEOUT_ZERO_CREATE_COOLDOWN_HOURS") ?? 6
);
const COMPANY_SOURCE_TIMEOUT_HEAVY_ZERO_CREATE_COOLDOWN_HOURS = Math.max(
  COMPANY_SOURCE_TIMEOUT_ZERO_CREATE_COOLDOWN_HOURS,
  readNonNegativeIntegerEnv("INGEST_TIMEOUT_HEAVY_ZERO_CREATE_COOLDOWN_HOURS") ?? 12
);
const COMPANY_SOURCE_TIMEOUT_ZERO_CREATE_ACCEPTED_THRESHOLD = Math.max(
  10,
  readNonNegativeIntegerEnv("INGEST_TIMEOUT_ZERO_CREATE_ACCEPTED_THRESHOLD") ?? 25
);
const COMPANY_SOURCE_TIMEOUT_HEAVY_ZERO_CREATE_ACCEPTED_THRESHOLD = Math.max(
  COMPANY_SOURCE_TIMEOUT_ZERO_CREATE_ACCEPTED_THRESHOLD,
  readNonNegativeIntegerEnv("INGEST_TIMEOUT_HEAVY_ZERO_CREATE_ACCEPTED_THRESHOLD") ?? 100
);
const COMPANY_SOURCE_SLOW_LOW_YIELD_MIN_RUNS = Math.max(
  2,
  readNonNegativeIntegerEnv("INGEST_SLOW_LOW_YIELD_MIN_RUNS") ?? 2
);
const COMPANY_SOURCE_SLOW_LOW_YIELD_MIN_RUNTIME_MS = Math.max(
  15_000,
  readNonNegativeIntegerEnv("INGEST_SLOW_LOW_YIELD_MIN_RUNTIME_MS") ?? 45_000
);
const COMPANY_SOURCE_SLOW_LOW_YIELD_MAX_CREATED_PER_MINUTE =
  Math.max(
    0,
    Math.min(
      100,
      readNonNegativeIntegerEnv("INGEST_SLOW_LOW_YIELD_MAX_CREATED_PER_100_MINUTES") ?? 5
    )
  ) / 100;
const COMPANY_SOURCE_ZERO_GROWTH_ACCEPTED_THRESHOLD = Math.max(
  5,
  readNonNegativeIntegerEnv("INGEST_ZERO_GROWTH_PENDING_ACCEPTED_THRESHOLD") ??
    DEFAULT_ZERO_GROWTH_ACCEPTED_THRESHOLD
);
const GROWTH_FRONTIER_WINDOW_HOURS = Math.max(
  24,
  readNonNegativeIntegerEnv("INGEST_GROWTH_FRONTIER_WINDOW_HOURS") ?? 120
);
const GROWTH_LOW_NOVELTY_RATIO =
  Math.max(
    1,
    Math.min(
      25,
      readNonNegativeIntegerEnv("INGEST_GROWTH_LOW_NOVELTY_RATIO_PERCENT") ?? 4
    )
  ) / 100;
const GROWTH_LOW_NOVELTY_ACCEPTED_THRESHOLD = Math.max(
  25,
  readNonNegativeIntegerEnv("INGEST_GROWTH_LOW_NOVELTY_ACCEPTED_THRESHOLD") ?? 50
);
const GROWTH_FRONTIER_PRIORITY_BOOST = Math.max(
  0,
  readNonNegativeIntegerEnv("INGEST_GROWTH_FRONTIER_PRIORITY_BOOST") ?? 220
);
const GROWTH_NON_FRONTIER_PRIORITY_PENALTY = Math.max(
  0,
  readNonNegativeIntegerEnv("INGEST_GROWTH_NON_FRONTIER_PRIORITY_PENALTY") ?? 45
);
const GROWTH_REFRESH_HEAVY_PRIORITY_PENALTY = Math.max(
  0,
  readNonNegativeIntegerEnv("INGEST_GROWTH_REFRESH_HEAVY_PRIORITY_PENALTY") ?? 220
);
const GROWTH_HARD_COOLDOWN_HOURS = Math.max(
  6,
  readNonNegativeIntegerEnv("INGEST_GROWTH_HARD_COOLDOWN_HOURS") ?? 24
);
const GROWTH_CHURN_HEAVY_REMOVED_THRESHOLD = Math.max(
  10,
  readNonNegativeIntegerEnv("INGEST_GROWTH_CHURN_HEAVY_REMOVED_THRESHOLD") ?? 50
);
const GROWTH_CHURN_HEAVY_REMOVED_TO_CREATED_RATIO =
  Math.max(
    100,
    readNonNegativeIntegerEnv("INGEST_GROWTH_CHURN_HEAVY_REMOVED_TO_CREATED_RATIO_X100") ??
      200
  ) / 100;
const GROWTH_CHURN_HEAVY_COOLDOWN_HOURS = Math.max(
  2,
  readNonNegativeIntegerEnv("INGEST_GROWTH_CHURN_HEAVY_COOLDOWN_HOURS") ?? 8
);
const GROWTH_CHURN_HEAVY_PRIORITY_PENALTY = Math.max(
  0,
  readNonNegativeIntegerEnv("INGEST_GROWTH_CHURN_HEAVY_PRIORITY_PENALTY") ?? 380
);
const GROWTH_SOURCE_QUERY_MULTIPLIER = Math.max(
  3,
  readNonNegativeIntegerEnv("INGEST_GROWTH_SOURCE_QUERY_MULTIPLIER") ?? 8
);
const PRODUCTIVE_SOURCE_BACKFILL_QUERY_LIMIT = Math.max(
  500,
  readNonNegativeIntegerEnv("INGEST_PRODUCTIVE_SOURCE_BACKFILL_QUERY_LIMIT") ?? 2_500
);
const PRODUCTIVE_SOURCE_BACKFILL_LIMIT = Math.max(
  50,
  readNonNegativeIntegerEnv("INGEST_PRODUCTIVE_SOURCE_BACKFILL_LIMIT") ?? 600
);
const OFFICIAL_COMPANY_SOURCE_POLL_LIMIT = Math.max(
  100,
  readNonNegativeIntegerEnv("OFFICIAL_COMPANY_SOURCE_POLL_LIMIT") ?? 500
);
const BANK_OF_AMERICA_OFFICIAL_SOURCE_POLL_LIMIT = Math.max(
  50,
  readNonNegativeIntegerEnv("BANK_OF_AMERICA_OFFICIAL_SOURCE_POLL_LIMIT") ?? 100
);
const EIGHTFOLD_OFFICIAL_SOURCE_POLL_LIMIT = Math.max(
  50,
  readNonNegativeIntegerEnv("EIGHTFOLD_OFFICIAL_SOURCE_POLL_LIMIT") ?? 100
);
const FRONTIER_POLL_SLICE_CONCURRENCY = Math.max(
  1,
  Math.min(4, readNonNegativeIntegerEnv("INGEST_FRONTIER_POLL_SLICE_CONCURRENCY") ?? 2)
);
const COMPANY_SOURCE_POLL_PREVIEW_MULTIPLIER = 3;
const COMPANY_SOURCE_POLL_DEFER_TIER_2_MINUTES = 10;
const COMPANY_SOURCE_POLL_DEFER_TIER_3_MINUTES = 30;
const WORKDAY_HOST_BLOCK_STREAK_THRESHOLD = 3;
const WORKDAY_HOST_COOLDOWN_HOURS = 12;
const WORKDAY_BLOCKED_HTTP_STATUSES = new Set([401, 403, 429, 500, 502, 503, 504]);
const DETERMINISTIC_ATS_HARD_INVALID_CONNECTORS = new Set([
  "greenhouse",
  "lever",
  "ashby",
]);
const PRODUCTIVE_IMPORTED_POLL_CONNECTORS = new Set([
  "greenhouse",
  "lever",
  "ashby",
]);
const LOW_SIGNAL_IMPORTED_POLL_CONNECTORS = new Set([
  "workable",
  "smartrecruiters",
  "workday",
  "successfactors",
  "icims",
  "recruitee",
]);
const TIER_1_POLL_CONNECTORS = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "jobvite",
  "teamtailor",
]);
const TIER_1_CONDITIONAL_CONNECTORS = new Set([
  "icims",
]);
const GROWTH_REFRESH_HEAVY_SOURCE_TYPES = new Set([
  "ATS",
  "COMPANY_JSON",
  "COMPANY_HTML",
]);

function isCompanySourceOverdueForPoll(
  source: {
    createdAt: Date;
    updatedAt: Date;
    lastSuccessfulPollAt: Date | null;
    pollingCadenceMinutes: number | null;
  },
  now: Date
) {
  const cadenceMinutes =
    source.pollingCadenceMinutes ?? DEFAULT_SOURCE_POLL_CADENCE_MINUTES;
  const lastPollReference =
    source.lastSuccessfulPollAt ?? source.updatedAt ?? source.createdAt;

  return (
    now.getTime() - lastPollReference.getTime() >=
    Math.max(30, cadenceMinutes) * 60 * 1000
  );
}

// 2026-04-16: Raised defaults + hard caps for the top TIME_BUDGET offenders
// (ashby/greenhouse/lever/workday). Big tenants like Coinbase, Affirm, Salesforce
// Workday, etc. legitimately need more time for per-job detail fetches.
// Trade-off: longer max cycle time, but fewer FAILED runs with live=0.
const DEFAULT_CONNECTOR_POLL_RUNTIME_MS: Record<string, number> = {
  ashby: 40_000,
  "company-site": 55_000,
  greenhouse: 30_000,
  icims: 34_000,
  jobvite: 24_000,
  lever: 30_000,
  recruitee: 18_000,
  rippling: 16_000,
  smartrecruiters: 30_000,
  successfactors: 42_000,
  oraclecloud: 150_000,
  taleo: 70_000,
  teamtailor: 24_000,
  workable: 24_000,
  workday: 90_000,
};
// 2026-04-18: Halved/shrunk hard caps for top TIME_BUDGET offenders during the
// rebuild. Slow polls (ashby/workday/taleo) were burning the full wall-clock
// budget and starving the queue — cycles processed only 4-7/38 tasks before
// hitting the cap. Failing-fast on these unlocks 3-5x more polls per cycle.
// Hard caps are still >= 1.5x the DEFAULT soft budget so healthy polls finish.
const HARD_CONNECTOR_POLL_TIMEOUT_MS: Record<string, number> = {
  ashby: 35_000,
  greenhouse: 35_000,
  icims: 35_000,
  jobvite: 40_000,
  lever: 35_000,
  recruitee: 25_000,
  rippling: 30_000,
  smartrecruiters: 35_000,
  successfactors: 45_000,
  oraclecloud: 180_000,
  taleo: 60_000,
  teamtailor: 45_000,
  workable: 30_000,
  workday: 45_000,
  "company-site": 45_000,
  // First-party official connectors can legitimately enumerate thousands of
  // jobs through checkpointed APIs. Keep them within the queue-wide cap, but
  // do not force the generic 90s fallback timeout used for unknown connectors.
  "official-company": 5 * 60_000,
};

const GROWTH_HARD_CONNECTOR_POLL_TIMEOUT_MS: Record<string, number> = {
  ashby: 120_000,
  greenhouse: 120_000,
  icims: 120_000,
  jobvite: 90_000,
  lever: 90_000,
  recruitee: 60_000,
  rippling: 60_000,
  smartrecruiters: 90_000,
  successfactors: 90_000,
  oraclecloud: 240_000,
  taleo: 90_000,
  teamtailor: 75_000,
  workable: 75_000,
  workday: 120_000,
  "company-site": 90_000,
  "official-company": 5 * 60_000,
};

type PollTier = "TIER_1" | "TIER_2" | "TIER_3";

type WorkdayHostMetrics = {
  host: string;
  avgRuntimeMs: number | null;
  blockedSourceCount: number;
  blockedStreak: number;
  cooldownUntil: Date | null;
  recentSuccessCount: number;
};

type RecentSourceYieldMetrics = {
  sourceName: string;
  canonicalCreatedCount7d: number;
  removedCount7d: number;
  acceptedCount7d: number;
  runCount7d: number;
  canonicalCreatedCount24h: number;
  acceptedCount24h: number;
  runCount24h: number;
};

type PollVelocitySignals = {
  createdPerMinute7d: number;
  acceptedPerMinute7d: number;
  duplicateRate: number;
  failureRate: number;
};

function clampScore(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampSourceQualityScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return clampScore(value, 0, 1);
}

function computeSourceYieldScore(input: {
  sourceQualityScore: number;
  pollAttemptCount: number;
  pollSuccessCount: number;
  jobsFetchedCount: number;
  jobsAcceptedCount: number;
  jobsCreatedCount: number;
  retainedLiveJobCount: number;
  overlapRatio: number | null;
}) {
  const successRate =
    input.pollAttemptCount > 0
      ? input.pollSuccessCount / input.pollAttemptCount
      : 0;
  const acceptanceRate =
    input.jobsFetchedCount > 0
      ? input.jobsAcceptedCount / input.jobsFetchedCount
      : 0;
  const creationRate =
    input.jobsFetchedCount > 0
      ? input.jobsCreatedCount / input.jobsFetchedCount
      : 0;
  const retainedRate =
    input.jobsAcceptedCount > 0
      ? input.retainedLiveJobCount / input.jobsAcceptedCount
      : input.jobsCreatedCount > 0
        ? input.retainedLiveJobCount / input.jobsCreatedCount
        : 0;
  const acceptedPerSuccessfulPoll =
    input.pollSuccessCount > 0 ? input.jobsAcceptedCount / input.pollSuccessCount : 0;
  const createdPerSuccessfulPoll =
    input.pollSuccessCount > 0 ? input.jobsCreatedCount / input.pollSuccessCount : 0;
  const retainedPerSuccessfulPoll =
    input.pollSuccessCount > 0
      ? input.retainedLiveJobCount / input.pollSuccessCount
      : 0;
  const overlapPenalty = input.overlapRatio ?? 0;

  return clampScore(
    input.sourceQualityScore * 0.22 +
      successRate * 0.16 +
      acceptanceRate * 0.08 +
      creationRate * 0.12 +
      Math.min(1, acceptedPerSuccessfulPoll / 175) * 0.08 +
      Math.min(1, createdPerSuccessfulPoll / 20) * 0.20 +
      Math.min(1, retainedPerSuccessfulPoll / 125) * 0.16 +
      retainedRate * 0.10 -
      overlapPenalty * 0.08,
    0.01,
    0.99
  );
}

function computeValidationPriorityScore(input: {
  now: Date;
  priorityScore: number;
  sourceQualityScore: number;
  yieldScore: number;
  discoveryConfidence: number;
  historicalYield: number;
  validationState: string;
  consecutiveFailures: number;
  validationAttemptCount: number;
  validationSuccessCount: number;
  sourceType: string | null;
  parserVersion: string | null;
  metadataJson: Prisma.JsonValue | null | undefined;
  companyMetadataJson: Prisma.JsonValue | null | undefined;
  createdAt: Date | null | undefined;
  updatedAt: Date | null | undefined;
}) {
  const validationSuccessRate =
    input.validationAttemptCount > 0
      ? input.validationSuccessCount / input.validationAttemptCount
      : 0;
  const csvImportBoost =
    input.parserVersion === "csv-import:v1" && input.sourceType === "ATS" ? 18 : 0;
  const structuredCompanySiteBoost =
    input.sourceType === "COMPANY_JSON" &&
    Boolean(input.parserVersion?.startsWith("company-site:"))
      ? 16
      : 0;
  const growthFrontier = isGrowthFrontierCandidate({
    now: input.now,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    pollAttemptCount: input.validationAttemptCount,
    sourceType: input.sourceType,
    metadataJson: input.metadataJson,
    companyMetadataJson: input.companyMetadataJson,
  });
  const growthPriorityAdjustment = GROWTH_MODE_ENABLED
    ? growthFrontier.frontierCandidate
      ? GROWTH_FRONTIER_PRIORITY_BOOST
      : -Math.round(GROWTH_NON_FRONTIER_PRIORITY_PENALTY * 0.5)
    : 0;

  return (
    Math.round(input.priorityScore * 100) / 100 +
    Math.round(input.sourceQualityScore * 45) +
    Math.round(input.yieldScore * 35) +
    Math.min(35, input.historicalYield * 1.25) +
    (input.validationState === "UNVALIDATED" ? 40 : 0) +
    (input.validationState === "SUSPECT" ? 20 : 0) +
    (input.validationState === "NEEDS_REDISCOVERY" ? 10 : 0) +
    csvImportBoost +
    structuredCompanySiteBoost +
    growthPriorityAdjustment +
    Math.round(validationSuccessRate * 20) -
    Math.max(0, input.consecutiveFailures * 5) +
    Math.round(input.discoveryConfidence * 10)
  );
}

function computeNoveltyRatio(input: {
  canonicalCreatedCount7d: number;
  acceptedCount7d: number;
  jobsCreatedCount: number;
  jobsAcceptedCount: number;
  lastJobsCreatedCount: number;
  lastJobsAcceptedCount: number;
}) {
  const recentRatio =
    input.acceptedCount7d > 0
      ? input.canonicalCreatedCount7d / input.acceptedCount7d
      : input.canonicalCreatedCount7d > 0
        ? 1
        : 0;
  const historicalRatio =
    input.jobsAcceptedCount > 0
      ? input.jobsCreatedCount / input.jobsAcceptedCount
      : input.jobsCreatedCount > 0
        ? 1
        : 0;
  const lastRatio =
    input.lastJobsAcceptedCount > 0
      ? input.lastJobsCreatedCount / input.lastJobsAcceptedCount
      : input.lastJobsCreatedCount > 0
        ? 1
        : 0;

  return clampScore(
    recentRatio * 0.6 + historicalRatio * 0.25 + lastRatio * 0.15,
    0,
    1
  );
}

function computePollVelocitySignals(input: {
  recentCanonicalCreatedCount: number;
  recentAcceptedCount: number;
  recentRunCount: number;
  estimatedRuntimeMs: number;
  pollAttemptCount: number;
  pollSuccessCount: number;
  jobsFetchedCount: number;
  jobsDedupedCount: number;
}) {
  const estimatedRecentRuntimeMinutes =
    (input.recentRunCount * Math.max(input.estimatedRuntimeMs, 1)) / 60_000;
  const createdPerMinute7d =
    estimatedRecentRuntimeMinutes > 0
      ? input.recentCanonicalCreatedCount / estimatedRecentRuntimeMinutes
      : 0;
  const acceptedPerMinute7d =
    estimatedRecentRuntimeMinutes > 0
      ? input.recentAcceptedCount / estimatedRecentRuntimeMinutes
      : 0;
  const duplicateRate =
    input.jobsFetchedCount > 0
      ? clampScore(input.jobsDedupedCount / input.jobsFetchedCount, 0, 1)
      : 0;
  const failureRate =
    input.pollAttemptCount > 0
      ? clampScore(
          (input.pollAttemptCount - input.pollSuccessCount) / input.pollAttemptCount,
          0,
          1
        )
      : 0;

  return {
    createdPerMinute7d,
    acceptedPerMinute7d,
    duplicateRate,
    failureRate,
  } satisfies PollVelocitySignals;
}

function shouldSuppressRecoveryAtsSource(input: {
  sourceType: string | null;
  pollSuccessCount: number;
  recentAcceptedCount: number;
  recentCanonicalCreatedCount: number;
  jobsAcceptedCount: number;
  jobsCreatedCount: number;
  lastJobsCreatedCount: number;
  noveltyRatio: number;
}) {
  if (!IN_RECOVERY_MODE || input.sourceType !== "ATS") {
    return false;
  }

  const hasRecentSignal =
    input.pollSuccessCount >= COMPANY_SOURCE_RECOVERY_ZERO_YIELD_SUCCESS_THRESHOLD ||
    input.recentAcceptedCount >= COMPANY_SOURCE_RECOVERY_LOW_NOVELTY_ACCEPTED_THRESHOLD;
  const historicalNoveltyRatio =
    input.jobsAcceptedCount > 0
      ? input.jobsCreatedCount / input.jobsAcceptedCount
      : input.jobsCreatedCount > 0
        ? 1
        : 0;

  if (!hasRecentSignal && input.pollSuccessCount < 10) {
    return false;
  }

  if (
    input.recentAcceptedCount >= 50 &&
    input.recentCanonicalCreatedCount === 0 &&
    input.lastJobsCreatedCount === 0
  ) {
    return true;
  }

  if (
    input.recentAcceptedCount >= 100 &&
    input.recentCanonicalCreatedCount <= 1 &&
    input.noveltyRatio < 0.03
  ) {
    return true;
  }

  if (
    input.recentAcceptedCount >= 200 &&
    input.recentCanonicalCreatedCount <= 2 &&
    input.noveltyRatio < 0.05
  ) {
    return true;
  }

  if (
    input.pollSuccessCount >= 10 &&
    input.jobsAcceptedCount >= 500 &&
    historicalNoveltyRatio < 0.03 &&
    input.lastJobsCreatedCount === 0
  ) {
    return true;
  }

  if (
    input.pollSuccessCount >= 20 &&
    input.jobsAcceptedCount >= 1000 &&
    historicalNoveltyRatio < 0.05
  ) {
    return true;
  }

  return false;
}

function shouldCooldownSlowLowYieldSource(input: {
  connectorName: string;
  sourceType: string | null;
  pollAttemptCount: number;
  pollSuccessCount: number;
  lastJobsCreatedCount: number;
  retainedLiveJobCount: number;
  recentCanonicalCreatedCount: number;
  recentAcceptedCount: number;
  recentRunCount: number;
  estimatedRuntimeMs: number;
  blockedRisk: number;
  velocitySignals: PollVelocitySignals;
  frontierCandidate: boolean;
}) {
  if (input.frontierCandidate || input.pollAttemptCount < 3) {
    return false;
  }

  const enoughRecentRuns =
    input.recentRunCount >= COMPANY_SOURCE_SLOW_LOW_YIELD_MIN_RUNS ||
    input.pollSuccessCount >= COMPANY_SOURCE_SLOW_LOW_YIELD_MIN_RUNS + 1;
  if (!enoughRecentRuns) {
    return false;
  }

  const slowOrRisky =
    input.estimatedRuntimeMs >= COMPANY_SOURCE_SLOW_LOW_YIELD_MIN_RUNTIME_MS ||
    input.connectorName === "taleo" ||
    input.connectorName === "workday" ||
    input.connectorName === "company-site" ||
    input.sourceType === "COMPANY_HTML" ||
    input.blockedRisk >= 0.6;
  if (!slowOrRisky) {
    return false;
  }

  const effectivelyNoNewJobs =
    input.recentCanonicalCreatedCount <= 1 &&
    input.lastJobsCreatedCount === 0 &&
    input.velocitySignals.createdPerMinute7d <=
      COMPANY_SOURCE_SLOW_LOW_YIELD_MAX_CREATED_PER_MINUTE;
  if (!effectivelyNoNewJobs) {
    return false;
  }

  const highDuplicateRefresh =
    input.recentAcceptedCount >= 50 &&
    input.velocitySignals.duplicateRate >= 0.75 &&
    input.retainedLiveJobCount > 0;
  const mostlyFailing =
    input.velocitySignals.failureRate >= 0.6 || input.blockedRisk >= 0.75;
  const emptySlowPolls = input.recentAcceptedCount === 0 && input.pollSuccessCount >= 2;

  return highDuplicateRefresh || mostlyFailing || emptySlowPolls || input.sourceType === "COMPANY_HTML";
}

function computePollPriorityScore(input: {
  now: Date;
  connectorName: string;
  priorityScore: number;
  sourceQualityScore: number;
  yieldScore: number;
  discoveryConfidence: number;
  historicalYield: number;
  status: string;
  consecutiveFailures: number;
  pollAttemptCount: number;
  pollSuccessCount: number;
  jobsAcceptedCount: number;
  jobsCreatedCount: number;
  lastJobsAcceptedCount: number;
  lastJobsCreatedCount: number;
  retainedLiveJobCount: number;
  recentCanonicalCreatedCount: number;
  recentAcceptedCount: number;
  sourceType: string | null;
  parserVersion: string | null;
  metadataJson: Prisma.JsonValue | null | undefined;
  companyMetadataJson: Prisma.JsonValue | null | undefined;
  createdAt: Date | null | undefined;
  updatedAt: Date | null | undefined;
  lastSuccessfulPollAt: Date | null | undefined;
}) {
  const pollSuccessRate =
    input.pollAttemptCount > 0
      ? input.pollSuccessCount / input.pollAttemptCount
      : 0;
  const acceptedPerSuccessfulPoll =
    input.pollSuccessCount > 0 ? input.jobsAcceptedCount / input.pollSuccessCount : 0;
  const createdPerSuccessfulPoll =
    input.pollSuccessCount > 0 ? input.jobsCreatedCount / input.pollSuccessCount : 0;
  const noveltyRatio = computeNoveltyRatio({
    canonicalCreatedCount7d: input.recentCanonicalCreatedCount,
    acceptedCount7d: input.recentAcceptedCount,
    jobsCreatedCount: input.jobsCreatedCount,
    jobsAcceptedCount: input.jobsAcceptedCount,
    lastJobsCreatedCount: input.lastJobsCreatedCount,
    lastJobsAcceptedCount: input.lastJobsAcceptedCount,
  });
  const growthSignals = computeGrowthModePollSignals({
    now: input.now,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    lastSuccessfulPollAt: input.lastSuccessfulPollAt,
    pollAttemptCount: input.pollAttemptCount,
    pollSuccessCount: input.pollSuccessCount,
    recentAcceptedCount: input.recentAcceptedCount,
    recentCanonicalCreatedCount: input.recentCanonicalCreatedCount,
    jobsAcceptedCount: input.jobsAcceptedCount,
    jobsCreatedCount: input.jobsCreatedCount,
    lastJobsCreatedCount: input.lastJobsCreatedCount,
    noveltyRatio,
    sourceType: input.sourceType,
    metadataJson: input.metadataJson,
    companyMetadataJson: input.companyMetadataJson,
  });
  const noveltyWeightedAcceptedPerPoll =
    acceptedPerSuccessfulPoll * Math.max(0.05, noveltyRatio);
  const noveltyWeightedRetainedCount =
    input.retainedLiveJobCount *
    (IN_RECOVERY_MODE ? Math.max(0.02, noveltyRatio * 0.08) : 0.18);
  const bootstrapBoost =
    input.pollAttemptCount === 0 ? 42 : input.pollSuccessCount === 0 ? 18 : 0;
  const csvImportBootstrapBoost =
    input.parserVersion === "csv-import:v1" &&
    input.sourceType === "ATS" &&
    input.pollAttemptCount === 0
      ? 18
      : 0;
  const productiveImportedConnectorBoost =
    input.parserVersion === "csv-import:v1" &&
    PRODUCTIVE_IMPORTED_POLL_CONNECTORS.has(input.connectorName)
      ? input.pollAttemptCount === 0
        ? 26
        : 18
      : 0;
  const structuredCompanySiteBootstrapBoost =
    input.sourceType === "COMPANY_JSON" &&
    Boolean(input.parserVersion?.startsWith("company-site:")) &&
    input.pollAttemptCount === 0
      ? 24
      : 0;
  const lowYieldPenalty =
    input.pollSuccessCount >= 3 && input.jobsCreatedCount === 0 ? 35 : 0;
  const emptyPenalty =
    input.pollSuccessCount >= 2 && input.jobsAcceptedCount === 0 ? 20 : 0;
  const importedLowSignalPenalty =
    input.parserVersion === "csv-import:v1" &&
    LOW_SIGNAL_IMPORTED_POLL_CONNECTORS.has(input.connectorName) &&
    input.pollAttemptCount >= 2 &&
    input.jobsCreatedCount === 0
      ? 28
      : 0;
  const workdayPriorityAdjustment =
    input.connectorName === "workday"
      ? computeWorkdayPollPriorityAdjustment({
          pollAttemptCount: input.pollAttemptCount,
          pollSuccessCount: input.pollSuccessCount,
          jobsAcceptedCount: input.jobsAcceptedCount,
          retainedLiveJobCount: input.retainedLiveJobCount,
          lastJobsAcceptedCount: input.lastJobsAcceptedCount,
          lastJobsCreatedCount: input.lastJobsCreatedCount,
          consecutiveFailures: input.consecutiveFailures,
        })
      : 0;
  const recentCreationBoost = IN_RECOVERY_MODE
    ? Math.min(320, input.recentCanonicalCreatedCount * 18)
    : Math.min(80, input.recentCanonicalCreatedCount * 3);
  const recentZeroYieldPenalty =
    IN_RECOVERY_MODE &&
    input.pollSuccessCount >= COMPANY_SOURCE_RECOVERY_ZERO_YIELD_SUCCESS_THRESHOLD &&
    input.recentCanonicalCreatedCount === 0 &&
    input.lastJobsCreatedCount === 0
      ? input.sourceType === "ATS"
        ? 90
        : 30
      : 0;
  const refreshHeavyPenalty =
    IN_RECOVERY_MODE &&
    input.sourceType === "ATS" &&
    input.recentAcceptedCount >= COMPANY_SOURCE_RECOVERY_LOW_NOVELTY_ACCEPTED_THRESHOLD &&
    noveltyRatio < COMPANY_SOURCE_RECOVERY_LOW_NOVELTY_RATIO &&
    input.recentCanonicalCreatedCount <= 1
      ? 140
      : IN_RECOVERY_MODE &&
          input.recentAcceptedCount >= COMPANY_SOURCE_RECOVERY_LOW_NOVELTY_ACCEPTED_THRESHOLD &&
          noveltyRatio < COMPANY_SOURCE_RECOVERY_LOW_NOVELTY_RATIO
        ? 60
        : 0;
  const noveltyBoost = IN_RECOVERY_MODE ? Math.round(noveltyRatio * 90) : Math.round(noveltyRatio * 30);

  return (
    Math.round(input.priorityScore * 100) / 100 +
    Math.round(input.sourceQualityScore * 28) +
    Math.round(input.yieldScore * 72) +
    Math.round(pollSuccessRate * 18) +
    Math.min(36, input.historicalYield * 1.2) +
    Math.min(18, noveltyWeightedAcceptedPerPoll * 0.12) +
    Math.min(160, createdPerSuccessfulPoll * 6) +
    Math.min(12, noveltyWeightedRetainedCount) +
    Math.min(10, input.lastJobsAcceptedCount * Math.max(0.03, noveltyRatio * 0.08)) +
    Math.min(120, input.lastJobsCreatedCount * 10) +
    recentCreationBoost +
    noveltyBoost +
    bootstrapBoost +
    csvImportBootstrapBoost +
    growthSignals.frontierSignals.boost +
    productiveImportedConnectorBoost +
    structuredCompanySiteBootstrapBoost +
    workdayPriorityAdjustment +
    growthSignals.priorityAdjustment +
    (input.status === "DEGRADED" ? 10 : 0) +
    Math.max(0, 15 - input.consecutiveFailures * 3) +
    Math.round(input.discoveryConfidence * 10) -
    lowYieldPenalty -
    emptyPenalty -
    importedLowSignalPenalty -
    recentZeroYieldPenalty -
    refreshHeavyPenalty
  );
}

type WorkdayValueScoreInput = {
  pollAttemptCount: number;
  pollSuccessCount: number;
  jobsAcceptedCount: number;
  retainedLiveJobCount: number;
};

function computeWorkdayValueScore(input: WorkdayValueScoreInput) {
  const recentSuccessRate =
    input.pollAttemptCount > 0 ? input.pollSuccessCount / input.pollAttemptCount : 0;

  return (
    input.retainedLiveJobCount * 0.5 +
    input.jobsAcceptedCount * 0.3 +
    recentSuccessRate * 100 * 0.2
  );
}

function getWorkdayTier(valueScore: number) {
  if (valueScore >= WORKDAY_TIER_A_VALUE_SCORE) return "A" as const;
  if (valueScore >= WORKDAY_TIER_B_VALUE_SCORE) return "B" as const;
  return "C" as const;
}

function computeWorkdayPollPriorityAdjustment(
  input: WorkdayValueScoreInput & {
    lastJobsAcceptedCount: number;
    lastJobsCreatedCount: number;
    consecutiveFailures: number;
  }
) {
  const valueScore = computeWorkdayValueScore(input);
  const tier = getWorkdayTier(valueScore);
  const tierBoost = tier === "A" ? 120 : tier === "B" ? 55 : -28;
  const recentWindowBoost =
    input.lastJobsAcceptedCount > 0
      ? Math.min(40, input.lastJobsAcceptedCount * 2)
      : input.lastJobsCreatedCount > 0
        ? Math.min(28, input.lastJobsCreatedCount * 4)
        : 0;
  const blockedDrag =
    input.consecutiveFailures <= 1
      ? 0
      : tier === "A"
        ? Math.min(18, input.consecutiveFailures * 4)
        : tier === "B"
          ? Math.min(30, input.consecutiveFailures * 6)
          : Math.min(48, input.consecutiveFailures * 10);

  return tierBoost + recentWindowBoost - blockedDrag;
}

function isHighValueWorkdaySource(input: WorkdayValueScoreInput) {
  return getWorkdayTier(computeWorkdayValueScore(input)) !== "C";
}

function pickBalancedPollSources<T extends { source: { connectorName: string }; priorityScore: number }>(
  candidates: T[],
  limit: number,
  tieBreaker: (left: T, right: T) => number
) {
  if (limit <= 0 || candidates.length === 0) return [] as T[];

  const buckets = new Map<string, T[]>();
  for (const candidate of candidates) {
    const bucket = buckets.get(candidate.source.connectorName) ?? [];
    bucket.push(candidate);
    buckets.set(candidate.source.connectorName, bucket);
  }

  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }

      return tieBreaker(left, right);
    });
  }

  const selected: T[] = [];

  while (selected.length < limit && buckets.size > 0) {
    const round = [...buckets.entries()]
      .map(([connectorName, bucket]) => {
        const head = bucket[0];
        return head ? { connectorName, head } : null;
      })
      .filter((entry): entry is { connectorName: string; head: T } => entry !== null)
      .sort((left, right) => {
        if (right.head.priorityScore !== left.head.priorityScore) {
          return right.head.priorityScore - left.head.priorityScore;
        }

        return tieBreaker(left.head, right.head);
      });

    if (round.length === 0) break;

    for (const { connectorName } of round) {
      if (selected.length >= limit) break;

      const bucket = buckets.get(connectorName);
      const next = bucket?.shift();
      if (!next) {
        buckets.delete(connectorName);
        continue;
      }

      selected.push(next);
      if (bucket && bucket.length === 0) {
        buckets.delete(connectorName);
      }
    }
  }

  return selected;
}

function readJsonRecord(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

function readNumberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readBooleanValue(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }

  return null;
}

function mergeMetadataJson(
  currentValue: Prisma.JsonValue | null | undefined,
  nextValue: Record<string, unknown>
) {
  const current = readJsonRecord(currentValue);
  const merged: Record<string, unknown> = { ...current };

  for (const [key, value] of Object.entries(nextValue)) {
    if (value === undefined) continue;

    const existing = merged[key];

    if (Array.isArray(existing) && Array.isArray(value)) {
      merged[key] = [...new Set([...existing, ...value])];
      continue;
    }

    if (
      existing &&
      value &&
      typeof existing === "object" &&
      typeof value === "object" &&
      !Array.isArray(existing) &&
      !Array.isArray(value)
    ) {
      merged[key] = {
        ...(existing as Record<string, unknown>),
        ...(value as Record<string, unknown>),
      };
      continue;
    }

    merged[key] = value;
  }

  return merged as Prisma.InputJsonValue;
}

function readSeedSourceChain(
  ...values: Array<Prisma.JsonValue | null | undefined>
) {
  for (const value of values) {
    const seedSource = readSeedSource(value);
    if (seedSource) {
      return seedSource;
    }
  }

  return null;
}

function isFrontierExpansionMetadata(value: Prisma.JsonValue | null | undefined) {
  return readBooleanValue(readJsonRecord(value).frontierExpansion) === true;
}

function computeCompanyFrontierSeedBoost(
  seedSource: string | null,
  phase: "discovery" | "poll-bootstrap" | "poll-active" = "discovery"
) {
  if (!seedSource) return 0;

  if (seedSource === "csv-job-board-seed") {
    return phase === "discovery" ? 22 : phase === "poll-bootstrap" ? 18 : 10;
  }

  if (seedSource === "ats-url-expansion") {
    return phase === "discovery" ? 20 : phase === "poll-bootstrap" ? 16 : 12;
  }

  if (EXTERNAL_FRONTIER_SEED_SOURCES.has(seedSource)) {
    return phase === "discovery" ? 18 : phase === "poll-bootstrap" ? 14 : 9;
  }

  if (INTERNAL_FRONTIER_SEED_SOURCES.has(seedSource)) {
    return phase === "discovery" ? 12 : phase === "poll-bootstrap" ? 9 : 6;
  }

  return 0;
}

function computeFrontierPollSignals(input: {
  pollAttemptCount: number;
  sourceType: string | null;
  metadataJson: Prisma.JsonValue | null | undefined;
  companyMetadataJson: Prisma.JsonValue | null | undefined;
}) {
  const seedSource = readSeedSourceChain(input.metadataJson, input.companyMetadataJson);
  const frontierExpansion =
    isFrontierExpansionMetadata(input.metadataJson) ||
    isFrontierExpansionMetadata(input.companyMetadataJson);
  const seedBoost = computeCompanyFrontierSeedBoost(
    seedSource,
    input.pollAttemptCount === 0 ? "poll-bootstrap" : "poll-active"
  );
  const frontierBoost = frontierExpansion
    ? input.pollAttemptCount === 0
      ? input.sourceType === "ATS"
        ? 18
        : 14
      : 8
    : 0;

  return {
    seedSource,
    frontierExpansion,
    boost: seedBoost + frontierBoost,
  };
}

function isRecentGrowthWindow(date: Date | null | undefined, now: Date) {
  if (!date) return false;
  return (
    now.getTime() - date.getTime() <=
    GROWTH_FRONTIER_WINDOW_HOURS * 60 * 60 * 1000
  );
}

function isGrowthFrontierCandidate(input: {
  now: Date;
  createdAt: Date | null | undefined;
  updatedAt: Date | null | undefined;
  lastSuccessfulPollAt?: Date | null | undefined;
  pollAttemptCount: number;
  sourceType: string | null;
  metadataJson: Prisma.JsonValue | null | undefined;
  companyMetadataJson: Prisma.JsonValue | null | undefined;
}) {
  const frontierSignals = computeFrontierPollSignals({
    pollAttemptCount: input.pollAttemptCount,
    sourceType: input.sourceType,
    metadataJson: input.metadataJson,
    companyMetadataJson: input.companyMetadataJson,
  });
  const recentlyTouched =
    isRecentGrowthWindow(input.createdAt, input.now) ||
    isRecentGrowthWindow(input.updatedAt, input.now) ||
    isRecentGrowthWindow(input.lastSuccessfulPollAt, input.now);

  return {
    frontierSignals,
    frontierCandidate:
      frontierSignals.frontierExpansion ||
      frontierSignals.seedSource != null ||
      (input.pollAttemptCount <= 1 && recentlyTouched),
  };
}

export function computeGrowthModePollSignals(input: {
  now: Date;
  createdAt: Date | null | undefined;
  updatedAt: Date | null | undefined;
  lastSuccessfulPollAt?: Date | null | undefined;
  pollAttemptCount: number;
  pollSuccessCount: number;
  recentAcceptedCount: number;
  recentCanonicalCreatedCount: number;
  jobsAcceptedCount: number;
  jobsCreatedCount: number;
  lastJobsCreatedCount: number;
  noveltyRatio: number;
  sourceType: string | null;
  metadataJson: Prisma.JsonValue | null | undefined;
  companyMetadataJson: Prisma.JsonValue | null | undefined;
}) {
  const growthFrontier = isGrowthFrontierCandidate({
    now: input.now,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    lastSuccessfulPollAt: input.lastSuccessfulPollAt,
    pollAttemptCount: input.pollAttemptCount,
    sourceType: input.sourceType,
    metadataJson: input.metadataJson,
    companyMetadataJson: input.companyMetadataJson,
  });
  const refreshHeavyLowNovelty =
    input.pollSuccessCount >= COMPANY_SOURCE_RECOVERY_ZERO_YIELD_SUCCESS_THRESHOLD &&
    input.recentAcceptedCount >= GROWTH_LOW_NOVELTY_ACCEPTED_THRESHOLD &&
    input.recentCanonicalCreatedCount <= 1 &&
    input.lastJobsCreatedCount === 0 &&
    input.noveltyRatio < GROWTH_LOW_NOVELTY_RATIO;
  const historicalNoveltyRatio =
    input.jobsAcceptedCount > 0
      ? input.jobsCreatedCount / input.jobsAcceptedCount
      : input.jobsCreatedCount > 0
        ? 1
        : 0;
  const historicalRefreshHeavy =
    input.jobsAcceptedCount >= GROWTH_LOW_NOVELTY_ACCEPTED_THRESHOLD * 8 &&
    input.lastJobsCreatedCount === 0 &&
    historicalNoveltyRatio < GROWTH_LOW_NOVELTY_RATIO;
  const refreshHeavySourceType = GROWTH_REFRESH_HEAVY_SOURCE_TYPES.has(
    input.sourceType ?? ""
  );
  const refreshHeavyCandidate =
    !growthFrontier.frontierCandidate &&
    refreshHeavySourceType &&
    (refreshHeavyLowNovelty || historicalRefreshHeavy);

  let priorityAdjustment = 0;
  if (GROWTH_MODE_ENABLED) {
    if (growthFrontier.frontierCandidate) {
      priorityAdjustment =
        GROWTH_FRONTIER_PRIORITY_BOOST +
        (input.pollAttemptCount === 0 ? 80 : input.pollAttemptCount <= 1 ? 40 : 0);
    } else if (refreshHeavyCandidate) {
      priorityAdjustment = -GROWTH_REFRESH_HEAVY_PRIORITY_PENALTY;
    } else {
      priorityAdjustment = -GROWTH_NON_FRONTIER_PRIORITY_PENALTY;
    }
  }

  return {
    ...growthFrontier,
    refreshHeavyCandidate,
    shouldHardCooldown: GROWTH_MODE_ENABLED && refreshHeavyCandidate,
    priorityAdjustment,
  };
}

function isGrowthChurnHeavySource(input: {
  frontierCandidate: boolean;
  recentCanonicalCreatedCount: number;
  recentRemovedCount: number;
  lastJobsCreatedCount: number;
}) {
  if (!GROWTH_MODE_ENABLED || input.frontierCandidate) {
    return false;
  }

  if (input.recentRemovedCount < GROWTH_CHURN_HEAVY_REMOVED_THRESHOLD) {
    return false;
  }

  const creationFloor = Math.max(
    input.recentCanonicalCreatedCount,
    input.lastJobsCreatedCount,
    1
  );

  return (
    input.recentRemovedCount >
    creationFloor * GROWTH_CHURN_HEAVY_REMOVED_TO_CREATED_RATIO
  );
}

function computePollAdmissionBudgetMs(
  maxWallClockMs: number = COMPANY_SOURCE_POLL_QUEUE_WALL_CLOCK_MS
) {
  return Math.max(
    COMPANY_SOURCE_POLL_MIN_REMAINING_BUDGET_MS * 2,
    Math.floor(maxWallClockMs * COMPANY_SOURCE_POLL_ADMISSION_BUDGET_RATIO)
  );
}

function computePollSoftStopMs(
  maxWallClockMs: number = COMPANY_SOURCE_POLL_QUEUE_WALL_CLOCK_MS
) {
  return Math.max(
    COMPANY_SOURCE_POLL_MIN_REMAINING_BUDGET_MS * 2,
    Math.floor(maxWallClockMs * COMPANY_SOURCE_POLL_SOFT_STOP_RATIO)
  );
}

function getWorkdayHostKey(input: {
  connectorName: string;
  token: string;
  boardUrl: string;
}) {
  if (input.connectorName !== "workday") return null;

  const tokenHost = input.token.split("|")[0]?.trim().toLowerCase();
  if (tokenHost) return tokenHost;

  try {
    return new URL(input.boardUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function getAveragePollRuntimeMs(metadataJson: Prisma.JsonValue | null | undefined) {
  const metadata = readJsonRecord(metadataJson);
  const pollRuntime = readJsonRecord(metadata.pollRuntime as Prisma.JsonValue | undefined);
  const avgMs = readNumberValue(pollRuntime.avgMs);
  if (avgMs != null) {
    return avgMs;
  }

  const lastSummary = readJsonRecord(metadata.lastSummary as Prisma.JsonValue | undefined);
  return readNumberValue(lastSummary.runtimeMs);
}

function estimateSourcePollRuntimeMs(input: {
  connectorName: string;
  sourceType: string | null;
  metadataJson: Prisma.JsonValue | null | undefined;
  pollAttemptCount: number;
  consecutiveFailures: number;
  hostMetrics?: WorkdayHostMetrics | null;
}) {
  const runtimeFromMetadata = getAveragePollRuntimeMs(input.metadataJson);
  const connectorBaseline =
    DEFAULT_CONNECTOR_POLL_RUNTIME_MS[input.connectorName] ?? 28_000;

  let estimateMs = runtimeFromMetadata ?? connectorBaseline;

  if (input.sourceType === "COMPANY_HTML") {
    estimateMs *= 1.35;
  } else if (input.sourceType === "COMPANY_JSON") {
    estimateMs *= 1.1;
  }

  if (input.pollAttemptCount === 0) {
    estimateMs *= 1.15;
  }

  if (input.consecutiveFailures > 0) {
    estimateMs *= 1 + Math.min(0.35, input.consecutiveFailures * 0.08);
  }

  if (input.connectorName === "workday" && input.hostMetrics?.avgRuntimeMs) {
    estimateMs = Math.max(estimateMs, input.hostMetrics.avgRuntimeMs);
  }

  return Math.round(
    clampScore(
      estimateMs,
      8_000,
      COMPANY_SOURCE_POLL_MAX_RUNTIME_MS
    )
  );
}

function computeBlockedRisk(input: {
  connectorName: string;
  pollState: string;
  consecutiveFailures: number;
  lastHttpStatus: number | null;
  hostMetrics?: WorkdayHostMetrics | null;
}) {
  let blockedRisk = 0;

  if (input.pollState === "BACKOFF") {
    blockedRisk += 0.2;
  }

  if (input.consecutiveFailures > 0) {
    blockedRisk += Math.min(0.45, input.consecutiveFailures * 0.1);
  }

  if (input.lastHttpStatus && WORKDAY_BLOCKED_HTTP_STATUSES.has(input.lastHttpStatus)) {
    blockedRisk += 0.3;
  }

  if (input.connectorName === "workday") {
    blockedRisk += 0.15;

    if (input.hostMetrics?.blockedSourceCount) {
      blockedRisk += Math.min(0.45, input.hostMetrics.blockedSourceCount * 0.12);
    }

    if (input.hostMetrics?.blockedStreak) {
      blockedRisk += Math.min(0.35, input.hostMetrics.blockedStreak * 0.08);
    }

    if (input.hostMetrics?.cooldownUntil) {
      blockedRisk = 1.5;
    }
  }

  return clampScore(blockedRisk, 0, 1.5);
}

function computeExpectedAcceptedJobs(input: {
  now: Date;
  connectorName: string;
  sourceType: string | null;
  sourceQualityScore: number;
  yieldScore: number;
  pollAttemptCount: number;
  pollSuccessCount: number;
  jobsAcceptedCount: number;
  jobsCreatedCount: number;
  lastJobsAcceptedCount: number;
  lastJobsCreatedCount: number;
  retainedLiveJobCount: number;
  canonicalCreatedCount7d: number;
  acceptedCount7d: number;
  metadataJson: Prisma.JsonValue | null | undefined;
  companyMetadataJson: Prisma.JsonValue | null | undefined;
  createdAt: Date | null | undefined;
  updatedAt: Date | null | undefined;
  lastSuccessfulPollAt: Date | null | undefined;
}) {
  const acceptedPerSuccessfulPoll =
    input.pollSuccessCount > 0 ? input.jobsAcceptedCount / input.pollSuccessCount : 0;
  const createdPerSuccessfulPoll =
    input.pollSuccessCount > 0 ? input.jobsCreatedCount / input.pollSuccessCount : 0;
  const noveltyRatio = computeNoveltyRatio({
    canonicalCreatedCount7d: input.canonicalCreatedCount7d,
    acceptedCount7d: input.acceptedCount7d,
    jobsCreatedCount: input.jobsCreatedCount,
    jobsAcceptedCount: input.jobsAcceptedCount,
    lastJobsCreatedCount: input.lastJobsCreatedCount,
    lastJobsAcceptedCount: input.lastJobsAcceptedCount,
  });
  const growthSignals = computeGrowthModePollSignals({
    now: input.now,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    lastSuccessfulPollAt: input.lastSuccessfulPollAt,
    pollAttemptCount: input.pollAttemptCount,
    pollSuccessCount: input.pollSuccessCount,
    recentAcceptedCount: input.acceptedCount7d,
    recentCanonicalCreatedCount: input.canonicalCreatedCount7d,
    jobsAcceptedCount: input.jobsAcceptedCount,
    jobsCreatedCount: input.jobsCreatedCount,
    lastJobsCreatedCount: input.lastJobsCreatedCount,
    noveltyRatio,
    sourceType: input.sourceType,
    metadataJson: input.metadataJson,
    companyMetadataJson: input.companyMetadataJson,
  });
  const bootstrapExpectation =
    input.pollAttemptCount === 0
      ? TIER_1_POLL_CONNECTORS.has(input.connectorName) ||
        TIER_1_CONDITIONAL_CONNECTORS.has(input.connectorName)
        ? 4
        : 1.5
      + (growthSignals.frontierSignals.frontierExpansion ? 2 : 0)
      + Math.min(2, growthSignals.frontierSignals.boost * 0.08)
      : 0;

  if (IN_RECOVERY_MODE) {
    const companyJsonBoost = input.sourceType === "COMPANY_JSON" ? 8 : 0;
    const companyHtmlBoost = input.sourceType === "COMPANY_HTML" ? 3 : 0;
    const recentCreatedDailyRate = input.canonicalCreatedCount7d / COMPANY_SOURCE_RECENT_YIELD_LOOKBACK_DAYS;
    const recentAcceptedDailyRate =
      (input.acceptedCount7d / COMPANY_SOURCE_RECENT_YIELD_LOOKBACK_DAYS) *
      Math.max(0.05, noveltyRatio);
    const staleAtsPenalty =
      input.sourceType === "ATS" &&
      input.pollSuccessCount >= COMPANY_SOURCE_RECOVERY_ZERO_YIELD_SUCCESS_THRESHOLD &&
      input.canonicalCreatedCount7d === 0 &&
      input.lastJobsCreatedCount === 0 &&
      createdPerSuccessfulPoll < 0.5
        ? 12
        : 0;
    const staleCompanySitePenalty =
      (input.sourceType === "COMPANY_JSON" || input.sourceType === "COMPANY_HTML") &&
      input.pollSuccessCount >= COMPANY_SOURCE_RECOVERY_ZERO_YIELD_SUCCESS_THRESHOLD &&
      input.canonicalCreatedCount7d === 0 &&
      input.lastJobsCreatedCount === 0
        ? 4
        : 0;
    const refreshHeavyPenalty =
      input.acceptedCount7d >= COMPANY_SOURCE_RECOVERY_LOW_NOVELTY_ACCEPTED_THRESHOLD &&
      noveltyRatio < COMPANY_SOURCE_RECOVERY_LOW_NOVELTY_RATIO
        ? input.sourceType === "ATS"
          ? 18
          : 8
        : 0;

    return Math.max(
      bootstrapExpectation,
      input.canonicalCreatedCount7d * 2.2 +
        recentCreatedDailyRate * 18 +
        recentAcceptedDailyRate * 1.5 +
        input.lastJobsCreatedCount * 11 +
        createdPerSuccessfulPoll * 7 +
        input.lastJobsAcceptedCount * Math.max(0.02, noveltyRatio * 0.1) +
        acceptedPerSuccessfulPoll * Math.max(0.02, noveltyRatio * 0.08) +
        input.sourceQualityScore * 8 +
        input.yieldScore * 12 +
        noveltyRatio * 30 +
        growthSignals.frontierSignals.boost * 0.45 +
        (GROWTH_MODE_ENABLED && growthSignals.frontierCandidate ? 10 : 0) -
        (GROWTH_MODE_ENABLED && growthSignals.refreshHeavyCandidate ? 18 : 0) +
        companyJsonBoost +
        companyHtmlBoost -
        staleAtsPenalty -
        staleCompanySitePenalty -
        refreshHeavyPenalty
    );
  }

  return Math.max(
    bootstrapExpectation,
    input.lastJobsAcceptedCount * 0.7 +
      input.lastJobsCreatedCount * 2.5 +
      acceptedPerSuccessfulPoll * 0.45 +
      createdPerSuccessfulPoll * 3.5 +
      input.retainedLiveJobCount * 0.05 +
      input.sourceQualityScore * 10 +
      input.yieldScore * 18 +
      growthSignals.frontierSignals.boost * 0.35 +
      (GROWTH_MODE_ENABLED && growthSignals.frontierCandidate ? 6 : 0) -
      (GROWTH_MODE_ENABLED && growthSignals.refreshHeavyCandidate ? 6 : 0)
  );
}

function classifyPollTier(input: {
  now: Date;
  connectorName: string;
  sourceType: string | null;
  pollAttemptCount: number;
  pollSuccessCount: number;
  lastJobsCreatedCount: number;
  retainedLiveJobCount: number;
  blockedRisk: number;
  workdayTier: ReturnType<typeof getWorkdayTier> | null;
  canonicalCreatedCount7d: number;
  acceptedCount7d: number;
  jobsAcceptedCount: number;
  jobsCreatedCount: number;
  metadataJson: Prisma.JsonValue | null | undefined;
  companyMetadataJson: Prisma.JsonValue | null | undefined;
  createdAt: Date | null | undefined;
  updatedAt: Date | null | undefined;
  lastSuccessfulPollAt: Date | null | undefined;
  velocitySignals: PollVelocitySignals;
}) {
  const noveltyRatio = computeNoveltyRatio({
    canonicalCreatedCount7d: input.canonicalCreatedCount7d,
    acceptedCount7d: input.acceptedCount7d,
    jobsCreatedCount: input.jobsCreatedCount,
    jobsAcceptedCount: input.jobsAcceptedCount,
    lastJobsCreatedCount: input.lastJobsCreatedCount,
    lastJobsAcceptedCount: 0,
  });
  const growthSignals = computeGrowthModePollSignals({
    now: input.now,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    lastSuccessfulPollAt: input.lastSuccessfulPollAt,
    pollAttemptCount: input.pollAttemptCount,
    pollSuccessCount: input.pollSuccessCount,
    recentAcceptedCount: input.acceptedCount7d,
    recentCanonicalCreatedCount: input.canonicalCreatedCount7d,
    jobsAcceptedCount: input.jobsAcceptedCount,
    jobsCreatedCount: input.jobsCreatedCount,
    lastJobsCreatedCount: input.lastJobsCreatedCount,
    noveltyRatio,
    sourceType: input.sourceType,
    metadataJson: input.metadataJson,
    companyMetadataJson: input.companyMetadataJson,
  });

  if (input.connectorName === "workday") {
    return input.workdayTier === "A"
      ? "TIER_1"
      : input.workdayTier === "B"
        ? "TIER_2"
        : "TIER_3";
  }

  if (
    input.pollAttemptCount === 0 &&
    (growthSignals.frontierSignals.frontierExpansion ||
      growthSignals.frontierSignals.seedSource != null)
  ) {
    return input.sourceType === "ATS" ||
      input.sourceType === "COMPANY_JSON" ||
      input.sourceType === "COMPANY_HTML"
      ? "TIER_1"
      : "TIER_2";
  }

  if (GROWTH_MODE_ENABLED && growthSignals.frontierCandidate) {
    return "TIER_1";
  }

  if (GROWTH_MODE_ENABLED && growthSignals.refreshHeavyCandidate) {
    return "TIER_3";
  }

  if (
    input.blockedRisk < 0.4 &&
    input.canonicalCreatedCount7d >= 5 &&
    input.velocitySignals.createdPerMinute7d >= 0.05 &&
    input.velocitySignals.failureRate <= 0.45
  ) {
    return "TIER_1";
  }

  if (
    IN_RECOVERY_MODE &&
    input.canonicalCreatedCount7d === 0 &&
    input.pollSuccessCount >= COMPANY_SOURCE_RECOVERY_ZERO_YIELD_SUCCESS_THRESHOLD
  ) {
    if (input.sourceType === "ATS") {
      return "TIER_3";
    }

    if (input.sourceType === "COMPANY_JSON" || input.sourceType === "COMPANY_HTML") {
      return input.retainedLiveJobCount > 0 ? "TIER_2" : "TIER_3";
    }
  }

  if (IN_RECOVERY_MODE && input.canonicalCreatedCount7d > 0) {
    if (input.sourceType === "COMPANY_JSON" || input.sourceType === "COMPANY_HTML") {
      return "TIER_1";
    }

    if (input.sourceType === "ATS") {
      return "TIER_1";
    }
  }

  if (
    IN_RECOVERY_MODE &&
    input.sourceType === "COMPANY_JSON" &&
    (input.pollSuccessCount > 0 || input.retainedLiveJobCount > 0)
  ) {
    return "TIER_1";
  }

  if (TIER_1_POLL_CONNECTORS.has(input.connectorName)) {
    if (
      IN_RECOVERY_MODE &&
      input.pollSuccessCount >= 3 &&
      input.lastJobsCreatedCount === 0
    ) {
      return "TIER_2";
    }

    return "TIER_1";
  }

  if (TIER_1_CONDITIONAL_CONNECTORS.has(input.connectorName)) {
    return input.pollSuccessCount > 0 || input.retainedLiveJobCount > 0
      ? "TIER_1"
      : "TIER_2";
  }

  if (input.blockedRisk >= 0.6) {
    return "TIER_3";
  }

  if (
    (input.sourceType === "COMPANY_JSON" || input.sourceType === "COMPANY_HTML") &&
    (input.pollSuccessCount > 0 || input.retainedLiveJobCount > 0)
  ) {
    return "TIER_2";
  }

  if (input.pollAttemptCount === 0) {
    return "TIER_3";
  }

  return input.retainedLiveJobCount > 0 || input.pollSuccessCount > 0
    ? "TIER_2"
    : "TIER_3";
}

function computePollEfficiencyScore(input: {
  basePriorityScore: number;
  estimatedRuntimeMs: number;
  expectedAcceptedJobs: number;
  blockedRisk: number;
  recentSuccessRate: number;
  retainedLiveJobCount: number;
  canonicalCreatedCount7d: number;
  acceptedCount7d: number;
  noveltyRatio: number;
  velocitySignals: PollVelocitySignals;
}) {
  const score =
    input.expectedAcceptedJobs * 5 +
    input.canonicalCreatedCount7d * 24 +
    input.acceptedCount7d * Math.max(0.01, input.noveltyRatio * 0.04) +
    input.retainedLiveJobCount * Math.max(0.01, input.noveltyRatio * 0.035) +
    Math.min(180, input.velocitySignals.createdPerMinute7d * 180) +
    Math.min(50, input.velocitySignals.acceptedPerMinute7d * 6) +
    input.noveltyRatio * 60 +
    input.recentSuccessRate * 20 +
    input.basePriorityScore * 0.12 -
    input.velocitySignals.duplicateRate * 12 -
    input.velocitySignals.failureRate * 28 -
    input.blockedRisk * 30;

  return score / Math.max(input.estimatedRuntimeMs / 1000, 1);
}

// Process-local cache for recent-source-yield metrics. The underlying query is
// a SUM/COUNT groupBy across ~685K IngestionRun rows. Without caching, every
// daemon + recovery-poll worker re-runs it every cycle, creating concurrent
// I/O contention. The metrics shift slowly (7-day window) so a 5-minute TTL
// per source is safe.
const RECENT_SOURCE_YIELD_TTL_MS = 5 * 60 * 1000;
const recentSourceYieldCache = new Map<
  string,
  { value: RecentSourceYieldMetrics; expiresAt: number }
>();

async function buildRecentSourceYieldMetrics(
  sourceNames: string[],
  now: Date
) {
  if (sourceNames.length === 0) {
    return new Map<string, RecentSourceYieldMetrics>();
  }

  const result = new Map<string, RecentSourceYieldMetrics>();
  const missing: string[] = [];
  const nowMs = now.getTime();

  // Bucket by cache hit/miss first to keep the DB query as small as possible.
  for (const sourceName of sourceNames) {
    const cached = recentSourceYieldCache.get(sourceName);
    if (cached && cached.expiresAt > nowMs) {
      result.set(sourceName, cached.value);
    } else {
      missing.push(sourceName);
    }
  }

  if (missing.length === 0) {
    return result;
  }

  const cutoff = new Date(
    nowMs - COMPANY_SOURCE_RECENT_YIELD_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  );
  const cutoff24h = new Date(nowMs - 24 * 60 * 60 * 1000);
  const [rows, rows24h] = await Promise.all([
    prisma.ingestionRun.groupBy({
      by: ["sourceName"],
      where: {
        startedAt: { gte: cutoff },
        sourceName: { in: missing },
      },
      _sum: {
        canonicalCreatedCount: true,
        removedCount: true,
        acceptedCount: true,
      },
      _count: {
        _all: true,
      },
    }),
    prisma.ingestionRun.groupBy({
      by: ["sourceName"],
      where: {
        startedAt: { gte: cutoff24h },
        sourceName: { in: missing },
      },
      _sum: {
        canonicalCreatedCount: true,
        acceptedCount: true,
      },
      _count: {
        _all: true,
      },
    }),
  ]);
  const metrics24hBySource = new Map(
    rows24h.map((row) => [
      row.sourceName,
      {
        canonicalCreatedCount24h: row._sum.canonicalCreatedCount ?? 0,
        acceptedCount24h: row._sum.acceptedCount ?? 0,
        runCount24h: row._count._all,
      },
    ])
  );

  const fetched = new Set<string>();
  const expiresAt = nowMs + RECENT_SOURCE_YIELD_TTL_MS;
  for (const row of rows) {
    const value: RecentSourceYieldMetrics = {
      sourceName: row.sourceName,
      canonicalCreatedCount7d: row._sum.canonicalCreatedCount ?? 0,
      removedCount7d: row._sum.removedCount ?? 0,
      acceptedCount7d: row._sum.acceptedCount ?? 0,
      runCount7d: row._count._all,
      canonicalCreatedCount24h:
        metrics24hBySource.get(row.sourceName)?.canonicalCreatedCount24h ?? 0,
      acceptedCount24h:
        metrics24hBySource.get(row.sourceName)?.acceptedCount24h ?? 0,
      runCount24h: metrics24hBySource.get(row.sourceName)?.runCount24h ?? 0,
    };
    result.set(row.sourceName, value);
    recentSourceYieldCache.set(row.sourceName, { value, expiresAt });
    fetched.add(row.sourceName);
  }

  // Cache the empty result for sourceNames that had no recent runs so we don't
  // keep re-asking the DB about cold sources.
  for (const sourceName of missing) {
    if (fetched.has(sourceName)) continue;
    const empty: RecentSourceYieldMetrics = {
      sourceName,
      canonicalCreatedCount7d: 0,
      removedCount7d: 0,
      acceptedCount7d: 0,
      runCount7d: 0,
      canonicalCreatedCount24h: 0,
      acceptedCount24h: 0,
      runCount24h: 0,
    };
    result.set(sourceName, empty);
    recentSourceYieldCache.set(sourceName, { value: empty, expiresAt });
  }

  // Bound the cache. If it grows past ~50K entries, drop oldest 25%.
  if (recentSourceYieldCache.size > 50_000) {
    const drop = Math.floor(recentSourceYieldCache.size * 0.25);
    let dropped = 0;
    for (const key of recentSourceYieldCache.keys()) {
      if (dropped >= drop) break;
      recentSourceYieldCache.delete(key);
      dropped += 1;
    }
  }

  return result;
}

function computeQueuePriorityScore(input: {
  tier: PollTier;
  efficiencyScore: number;
  basePriorityScore: number;
}) {
  const tierBoost =
    input.tier === "TIER_1" ? 4_000 : input.tier === "TIER_2" ? 2_500 : 1_000;

  return tierBoost + input.efficiencyScore * 100 + input.basePriorityScore;
}

async function buildWorkdayHostMetrics(now: Date) {
  const recentFailureCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const recentSuccessCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sources = await prisma.companySource.findMany({
    where: { connectorName: "workday" },
    select: {
      token: true,
      boardUrl: true,
      cooldownUntil: true,
      lastFailureAt: true,
      lastSuccessfulPollAt: true,
      lastHttpStatus: true,
      consecutiveFailures: true,
      metadataJson: true,
    },
  });

  const runtimeTotals = new Map<string, { totalMs: number; samples: number }>();
  const metrics = new Map<string, WorkdayHostMetrics>();

  for (const source of sources) {
    const host = getWorkdayHostKey({
      connectorName: "workday",
      token: source.token,
      boardUrl: source.boardUrl,
    });
    if (!host) continue;

    const entry = metrics.get(host) ?? {
      host,
      avgRuntimeMs: null,
      blockedSourceCount: 0,
      blockedStreak: 0,
      cooldownUntil: null,
      recentSuccessCount: 0,
    };

    if (
      source.lastFailureAt &&
      source.lastFailureAt >= recentFailureCutoff &&
      source.lastHttpStatus &&
      WORKDAY_BLOCKED_HTTP_STATUSES.has(source.lastHttpStatus)
    ) {
      entry.blockedSourceCount += 1;
      entry.blockedStreak = Math.max(entry.blockedStreak, source.consecutiveFailures);
    }

    if (source.lastSuccessfulPollAt && source.lastSuccessfulPollAt >= recentSuccessCutoff) {
      entry.recentSuccessCount += 1;
    }

    if (source.cooldownUntil && source.cooldownUntil > now) {
      entry.cooldownUntil =
        entry.cooldownUntil && entry.cooldownUntil > source.cooldownUntil
          ? entry.cooldownUntil
          : source.cooldownUntil;
    }

    const avgRuntimeMs = getAveragePollRuntimeMs(source.metadataJson);
    if (avgRuntimeMs != null) {
      const existing = runtimeTotals.get(host) ?? { totalMs: 0, samples: 0 };
      existing.totalMs += avgRuntimeMs;
      existing.samples += 1;
      runtimeTotals.set(host, existing);
    }

    metrics.set(host, entry);
  }

  for (const [host, totals] of runtimeTotals.entries()) {
    const entry = metrics.get(host);
    if (!entry || totals.samples === 0) continue;
    entry.avgRuntimeMs = Math.round(totals.totalMs / totals.samples);
    metrics.set(host, entry);
  }

  return metrics;
}

function estimateClaimablePollTaskCountFromPreview(
  tasks: Array<{ payloadJson: Prisma.JsonValue | null }>,
  limit: number,
  remainingBudgetMs: number
) {
  if (limit <= 0 || tasks.length === 0 || remainingBudgetMs <= 0) {
    return 0;
  }

  let admitted = 0;
  let consumedMs = 0;

  for (const task of tasks) {
    if (admitted >= limit) break;

    const payload = readJsonRecord(task.payloadJson);
    const estimatedRuntimeMs = Math.round(
      clampScore(
        readNumberValue(payload.estimatedRuntimeMs) ??
          DEFAULT_CONNECTOR_POLL_RUNTIME_MS["company-site"],
        8_000,
        COMPANY_SOURCE_POLL_MAX_RUNTIME_MS
      )
    );

    if (consumedMs + estimatedRuntimeMs > remainingBudgetMs && admitted > 0) {
      break;
    }

    consumedMs += estimatedRuntimeMs;
    admitted += 1;
  }

  return admitted;
}

function resolveConnectorPollTimeoutMs(input: {
  connectorName: string;
  sourceType: string | null;
  maxRuntimeMs: number;
}) {
  const connectorKey =
    input.connectorName === "company-site"
      ? "company-site"
      : input.connectorName;
  const configuredMap = GROWTH_MODE_ENABLED
    ? GROWTH_HARD_CONNECTOR_POLL_TIMEOUT_MS
    : HARD_CONNECTOR_POLL_TIMEOUT_MS;
  const configured =
    configuredMap[connectorKey] ??
    configuredMap[input.sourceType ?? ""] ??
    HARD_CONNECTOR_POLL_TIMEOUT_MS[connectorKey] ??
    HARD_CONNECTOR_POLL_TIMEOUT_MS[input.sourceType ?? ""] ??
    90_000;

  return Math.max(
    15_000,
    Math.min(input.maxRuntimeMs, configured)
  );
}

function isInfrastructureFailureMessage(errorMessage: string) {
  return /timeout exceeded when trying to connect|connection terminated unexpectedly|too many clients|remaining connection slots|prisma|pg[- ]?pool|database server|P10\d{2}/i.test(
    errorMessage
  );
}

export async function syncCompaniesFromJobs(options: { limit?: number } = {}) {
  const rows = await prisma.jobCanonical.findMany({
    where: {
      OR: [{ companyId: null }, { companyRecord: null }],
      companyKey: { not: "" },
      status: { in: ["LIVE", "AGING", "STALE"] },
    },
    select: {
      id: true,
      company: true,
      companyKey: true,
      applyUrl: true,
      sourceMappings: {
        where: { removedAt: null, isPrimary: true },
        select: { sourceUrl: true },
        take: 1,
      },
    },
    orderBy: [{ lastSeenAt: "desc" }],
    take: options.limit ?? 500,
  });

  let companyCount = 0;
  const companyIds = new Set<string>();

  for (const row of rows) {
    const company = await ensureCompanyRecord({
      companyName: row.company,
      companyKey: row.companyKey,
      urls: [row.applyUrl, row.sourceMappings[0]?.sourceUrl ?? null],
    });
    companyIds.add(company.id);
    companyCount += 1;
    await prisma.jobCanonical.update({
      where: { id: row.id },
      data: { companyId: company.id },
    });
    await assignCanonicalJobsToCompany(company.id, row.companyKey);
  }

  return {
    canonicalJobsLinked: companyCount,
    distinctCompaniesLinked: companyIds.size,
  };
}

export async function seedCompanyDiscoveryUniverse(options: {
  catalogLimit?: number;
  corpusLimit?: number;
  inventoryLimit?: number;
  existingAtsLimit?: number;
} = {}) {
  const catalogLimit = options.catalogLimit ?? DEFAULT_COMPANY_CATALOG_SEED_LIMIT;
  const corpusLimit = options.corpusLimit ?? DEFAULT_COMPANY_CORPUS_SEED_LIMIT;
  const inventoryLimit = options.inventoryLimit ?? DEFAULT_COMPANY_INVENTORY_SEED_LIMIT;
  const existingAtsLimit = options.existingAtsLimit ?? DEFAULT_EXISTING_ATS_SEED_LIMIT;

  const [inventorySeeded, reverseAtsSeeded] = await Promise.all([
    seedCompaniesFromCanonicalInventory({
      limit: inventoryLimit,
      includeHistorical: true,
    }),
    seedCompanySourcesFromExistingAts({
      limit: existingAtsLimit,
    }),
  ]);

  const seededCompanyKeys = new Set(
    (
      await prisma.company.findMany({
        select: { companyKey: true },
      })
    ).map((company) => company.companyKey)
  );

  let catalogSeeded = 0;
  for (const record of ENTERPRISE_DISCOVERY_COMPANIES.slice(0, catalogLimit)) {
    const companyKey = buildCompanyKey(record.name);
    if (!companyKey || seededCompanyKeys.has(companyKey)) continue;

    await ensureCompanyRecord({
      companyName: record.name,
      companyKey,
      urls: [...(record.seedPageUrls ?? []), ...(record.domains ?? []).map((domain) => `https://${domain}`)],
      careersUrl: record.seedPageUrls?.[0] ?? null,
      detectedAts: record.ats !== "unknown" ? record.ats : null,
      discoveryStatus: "PENDING",
      crawlStatus: "IDLE",
      discoveryConfidence:
        record.ats !== "unknown" ? 0.75 : (record.seedPageUrls?.length ?? 0) > 0 ? 0.55 : 0.35,
      metadataJson: {
        seedSource: "enterprise-catalog",
        ats: record.ats,
        searchTerms: record.searchTerms ?? [],
        tenants: record.tenants,
        domains: record.domains ?? [],
        seedPageUrls: record.seedPageUrls ?? [],
        wdVariants: record.wdVariants ?? [],
        wdSites: record.wdSites ?? [],
        sfHosts: record.sfHosts ?? [],
        sfPaths: record.sfPaths ?? [],
        sectors: record.sectors,
        canadaCities: record.canadaCities ?? [],
        remoteCanadaLikely: record.remoteCanadaLikely ?? false,
      },
    });
    seededCompanyKeys.add(companyKey);
    catalogSeeded += 1;
  }

  const corpus = await buildCompanyDiscoveryCorpus({
    limit: corpusLimit,
    minCanadaRelevantCount: 0,
    minTotalLiveCount: 1,
  });

  let corpusSeeded = 0;
  for (const entry of corpus) {
    if (seededCompanyKeys.has(entry.companyKey)) continue;

    const seedPageUrls = entry.record.seedPageUrls ?? [];
    await ensureCompanyRecord({
      companyName: entry.displayName,
      companyKey: entry.companyKey,
      urls: [...seedPageUrls, ...(entry.record.domains ?? []).map((domain) => `https://${domain}`)],
      careersUrl: seedPageUrls[0] ?? null,
      detectedAts: entry.record.ats !== "unknown" ? entry.record.ats : null,
      discoveryStatus: "PENDING",
      crawlStatus: "IDLE",
      discoveryConfidence: Math.min(0.9, Math.max(0.35, entry.score / 20)),
      metadataJson: {
        seedSource: "live-corpus",
        aliases: entry.aliases,
        totalLiveCount: entry.totalLiveCount,
        canadaRelevantCount: entry.canadaRelevantCount,
        canadaRemoteCount: entry.canadaRemoteCount,
        matchedCatalogName: entry.matchedCatalogName,
        ats: entry.record.ats,
        searchTerms: entry.record.searchTerms ?? [],
        tenants: entry.record.tenants,
        domains: entry.record.domains ?? [],
        seedPageUrls,
        wdVariants: entry.record.wdVariants ?? [],
        wdSites: entry.record.wdSites ?? [],
        sfHosts: entry.record.sfHosts ?? [],
        sfPaths: entry.record.sfPaths ?? [],
        sectors: entry.record.sectors,
      },
    });
    await assignCanonicalJobsToCompanyByKey(entry.companyKey);
    seededCompanyKeys.add(entry.companyKey);
    corpusSeeded += 1;
  }

  return {
    inventorySeeded: inventorySeeded.seededCount,
    reverseAtsCompanySeeded: reverseAtsSeeded.companySeededCount,
    reverseAtsSourceProvisioned: reverseAtsSeeded.sourceProvisionedCount,
    catalogSeeded,
    corpusSeeded,
    totalSeeded:
      inventorySeeded.seededCount +
      reverseAtsSeeded.companySeededCount +
      catalogSeeded +
      corpusSeeded,
  };
}

async function assignCanonicalJobsToCompanyByKey(companyKey: string) {
  const company = await prisma.company.findUnique({
    where: { companyKey },
    select: { id: true },
  });

  if (!company) return;
  await assignCanonicalJobsToCompany(company.id, companyKey);
}

export async function enqueueCompanyDiscoveryTasks(options: {
  limit?: number;
  now?: Date;
} = {}) {
  const now = options.now ?? new Date();
  const discoveryLimit = options.limit ?? DISCOVERY_TASK_LIMIT;
  await syncCompaniesFromJobs({ limit: discoveryLimit * 30 });
  await seedCompanyDiscoveryUniverse({
    inventoryLimit: Math.max(3_000, discoveryLimit * 100),
    existingAtsLimit: Math.max(750, discoveryLimit * 24),
    catalogLimit: Math.max(600, discoveryLimit * 14),
    corpusLimit: Math.max(3_500, discoveryLimit * 70),
  });

  const candidates = await prisma.company.findMany({
    where: {
      OR: [
        { discoveryStatus: { in: ["PENDING", "FAILED", "NEEDS_REVIEW"] } },
        { lastDiscoveryAt: null },
        { sources: { none: {} } },
      ],
    },
    include: {
      jobs: {
        where: { status: { in: ["LIVE", "AGING"] } },
        select: { id: true },
        take: 10,
      },
      sources: { select: { id: true } },
    },
    take: Math.max(
      (options.limit ?? DISCOVERY_TASK_LIMIT) * 6,
      options.limit ?? DISCOVERY_TASK_LIMIT
    ),
  });

  const companies = candidates
    .sort((left, right) => {
      const leftSeedSource = readSeedSource(left.metadataJson);
      const rightSeedSource = readSeedSource(right.metadataJson);
      const leftScore =
        (left.sources.length === 0 ? 50 : 0) +
        (left.detectedAts ? 40 : 0) +
        (left.careersUrl ? 18 : 0) +
        computeCompanyFrontierSeedBoost(leftSeedSource, "discovery") +
        Math.round(left.discoveryConfidence * 20) +
        Math.min(30, left.jobs.length * 3) +
        (left.discoveryStatus === "FAILED" ? -20 : 0) +
        (left.lastDiscoveryAt ? 0 : 15);
      const rightScore =
        (right.sources.length === 0 ? 50 : 0) +
        (right.detectedAts ? 40 : 0) +
        (right.careersUrl ? 18 : 0) +
        computeCompanyFrontierSeedBoost(rightSeedSource, "discovery") +
        Math.round(right.discoveryConfidence * 20) +
        Math.min(30, right.jobs.length * 3) +
        (right.discoveryStatus === "FAILED" ? -20 : 0) +
        (right.lastDiscoveryAt ? 0 : 15);

      if (rightScore !== leftScore) return rightScore - leftScore;
      return (right.updatedAt?.getTime?.() ?? 0) - (left.updatedAt?.getTime?.() ?? 0);
    })
    .slice(0, options.limit ?? DISCOVERY_TASK_LIMIT);

  for (const company of companies) {
    const seedSource = readSeedSource(company.metadataJson);
    const priorityScore =
      Math.min(40, company.jobs.length * 3) +
      (company.sources.length === 0 ? 30 : 0) +
      (company.careersUrl ? 12 : 0) +
      computeCompanyFrontierSeedBoost(seedSource, "poll-bootstrap") +
      (company.discoveryStatus === "FAILED" ? -10 : 15) +
      Math.max(0, 20 - Math.round(company.discoveryConfidence * 20));

    await enqueueUniqueSourceTask({
      kind: "COMPANY_DISCOVERY",
      companyId: company.id,
      priorityScore,
      notBeforeAt: now,
    });
  }

  return {
    enqueuedCount: companies.length,
    companyIds: companies.map((company) => company.id),
  };
}

export async function enqueueRediscoveryTasks(options: {
  limit?: number;
  now?: Date;
} = {}) {
  const now = options.now ?? new Date();
  const sources = await prisma.companySource.findMany({
    where: {
      OR: [
        { status: "REDISCOVER_REQUIRED" },
        { validationState: "NEEDS_REDISCOVERY" },
        { status: "DEGRADED", consecutiveFailures: { gte: REDISCOVERY_FAILURE_THRESHOLD } },
      ],
    },
    orderBy: [
      { consecutiveFailures: "desc" },
      { lastDiscoveryAt: "asc" },
      { priorityScore: "desc" },
    ],
    take: options.limit ?? REDISCOVERY_TASK_LIMIT,
  });

  for (const source of sources) {
    await enqueueUniqueSourceTask({
      kind: "REDISCOVERY",
      companyId: source.companyId,
      companySourceId: source.id,
      priorityScore: 60 + source.consecutiveFailures * 5,
      notBeforeAt: now,
    });
  }

  return {
    enqueuedCount: sources.length,
    companySourceIds: sources.map((source) => source.id),
  };
}

export async function enqueueSourceValidationTasks(options: {
  limit?: number;
  now?: Date;
  companySourceIds?: string[];
  frontierOnly?: boolean;
  growthMode?: boolean;
} = {}) {
  const now = options.now ?? new Date();
  const frontierOnly = options.frontierOnly ?? DEFAULT_FRONTIER_ONLY_POLLING;
  const growthMode = options.growthMode ?? GROWTH_MODE_ENABLED;
  const targetIds =
    options.companySourceIds && options.companySourceIds.length > 0
      ? new Set(options.companySourceIds)
      : null;
  const requestedLimit = options.limit ?? SOURCE_VALIDATION_TASK_LIMIT;
  const sources = await prisma.companySource.findMany({
    where: {
      status: { not: "DISABLED" },
      validationState: { in: ["UNVALIDATED", "SUSPECT", "NEEDS_REDISCOVERY", "BLOCKED"] },
      OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }],
      ...(targetIds ? { id: { in: [...targetIds] } } : {}),
    },
    include: {
      company: {
        select: {
          discoveryConfidence: true,
          metadataJson: true,
          jobs: {
            where: { status: { in: ["LIVE", "AGING"] } },
            select: { id: true },
            take: 25,
          },
        },
      },
    },
    orderBy: [
      { validationState: "asc" },
      { priorityScore: "desc" },
      { updatedAt: "asc" },
    ],
    take: targetIds
      ? Math.max(requestedLimit, targetIds.size)
      : growthMode || frontierOnly
        ? Math.max(requestedLimit * GROWTH_SOURCE_QUERY_MULTIPLIER, requestedLimit + 750)
        : requestedLimit,
  });

  const scheduledSources = [...sources]
    .filter((source) => {
      if (targetIds && !targetIds.has(source.id)) {
        return false;
      }

      if (!frontierOnly) {
        return true;
      }

      return isGrowthFrontierCandidate({
        now,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt,
        pollAttemptCount: source.pollAttemptCount,
        sourceType: source.sourceType,
        metadataJson: source.metadataJson,
        companyMetadataJson: source.company.metadataJson,
      }).frontierCandidate;
    })
    .sort((left, right) => {
      const leftFrontier = isGrowthFrontierCandidate({
        now,
        createdAt: left.createdAt,
        updatedAt: left.updatedAt,
        pollAttemptCount: left.pollAttemptCount,
        sourceType: left.sourceType,
        metadataJson: left.metadataJson,
        companyMetadataJson: left.company.metadataJson,
      }).frontierCandidate;
      const rightFrontier = isGrowthFrontierCandidate({
        now,
        createdAt: right.createdAt,
        updatedAt: right.updatedAt,
        pollAttemptCount: right.pollAttemptCount,
        sourceType: right.sourceType,
        metadataJson: right.metadataJson,
        companyMetadataJson: right.company.metadataJson,
      }).frontierCandidate;

      if (leftFrontier !== rightFrontier) {
        return leftFrontier ? -1 : 1;
      }

      if (right.priorityScore !== left.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }

      return left.updatedAt.getTime() - right.updatedAt.getTime();
    })
    .slice(0, requestedLimit);

  for (const source of scheduledSources) {
    const historicalYield = source.company.jobs.length;
    const priorityScore = computeValidationPriorityScore({
      now,
      priorityScore: source.priorityScore,
      sourceQualityScore: clampSourceQualityScore(source.sourceQualityScore),
      yieldScore: source.yieldScore,
      discoveryConfidence: source.company.discoveryConfidence,
      historicalYield,
      validationState: source.validationState,
      consecutiveFailures: source.consecutiveFailures,
      validationAttemptCount: source.validationAttemptCount,
      validationSuccessCount: source.validationSuccessCount,
      sourceType: source.sourceType,
      parserVersion: source.parserVersion,
      metadataJson: source.metadataJson,
      companyMetadataJson: source.company.metadataJson,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    });

    await enqueueUniqueSourceTask({
      kind: "SOURCE_VALIDATION",
      companyId: source.companyId,
      companySourceId: source.id,
      priorityScore,
      notBeforeAt: now,
    });
  }

  return {
    enqueuedCount: scheduledSources.length,
    companySourceIds: scheduledSources.map((source) => source.id),
  };
}

export async function enqueueCompanySourcePollTasks(options: {
  limit?: number;
  now?: Date;
  companySourceIds?: string[];
  frontierOnly?: boolean;
  growthMode?: boolean;
} = {}) {
  const now = options.now ?? new Date();
  const pollLimit = options.limit ?? COMPANY_SOURCE_POLL_LIMIT;
  const frontierOnly = options.frontierOnly ?? DEFAULT_FRONTIER_ONLY_POLLING;
  const growthMode = options.growthMode ?? GROWTH_MODE_ENABLED;
  const targetIds =
    options.companySourceIds && options.companySourceIds.length > 0
      ? new Set(options.companySourceIds)
      : null;
  const admissionBudgetMs = computePollAdmissionBudgetMs();
  const workdayHostMetrics = await buildWorkdayHostMetrics(now);
  let candidates = await prisma.companySource.findMany({
    where: {
      status: { in: ["PROVISIONED", "ACTIVE", "DEGRADED"] },
      validationState: "VALIDATED",
      pollState: { in: ["READY", "ACTIVE", "BACKOFF"] },
      OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }],
      tasks: {
        none: {
          kind: "CONNECTOR_POLL",
          status: "RUNNING",
        },
      },
      ...(targetIds ? { id: { in: [...targetIds] } } : {}),
    },
    include: {
      company: {
        select: {
          id: true,
          discoveryConfidence: true,
          metadataJson: true,
          jobs: {
            where: { status: { in: ["LIVE", "AGING"] } },
            select: { id: true },
            take: 25,
          },
        },
      },
    },
    orderBy: [{ priorityScore: "desc" }, { lastSuccessfulPollAt: "asc" }],
    take: targetIds
      ? Math.max(pollLimit, targetIds.size)
      : growthMode || frontierOnly
        ? Math.max(pollLimit * GROWTH_SOURCE_QUERY_MULTIPLIER, pollLimit + 1_200)
        : Math.max(pollLimit * 6, pollLimit + 600),
  });
  const productiveRefreshBackfillIds = new Set<string>();
  if (!targetIds) {
    const overdueProductiveCandidates = await prisma.companySource.findMany({
      where: {
        status: { in: ["ACTIVE", "DEGRADED"] },
        validationState: "VALIDATED",
        // BACKOFF sources hold real live supply too (73k jobs at the time of
        // the July 2026 decline investigation); once their cooldown expires
        // they must be reachable by the retention lane, not stranded.
        pollState: { in: ["READY", "BACKOFF"] },
        OR: [{ cooldownUntil: null }, { cooldownUntil: { lte: now } }],
        retainedLiveJobCount: { gt: 0 },
        tasks: {
          none: {
            kind: "CONNECTOR_POLL",
            status: { in: ["PENDING", "RUNNING"] },
          },
        },
      },
      include: {
        company: {
          select: {
            id: true,
            discoveryConfidence: true,
            metadataJson: true,
            jobs: {
              where: { status: { in: ["LIVE", "AGING"] } },
              select: { id: true },
              take: 25,
            },
          },
        },
      },
      orderBy: [
        { lastSuccessfulPollAt: "asc" },
        { retainedLiveJobCount: "desc" },
        { sourceQualityScore: "desc" },
      ],
      take: PRODUCTIVE_SOURCE_BACKFILL_QUERY_LIMIT,
    });

    const candidateById = new Map(candidates.map((source) => [source.id, source]));
    for (const source of overdueProductiveCandidates) {
      if (productiveRefreshBackfillIds.size >= PRODUCTIVE_SOURCE_BACKFILL_LIMIT) {
        break;
      }

      if (!isCompanySourceOverdueForPoll(source, now)) {
        continue;
      }

      productiveRefreshBackfillIds.add(source.id);
      if (!candidateById.has(source.id)) {
        candidateById.set(source.id, source);
      }
    }

    candidates = [...candidateById.values()];
  }
  const recentYieldMetrics = await buildRecentSourceYieldMetrics(
    candidates.map((source) => source.sourceName),
    now
  );

  const scoredSources = candidates.map((source) => {
    const historicalYield = source.company.jobs.length;
    const recentYield = recentYieldMetrics.get(source.sourceName);
    const recentCanonicalCreatedCount = recentYield?.canonicalCreatedCount7d ?? 0;
    const recentRemovedCount = recentYield?.removedCount7d ?? 0;
    const recentAcceptedCount = recentYield?.acceptedCount7d ?? 0;
    const recentRunCount = recentYield?.runCount7d ?? 0;
    const recentCanonicalCreatedCount24h =
      recentYield?.canonicalCreatedCount24h ?? 0;
    const recentAcceptedCount24h = recentYield?.acceptedCount24h ?? 0;
    const recentNetCreatedCount =
      recentCanonicalCreatedCount - recentRemovedCount;
    const basePriorityScore = computePollPriorityScore({
      now,
      connectorName: source.connectorName,
      priorityScore: source.priorityScore,
      sourceQualityScore: clampSourceQualityScore(source.sourceQualityScore),
      yieldScore: source.yieldScore,
      discoveryConfidence: source.company.discoveryConfidence,
      historicalYield,
      status: source.status,
      consecutiveFailures: source.consecutiveFailures,
      pollAttemptCount: source.pollAttemptCount,
      pollSuccessCount: source.pollSuccessCount,
      jobsAcceptedCount: source.jobsAcceptedCount,
      jobsCreatedCount: source.jobsCreatedCount,
      lastJobsAcceptedCount: source.lastJobsAcceptedCount,
      lastJobsCreatedCount: source.lastJobsCreatedCount,
      retainedLiveJobCount: source.retainedLiveJobCount,
      recentCanonicalCreatedCount,
      recentAcceptedCount,
      sourceType: source.sourceType,
      parserVersion: source.parserVersion,
      metadataJson: source.metadataJson,
      companyMetadataJson: source.company.metadataJson,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      lastSuccessfulPollAt: source.lastSuccessfulPollAt,
    });
    const workdayHost = getWorkdayHostKey({
      connectorName: source.connectorName,
      token: source.token,
      boardUrl: source.boardUrl,
    });
    const hostMetrics = workdayHost ? workdayHostMetrics.get(workdayHost) ?? null : null;

    const workdayValueScore =
      source.connectorName === "workday"
        ? computeWorkdayValueScore({
            pollAttemptCount: source.pollAttemptCount,
            pollSuccessCount: source.pollSuccessCount,
            jobsAcceptedCount: source.jobsAcceptedCount,
            retainedLiveJobCount: source.retainedLiveJobCount,
          })
        : null;
    const recentSuccessRate =
      source.pollAttemptCount > 0 ? source.pollSuccessCount / source.pollAttemptCount : 0;
    const estimatedRuntimeMs = estimateSourcePollRuntimeMs({
      connectorName: source.connectorName,
      sourceType: source.sourceType,
      metadataJson: source.metadataJson,
      pollAttemptCount: source.pollAttemptCount,
      consecutiveFailures: source.consecutiveFailures,
      hostMetrics,
    });
    const blockedRisk = computeBlockedRisk({
      connectorName: source.connectorName,
      pollState: source.pollState,
      consecutiveFailures: source.consecutiveFailures,
      lastHttpStatus: source.lastHttpStatus,
      hostMetrics,
    });
    const velocitySignals = computePollVelocitySignals({
      recentCanonicalCreatedCount,
      recentAcceptedCount,
      recentRunCount,
      estimatedRuntimeMs,
      pollAttemptCount: source.pollAttemptCount,
      pollSuccessCount: source.pollSuccessCount,
      jobsFetchedCount: source.jobsFetchedCount,
      jobsDedupedCount: source.jobsDedupedCount,
    });
    const expectedAcceptedJobs = computeExpectedAcceptedJobs({
      now,
      connectorName: source.connectorName,
      sourceType: source.sourceType,
      sourceQualityScore: clampSourceQualityScore(source.sourceQualityScore),
      yieldScore: source.yieldScore,
      pollAttemptCount: source.pollAttemptCount,
      pollSuccessCount: source.pollSuccessCount,
      jobsAcceptedCount: source.jobsAcceptedCount,
      jobsCreatedCount: source.jobsCreatedCount,
      lastJobsAcceptedCount: source.lastJobsAcceptedCount,
      lastJobsCreatedCount: source.lastJobsCreatedCount,
      retainedLiveJobCount: source.retainedLiveJobCount,
      canonicalCreatedCount7d: recentCanonicalCreatedCount,
      acceptedCount7d: recentAcceptedCount,
      metadataJson: source.metadataJson,
      companyMetadataJson: source.company.metadataJson,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      lastSuccessfulPollAt: source.lastSuccessfulPollAt,
    });
    const noveltyRatio = computeNoveltyRatio({
      canonicalCreatedCount7d: recentCanonicalCreatedCount,
      acceptedCount7d: recentAcceptedCount,
      jobsCreatedCount: source.jobsCreatedCount,
      jobsAcceptedCount: source.jobsAcceptedCount,
      lastJobsCreatedCount: source.lastJobsCreatedCount,
      lastJobsAcceptedCount: source.lastJobsAcceptedCount,
    });
    const workdayTier =
      workdayValueScore === null ? null : getWorkdayTier(workdayValueScore);
    const tier = classifyPollTier({
      now,
      connectorName: source.connectorName,
      sourceType: source.sourceType,
      pollAttemptCount: source.pollAttemptCount,
      pollSuccessCount: source.pollSuccessCount,
      lastJobsCreatedCount: source.lastJobsCreatedCount,
      retainedLiveJobCount: source.retainedLiveJobCount,
      blockedRisk,
      workdayTier,
      canonicalCreatedCount7d: recentCanonicalCreatedCount,
      acceptedCount7d: recentAcceptedCount,
      jobsAcceptedCount: source.jobsAcceptedCount,
      jobsCreatedCount: source.jobsCreatedCount,
      metadataJson: source.metadataJson,
      companyMetadataJson: source.company.metadataJson,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      lastSuccessfulPollAt: source.lastSuccessfulPollAt,
      velocitySignals,
    });
    const efficiencyScore = computePollEfficiencyScore({
      basePriorityScore,
      estimatedRuntimeMs,
      expectedAcceptedJobs,
      blockedRisk,
      recentSuccessRate,
      retainedLiveJobCount: source.retainedLiveJobCount,
      canonicalCreatedCount7d: recentCanonicalCreatedCount,
      acceptedCount7d: recentAcceptedCount,
      noveltyRatio,
      velocitySignals,
    });
    const priorityScore = computeQueuePriorityScore({
      tier,
      efficiencyScore,
      basePriorityScore,
    });
    const suppressedForLowNoveltyAts = shouldSuppressRecoveryAtsSource({
      sourceType: source.sourceType,
      pollSuccessCount: source.pollSuccessCount,
      recentAcceptedCount: recentYield?.acceptedCount7d ?? 0,
      recentCanonicalCreatedCount: recentYield?.canonicalCreatedCount7d ?? 0,
      jobsAcceptedCount: source.jobsAcceptedCount,
      jobsCreatedCount: source.jobsCreatedCount,
      lastJobsCreatedCount: source.lastJobsCreatedCount,
      noveltyRatio,
    });
    const growthSignals = computeGrowthModePollSignals({
      now,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      lastSuccessfulPollAt: source.lastSuccessfulPollAt,
      pollAttemptCount: source.pollAttemptCount,
      pollSuccessCount: source.pollSuccessCount,
      recentAcceptedCount,
      recentCanonicalCreatedCount,
      jobsAcceptedCount: source.jobsAcceptedCount,
      jobsCreatedCount: source.jobsCreatedCount,
      lastJobsCreatedCount: source.lastJobsCreatedCount,
      noveltyRatio,
      sourceType: source.sourceType,
      metadataJson: source.metadataJson,
      companyMetadataJson: source.company.metadataJson,
    });
    // Deadline-driven retention pressure: every source whose retained live
    // jobs are approaching the feed's 14-day evidence window gains urgency —
    // not just the capped backfill lane. Near the cliff the source is also
    // exempt from growth churn penalties: its "churn" is usually our own
    // stale-evidence removals, and penalizing it creates a death spiral
    // (staler -> more removals -> lower priority -> staler).
    const retentionPolicyInput = {
      now,
      lastSuccessfulPollAt: source.lastSuccessfulPollAt,
      fallbackReferenceAt: source.updatedAt ?? source.createdAt,
      retainedLiveJobCount: source.retainedLiveJobCount,
    };
    const retentionUrgency = computeRetentionUrgency(retentionPolicyInput);
    const retentionPriorityBoost =
      computeRetentionPriorityBoost(retentionPolicyInput);
    const retentionPenaltyExempt =
      shouldExemptFromGrowthPenalties(retentionPolicyInput);
    const churnHeavyCooldown =
      targetIds === null &&
      !retentionPenaltyExempt &&
      isGrowthChurnHeavySource({
        frontierCandidate: growthSignals.frontierCandidate,
        recentCanonicalCreatedCount,
        recentRemovedCount,
        lastJobsCreatedCount: source.lastJobsCreatedCount,
      });
    const churnPriorityPenalty = churnHeavyCooldown
      ? GROWTH_CHURN_HEAVY_PRIORITY_PENALTY +
        Math.min(1_200, Math.abs(Math.min(recentNetCreatedCount, 0)) * 4)
      : 0;
    const growthNetNegativePriorityPenalty =
      growthMode &&
      !retentionPenaltyExempt &&
      recentRunCount > 0 &&
      recentNetCreatedCount < 0
        ? Math.min(
            1_800,
            Math.abs(recentNetCreatedCount) * 45 + recentRemovedCount * 12
          )
        : 0;
    const slowLowYieldCooldown = shouldCooldownSlowLowYieldSource({
      connectorName: source.connectorName,
      sourceType: source.sourceType,
      pollAttemptCount: source.pollAttemptCount,
      pollSuccessCount: source.pollSuccessCount,
      lastJobsCreatedCount: source.lastJobsCreatedCount,
      retainedLiveJobCount: source.retainedLiveJobCount,
      recentCanonicalCreatedCount,
      recentAcceptedCount,
      recentRunCount,
      estimatedRuntimeMs,
      blockedRisk,
      velocitySignals,
      frontierCandidate: growthSignals.frontierCandidate,
    });
    const sourceOverdueForPoll = isCompanySourceOverdueForPoll(source, now);
    const productiveRefreshBackfill = productiveRefreshBackfillIds.has(source.id);
    // The deadline-driven retention boost supersedes the old lane-only
    // formula; lane members keep a small floor so freshly-overdue productive
    // sources still rank ahead of zero-history candidates.
    const productiveRefreshBackfillBoost = Math.max(
      retentionPriorityBoost,
      productiveRefreshBackfill && source.retainedLiveJobCount > 0 ? 240 : 0
    );
    const zeroGrowthPollDefer =
      growthMode &&
      !productiveRefreshBackfill &&
      !retentionPenaltyExempt &&
      shouldDeferZeroGrowthPollSource(
        {
          pollAttemptCount: source.pollAttemptCount,
          lastJobsCreatedCount: source.lastJobsCreatedCount,
          jobsCreatedCount: source.jobsCreatedCount,
          recentAcceptedCount: recentAcceptedCount24h,
          recentCanonicalCreatedCount: recentCanonicalCreatedCount24h,
          retainedLiveJobCount: source.retainedLiveJobCount,
          overdueByCadence: sourceOverdueForPoll,
        },
        { acceptedThreshold: COMPANY_SOURCE_ZERO_GROWTH_ACCEPTED_THRESHOLD }
      );

    return {
      source,
      priorityScore: Math.max(
        0,
        priorityScore +
          productiveRefreshBackfillBoost -
          churnPriorityPenalty -
          growthNetNegativePriorityPenalty
      ),
      basePriorityScore,
      workdayValueScore,
      workdayTier,
      tier,
      workdayHost,
      hostMetrics,
      recentSuccessRate,
      estimatedRuntimeMs,
      expectedAcceptedJobs,
      blockedRisk,
      efficiencyScore:
        efficiencyScore + Math.min(30, productiveRefreshBackfillBoost / 100),
      velocitySignals,
      noveltyRatio,
      recentCanonicalCreatedCount,
      recentRemovedCount,
      recentNetCreatedCount,
      suppressedForLowNoveltyAts:
        suppressedForLowNoveltyAts && !retentionPenaltyExempt,
      frontierCandidate: growthSignals.frontierCandidate,
      productiveRefreshBackfill,
      retentionUrgency: retentionUrgency.urgency,
      retentionHoursUntilCliff: retentionUrgency.hoursUntilEvidenceCliff,
      retentionPenaltyExempt,
      hardCooldownForGrowth:
        growthSignals.shouldHardCooldown &&
        !productiveRefreshBackfill &&
        !retentionPenaltyExempt,
      churnHeavyCooldown: churnHeavyCooldown && !productiveRefreshBackfill,
      slowLowYieldCooldown:
        slowLowYieldCooldown &&
        !productiveRefreshBackfill &&
        !retentionPenaltyExempt,
      zeroGrowthPollDefer,
    };
  }).filter(({ hostMetrics, source, frontierCandidate }) => {
    if (SKIP_GENERIC_COMPANY_SITE_POLLS && source.connectorName === "company-site") {
      return false;
    }

    if (hostMetrics?.cooldownUntil && hostMetrics.cooldownUntil > now) {
      return false;
    }

    if (targetIds && !targetIds.has(source.id)) {
      return false;
    }

    if (frontierOnly && !frontierCandidate) {
      return false;
    }

    return true;
  });

  const suppressedLowNoveltyAtsSourceIds = scoredSources
    .filter((candidate) => candidate.suppressedForLowNoveltyAts)
    .map((candidate) => candidate.source.id);
  const hardCooldownGrowthSourceIds = scoredSources
    .filter((candidate) => candidate.hardCooldownForGrowth)
    .map((candidate) => candidate.source.id);
  const churnHeavyCooldownSourceIds = scoredSources
    .filter((candidate) => candidate.churnHeavyCooldown)
    .map((candidate) => candidate.source.id);
  const slowLowYieldCooldownSourceIds = targetIds
    ? []
    : scoredSources
        .filter((candidate) => candidate.slowLowYieldCooldown)
        .map((candidate) => candidate.source.id);
  const eligibleScoredSources = scoredSources.filter(
    (candidate) =>
      !candidate.suppressedForLowNoveltyAts &&
      !candidate.hardCooldownForGrowth &&
      !candidate.churnHeavyCooldown &&
      (!candidate.slowLowYieldCooldown || targetIds !== null) &&
      (!candidate.zeroGrowthPollDefer || targetIds !== null)
  );

  const orderedByTier = (tier: PollTier) =>
    pickBalancedPollSources(
      eligibleScoredSources.filter((candidate) => candidate.tier === tier),
      eligibleScoredSources.length,
      (left, right) => {
        if (right.efficiencyScore !== left.efficiencyScore) {
          return right.efficiencyScore - left.efficiencyScore;
        }

        return (
          (left.source.lastSuccessfulPollAt?.getTime() ?? 0) -
          (right.source.lastSuccessfulPollAt?.getTime() ?? 0)
        );
      }
    );

  const tierCandidates = {
    TIER_1: orderedByTier("TIER_1"),
    TIER_2: orderedByTier("TIER_2"),
    TIER_3: orderedByTier("TIER_3"),
  } satisfies Record<PollTier, typeof scoredSources>;

  const connectorCounts = new Map<string, number>();
  const selectedSources: typeof scoredSources = [];
  const selectedIds = new Set<string>();
  let carryBudgetMs = 0;

  // Retention lane: reserved admission slice for sources whose retained live
  // jobs are approaching the evidence cliff, ordered earliest-deadline-first.
  // Tier admission below orders by efficiency (yield per runtime), which
  // structurally starves pure re-confirmation polls; this lane guarantees
  // they are admitted before the feed hides supply that is still live.
  const retentionBudgetMs = Math.round(
    admissionBudgetMs * RETENTION_ADMISSION_BUDGET_RATIO
  );
  if (retentionBudgetMs > 0) {
    let retentionUsedMs = 0;
    const retentionLaneCandidates = eligibleScoredSources
      .filter((candidate) => candidate.retentionUrgency > 0)
      .sort(
        (left, right) =>
          left.retentionHoursUntilCliff - right.retentionHoursUntilCliff
      );

    for (const candidate of retentionLaneCandidates) {
      if (selectedSources.length >= pollLimit) break;
      if (selectedIds.has(candidate.source.id)) continue;

      const connectorCap =
        CONNECTOR_POLL_CYCLE_CAPS[candidate.source.connectorName];
      const currentConnectorCount =
        connectorCounts.get(candidate.source.connectorName) ?? 0;
      if (
        typeof connectorCap === "number" &&
        currentConnectorCount >= connectorCap
      ) {
        continue;
      }

      const projectedMs = retentionUsedMs + candidate.estimatedRuntimeMs;
      if (projectedMs > retentionBudgetMs && retentionUsedMs > 0) {
        continue;
      }

      selectedSources.push(candidate);
      selectedIds.add(candidate.source.id);
      connectorCounts.set(
        candidate.source.connectorName,
        currentConnectorCount + 1
      );
      retentionUsedMs = projectedMs;
    }
  }

  const tierConfigs: Array<{ tier: PollTier; budgetRatio: number }> = [
    { tier: "TIER_1", budgetRatio: COMPANY_SOURCE_POLL_TIER_1_BUDGET_RATIO },
    { tier: "TIER_2", budgetRatio: COMPANY_SOURCE_POLL_TIER_2_BUDGET_RATIO },
    { tier: "TIER_3", budgetRatio: COMPANY_SOURCE_POLL_TIER_3_BUDGET_RATIO },
  ];

  for (const { tier, budgetRatio } of tierConfigs) {
    const candidatesForTier = tierCandidates[tier];
    const tierBudgetMs = Math.round(admissionBudgetMs * budgetRatio) + carryBudgetMs;
    let tierUsedMs = 0;

    for (const candidate of candidatesForTier) {
      if (selectedSources.length >= pollLimit) break;
      if (selectedIds.has(candidate.source.id)) continue;

      const connectorCap = CONNECTOR_POLL_CYCLE_CAPS[candidate.source.connectorName];
      const currentConnectorCount = connectorCounts.get(candidate.source.connectorName) ?? 0;
      if (typeof connectorCap === "number" && currentConnectorCount >= connectorCap) {
        continue;
      }

      const projectedMs = tierUsedMs + candidate.estimatedRuntimeMs;
      if (projectedMs > tierBudgetMs && tierUsedMs > 0) {
        continue;
      }

      selectedSources.push(candidate);
      selectedIds.add(candidate.source.id);
      connectorCounts.set(candidate.source.connectorName, currentConnectorCount + 1);
      tierUsedMs = projectedMs;
    }

    carryBudgetMs = Math.max(0, tierBudgetMs - tierUsedMs);
  }

  const remainingCandidates = [...eligibleScoredSources]
    .filter((candidate) => !selectedIds.has(candidate.source.id))
    .sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }

      return right.efficiencyScore - left.efficiencyScore;
    });

  let totalSelectedRuntimeMs = selectedSources.reduce(
    (sum, candidate) => sum + candidate.estimatedRuntimeMs,
    0
  );

  for (const candidate of remainingCandidates) {
    if (selectedSources.length >= pollLimit) break;
    if (totalSelectedRuntimeMs + candidate.estimatedRuntimeMs > admissionBudgetMs) break;

    const connectorCap = CONNECTOR_POLL_CYCLE_CAPS[candidate.source.connectorName];
    const currentConnectorCount = connectorCounts.get(candidate.source.connectorName) ?? 0;
    if (typeof connectorCap === "number" && currentConnectorCount >= connectorCap) {
      continue;
    }

    selectedSources.push(candidate);
    selectedIds.add(candidate.source.id);
    connectorCounts.set(candidate.source.connectorName, currentConnectorCount + 1);
    totalSelectedRuntimeMs += candidate.estimatedRuntimeMs;
  }

  const deferredTier2SourceIds = scoredSources
    .filter(
      (candidate) =>
        !candidate.suppressedForLowNoveltyAts &&
        candidate.tier === "TIER_2" &&
        !selectedIds.has(candidate.source.id)
    )
    .map((candidate) => candidate.source.id);
  const deferredTier3SourceIds = scoredSources
    .filter(
      (candidate) =>
        !candidate.suppressedForLowNoveltyAts &&
        candidate.tier === "TIER_3" &&
        !selectedIds.has(candidate.source.id)
    )
    .map((candidate) => candidate.source.id);

  if (deferredTier2SourceIds.length > 0) {
    await prisma.sourceTask.updateMany({
      where: {
        kind: "CONNECTOR_POLL",
        status: "PENDING",
        notBeforeAt: { lte: now },
        companySourceId: { in: deferredTier2SourceIds },
      },
      data: {
        notBeforeAt: new Date(
          now.getTime() + COMPANY_SOURCE_POLL_DEFER_TIER_2_MINUTES * 60 * 1000
        ),
      },
    });
  }

  if (deferredTier3SourceIds.length > 0) {
    await prisma.sourceTask.updateMany({
      where: {
        kind: "CONNECTOR_POLL",
        status: "PENDING",
        notBeforeAt: { lte: now },
        companySourceId: { in: deferredTier3SourceIds },
      },
      data: {
        notBeforeAt: new Date(
          now.getTime() + COMPANY_SOURCE_POLL_DEFER_TIER_3_MINUTES * 60 * 1000
        ),
      },
    });
  }

  if (suppressedLowNoveltyAtsSourceIds.length > 0) {
    const suppressionUntil = new Date(
      now.getTime() + COMPANY_SOURCE_RECOVERY_SUPPRESSED_ATS_DEFER_MINUTES * 60 * 1000
    );

    await prisma.sourceTask.updateMany({
      where: {
        kind: "CONNECTOR_POLL",
        status: "PENDING",
        companySourceId: { in: suppressedLowNoveltyAtsSourceIds },
      },
      data: {
        notBeforeAt: suppressionUntil,
      },
    });

    await prisma.companySource.updateMany({
      where: {
        id: { in: suppressedLowNoveltyAtsSourceIds },
        OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: suppressionUntil } }],
      },
      data: {
        cooldownUntil: suppressionUntil,
        pollState: "BACKOFF",
        validationMessage:
          "Recovery novelty suppression: ATS source recently refreshed many known jobs without creating enough new canonicals.",
      },
    });
  }

  if (hardCooldownGrowthSourceIds.length > 0) {
    const suppressionUntil = new Date(
      now.getTime() + GROWTH_HARD_COOLDOWN_HOURS * 60 * 60 * 1000
    );

    await prisma.sourceTask.updateMany({
      where: {
        kind: "CONNECTOR_POLL",
        status: "PENDING",
        companySourceId: { in: hardCooldownGrowthSourceIds },
      },
      data: {
        notBeforeAt: suppressionUntil,
      },
    });

    await prisma.companySource.updateMany({
      where: {
        id: { in: hardCooldownGrowthSourceIds },
        OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: suppressionUntil } }],
      },
      data: {
        cooldownUntil: suppressionUntil,
        pollState: "BACKOFF",
        validationMessage:
          "Growth mode cooldown: source recently refreshed many known jobs without creating enough new canonicals.",
      },
    });
  }

  if (churnHeavyCooldownSourceIds.length > 0) {
    const suppressionUntil = new Date(
      now.getTime() + GROWTH_CHURN_HEAVY_COOLDOWN_HOURS * 60 * 60 * 1000
    );

    await prisma.sourceTask.updateMany({
      where: {
        kind: "CONNECTOR_POLL",
        status: "PENDING",
        companySourceId: { in: churnHeavyCooldownSourceIds },
      },
      data: {
        notBeforeAt: suppressionUntil,
      },
    });

    await prisma.companySource.updateMany({
      where: {
        id: { in: churnHeavyCooldownSourceIds },
        OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: suppressionUntil } }],
      },
      data: {
        cooldownUntil: suppressionUntil,
        pollState: "BACKOFF",
        validationMessage:
          "Growth mode cooldown: source recently removed far more canonical jobs than it created; refresh later without crowding out net-new source polling.",
      },
    });
  }

  if (slowLowYieldCooldownSourceIds.length > 0) {
    const suppressionUntil = new Date(
      now.getTime() + COMPANY_SOURCE_SLOW_LOW_YIELD_COOLDOWN_HOURS * 60 * 60 * 1000
    );

    await prisma.sourceTask.updateMany({
      where: {
        kind: "CONNECTOR_POLL",
        status: "PENDING",
        companySourceId: { in: slowLowYieldCooldownSourceIds },
      },
      data: {
        notBeforeAt: suppressionUntil,
      },
    });

    await prisma.companySource.updateMany({
      where: {
        id: { in: slowLowYieldCooldownSourceIds },
        OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: suppressionUntil } }],
      },
      data: {
        cooldownUntil: suppressionUntil,
        pollState: "BACKOFF",
        validationMessage:
          "Throughput cooldown: source is slow or failure-prone and has not created enough new canonical jobs recently.",
      },
    });
  }

  for (const candidate of selectedSources) {
    await enqueueUniqueSourceTask({
      kind: "CONNECTOR_POLL",
      companyId: candidate.source.companyId,
      companySourceId: candidate.source.id,
      priorityScore: candidate.priorityScore,
      notBeforeAt: now,
      payloadJson: {
        blockedRisk: Math.round(candidate.blockedRisk * 1000) / 1000,
        efficiencyScore: Math.round(candidate.efficiencyScore * 1000) / 1000,
        estimatedRuntimeMs: candidate.estimatedRuntimeMs,
        expectedAcceptedJobs:
          Math.round(candidate.expectedAcceptedJobs * 100) / 100,
        createdPerMinute7d:
          Math.round(candidate.velocitySignals.createdPerMinute7d * 1000) / 1000,
        acceptedPerMinute7d:
          Math.round(candidate.velocitySignals.acceptedPerMinute7d * 1000) / 1000,
        duplicateRate:
          Math.round(candidate.velocitySignals.duplicateRate * 1000) / 1000,
        failureRate:
          Math.round(candidate.velocitySignals.failureRate * 1000) / 1000,
        tier: candidate.tier,
        workdayHost: candidate.workdayHost,
        workdayTier: candidate.workdayTier,
        recentCanonicalCreatedCount7d: candidate.recentCanonicalCreatedCount,
        recentRemovedCount7d: candidate.recentRemovedCount,
        recentNetCreatedCount7d: candidate.recentNetCreatedCount,
      },
    });
  }

  return {
    enqueuedCount: selectedSources.length,
    companySourceIds: selectedSources.map(({ source }) => source.id),
    suppressedLowNoveltyAtsCount: suppressedLowNoveltyAtsSourceIds.length,
    churnHeavyCooldownCount: churnHeavyCooldownSourceIds.length,
    slowLowYieldCooldownCount: slowLowYieldCooldownSourceIds.length,
  };
}

export async function runCompanyDiscoveryQueue(options: {
  limit?: number;
  now?: Date;
} = {}) {
  const now = options.now ?? new Date();
  const tasks = await claimSourceTasks("COMPANY_DISCOVERY", options.limit ?? DISCOVERY_TASK_LIMIT, now);
  return runDiscoveryTasks(tasks, now, false);
}

export async function runRediscoveryQueue(options: {
  limit?: number;
  now?: Date;
} = {}) {
  const now = options.now ?? new Date();
  const tasks = await claimSourceTasks("REDISCOVERY", options.limit ?? REDISCOVERY_TASK_LIMIT, now);
  return runDiscoveryTasks(tasks, now, true);
}

export async function runSourceValidationQueue(options: {
  limit?: number;
  now?: Date;
  companySourceIds?: string[];
} = {}) {
  const now = options.now ?? new Date();
  const tasks = await claimSourceTasks(
    "SOURCE_VALIDATION",
    options.limit ?? SOURCE_VALIDATION_TASK_LIMIT,
    now,
    { companySourceIds: options.companySourceIds }
  );

  let successCount = 0;
  let failedCount = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor]!;
      cursor += 1;

      try {
        if (!task.companySourceId) {
          await finishSourceTask(task.id, "SKIPPED", {
            finishedAt: now,
            lastError: "No company source is attached to validation task.",
          });
          continue;
        }

        await runSourceValidation(task.companySourceId, now);
        successCount += 1;
        await finishSourceTask(task.id, "SUCCESS", { finishedAt: now });
      } catch (error) {
        failedCount += 1;
        await handleCompanySourceValidationFailure(task.companySourceId, now, error);
        await finishSourceTask(task.id, "FAILED", {
          lastError: error instanceof Error ? error.message : String(error),
          retryAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
        });
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(SOURCE_VALIDATION_QUEUE_CONCURRENCY, tasks.length) },
      () => worker()
    )
  );

  return {
    processedCount: tasks.length,
    successCount,
    failedCount,
  };
}

async function selectRuntimeAdmittedConnectorPollTasks(input: {
  tasks: SourceTask[];
  connectorCounts: Map<string, number>;
  now: Date;
}) {
  const sourceIds = [
    ...new Set(
      input.tasks
        .map((task) => task.companySourceId)
        .filter((sourceId): sourceId is string => Boolean(sourceId))
    ),
  ];

  const sources = sourceIds.length
    ? await prisma.companySource.findMany({
        where: { id: { in: sourceIds } },
        select: { id: true, connectorName: true },
      })
    : [];
  const connectorBySourceId = new Map(
    sources.map((source) => [source.id, source.connectorName] as const)
  );

  const batchConnectorCounts = new Map<string, number>();
  const admittedTasks: SourceTask[] = [];
  const skippedGenericCompanySiteTaskIds: string[] = [];
  const deferredBatchOverflowTaskIds: string[] = [];
  const deferredCycleOverflowTaskIds: string[] = [];

  for (const task of input.tasks) {
    const connectorName = task.companySourceId
      ? connectorBySourceId.get(task.companySourceId)
      : null;

    if (!connectorName) {
      admittedTasks.push(task);
      continue;
    }

    if (SKIP_GENERIC_COMPANY_SITE_POLLS && connectorName === "company-site") {
      skippedGenericCompanySiteTaskIds.push(task.id);
      continue;
    }

    const runtimeCycleCap =
      CONNECTOR_POLL_RUNTIME_CYCLE_CAPS[connectorName] ??
      Number.MAX_SAFE_INTEGER;
    const runtimeBatchCap =
      CONNECTOR_POLL_RUNTIME_BATCH_CAPS[connectorName] ??
      Number.MAX_SAFE_INTEGER;
    const currentCycleCount = input.connectorCounts.get(connectorName) ?? 0;
    const currentBatchCount = batchConnectorCounts.get(connectorName) ?? 0;

    if (currentCycleCount >= runtimeCycleCap) {
      deferredCycleOverflowTaskIds.push(task.id);
      continue;
    }

    if (currentBatchCount >= runtimeBatchCap) {
      deferredBatchOverflowTaskIds.push(task.id);
      continue;
    }

    admittedTasks.push(task);
    input.connectorCounts.set(connectorName, currentCycleCount + 1);
    batchConnectorCounts.set(connectorName, currentBatchCount + 1);
  }

  const resetDeferredTasks = async (taskIds: string[], retryMs: number) => {
    if (taskIds.length === 0) return;
    await prisma.sourceTask.updateMany({
      where: {
        id: { in: taskIds },
        status: "RUNNING",
      },
      data: {
        status: "PENDING",
        startedAt: null,
        finishedAt: null,
        notBeforeAt: new Date(input.now.getTime() + retryMs),
        lastError:
          "Deferred by connector runtime admission control to avoid source-level rate limits.",
      },
    });
  };

  if (skippedGenericCompanySiteTaskIds.length > 0) {
    await prisma.sourceTask.updateMany({
      where: {
        id: { in: skippedGenericCompanySiteTaskIds },
        status: "RUNNING",
      },
      data: {
        status: "SKIPPED",
        finishedAt: input.now,
        lastError:
          "Skipped generic company-site poll because INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS is enabled.",
      },
    });
  }

  await resetDeferredTasks(
    deferredBatchOverflowTaskIds,
    CONNECTOR_POLL_BATCH_OVERFLOW_RETRY_MS
  );
  await resetDeferredTasks(
    deferredCycleOverflowTaskIds,
    CONNECTOR_POLL_CYCLE_OVERFLOW_RETRY_MS
  );

  return {
    admittedTasks,
    skippedGenericCompanySiteCount: skippedGenericCompanySiteTaskIds.length,
    deferredBatchOverflowCount: deferredBatchOverflowTaskIds.length,
    deferredCycleOverflowCount: deferredCycleOverflowTaskIds.length,
  };
}

export async function runCompanySourcePollQueue(options: {
  limit?: number;
  now?: Date;
  maxWallClockMs?: number;
  companySourceIds?: string[];
} = {}) {
  const maxTasks = options.limit ?? COMPANY_SOURCE_POLL_LIMIT;
  const maxWallClockMs = options.maxWallClockMs ?? COMPANY_SOURCE_POLL_QUEUE_WALL_CLOCK_MS;
  const softStopMs = computePollSoftStopMs(maxWallClockMs);
  const queueStart = Date.now();
  let successCount = 0;
  let failedCount = 0;
  let processedCount = 0;
  let lastStaleRunRecoveryAt = 0;
  const runtimeConnectorCounts = new Map<string, number>();
  let zeroAdmissionDeferralBatches = 0;

  const recoverCompanySourceStaleRuns = async (recoveryNow: Date) => {
    const recovery = await recoverStaleRunningIngestionRuns({
      now: recoveryNow,
      companySourceOnly: true,
    });
    if (recovery.recoveredCount > 0) {
      console.log(
        `[sourcePollQueue] Recovered ${recovery.recoveredCount} stale company-source ingestion run(s): ${recovery.connectorKeys.join(", ")}`
      );
    }
    lastStaleRunRecoveryAt = Date.now();
  };

  await recoverCompanySourceStaleRuns(options.now ?? new Date());

  while (processedCount < maxTasks) {
    const elapsed = Date.now() - queueStart;
    if (Date.now() - lastStaleRunRecoveryAt >= COMPANY_SOURCE_STALE_RUN_RECOVERY_INTERVAL_MS) {
      await recoverCompanySourceStaleRuns(new Date());
    }
    const remainingWallClockMs = maxWallClockMs - elapsed;
    if (remainingWallClockMs <= COMPANY_SOURCE_POLL_MIN_REMAINING_BUDGET_MS) {
      console.log(
        `[sourcePollQueue] Wall-clock cap reached (${Math.round(elapsed / 1000)}s / ${Math.round(maxWallClockMs / 1000)}s) — stopping after ${processedCount} tasks`
      );
      break;
    }
    if (elapsed >= softStopMs) {
      console.log(
        `[sourcePollQueue] Soft stop reached (${Math.round(elapsed / 1000)}s / ${Math.round(maxWallClockMs / 1000)}s) — stopping admissions after ${processedCount} tasks`
      );
      break;
    }

    const remaining = maxTasks - processedCount;
    const batchConcurrency =
      remainingWallClockMs <= COMPANY_SOURCE_POLL_END_STAGE_WINDOW_MS
        ? COMPANY_SOURCE_POLL_CRITICAL_TIME_CONCURRENCY
        : remainingWallClockMs <= COMPANY_SOURCE_POLL_LATE_STAGE_WINDOW_MS
          ? COMPANY_SOURCE_POLL_LOW_TIME_CONCURRENCY
          : EFFECTIVE_COMPANY_SOURCE_POLL_CONCURRENCY;
    const effectiveRemainingMs = Math.max(
      0,
      remainingWallClockMs - COMPANY_SOURCE_POLL_BATCH_GRACE_MS
    );
    const batchRuntimeCeilingMs =
      remainingWallClockMs <= COMPANY_SOURCE_POLL_END_STAGE_WINDOW_MS
        ? Math.floor(effectiveRemainingMs * 0.5)
        : remainingWallClockMs <= COMPANY_SOURCE_POLL_LATE_STAGE_WINDOW_MS
          ? Math.floor(effectiveRemainingMs * 0.7)
          : effectiveRemainingMs;
    const batchRuntimeMs = Math.max(
      COMPANY_SOURCE_POLL_MIN_REMAINING_BUDGET_MS,
      Math.min(
        COMPANY_SOURCE_POLL_MAX_RUNTIME_MS,
        batchRuntimeCeilingMs
      )
    );
    const batchNow = new Date();
    const excludedConnectorNames =
      getRuntimeCycleExhaustedConnectorNames(runtimeConnectorCounts);
    const excludedConnectorWhere =
      excludedConnectorNames.length > 0
        ? {
            OR: [
              { companySourceId: null },
              {
                companySource: {
                  connectorName: { notIn: excludedConnectorNames },
                },
              },
            ],
          } satisfies Prisma.SourceTaskWhereInput
        : {};
    const previewTasks = await prisma.sourceTask.findMany({
      where: {
        kind: "CONNECTOR_POLL",
        status: "PENDING",
        notBeforeAt: { lte: batchNow },
        ...excludedConnectorWhere,
        ...(options.companySourceIds && options.companySourceIds.length > 0
          ? { companySourceId: { in: options.companySourceIds } }
          : {}),
      },
      orderBy: [{ priorityScore: "desc" }, { createdAt: "asc" }],
      take: Math.max(
        Math.min(batchConcurrency, remaining) * COMPANY_SOURCE_POLL_PREVIEW_MULTIPLIER,
        Math.min(batchConcurrency, remaining)
      ),
      select: {
        payloadJson: true,
      },
    });
    const claimLimit = estimateClaimablePollTaskCountFromPreview(
      previewTasks,
      Math.min(batchConcurrency, remaining),
      Math.max(0, effectiveRemainingMs)
    );

    if (claimLimit === 0) {
      if (previewTasks.length === 0) {
        console.log(
          `[sourcePollQueue] No eligible due connector poll tasks after cooldown and source-family caps — stopping after ${processedCount} tasks`
        );
      } else {
        console.log(
          `[sourcePollQueue] Remaining budget too small to admit another poll batch (${Math.round(remainingWallClockMs / 1000)}s left) — stopping after ${processedCount} tasks`
        );
      }
      break;
    }

    const tasks = await claimSourceTasks(
      "CONNECTOR_POLL",
      claimLimit,
      batchNow,
      { companySourceIds: options.companySourceIds, excludedConnectorNames }
    );

    if (tasks.length === 0) {
      break;
    }

    const admission = await selectRuntimeAdmittedConnectorPollTasks({
      tasks,
      connectorCounts: runtimeConnectorCounts,
      now: batchNow,
    });
    const admittedTasks = admission.admittedTasks;
    if (
      admission.skippedGenericCompanySiteCount > 0 ||
      admission.deferredBatchOverflowCount > 0 ||
      admission.deferredCycleOverflowCount > 0
    ) {
      console.log(
        `[sourcePollQueue] Skipped ${admission.skippedGenericCompanySiteCount} generic company-site, deferred ${admission.deferredBatchOverflowCount} batch-overflow and ${admission.deferredCycleOverflowCount} cycle-overflow connector poll task(s) by source family cap.`
      );
    }

    if (admittedTasks.length === 0) {
      if (admission.skippedGenericCompanySiteCount > 0) {
        zeroAdmissionDeferralBatches = 0;
        continue;
      }

      zeroAdmissionDeferralBatches += 1;
      if (zeroAdmissionDeferralBatches >= 3) {
        console.log(
          `[sourcePollQueue] Stopping after ${zeroAdmissionDeferralBatches} consecutive batches admitted no runnable tasks because connector family caps deferred all claimed tasks.`
        );
        break;
      }
      continue;
    }
    zeroAdmissionDeferralBatches = 0;

    let cursor = 0;

    async function worker() {
      while (cursor < admittedTasks.length) {
        const task = admittedTasks[cursor]!;
        cursor += 1;

        try {
          if (!task.companySourceId) {
            await finishSourceTask(task.id, "SKIPPED", {
              finishedAt: new Date(),
              lastError: "No company source is attached to connector poll task.",
            });
            continue;
          }

          const taskStartedAt = new Date();
          await pollCompanySource(task.companySourceId, taskStartedAt, batchRuntimeMs);
          successCount += 1;
          await finishSourceTask(task.id, "SUCCESS", { finishedAt: new Date() });
        } catch (error) {
          failedCount += 1;
          const taskFailedAt = new Date();
          let cooldownUntil: Date | null = null;
          try {
            cooldownUntil = await handleCompanySourcePollFailure(
              task.companySourceId,
              taskFailedAt,
              error
            );
          } catch (failureHandlingError) {
            console.error(
              `[sourcePollQueue] Failed to update source failure state for task ${task.id}:`,
              failureHandlingError instanceof Error
                ? (failureHandlingError.stack ?? failureHandlingError.message)
                : failureHandlingError
            );
          }
          await finishSourceTask(task.id, "FAILED", {
            lastError: error instanceof Error ? error.message : String(error),
            retryAt: cooldownUntil ?? new Date(taskFailedAt.getTime() + 60 * 60 * 1000),
          });
        }
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(batchConcurrency, admittedTasks.length) },
        () => worker()
      )
    );

    processedCount += admittedTasks.length;
  }

  return {
    processedCount,
    successCount,
    failedCount,
  };
}

export async function runCompanySourcePollSlice(options: {
  companySourceIds: string[];
  limit?: number;
  now?: Date;
  maxRuntimeMs?: number;
  concurrency?: number;
}) {
  const companySourceIds = [...new Set(options.companySourceIds.filter(Boolean))];
  if (companySourceIds.length === 0) {
    return {
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
    };
  }

  const now = options.now ?? new Date();
  const maxRuntimeMs = options.maxRuntimeMs ?? COMPANY_SOURCE_POLL_MAX_RUNTIME_MS;
  const tasks = await claimSourceTasks(
    "CONNECTOR_POLL",
    Math.min(options.limit ?? companySourceIds.length, companySourceIds.length),
    now,
    { companySourceIds }
  );

  let successCount = 0;
  let failedCount = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor]!;
      cursor += 1;

      try {
        if (!task.companySourceId) {
          await finishSourceTask(task.id, "SKIPPED", {
            finishedAt: new Date(),
            lastError: "No company source is attached to connector poll task.",
          });
          continue;
        }

        await pollCompanySource(task.companySourceId, new Date(), maxRuntimeMs);
        successCount += 1;
        await finishSourceTask(task.id, "SUCCESS", { finishedAt: new Date() });
    } catch (error) {
      failedCount += 1;
      const taskFailedAt = new Date();
      let cooldownUntil: Date | null = null;
      try {
        cooldownUntil = await handleCompanySourcePollFailure(
          task.companySourceId,
          taskFailedAt,
          error
        );
      } catch (failureHandlingError) {
        console.error(
          `[sourcePollQueue] Failed to update source failure state for task ${task.id}:`,
          failureHandlingError instanceof Error
            ? (failureHandlingError.stack ?? failureHandlingError.message)
            : failureHandlingError
        );
      }
      await finishSourceTask(task.id, "FAILED", {
        lastError: error instanceof Error ? error.message : String(error),
        retryAt: cooldownUntil ?? new Date(taskFailedAt.getTime() + 60 * 60 * 1000),
      });
    }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(options.concurrency ?? FRONTIER_POLL_SLICE_CONCURRENCY, tasks.length) },
      () => worker()
    )
  );

  return {
    processedCount: tasks.length,
    successCount,
    failedCount,
  };
}

async function runDiscoveryTasks(tasks: SourceTask[], now: Date, isRediscovery: boolean) {
  let successCount = 0;
  let failedCount = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor]!;
      cursor += 1;

      try {
        if (!task.companyId) {
          await finishSourceTask(task.id, "SKIPPED", {
            finishedAt: now,
            lastError: "No company attached to discovery task.",
          });
          continue;
        }

        await discoverCompanySurface(task.companyId, now, isRediscovery);
        successCount += 1;
        await finishSourceTask(task.id, "SUCCESS", { finishedAt: now });
      } catch (error) {
        failedCount += 1;
        await finishSourceTask(task.id, "FAILED", {
          lastError: error instanceof Error ? error.message : String(error),
          retryAt: new Date(now.getTime() + 3 * 60 * 60 * 1000),
        });
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(DISCOVERY_QUEUE_CONCURRENCY, tasks.length) },
      () => worker()
    )
  );

  return {
    processedCount: tasks.length,
    successCount,
    failedCount,
  };
}

async function discoverCompanySurface(
  companyId: string,
  now: Date,
  isRediscovery: boolean
) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: {
      sources: true,
      discoveryPages: true,
    },
  });

  if (!company) {
    throw new Error(`Company ${companyId} not found for discovery.`);
  }

  await prisma.company.update({
    where: { id: company.id },
    data: {
      discoveryStatus: "DISCOVERING",
      crawlStatus: "ACTIVE",
      lastDiscoveryAt: now,
      lastRediscoveryAt: isRediscovery ? now : company.lastRediscoveryAt,
      lastDiscoveryError: null,
    },
  });

  const knownStatuses = new Map<string, "pending" | "rejected" | "promoted">();
  for (const source of company.sources) {
    const status =
      source.status === "DISABLED"
        ? "rejected"
        : source.status === "ACTIVE"
          ? "promoted"
          : "pending";
    knownStatuses.set(source.sourceName.toLowerCase(), status);
  }

  const record = buildEnterpriseRecordForCompany(company);
  const discovery = await discoverEnterpriseCareerPageCandidates({
    companies: [record],
    knownStatuses,
  });

  let discoveredSourceCount = 0;
  let atsSourceName: string | null = null;

  for (const candidate of discovery.records) {
    await persistAtsCandidate(
      company.id,
      {
        ...candidate,
        sourceName: buildDiscoveredSourceName(
          candidate.connectorName as DiscoveredSourceCandidate["connectorName"],
          candidate.token
        ),
      },
      now
    );
    discoveredSourceCount += 1;
    atsSourceName = atsSourceName ?? candidate.connectorName;
  }

  const candidatePages = new Set<string>();
  if (company.careersUrl) candidatePages.add(company.careersUrl);
  if (company.domain) {
    candidatePages.add(`https://${company.domain}/careers`);
    candidatePages.add(`https://${company.domain}/jobs`);
  }

  for (const recordCandidate of discovery.records) {
    for (const careerPageUrl of recordCandidate.careerPageUrls) {
      candidatePages.add(careerPageUrl);
    }
  }

  let bestCustomRoute: {
    url: string;
    extractionRoute: ExtractionRouteKind;
    parserVersion: string;
    confidence: number;
    metadata: Record<string, Prisma.InputJsonValue | null>;
  } | null = null;

  const seedSource = readSeedSource(company.metadataJson);
  const orderedCandidatePages = prioritizeCareerPageUrls([...candidatePages]);
  const inspectionLimit =
    seedSource === "csv-job-board-seed"
      ? Math.min(MAX_CAREER_PAGE_INSPECTIONS_CSV_IMPORT, orderedCandidatePages.length)
      : Math.min(MAX_CAREER_PAGE_INSPECTIONS, orderedCandidatePages.length);

  for (const pageUrl of orderedCandidatePages.slice(0, inspectionLimit)) {
    try {
      const inspection = await inspectCompanySiteRoute(pageUrl);
      await prisma.companyDiscoveryPage.upsert({
        where: {
          companyId_url: {
            companyId: company.id,
            url: inspection.finalUrl,
          },
        },
        create: {
          companyId: company.id,
          url: inspection.finalUrl,
          confidence: inspection.confidence,
          isChosen: false,
          extractorRoute: inspection.extractionRoute,
          parserVersion: inspection.parserVersion,
          lastCheckedAt: now,
          metadataJson: inspection.metadata as Prisma.InputJsonValue,
        },
        update: {
          confidence: inspection.confidence,
          extractorRoute: inspection.extractionRoute,
          parserVersion: inspection.parserVersion,
          lastCheckedAt: now,
          lastError: null,
          metadataJson: inspection.metadata as Prisma.InputJsonValue,
        },
      });

      if (
        inspection.extractionRoute !== "UNKNOWN" &&
        (!bestCustomRoute || inspection.confidence > bestCustomRoute.confidence)
      ) {
        bestCustomRoute = {
          url: inspection.finalUrl,
          extractionRoute: inspection.extractionRoute,
          parserVersion: inspection.parserVersion,
          confidence: inspection.confidence,
          metadata: inspection.metadata,
        };
      }
    } catch (error) {
      await prisma.companyDiscoveryPage.upsert({
        where: {
          companyId_url: {
            companyId: company.id,
            url: pageUrl,
          },
        },
        create: {
          companyId: company.id,
          url: pageUrl,
          confidence: 0,
          isChosen: false,
          extractorRoute: "UNKNOWN",
          lastCheckedAt: now,
          failureCount: 1,
          lastError: error instanceof Error ? error.message : String(error),
        },
        update: {
          confidence: 0,
          extractorRoute: "UNKNOWN",
          lastCheckedAt: now,
          failureCount: { increment: 1 },
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  const fallbackRoute = bestCustomRoute ?? buildWeakFallbackRoute(company);

  let customSourceProvisioned = false;
  const shouldProvisionParallelCompanySite =
    seedSource === "csv-job-board-seed" &&
    bestCustomRoute !== null &&
    bestCustomRoute.extractionRoute !== "HTML_FALLBACK" &&
    bestCustomRoute.confidence >= 0.7 &&
    !isKnownAtsBoardUrl(bestCustomRoute.url);

  if (
    fallbackRoute &&
    (discoveredSourceCount === 0 || shouldProvisionParallelCompanySite)
  ) {
    const provisionedSource = await provisionCompanySiteSource(
      company.id,
      company.companyKey,
      fallbackRoute,
      now
    );
    customSourceProvisioned = provisionedSource !== null;
  }

  const nextStatus: CompanyDiscoveryStatus =
    discoveredSourceCount > 0 || customSourceProvisioned
      ? "DISCOVERED"
      : fallbackRoute
        ? "NEEDS_REVIEW"
        : "FAILED";

  await prisma.company.update({
    where: { id: company.id },
    data: {
      careersUrl: company.careersUrl ?? fallbackRoute?.url ?? null,
      detectedAts: atsSourceName,
      discoveryConfidence:
        fallbackRoute?.confidence ??
        (discoveredSourceCount > 0 ? 0.9 : company.discoveryConfidence),
      discoveryStatus: nextStatus,
      crawlStatus: nextStatus === "FAILED" ? "FAILED" : "IDLE",
      lastDiscoveryAt: now,
      lastSuccessfulPollAt:
        discoveredSourceCount > 0 || customSourceProvisioned
          ? company.lastSuccessfulPollAt
          : null,
      lastDiscoveryError:
        nextStatus === "FAILED" ? "No ATS or structured career surface was confirmed." : null,
    },
  });
}

async function persistAtsCandidate(
  companyId: string,
  candidate: {
    sourceName: string;
    connectorName: string;
    token: string;
    boardUrl: string;
    atsTenantId?: string | null;
    careerPageUrls: string[];
    directAtsUrls: string[];
    matchedReasons: string[];
    metadataJson?: Record<string, Prisma.InputJsonValue | null> | null;
  },
  now: Date
) {
  const candidateMetadata = mergeMetadataJson(candidate.metadataJson as Prisma.JsonValue, {
    matchedReasons: candidate.matchedReasons,
    careerPageUrls: candidate.careerPageUrls,
    directAtsUrls: candidate.directAtsUrls,
  }) as Prisma.InputJsonValue;

  for (const pageUrl of candidate.careerPageUrls) {
    await prisma.companyDiscoveryPage.upsert({
      where: {
        companyId_url: {
          companyId,
          url: pageUrl,
        },
      },
      create: {
        companyId,
        url: pageUrl,
        confidence: 0.92,
        isChosen: true,
        extractorRoute: "ATS_NATIVE",
        parserVersion: "ats-native:v1",
        lastCheckedAt: now,
        metadataJson: candidateMetadata,
      },
      update: {
        confidence: 0.92,
        isChosen: true,
        extractorRoute: "ATS_NATIVE",
        parserVersion: "ats-native:v1",
        lastCheckedAt: now,
        lastError: null,
        metadataJson: candidateMetadata,
      },
    });
  }

  const companySource = await upsertCompanySourceByIdentity({
    identity: {
      companyId,
      atsTenantId: candidate.atsTenantId ?? null,
      sourceName: candidate.sourceName,
      connectorName: candidate.connectorName,
      token: candidate.token,
    },
    create: {
      companyId,
      atsTenantId: candidate.atsTenantId ?? null,
      sourceName: candidate.sourceName,
      connectorName: candidate.connectorName,
      token: candidate.token,
      boardUrl: candidate.boardUrl,
      status: "PROVISIONED",
      validationState: "UNVALIDATED",
      pollState: "READY",
      sourceType: "ATS",
      extractionRoute: "ATS_NATIVE",
      parserVersion: "ats-native:v1",
      pollingCadenceMinutes: DEFAULT_SOURCE_POLL_CADENCE_MINUTES,
      priorityScore: 0.95,
      sourceQualityScore: 0.8,
      yieldScore: 0.56,
      firstSeenAt: now,
      lastProvisionedAt: now,
      lastDiscoveryAt: now,
      metadataJson: candidateMetadata,
    },
    update: {
      companyId,
      atsTenantId: candidate.atsTenantId ?? null,
      boardUrl: candidate.boardUrl,
      status: "PROVISIONED",
      validationState: "UNVALIDATED",
      pollState: "READY",
      sourceType: "ATS",
      extractionRoute: "ATS_NATIVE",
      parserVersion: "ats-native:v1",
      priorityScore: Math.max(0.95, 0.9),
      sourceQualityScore: Math.max(0.8, 0.75),
      yieldScore: Math.max(0.56, 0.75 * 0.7),
      lastProvisionedAt: now,
      lastDiscoveryAt: now,
      lastValidatedAt: null,
      lastHttpStatus: null,
      consecutiveFailures: 0,
      failureStreak: 0,
      validationMessage: null,
      metadataJson: candidateMetadata,
    },
  });

  await enqueueUniqueSourceTask({
    kind: "SOURCE_VALIDATION",
    companyId,
    companySourceId: companySource.id,
    priorityScore: 95,
    notBeforeAt: now,
  });

  return companySource;
}

export async function promoteDiscoveredAtsCompanySource(
  companyId: string,
  candidate: {
    sourceName: string;
    connectorName: string;
    token: string;
    boardUrl: string;
    atsTenantId?: string | null;
    careerPageUrls: string[];
    directAtsUrls: string[];
    matchedReasons: string[];
    metadataJson?: Record<string, Prisma.InputJsonValue | null> | null;
  },
  now: Date
) {
  return persistAtsCandidate(companyId, candidate, now);
}

async function provisionCompanySiteSource(
  companyId: string,
  companyKey: string,
  route: {
    url: string;
    extractionRoute: ExtractionRouteKind;
    parserVersion: string;
    confidence: number;
    metadata: Record<string, Prisma.InputJsonValue | null>;
  },
  now: Date
) {
  const sourceName =
    route.extractionRoute === "STRUCTURED_JSON" ||
    route.extractionRoute === "STRUCTURED_API" ||
    route.extractionRoute === "STRUCTURED_SITEMAP"
      ? `CompanyJson:${companyKey}`
      : `CompanyHtml:${companyKey}`;

  const tombstone = await readCompanySourceTombstone(companyId);
  if (
    tombstone.invalidSourceNames.has(sourceName) ||
    tombstone.invalidSourceUrls.has(normalizeTombstonedSourceUrl(route.url))
  ) {
    console.warn(
      `[company-discovery] Skipping tombstoned company-site source ${sourceName} (${route.url})`
    );
    return null;
  }

  const companySource = await upsertCompanySourceByIdentity({
    identity: {
      companyId,
      sourceName,
      connectorName: "company-site",
      token: companyKey,
    },
    create: {
      companyId,
      sourceName,
      connectorName: "company-site",
      token: companyKey,
      boardUrl: route.url,
      status: "PROVISIONED",
      validationState: "UNVALIDATED",
      pollState: "READY",
      sourceType:
        route.extractionRoute === "HTML_FALLBACK" ? "COMPANY_HTML" : "COMPANY_JSON",
      extractionRoute: route.extractionRoute,
      parserVersion: route.parserVersion,
      pollingCadenceMinutes:
        route.extractionRoute === "HTML_FALLBACK" ? 720 : DEFAULT_SOURCE_POLL_CADENCE_MINUTES,
      priorityScore: route.confidence,
      sourceQualityScore: Math.max(0.18, route.confidence),
      yieldScore: Math.max(0.08, Math.max(0.18, route.confidence) * 0.55),
      firstSeenAt: now,
      lastProvisionedAt: now,
      lastDiscoveryAt: now,
      metadataJson: route.metadata as Prisma.InputJsonValue,
    },
    update: {
      companyId,
      boardUrl: route.url,
      status: "PROVISIONED",
      validationState: "UNVALIDATED",
      pollState: "READY",
      sourceType:
        route.extractionRoute === "HTML_FALLBACK" ? "COMPANY_HTML" : "COMPANY_JSON",
      extractionRoute: route.extractionRoute,
      parserVersion: route.parserVersion,
      pollingCadenceMinutes:
        route.extractionRoute === "HTML_FALLBACK" ? 720 : DEFAULT_SOURCE_POLL_CADENCE_MINUTES,
      priorityScore: route.confidence,
      sourceQualityScore: Math.max(0.18, route.confidence),
      yieldScore: Math.max(0.08, Math.max(0.18, route.confidence) * 0.55),
      lastProvisionedAt: now,
      lastDiscoveryAt: now,
      lastValidatedAt: null,
      lastHttpStatus: null,
      consecutiveFailures: 0,
      failureStreak: 0,
      validationMessage: null,
      metadataJson: route.metadata as Prisma.InputJsonValue,
    },
  });

  await prisma.companyDiscoveryPage.updateMany({
    where: { companyId },
    data: { isChosen: false },
  });
  await prisma.companyDiscoveryPage.updateMany({
    where: { companyId, url: route.url },
    data: { isChosen: true },
  });

  await enqueueUniqueSourceTask({
    kind: "SOURCE_VALIDATION",
    companyId,
    companySourceId: companySource.id,
    priorityScore: Math.round(route.confidence * 100),
    notBeforeAt: now,
  });

  return companySource;
}

async function readCompanySourceTombstone(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { metadataJson: true },
  });
  const metadata =
    company?.metadataJson &&
    typeof company.metadataJson === "object" &&
    !Array.isArray(company.metadataJson)
      ? (company.metadataJson as Record<string, Prisma.JsonValue>)
      : {};

  return {
    invalidSourceNames: new Set(readStringArray(metadata.invalidSourceNames)),
    invalidSourceUrls: new Set(
      readStringArray(metadata.invalidSourceUrls).map((url) =>
        normalizeTombstonedSourceUrl(url)
      )
    ),
  };
}

function normalizeTombstonedSourceUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    return url.toString().replace(/\/+$/, "");
  } catch {
    return value.trim().toLowerCase().replace(/\/+$/, "");
  }
}

export async function promoteCompanySiteSourceRoute(
  companyId: string,
  companyKey: string,
  route: {
    url: string;
    extractionRoute: ExtractionRouteKind;
    parserVersion: string;
    confidence: number;
    metadata: Record<string, Prisma.InputJsonValue | null>;
  },
  now: Date
) {
  return provisionCompanySiteSource(companyId, companyKey, route, now);
}

function buildWeakFallbackRoute(company: {
  domain: string | null;
  careersUrl: string | null;
  discoveryPages: Array<{ url: string; confidence: number; extractorRoute: ExtractionRouteKind }>;
}) {
  const chosenPage =
    company.discoveryPages
      .filter((page) => page.extractorRoute !== "UNKNOWN")
      .sort((left, right) => right.confidence - left.confidence)[0] ??
    company.discoveryPages
      .sort((left, right) => right.confidence - left.confidence)[0] ??
    null;

  const url =
    company.careersUrl ??
    chosenPage?.url ??
    (company.domain ? `https://${company.domain}/careers` : null) ??
    (company.domain ? `https://${company.domain}/jobs` : null);

  if (!url) return null;

  return {
    url,
    extractionRoute: "HTML_FALLBACK" as const,
    parserVersion: "company-site:fallback-v2",
    confidence: Math.max(0.18, chosenPage?.confidence ?? 0.18),
    metadata: {
      reason: "weak-discovery-fallback",
      chosenPageUrl: chosenPage?.url ?? null,
      chosenPageConfidence: chosenPage?.confidence ?? null,
    } satisfies Record<string, Prisma.InputJsonValue | null>,
  };
}

function prioritizeCareerPageUrls(urls: string[]) {
  return [...urls].sort((left, right) => scoreCareerPageUrl(right) - scoreCareerPageUrl(left));
}

function scoreCareerPageUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const path = parsed.pathname.toLowerCase();
    return (
      (isKnownAtsHost(host) ? -20 : 25) +
      (/\/careers?|\/jobs?|\/join|\/work/.test(path) ? 20 : 0) +
      (/\/job\/|\/jobs\/[^/]+/.test(path) ? 6 : 0) +
      (path === "/" ? -8 : 0)
    );
  } catch {
    return 0;
  }
}

function isKnownAtsBoardUrl(url: string) {
  try {
    return isKnownAtsHost(new URL(url).hostname.replace(/^www\./i, "").toLowerCase());
  } catch {
    return false;
  }
}

async function runSourceValidation(companySourceId: string, now: Date) {
  const source = await prisma.companySource.findUnique({
    where: { id: companySourceId },
    include: { company: { select: { id: true, name: true } } },
  });

  if (!source) {
    throw new Error(`Company source ${companySourceId} not found.`);
  }

  await prisma.companySource.update({
    where: { id: source.id },
    data: {
      validationState: "VALIDATING",
      validationMessage: null,
    },
  });

  const result = await validateCompanySource(source, now);
  const nextFailureCount =
    result.kind === "VALIDATED" ? 0 : source.consecutiveFailures + 1;
  const nextValidationAttemptCount = source.validationAttemptCount + 1;
  const nextValidationSuccessCount =
    source.validationSuccessCount + (result.kind === "VALIDATED" ? 1 : 0);
  const nextStatus =
    result.kind === "VALIDATED"
      ? source.lastSuccessfulPollAt
        ? "ACTIVE"
        : "PROVISIONED"
      : result.kind === "INVALID" || result.kind === "NEEDS_REDISCOVERY"
        ? "REDISCOVER_REQUIRED"
        : "DEGRADED";

  const nextYieldScore = computeSourceYieldScore({
    sourceQualityScore: result.sourceQualityScore,
    pollAttemptCount: source.pollAttemptCount,
    pollSuccessCount: source.pollSuccessCount,
    jobsFetchedCount: source.jobsFetchedCount,
    jobsAcceptedCount: source.jobsAcceptedCount,
    jobsCreatedCount: source.jobsCreatedCount,
    retainedLiveJobCount: source.retainedLiveJobCount,
    overlapRatio: source.overlapRatio,
  });
  const recommendedCooldownUntil =
    result.recommendedCooldownMinutes > 0
      ? new Date(now.getTime() + result.recommendedCooldownMinutes * 60 * 1000)
      : null;
  const preservedFutureCooldownUntil =
    source.cooldownUntil && source.cooldownUntil > now ? source.cooldownUntil : null;

  await prisma.companySource.update({
    where: { id: source.id },
    data: {
      status: nextStatus,
      validationState: result.validationState,
      pollState: result.pollState,
      lastValidatedAt: now,
      lastFailureAt: result.kind === "VALIDATED" ? null : now,
      lastHttpStatus: result.httpStatus,
      cooldownUntil: recommendedCooldownUntil ?? preservedFutureCooldownUntil,
      validationAttemptCount: nextValidationAttemptCount,
      validationSuccessCount: nextValidationSuccessCount,
      consecutiveFailures: nextFailureCount,
      failureStreak: nextFailureCount,
      sourceQualityScore: result.sourceQualityScore,
      yieldScore: nextYieldScore,
      validationMessage: result.message,
    },
  });

  const companyUpdateData: Prisma.CompanyUpdateInput = {
    crawlStatus:
      result.kind === "VALIDATED"
        ? "IDLE"
        : result.kind === "BLOCKED"
          ? "BLOCKED"
          : result.kind === "INVALID" || result.kind === "NEEDS_REDISCOVERY"
            ? "DEGRADED"
            : "ACTIVE",
    lastDiscoveryError: result.kind === "VALIDATED" ? null : result.message,
  };

  if (result.kind === "VALIDATED") {
    companyUpdateData.discoveryStatus = "DISCOVERED";
  } else if (result.kind === "INVALID" || result.kind === "NEEDS_REDISCOVERY") {
    companyUpdateData.discoveryStatus = "NEEDS_REVIEW";
  }

  await prisma.company.update({
    where: { id: source.companyId },
    data: companyUpdateData,
  });

  if (result.kind === "VALIDATED") {
    const shouldFastTrackPoll =
      result.jobsFound > 0 ||
      source.pollSuccessCount > 0 ||
      source.retainedLiveJobCount > 0;

    if (shouldFastTrackPoll) {
      await enqueueUniqueSourceTask({
        kind: "CONNECTOR_POLL",
        companyId: source.companyId,
        companySourceId: source.id,
        priorityScore: Math.max(70, Math.round(source.priorityScore * 100)),
        notBeforeAt: now,
      });
    }
    return;
  }

  if (
    result.kind === "INVALID" ||
    result.kind === "NEEDS_REDISCOVERY" ||
    (result.kind === "SUSPECT" &&
      nextFailureCount >= HARD_FAILURE_REDISCOVERY_THRESHOLD &&
      !result.softDiscoveryMiss)
  ) {
    await prisma.companySource.update({
      where: { id: source.id },
      data: {
        status: "REDISCOVER_REQUIRED",
        validationState:
          result.kind === "SUSPECT" ? "NEEDS_REDISCOVERY" : result.validationState,
        pollState: "QUARANTINED",
      },
    });

    await enqueueUniqueSourceTask({
      kind: "REDISCOVERY",
      companyId: source.companyId,
      companySourceId: source.id,
      priorityScore: 90,
      notBeforeAt: now,
    });
  }
}

function resolveCompanySourceConnectorPollLimit(source: {
  connectorName: string;
  token: string | null;
}) {
  if (source.connectorName !== "official-company") return undefined;
  if (source.token?.toLowerCase().startsWith("bankofamerica")) {
    return BANK_OF_AMERICA_OFFICIAL_SOURCE_POLL_LIMIT;
  }
  if (
    source.token?.toLowerCase().startsWith("microsoft") ||
    source.token?.toLowerCase().startsWith("nvidia") ||
    source.token?.toLowerCase().startsWith("starbucks")
  ) {
    return EIGHTFOLD_OFFICIAL_SOURCE_POLL_LIMIT;
  }
  return OFFICIAL_COMPANY_SOURCE_POLL_LIMIT;
}

async function pollCompanySource(
  companySourceId: string,
  now: Date,
  maxRuntimeMs: number = COMPANY_SOURCE_POLL_MAX_RUNTIME_MS
) {
  const source = await prisma.companySource.findUnique({
    where: { id: companySourceId },
    include: { company: true },
  });

  if (!source) {
    throw new Error(`Company source ${companySourceId} not found.`);
  }

  if (source.validationState !== "VALIDATED" || source.pollState === "QUARANTINED") {
    throw new Error(
      `Company source ${source.sourceName} is not eligible for active polling (${source.validationState}/${source.pollState}).`
    );
  }

  const effectiveMaxRuntimeMs = resolveConnectorPollTimeoutMs({
    connectorName: source.connectorName,
    sourceType: source.sourceType,
    maxRuntimeMs,
  });

  await prisma.companySource.update({
    where: { id: source.id },
    data: {
      pollState: "ACTIVE",
    },
  });

  const connector = buildConnectorForCompanySource(source);
  const staleRunRecovery = await recoverStaleRunningIngestionRuns({
    now,
    connectorKeys: [connector.key],
  });
  if (staleRunRecovery.recoveredCount > 0) {
    console.log(
      `[companySourcePoll] Recovered ${staleRunRecovery.recoveredCount} stale RUNNING ingestion run(s) for ${connector.key}`
    );
  }
  const summary = await ingestConnector(connector, {
    now,
    runMode: "SCHEDULED",
    limit:
      resolveCompanySourceConnectorPollLimit(source),
    maxRuntimeMs: effectiveMaxRuntimeMs,
    triggerLabel: `company-source:${source.id}`,
    scheduleCadenceMinutes: source.pollingCadenceMinutes,
    runMetadata: {
      origin: "company_source",
      companyId: source.companyId,
      companySourceId: source.id,
      registryKey: null,
      sourceName: source.sourceName,
      validationState: source.validationState,
    },
  });
  const pollFinishedAt = new Date();
  const runtimeMs = Math.max(1, pollFinishedAt.getTime() - now.getTime());
  const existingPollRuntime = readJsonRecord(
    readJsonRecord(source.metadataJson).pollRuntime as Prisma.JsonValue | undefined
  );
  const previousAvgRuntimeMs = readNumberValue(existingPollRuntime.avgMs) ?? runtimeMs;
  const previousRuntimeSamples = readNumberValue(existingPollRuntime.sampleCount) ?? 0;
  const nextRuntimeSamples = Math.min(previousRuntimeSamples + 1, 20);
  const nextAvgRuntimeMs =
    previousRuntimeSamples <= 0
      ? runtimeMs
      : Math.round(
          (previousAvgRuntimeMs * previousRuntimeSamples + runtimeMs) /
            Math.max(1, previousRuntimeSamples + 1)
        );

  const overlapRatio =
    summary.fetchedCount > 0 ? summary.dedupedCount / summary.fetchedCount : source.overlapRatio;
  const taleoZeroYield =
    source.connectorName === "taleo" &&
    summary.fetchedCount === 0 &&
    summary.acceptedCount === 0;
  const repeatedTaleoZeroYield =
    taleoZeroYield &&
    source.lastJobsFetchedCount === 0 &&
    source.lastJobsAcceptedCount === 0 &&
    source.pollSuccessCount > 0;
  const predictedPriority = Math.max(
    0.1,
    Math.min(
      1.5,
      (summary.canonicalCreatedCount + 1) / Math.max(1, summary.fetchedCount) +
        (source.extractionRoute === "HTML_FALLBACK" ? 0.15 : 0.3)
    )
  );
  const nextPollAttemptCount = source.pollAttemptCount + 1;
  const nextPollSuccessCount = source.pollSuccessCount + 1;
  const nextJobsFetchedCount = source.jobsFetchedCount + summary.fetchedCount;
  const nextJobsAcceptedCount = source.jobsAcceptedCount + summary.acceptedCount;
  const nextJobsDedupedCount = source.jobsDedupedCount + summary.dedupedCount;
  const nextJobsCreatedCount = source.jobsCreatedCount + summary.canonicalCreatedCount;
  const retainedLiveJobCount = await prisma.jobSourceMapping.count({
    where: {
      sourceName: source.sourceName,
      removedAt: null,
      canonicalJob: {
        status: { in: ["LIVE", "AGING"] },
      },
    },
  });
  const importedAtsZeroYield =
    source.parserVersion === "csv-import:v1" &&
    source.sourceType === "ATS" &&
    retainedLiveJobCount === 0 &&
    nextPollSuccessCount >= 2 &&
    nextJobsAcceptedCount === 0;
  const importedAtsLowYield =
    source.parserVersion === "csv-import:v1" &&
    source.sourceType === "ATS" &&
    retainedLiveJobCount === 0 &&
    nextPollSuccessCount >= 3 &&
    nextJobsCreatedCount === 0;
  const repeatedZeroYieldNoRetained =
    retainedLiveJobCount === 0 &&
    nextPollSuccessCount >= COMPANY_SOURCE_ZERO_YIELD_BACKOFF_SUCCESS_THRESHOLD &&
    nextJobsFetchedCount === 0 &&
    nextJobsAcceptedCount === 0 &&
    nextJobsCreatedCount === 0;
  const runRemovedCount = summary.removedCount ?? 0;
  const runChurnHeavy =
    runRemovedCount >= GROWTH_CHURN_HEAVY_REMOVED_THRESHOLD &&
    runRemovedCount >
      Math.max(
        summary.canonicalCreatedCount,
        source.lastJobsCreatedCount,
        1
      ) *
        GROWTH_CHURN_HEAVY_REMOVED_TO_CREATED_RATIO;
  const runZeroFetchRemoval =
    summary.fetchedCount === 0 &&
    summary.acceptedCount === 0 &&
    summary.canonicalCreatedCount === 0 &&
    runRemovedCount >= 20;
  const growthChurnBackoff =
    GROWTH_MODE_ENABLED && (runChurnHeavy || runZeroFetchRemoval);
  const currentSourceQualityScore = clampSourceQualityScore(source.sourceQualityScore);
  const nextYieldScore = computeSourceYieldScore({
    sourceQualityScore: clampSourceQualityScore(Math.max(
      growthChurnBackoff
        ? Math.max(0.18, Math.min(currentSourceQualityScore, 0.45))
        : taleoZeroYield
        ? Math.max(
            0.12,
            Math.min(currentSourceQualityScore, repeatedTaleoZeroYield ? 0.22 : 0.32)
          )
        : repeatedZeroYieldNoRetained
          ? Math.max(0.1, Math.min(currentSourceQualityScore, 0.18))
        : currentSourceQualityScore,
      taleoZeroYield
        ? Math.min(0.38, predictedPriority / 1.5)
        : Math.min(0.99, predictedPriority / 1.5)
    )),
    pollAttemptCount: nextPollAttemptCount,
    pollSuccessCount: nextPollSuccessCount,
    jobsFetchedCount: nextJobsFetchedCount,
    jobsAcceptedCount: nextJobsAcceptedCount,
    jobsCreatedCount: nextJobsCreatedCount,
    retainedLiveJobCount,
    overlapRatio,
  });
  const hasPendingCheckpoint =
    summary.checkpointExhausted === false && summary.checkpoint != null;
  const successCooldownMinutes =
    growthChurnBackoff
      ? GROWTH_CHURN_HEAVY_COOLDOWN_HOURS * 60
      : importedAtsLowYield
      ? 48 * 60
      : importedAtsZeroYield
        ? 24 * 60
      : repeatedZeroYieldNoRetained
        ? COMPANY_SOURCE_ZERO_YIELD_BACKOFF_HOURS * 60
      : taleoZeroYield
        ? repeatedTaleoZeroYield
          ? 24 * 60
          : 12 * 60
      : hasPendingCheckpoint
        ? GROWTH_MODE_ENABLED
          ? 2
          : 15
        : source.pollingCadenceMinutes ?? DEFAULT_SOURCE_POLL_CADENCE_MINUTES;

  await prisma.companySource.update({
    where: { id: source.id },
    data: {
      status:
        growthChurnBackoff ||
        repeatedTaleoZeroYield ||
        importedAtsZeroYield ||
        importedAtsLowYield ||
        repeatedZeroYieldNoRetained
          ? "DEGRADED"
          : "ACTIVE",
      validationState: "VALIDATED",
      pollState:
        growthChurnBackoff ||
        taleoZeroYield ||
        importedAtsZeroYield ||
        importedAtsLowYield ||
        repeatedZeroYieldNoRetained
          ? "BACKOFF"
          : "READY",
      lastValidatedAt: source.lastValidatedAt ?? now,
      lastSuccessfulPollAt: pollFinishedAt,
      lastHttpStatus: 200,
      cooldownUntil: new Date(
        pollFinishedAt.getTime() + successCooldownMinutes * 60 * 1000
      ),
      pollAttemptCount: nextPollAttemptCount,
      pollSuccessCount: nextPollSuccessCount,
      jobsFetchedCount: nextJobsFetchedCount,
      jobsAcceptedCount: nextJobsAcceptedCount,
      jobsDedupedCount: nextJobsDedupedCount,
      jobsCreatedCount: nextJobsCreatedCount,
      retainedLiveJobCount,
      lastJobsFetchedCount: summary.fetchedCount,
      lastJobsAcceptedCount: summary.acceptedCount,
      lastJobsDedupedCount: summary.dedupedCount,
      lastJobsCreatedCount: summary.canonicalCreatedCount,
      consecutiveFailures: 0,
      failureStreak: 0,
      lastFailureAt: null,
      priorityScore: predictedPriority,
      sourceQualityScore: clampSourceQualityScore(
        growthChurnBackoff
          ? Math.max(0.18, Math.min(currentSourceQualityScore, 0.45))
          : importedAtsLowYield || importedAtsZeroYield
          ? Math.max(
              0.1,
              Math.min(currentSourceQualityScore, importedAtsLowYield ? 0.18 : 0.26)
            )
          : repeatedZeroYieldNoRetained
            ? Math.max(0.1, Math.min(currentSourceQualityScore, 0.18))
          : taleoZeroYield
            ? Math.max(
                0.12,
                Math.min(currentSourceQualityScore, repeatedTaleoZeroYield ? 0.22 : 0.32)
              )
            : Math.max(currentSourceQualityScore, Math.min(0.99, predictedPriority / 1.5))
      ),
      yieldScore: nextYieldScore,
      overlapRatio,
      validationMessage:
        growthChurnBackoff
          ? runZeroFetchRemoval
            ? "Growth mode cooldown: source returned no jobs but removed live mappings; refresh later so net-new polling is not crowded out."
            : "Growth mode cooldown: source removed far more canonical jobs than it created in the latest poll."
          : importedAtsLowYield
          ? "Imported ATS source has produced no new canonicals after repeated successful polls and was cooled down aggressively."
          : importedAtsZeroYield
            ? "Imported ATS source validated but has not yielded accepted jobs after repeated polls and was backed off."
            : repeatedZeroYieldNoRetained
              ? "Source has produced no listings after repeated successful polls and was backed off so polling capacity can move to productive sources."
            : taleoZeroYield
              ? repeatedTaleoZeroYield
                ? "Taleo source returned zero listings in consecutive polls and was cooled down aggressively."
                : "Taleo source returned zero listings and was backed off for a longer cooldown."
              : hasPendingCheckpoint
                ? "Checkpointed source has more pages; scheduled a short continuation poll."
              : null,
      metadataJson: mergeMetadataJson(source.metadataJson, {
        lastSummary: {
          acceptedCount: summary.acceptedCount,
          canonicalCreatedCount: summary.canonicalCreatedCount,
          canonicalUpdatedCount: summary.canonicalUpdatedCount,
          dedupedCount: summary.dedupedCount,
          fetchedCount: summary.fetchedCount,
          removedCount: runRemovedCount,
          runtimeMs,
        },
        pollRuntime: {
          avgMs: nextAvgRuntimeMs,
          lastFinishedAt: pollFinishedAt.toISOString(),
          lastMs: runtimeMs,
          sampleCount: nextRuntimeSamples,
        },
        workdayHost: getWorkdayHostKey({
          connectorName: source.connectorName,
          token: source.token,
          boardUrl: source.boardUrl,
        }),
      }),
    },
  });

  await prisma.company.update({
    where: { id: source.companyId },
    data: {
      lastSuccessfulPollAt: pollFinishedAt,
      crawlStatus: taleoZeroYield ? "DEGRADED" : "IDLE",
      discoveryStatus: "DISCOVERED",
    },
  });

  if (hasPendingCheckpoint) {
    await enqueueSourceTask({
      kind: "CONNECTOR_POLL",
      companyId: source.companyId,
      companySourceId: source.id,
      priorityScore: GROWTH_MODE_ENABLED
        ? 90_000
        : Math.max(120, Math.round(source.priorityScore * 100)),
      notBeforeAt: new Date(
        pollFinishedAt.getTime() + (GROWTH_MODE_ENABLED ? 15_000 : 60_000)
      ),
      payloadJson: {
        checkpointContinuation: true,
        previousAcceptedCount: summary.acceptedCount,
        previousCanonicalCreatedCount: summary.canonicalCreatedCount,
      },
    });
  }
}

async function handleCompanySourcePollFailure(
  companySourceId: string | null,
  now: Date,
  error: unknown
): Promise<Date | null> {
  if (!companySourceId) return null;

  const source = await prisma.companySource.findUnique({
    where: { id: companySourceId },
    select: {
      id: true,
      companyId: true,
      boardUrl: true,
      connectorName: true,
      sourceName: true,
      sourceQualityScore: true,
      yieldScore: true,
      jobsFetchedCount: true,
      jobsAcceptedCount: true,
      jobsCreatedCount: true,
      retainedLiveJobCount: true,
      overlapRatio: true,
      pollAttemptCount: true,
      pollSuccessCount: true,
      validationState: true,
      pollState: true,
      consecutiveFailures: true,
      failureStreak: true,
      status: true,
      token: true,
      metadataJson: true,
    },
  });

  if (!source) return null;

  const errorMessage = error instanceof Error ? error.message : String(error);
  // 400 is treated as hard failure alongside 404/410: a Bad Request from a
  // company career page almost always means a misconfigured or defunct source URL.
  const hardFailure = /\b(400|404|410)\b/.test(errorMessage);
  const blockedFailure = /\b(401|403|429)\b/.test(errorMessage);
  const timeoutFailure =
    /TIME_BUDGET_EXCEEDED|ABORTED_BY_RUNNER|RuntimeBudgetExceededError|AbortError|runtime budget exceeded/i.test(
      errorMessage
    );
  const infrastructureFailure = isInfrastructureFailureMessage(errorMessage);
  const transientRuntimeFailure = timeoutFailure || infrastructureFailure;
  const latestTimeoutRun = timeoutFailure
    ? await prisma.ingestionRun.findFirst({
        where: {
          sourceName: source.sourceName,
          status: "FAILED",
          startedAt: {
            gte: new Date(now.getTime() - 20 * 60 * 1000),
          },
        },
        orderBy: { startedAt: "desc" },
        select: {
          acceptedCount: true,
          canonicalCreatedCount: true,
          canonicalUpdatedCount: true,
          dedupedCount: true,
          fetchedCount: true,
        },
      })
    : null;
  const timeoutCreatedCount = latestTimeoutRun?.canonicalCreatedCount ?? 0;
  const timeoutAcceptedCount = latestTimeoutRun?.acceptedCount ?? 0;
  const timeoutUpdatedCount = latestTimeoutRun?.canonicalUpdatedCount ?? 0;
  const timeoutMadeProgress =
    timeoutCreatedCount > 0 || timeoutAcceptedCount > 0 || timeoutUpdatedCount > 0;
  const timeoutZeroCreateRefresh =
    timeoutFailure &&
    timeoutCreatedCount === 0 &&
    timeoutAcceptedCount >= COMPANY_SOURCE_TIMEOUT_ZERO_CREATE_ACCEPTED_THRESHOLD;
  const timeoutHeavyZeroCreateRefresh =
    timeoutZeroCreateRefresh &&
    timeoutAcceptedCount >= COMPANY_SOURCE_TIMEOUT_HEAVY_ZERO_CREATE_ACCEPTED_THRESHOLD;
  // Workday returns 500/502/503/504 and text/html as bot-detection responses,
  // not as genuine server errors. Treat all of these as blocked failures so they
  // get the 12h/24h/36h cooldown ladder rather than the 1h generic ladder.
  const workdayBlockedFailure =
    source.connectorName === "workday" &&
    (!timeoutFailure &&
      (blockedFailure ||
      /\b(500|502|503|504)\b/.test(errorMessage) ||
      /bot detection|text\/html|content.type/i.test(errorMessage)));
  const protectedHighValueWorkday =
    workdayBlockedFailure &&
    isHighValueWorkdaySource({
      pollAttemptCount: source.pollAttemptCount,
      pollSuccessCount: source.pollSuccessCount,
      jobsAcceptedCount: source.jobsAcceptedCount,
      retainedLiveJobCount: source.retainedLiveJobCount,
    });
  const deterministicHardInvalid =
    hardFailure && DETERMINISTIC_ATS_HARD_INVALID_CONNECTORS.has(source.connectorName);
  const nextFailureStreak = source.failureStreak + 1;
  const nextConsecutiveFailures = source.consecutiveFailures + 1;
  const nextPollAttemptCount = source.pollAttemptCount + 1;
  const shouldRediscover =
    protectedHighValueWorkday
      ? false
      : transientRuntimeFailure
        ? false
      :
    deterministicHardInvalid
      ? true
      : hardFailure
      ? nextConsecutiveFailures >= HARD_FAILURE_REDISCOVERY_THRESHOLD
      : workdayBlockedFailure
        ? nextConsecutiveFailures >= WORKDAY_BLOCKED_REDISCOVERY_THRESHOLD
      : nextFailureStreak >= REDISCOVERY_FAILURE_THRESHOLD;
  const nextStatus: CompanySourceStatus =
    protectedHighValueWorkday
      ? "DEGRADED"
      : transientRuntimeFailure
        ? "DEGRADED"
      : shouldRediscover
        ? "REDISCOVER_REQUIRED"
        : "DEGRADED";
  const nextValidationState: CompanySourceValidationState =
    protectedHighValueWorkday
      ? "VALIDATED"
      : transientRuntimeFailure
        ? "VALIDATED"
      :
    deterministicHardInvalid
      ? "INVALID"
      : hardFailure
      ? shouldRediscover
        ? "NEEDS_REDISCOVERY"
        : "SUSPECT"
      : (blockedFailure || workdayBlockedFailure)
        ? "BLOCKED"
        : "SUSPECT";
  const nextPollState: CompanySourcePollState =
    protectedHighValueWorkday
      ? "BACKOFF"
      : transientRuntimeFailure
        ? "BACKOFF"
      : shouldRediscover
        ? "QUARANTINED"
        : "BACKOFF";
  const statusMatch = errorMessage.match(/\b(401|403|404|410|429|500|502|503|504)\b/);
  const nextHttpStatus = statusMatch ? Number(statusMatch[1]) : null;
  const currentSourceQualityScore = clampSourceQualityScore(source.sourceQualityScore);
  const nextSourceQualityScore = clampSourceQualityScore(
    protectedHighValueWorkday
      ? Math.max(0.45, currentSourceQualityScore * 0.88)
      : infrastructureFailure
        ? Math.max(0.5, currentSourceQualityScore * 0.98)
      : timeoutZeroCreateRefresh
        ? Math.max(0.22, currentSourceQualityScore * 0.82)
      : timeoutFailure
        ? Math.max(0.28, currentSourceQualityScore * 0.9)
      : Math.max(0.02, source.failureStreak > 0 ? 0.12 : 0.2)
  );
  const nextYieldScore = computeSourceYieldScore({
    sourceQualityScore: nextSourceQualityScore,
    pollAttemptCount: nextPollAttemptCount,
    pollSuccessCount: source.pollSuccessCount,
    jobsFetchedCount: source.jobsFetchedCount,
    jobsAcceptedCount: source.jobsAcceptedCount,
    jobsCreatedCount: source.jobsCreatedCount,
    retainedLiveJobCount: source.retainedLiveJobCount,
    overlapRatio: source.overlapRatio,
  });
  const workdayHost = getWorkdayHostKey({
    connectorName: source.connectorName,
    token: source.token,
    boardUrl: source.boardUrl,
  });

  const timeoutCooldownMinutes =
    timeoutZeroCreateRefresh
      ? (timeoutHeavyZeroCreateRefresh
          ? COMPANY_SOURCE_TIMEOUT_HEAVY_ZERO_CREATE_COOLDOWN_HOURS
          : COMPANY_SOURCE_TIMEOUT_ZERO_CREATE_COOLDOWN_HOURS) * 60
    :
    transientRuntimeFailure && GROWTH_MODE_ENABLED
      ? timeoutCreatedCount >= 25
        ? 8
        : timeoutCreatedCount > 0
          ? 15
          : infrastructureFailure
            ? 10
          : timeoutAcceptedCount >= 100
            ? 25
            : timeoutMadeProgress
              ? 45
              : Math.min(120, Math.max(45, nextConsecutiveFailures * 30))
      : null;
  const cooldownHours = deterministicHardInvalid
    ? 12
    : protectedHighValueWorkday
      ? nextConsecutiveFailures * 6
    : transientRuntimeFailure
      ? Math.min(12, Math.max(2, nextConsecutiveFailures * 2))
    : hardFailure
      ? nextConsecutiveFailures * 4        // 400/404/410: 4h, 8h, 12h…
      : workdayBlockedFailure
        ? nextConsecutiveFailures * 12     // Workday 403/429: 12h, 24h, 36h…
        : blockedFailure
          ? nextConsecutiveFailures * 8    // other 403/429: 8h, 16h, 24h…
          : nextFailureStreak;             // generic failures: 1h, 2h, 3h…
  const cooldownUntil = new Date(
    now.getTime() +
      (timeoutCooldownMinutes != null
        ? timeoutCooldownMinutes * 60 * 1000
        : cooldownHours * 60 * 60 * 1000)
  );
  let hostCooldownUntil: Date | null = null;
  let hostBlockedStreak = 0;

  if (workdayBlockedFailure && workdayHost) {
    const siblingSources = await prisma.companySource.findMany({
      where: {
        connectorName: "workday",
        token: {
          startsWith: `${workdayHost}|`,
        },
      },
      select: {
        cooldownUntil: true,
        lastFailureAt: true,
        lastHttpStatus: true,
        consecutiveFailures: true,
      },
    });

    const recentBlockedCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recentBlockedSourceCount = siblingSources.filter(
      (sibling) =>
        sibling.lastFailureAt &&
        sibling.lastFailureAt >= recentBlockedCutoff &&
        sibling.lastHttpStatus &&
        WORKDAY_BLOCKED_HTTP_STATUSES.has(sibling.lastHttpStatus)
    ).length;
    const maxSiblingConsecutiveFailures = siblingSources.reduce(
      (maxStreak, sibling) => Math.max(maxStreak, sibling.consecutiveFailures),
      0
    );

    hostBlockedStreak = Math.max(
      recentBlockedSourceCount,
      maxSiblingConsecutiveFailures,
      nextConsecutiveFailures
    );

    if (hostBlockedStreak >= WORKDAY_HOST_BLOCK_STREAK_THRESHOLD) {
      hostCooldownUntil = new Date(
        now.getTime() + WORKDAY_HOST_COOLDOWN_HOURS * 60 * 60 * 1000
      );

      await prisma.companySource.updateMany({
        where: {
          connectorName: "workday",
          token: {
            startsWith: `${workdayHost}|`,
          },
          OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: hostCooldownUntil } }],
        },
        data: {
          cooldownUntil: hostCooldownUntil,
          pollState: "BACKOFF",
          status: "DEGRADED",
        },
      });
    }
  }

  await prisma.companySource.update({
    where: { id: source.id },
    data: {
      status: nextStatus,
      validationState: nextValidationState,
      pollState: nextPollState,
      lastFailureAt: now,
      lastHttpStatus: nextHttpStatus,
      pollAttemptCount: nextPollAttemptCount,
      consecutiveFailures: nextConsecutiveFailures,
      failureStreak: nextFailureStreak,
      cooldownUntil: hostCooldownUntil ?? cooldownUntil,
      sourceQualityScore: nextSourceQualityScore,
      yieldScore: nextYieldScore,
      validationMessage: protectedHighValueWorkday
        ? `High-value Workday source blocked; preserved with slower retry window. ${errorMessage}`
        : infrastructureFailure
          ? `INFRASTRUCTURE_FAILURE: ingestion infrastructure had a transient database/runtime failure; source quality preserved and retry scheduled. ${errorMessage}`
        : timeoutZeroCreateRefresh
          ? `TIME_BUDGET_LOW_NOVELTY: poll accepted ${timeoutAcceptedCount} known jobs but created 0 new canonicals before timing out; source cooled down to protect ingestion throughput. ${errorMessage}`
        : timeoutFailure
          ? `TIME_BUDGET_EXCEEDED: poll exceeded runtime budget after partial progress (${timeoutAcceptedCount} accepted, ${timeoutCreatedCount} created); retry scheduled on a short growth-mode cooldown. ${errorMessage}`
        : workdayBlockedFailure && workdayHost
          ? `Workday host ${workdayHost} blocked (${hostBlockedStreak} recent blocked source(s)); source backed off. ${errorMessage}`
          : errorMessage,
      metadataJson: mergeMetadataJson(source.metadataJson, {
        lastFailure: {
          failureType:
            infrastructureFailure
              ? "INFRASTRUCTURE_FAILURE"
              : timeoutFailure && /ABORTED_BY_RUNNER/i.test(errorMessage)
              ? "ABORTED_BY_RUNNER"
              : timeoutFailure
                ? "TIME_BUDGET_EXCEEDED"
            : source.connectorName === "workday" && nextHttpStatus === 403
              ? "BLOCKED_403"
              : source.connectorName === "workday" && workdayBlockedFailure
                ? "BLOCKED_WORKDAY"
                : hardFailure
                  ? "HARD_FAILURE"
                  : blockedFailure
                    ? "BLOCKED"
                    : "GENERIC_FAILURE",
          httpStatus: nextHttpStatus,
          occurredAt: now.toISOString(),
          partialAcceptedCount: timeoutFailure ? timeoutAcceptedCount : undefined,
          partialCanonicalCreatedCount: timeoutFailure ? timeoutCreatedCount : undefined,
          partialCanonicalUpdatedCount: timeoutFailure ? timeoutUpdatedCount : undefined,
        },
        workdayHost,
        workdayHostState:
          workdayHost && workdayBlockedFailure
            ? {
                blockedStreak: hostBlockedStreak,
                cooldownUntil: (hostCooldownUntil ?? cooldownUntil).toISOString(),
                lastBlockedAt: now.toISOString(),
              }
            : undefined,
      }),
    },
  });

  await prisma.company.update({
    where: { id: source.companyId },
    data: {
      crawlStatus:
        nextStatus === "REDISCOVER_REQUIRED"
          ? "DEGRADED"
          : blockedFailure
            ? "BLOCKED"
            : "ACTIVE",
      lastDiscoveryError: deterministicHardInvalid
        ? `${source.connectorName} source returned a hard not-found response and was quarantined for rediscovery.`
        : errorMessage,
    },
  });

  if (nextStatus === "REDISCOVER_REQUIRED") {
    await enqueueUniqueSourceTask({
      kind: "REDISCOVERY",
      companyId: source.companyId,
      companySourceId: source.id,
      priorityScore: 85,
      notBeforeAt: now,
    });
  }

  return hostCooldownUntil ?? cooldownUntil;
}

async function handleCompanySourceValidationFailure(
  companySourceId: string | null,
  now: Date,
  error: unknown
) {
  if (!companySourceId) return;

  const source = await prisma.companySource.findUnique({
    where: { id: companySourceId },
    select: {
      id: true,
      companyId: true,
      sourceQualityScore: true,
      jobsFetchedCount: true,
      jobsAcceptedCount: true,
      jobsCreatedCount: true,
      retainedLiveJobCount: true,
      overlapRatio: true,
      pollAttemptCount: true,
      pollSuccessCount: true,
      validationAttemptCount: true,
      validationSuccessCount: true,
      consecutiveFailures: true,
      connectorName: true,
      validationState: true,
      pollState: true,
    },
  });

  if (!source) return;

  const errorMessage = error instanceof Error ? error.message : String(error);
  const infrastructureFailure = isInfrastructureFailureMessage(errorMessage);
  const nextFailureCount = source.consecutiveFailures + 1;
  const nextValidationAttemptCount = source.validationAttemptCount + 1;
  const statusMatch = errorMessage.match(/\b(401|403|404|410|429|500|502|503|504)\b/);
  const currentSourceQualityScore = clampSourceQualityScore(source.sourceQualityScore);
  const nextSourceQualityScore = clampSourceQualityScore(
    infrastructureFailure ? Math.max(0.5, currentSourceQualityScore * 0.98) : 0.1
  );
  const nextYieldScore = computeSourceYieldScore({
    sourceQualityScore: nextSourceQualityScore,
    pollAttemptCount: source.pollAttemptCount,
    pollSuccessCount: source.pollSuccessCount,
    jobsFetchedCount: source.jobsFetchedCount,
    jobsAcceptedCount: source.jobsAcceptedCount,
    jobsCreatedCount: source.jobsCreatedCount,
    retainedLiveJobCount: source.retainedLiveJobCount,
    overlapRatio: source.overlapRatio,
  });

  await prisma.companySource.update({
    where: { id: source.id },
    data: {
      status:
        infrastructureFailure
          ? "DEGRADED"
          : nextFailureCount >= HARD_FAILURE_REDISCOVERY_THRESHOLD
            ? "REDISCOVER_REQUIRED"
            : "DEGRADED",
      validationState:
        infrastructureFailure
          ? source.validationSuccessCount > 0 ||
            source.jobsAcceptedCount > 0 ||
            source.connectorName === "official-company"
            ? "VALIDATED"
            : "UNVALIDATED"
        : nextFailureCount >= HARD_FAILURE_REDISCOVERY_THRESHOLD
          ? "NEEDS_REDISCOVERY"
          : "SUSPECT",
      pollState:
        infrastructureFailure
          ? "BACKOFF"
        : nextFailureCount >= HARD_FAILURE_REDISCOVERY_THRESHOLD
          ? "QUARANTINED"
          : "BACKOFF",
      validationAttemptCount: nextValidationAttemptCount,
      consecutiveFailures: nextFailureCount,
      failureStreak: nextFailureCount,
      lastFailureAt: now,
      lastHttpStatus: statusMatch ? Number(statusMatch[1]) : null,
      cooldownUntil: new Date(
        now.getTime() +
          (infrastructureFailure
            ? 10 * 60 * 1000
            : nextFailureCount * 2 * 60 * 60 * 1000)
      ),
      validationMessage: infrastructureFailure
        ? `INFRASTRUCTURE_FAILURE: validation infrastructure had a transient database/runtime failure; source quality preserved and retry scheduled. ${errorMessage}`
        : errorMessage,
      sourceQualityScore: nextSourceQualityScore,
      yieldScore: nextYieldScore,
    },
  });

  await prisma.company.update({
    where: { id: source.companyId },
    data: {
      crawlStatus: infrastructureFailure ? "ACTIVE" : "DEGRADED",
      lastDiscoveryError: errorMessage,
    },
  });

  if (!infrastructureFailure && nextFailureCount >= HARD_FAILURE_REDISCOVERY_THRESHOLD) {
    await enqueueUniqueSourceTask({
      kind: "REDISCOVERY",
      companyId: source.companyId,
      companySourceId: source.id,
      priorityScore: 88,
      notBeforeAt: now,
    });
  }
}

function buildConnectorForCompanySource(
  source: {
    sourceName: string;
    connectorName: string;
    token: string;
    boardUrl: string;
    extractionRoute: ExtractionRouteKind;
    parserVersion: string | null;
    company: { name: string };
  }
) {
  if (source.connectorName === "company-site") {
    return createCompanySiteConnector({
      sourceName: source.sourceName,
      companyName: source.company.name,
      boardUrl: source.boardUrl,
      extractionRoute: source.extractionRoute,
      parserVersion: source.parserVersion,
    });
  }

  if (source.connectorName === "official-company") {
    return createOfficialCompanyConnector(parseOfficialCompanySourceToken(source.token));
  }

  if (source.connectorName === "oraclecloud") {
    const [tenant, site] = source.token.split("|");
    if (!tenant) {
      throw new Error(`Invalid Oracle Cloud source token "${source.token}".`);
    }
    return createOracleCloudConnector({
      tenant,
      site: site?.trim() || "CX",
      companyName: source.company.name,
    });
  }

  return withCompanySourceOwner(
    createConnectorForCandidate({
    input: source.boardUrl,
    connectorName: source.connectorName as DiscoveredSourceCandidate["connectorName"],
    token: source.token,
    sourceKey: `${source.connectorName}:${source.token}`.toLowerCase(),
    sourceName: source.sourceName,
    boardUrl: source.boardUrl,
    source: "url",
    }),
    source.company.name
  );
}

function withCompanySourceOwner(
  connector: SourceConnector,
  companyName: string
): SourceConnector {
  const cleanedCompanyName = cleanCompanyName(companyName) || companyName.trim();
  if (!cleanedCompanyName) return connector;

  return {
    ...connector,
    async fetchJobs(options): Promise<SourceConnectorFetchResult> {
      const result = await connector.fetchJobs(options);
      return {
        ...result,
        jobs: result.jobs.map((job) =>
          rewriteSourceJobCompany(job, cleanedCompanyName)
        ),
      };
    },
  };
}

function rewriteSourceJobCompany(
  job: SourceConnectorJob,
  companyName: string
): SourceConnectorJob {
  if (job.company === companyName) return job;

  return {
    ...job,
    company: companyName,
    metadata: {
      ...(typeof job.metadata === "object" && job.metadata !== null && !Array.isArray(job.metadata)
        ? job.metadata
        : {}),
      sourceReportedCompany: job.company,
      companySourceOwnerCompany: companyName,
    },
  };
}

function buildEnterpriseRecordForCompany(company: {
  name: string;
  companyKey: string;
  domain: string | null;
  careersUrl: string | null;
  detectedAts?: string | null;
  metadataJson?: Prisma.JsonValue | null;
}) {
  const metadata =
    company.metadataJson && typeof company.metadataJson === "object" && !Array.isArray(company.metadataJson)
      ? (company.metadataJson as Record<string, Prisma.JsonValue>)
      : {};

  const metadataTenants = readStringArray(metadata.tenants);
  const metadataDomains = readStringArray(metadata.domains);
  const metadataSeedPageUrls = readStringArray(metadata.seedPageUrls);
  const metadataSearchTerms = Array.from(
    new Set([...readStringArray(metadata.searchTerms), ...readStringArray(metadata.aliases)])
  );
  const metadataSectors = readStringArray(metadata.sectors);
  const metadataWdVariants = readStringArray(metadata.wdVariants);
  const metadataWdSites = readStringArray(metadata.wdSites);
  const metadataSfHosts = readStringArray(metadata.sfHosts);
  const metadataSfPaths = readStringArray(metadata.sfPaths);
  const metadataAts = readStringValue(metadata.ats) ?? readStringValue(metadata.detectedAts);
  const cleanedName = cleanCompanyName(company.name) || company.name;
  const companyKey = buildCompanyKey(cleanedName) || company.companyKey;
  const seedPageUrls = Array.from(new Set([
    ...metadataSeedPageUrls,
    company.careersUrl,
    company.domain ? `https://${company.domain}/careers` : null,
    company.domain ? `https://${company.domain}/jobs` : null,
  ].filter(Boolean) as string[]));
  const domains = Array.from(new Set([
    ...metadataDomains,
    company.domain,
  ].filter(Boolean) as string[]));
  const tenants = Array.from(new Set([
    ...metadataTenants,
    companyKey,
  ].filter(Boolean)));
  const searchTerms = Array.from(new Set([
    cleanedName,
    ...metadataSearchTerms,
  ].filter(Boolean)));

  return {
    name: cleanedName,
    searchTerms,
    tenants,
    domains,
    seedPageUrls,
    ats:
      metadataAts === "workday" ||
      metadataAts === "successfactors" ||
      metadataAts === "both"
        ? metadataAts
        : company.detectedAts === "workday" ||
            company.detectedAts === "successfactors" ||
            company.detectedAts === "both"
          ? company.detectedAts
          : "unknown",
    sectors: metadataSectors,
    wdVariants: metadataWdVariants,
    wdSites: metadataWdSites,
    sfHosts: metadataSfHosts,
    sfPaths: metadataSfPaths,
  } satisfies EnterpriseCompanyRecord;
}

function readStringArray(value: Prisma.JsonValue | undefined) {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function readStringValue(value: Prisma.JsonValue | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readSeedSource(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return readStringValue((value as Record<string, Prisma.JsonValue>).seedSource);
}
