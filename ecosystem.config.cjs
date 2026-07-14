/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * PM2 ecosystem configuration for ApplyOverflow background workers.
 *
 * Set APPLYOVERFLOW_WORKER_GROUPS to run a scoped subset in a worker
 * container:
 * - ingestion: steady scheduler daemon
 * - source-workers: poll / validation / discovery queue drains
 * - maintenance: feed summary and feed-index repair loops
 * - top-picks: durable Top Picks refresh worker
 * - overnight: optional high-throughput overnight expansion apps
 * - all: legacy/default behavior
 */
const fs = require("node:fs");
const path = require("node:path");

const overnightAccelerationEnabled =
  process.env.INGEST_OVERNIGHT_ACCELERATION === "1";
const selectedWorkerGroups = parseWorkerGroups(
  process.env.APPLYOVERFLOW_WORKER_GROUPS ||
    process.env.WORKER_GROUP ||
    "all"
);

function parseWorkerGroups(value) {
  const groups = new Set(
    String(value)
      .split(",")
      .map((group) => group.trim())
      .filter(Boolean)
  );
  return groups.size > 0 ? groups : new Set(["all"]);
}

function selectWorkerApps(apps) {
  if (selectedWorkerGroups.has("all")) {
    return apps.map(stripWorkerGroupMetadata);
  }

  return apps
    .filter((app) =>
      app.__workerGroups?.some((group) => selectedWorkerGroups.has(group))
    )
    .map(stripWorkerGroupMetadata);
}

function stripWorkerGroupMetadata(app) {
  const pm2App = { ...app };
  delete pm2App.__workerGroups;
  return pm2App;
}

function withWorkerGroups(app, groups) {
  return {
    ...app,
    __workerGroups: groups,
  };
}

function buildOvernightApp(name, args, output, error, extraEnv = {}) {
  return withWorkerGroups({
    name,
    script: "node_modules/.bin/tsx",
    args,
    cwd: __dirname,
    autorestart: true,
    max_restarts: 20,
    min_uptime: "30s",
    restart_delay: 10000,
    output,
    error,
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    merge_logs: true,
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || "production",
      DATABASE_PROCESS_ROLE: "daemon",
      DATABASE_POOL_MAX_DAEMON: process.env.DATABASE_POOL_MAX_DAEMON || "4",
      DATABASE_POOL_MAX_RECOVERY_POLL:
        process.env.DATABASE_POOL_MAX_RECOVERY_POLL || "3",
      DATABASE_POOL_CONNECTION_TIMEOUT_MS:
        process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "30000",
      INGEST_GROWTH_MODE: process.env.INGEST_GROWTH_MODE || "1",
      JOOBLE_ENABLED: "false",
      SOURCE_JOOBLE_ENABLED: "false",
      INGEST_JOOBLE_ENABLED: "false",
      ADZUNA_ENABLED: "false",
      SOURCE_ADZUNA_ENABLED: "false",
      INGEST_ADZUNA_ENABLED: "false",
      INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS:
        process.env.INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS || "true",
      ...extraEnv,
    },
    max_memory_restart: "1024M",
  }, ["overnight"]);
}

function buildOvernightShellApp(name, args, output, error, extraEnv = {}) {
  return withWorkerGroups({
    name,
    script: "bash",
    args,
    cwd: __dirname,
    autorestart: true,
    max_restarts: 20,
    min_uptime: "30s",
    restart_delay: 10000,
    output,
    error,
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    merge_logs: true,
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || "production",
      DATABASE_PROCESS_ROLE: "recovery_poll",
      DATABASE_POOL_CONNECTION_TIMEOUT_MS:
        process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "10000",
      INGEST_GROWTH_MODE: process.env.INGEST_GROWTH_MODE || "1",
      INGEST_FRONTIER_POLL_ONLY: process.env.INGEST_FRONTIER_POLL_ONLY || "true",
      JOOBLE_ENABLED: "false",
      SOURCE_JOOBLE_ENABLED: "false",
      INGEST_JOOBLE_ENABLED: "false",
      ADZUNA_ENABLED: "false",
      SOURCE_ADZUNA_ENABLED: "false",
      INGEST_ADZUNA_ENABLED: "false",
      INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS:
        process.env.INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS || "true",
      ...extraEnv,
    },
    max_memory_restart: "1024M",
  }, ["overnight"]);
}

function buildMaintenanceShellApp(name, args, output, error, extraEnv = {}) {
  return withWorkerGroups({
    name,
    script: "bash",
    args,
    cwd: __dirname,
    autorestart: true,
    max_restarts: 10,
    min_uptime: "30s",
    restart_delay: 10000,
    output,
    error,
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    merge_logs: true,
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || "production",
      DATABASE_PROCESS_ROLE: "maintenance",
      DATABASE_POOL_CONNECTION_TIMEOUT_MS:
        process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "10000",
      DATABASE_POOL_MAX_MAINTENANCE:
        process.env.DATABASE_POOL_MAX_MAINTENANCE || "2",
      ...extraEnv,
    },
    max_memory_restart: "384M",
  }, ["maintenance"]);
}

const overnightAccelerationApps = overnightAccelerationEnabled
  ? [
      buildOvernightApp(
        "ingest-expansion-exploration",
        "-r dotenv/config scripts/run-expansion-pipeline.ts --mode=exploration --limit=600 --max-batches=4 --idle-sleep-ms=45000 --error-sleep-ms=90000 --forever",
        "./logs/expansion-pipeline-overnight-out.log",
        "./logs/expansion-pipeline-overnight-err.log"
      ),
      buildOvernightApp(
        "ingest-exploration-scheduler",
        "-r dotenv/config scripts/run-expansion-pipeline.ts --mode=exploration --schedule-only --skip-seed --limit=1200 --idle-sleep-ms=60000 --error-sleep-ms=90000 --forever --skip-metrics",
        "./logs/exploration-scheduler-overnight-out.log",
        "./logs/exploration-scheduler-overnight-err.log"
      ),
      buildOvernightApp(
        "ingest-exploration-drain",
        "-r dotenv/config scripts/run-expansion-pipeline.ts --mode=exploration --worker-only --limit=800 --max-batches=4 --idle-sleep-ms=30000 --error-sleep-ms=90000 --forever --skip-metrics",
        "./logs/exploration-drain-overnight-out.log",
        "./logs/exploration-drain-overnight-err.log"
      ),
      buildOvernightApp(
        "ingest-exploitation-drain",
        "-r dotenv/config scripts/run-expansion-pipeline.ts --mode=exploitation --worker-only --limit=1000 --max-batches=12 --idle-sleep-ms=15000 --error-sleep-ms=60000 --forever --skip-metrics",
        "./logs/exploitation-drain-overnight-out.log",
        "./logs/exploitation-drain-overnight-err.log"
      ),
      buildOvernightApp(
        "ingest-operational-drain",
        "-r dotenv/config scripts/run-expansion-pipeline.ts --mode=all --worker-only --skip-seed --limit=400 --max-batches=4 --idle-sleep-ms=30000 --error-sleep-ms=90000 --forever --skip-metrics",
        "./logs/operational-drain-overnight-out.log",
        "./logs/operational-drain-overnight-err.log"
      ),
      buildOvernightApp(
        "ingest-poll-worker-burst",
        "-r dotenv/config scripts/ingest-recovery-worker.ts --role=poll --interval=5",
        "./logs/poll-worker-burst-out.log",
        "./logs/poll-worker-burst-err.log",
        {
          DATABASE_PROCESS_ROLE: "recovery_poll",
          INGEST_RECOVERY_MODE: "1",
          RECOVERY_WORKER_SOURCE_POLL_LIMIT:
            process.env.RECOVERY_WORKER_SOURCE_POLL_LIMIT || "80",
          INGEST_SOURCE_POLL_RECOVERY_CONCURRENCY:
            process.env.INGEST_SOURCE_POLL_RECOVERY_CONCURRENCY || "2",
        }
      ),
      buildOvernightShellApp(
        "ingest-frontier-growth",
        "-lc 'while true; do node_modules/.bin/tsx -r dotenv/config scripts/run-frontier-growth-pass.ts --cycles=3 --validation-limit=300 --poll-limit=140 --poll-concurrency=6 --max-wall-clock-ms=240000; sleep 300; done'",
        "./logs/frontier-growth-overnight-out.log",
        "./logs/frontier-growth-overnight-err.log",
        {
          INGEST_SOURCE_POLL_RECOVERY_CONCURRENCY:
            process.env.INGEST_SOURCE_POLL_RECOVERY_CONCURRENCY || "2",
        }
      ),
      buildOvernightShellApp(
        "ingest-high-yield-source-poll",
        "-lc 'while true; do timeout 360s node_modules/.bin/tsx -r dotenv/config scripts/run-high-yield-source-poll-pass.ts --growth-only --limit=45 --concurrency=4 --min-age-minutes=120 --min-recent-created=2 --min-last-created=1 --min-total-created=10 --lookback-hours=24 --max-runtime-ms=150000; sleep 900; done'",
        "./logs/high-yield-source-poll-overnight-out.log",
        "./logs/high-yield-source-poll-overnight-err.log",
        {
          DATABASE_POOL_MAX_RECOVERY_POLL:
            process.env.DATABASE_POOL_MAX_RECOVERY_POLL || "3",
          INGEST_SOURCE_POLL_RECOVERY_CONCURRENCY:
            process.env.INGEST_SOURCE_POLL_RECOVERY_CONCURRENCY || "2",
        }
      ),
      buildOvernightShellApp(
        "ingest-ats-frontier-expansion",
        "-lc 'sleep 7200; while true; do timeout 900s node_modules/.bin/tsx -r dotenv/config scripts/expand-ats-frontier.ts --company-limit=3000 --url-limit=20000 --page-scan-limit=500 --page-discovery-concurrency=8 --promotion-threshold=0.78; sleep 7200; done'",
        "./logs/ats-frontier-expansion-overnight-out.log",
        "./logs/ats-frontier-expansion-overnight-err.log",
        {
          DATABASE_POOL_MAX_RECOVERY_POLL:
            process.env.DATABASE_POOL_MAX_RECOVERY_POLL || "3",
        }
      ),
      buildOvernightApp(
        "ingest-search-index-scheduler",
        "-r dotenv/config scripts/run-expansion-pipeline.ts --mode=exploitation --schedule-only --limit=500 --raw-parse-limit=0 --dedupe-limit=0 --lifecycle-limit=0 --search-index-limit=50000 --idle-sleep-ms=60000 --error-sleep-ms=90000 --forever --skip-metrics",
        "./logs/search-index-scheduler-overnight-out.log",
        "./logs/search-index-scheduler-overnight-err.log"
      ),
      buildOvernightShellApp(
        "ingest-feed-index-sync",
        "-lc 'sleep 900; while true; do timeout 300s node_modules/.bin/tsx -r dotenv/config scripts/backfill-job-feed-index.ts --mode=all --batch-size=250 --max-batches=4 --concurrency=2 --sleep-ms=100; sleep 1800; done'",
        "./logs/feed-index-sync-overnight-out.log",
        "./logs/feed-index-sync-overnight-err.log",
        {
          DATABASE_POOL_MAX_RECOVERY_POLL:
            process.env.DATABASE_POOL_MAX_RECOVERY_POLL || "3",
        }
      ),
      buildOvernightApp(
        "ingest-bulk-fast",
        "-r dotenv/config scripts/bulk-recovery-loop.ts --interval=10 --catchup-seconds=30 --keys=hiringcafe:feed,himalayas:na_scale,jobicy:feed,remotive:feed,remoteok:feed,weworkremotely:feed,jobbank-live:feed,workatastartup:feed",
        "./logs/bulk-fast-overnight-out.log",
        "./logs/bulk-fast-overnight-err.log",
        {
          BULK_RECOVERY_HIRINGCAFE_CADENCE_MINUTES:
            process.env.BULK_RECOVERY_HIRINGCAFE_CADENCE_MINUTES || "10",
          BULK_RECOVERY_HIRINGCAFE_MAX_RUNTIME_MS:
            process.env.BULK_RECOVERY_HIRINGCAFE_MAX_RUNTIME_MS || "120000",
        }
      ),
      buildOvernightApp(
        "ingest-bulk-builtin",
        "-r dotenv/config scripts/bulk-recovery-loop.ts --interval=20 --catchup-seconds=60 --keys=builtin:feed,builtin:nyc,builtin:la,builtin:boston,builtin:chicago,builtin:austin,builtin:seattle,builtin:colorado,builtin:sf",
        "./logs/bulk-builtin-overnight-out.log",
        "./logs/bulk-builtin-overnight-err.log"
      ),
    ]
  : [];

const maintenanceApps = [
  buildMaintenanceShellApp(
    "maintenance-feed-summary",
    `-lc 'while true; do node_modules/.bin/tsx -r dotenv/config scripts/refresh-job-feed-summary.ts || true; sleep ${process.env.JOB_FEED_SUMMARY_REFRESH_SECONDS || 300}; done'`,
    "./logs/maintenance-feed-summary-out.log",
    "./logs/maintenance-feed-summary-err.log"
  ),
  buildMaintenanceShellApp(
    "maintenance-feed-index-sync",
    `-lc 'sleep ${process.env.JOB_FEED_INDEX_SYNC_INITIAL_DELAY_SECONDS || 120}; while true; do timeout ${process.env.JOB_FEED_INDEX_SYNC_TIMEOUT_SECONDS || 300}s node_modules/.bin/tsx -r dotenv/config scripts/backfill-job-feed-index.ts --mode=all --batch-size=${process.env.JOB_FEED_INDEX_SYNC_BATCH_SIZE || 250} --max-batches=${process.env.JOB_FEED_INDEX_SYNC_MAX_BATCHES || 4} --concurrency=${process.env.JOB_FEED_INDEX_SYNC_CONCURRENCY || 2} --sleep-ms=100 || true; sleep ${process.env.JOB_FEED_INDEX_SYNC_INTERVAL_SECONDS || 1800}; done'`,
    "./logs/maintenance-feed-index-sync-out.log",
    "./logs/maintenance-feed-index-sync-err.log"
  ),
  buildMaintenanceShellApp(
    "maintenance-url-health-cycle",
    `-lc 'sleep ${process.env.URL_HEALTH_CYCLE_INITIAL_DELAY_SECONDS || 60}; while true; do timeout ${process.env.URL_HEALTH_CYCLE_TIMEOUT_SECONDS || 900}s node_modules/.bin/tsx -r dotenv/config scripts/url-health-cycle.ts --enqueue-limit=${process.env.URL_HEALTH_CYCLE_ENQUEUE_LIMIT || 8000} --run-limit=${process.env.URL_HEALTH_CYCLE_RUN_LIMIT || 4000} || true; sleep ${process.env.URL_HEALTH_CYCLE_INTERVAL_SECONDS || 600}; done'`,
    "./logs/maintenance-url-health-cycle-out.log",
    "./logs/maintenance-url-health-cycle-err.log",
    {
      DATABASE_POOL_MAX_MAINTENANCE:
        process.env.DATABASE_POOL_MAX_MAINTENANCE || "3",
    }
  ),
  buildMaintenanceShellApp(
    "maintenance-search-index-queue-drain",
    `-lc 'sleep ${process.env.SEARCH_INDEX_QUEUE_DRAIN_INITIAL_DELAY_SECONDS || 180}; while true; do timeout ${process.env.SEARCH_INDEX_QUEUE_DRAIN_TIMEOUT_SECONDS || 900}s node_modules/.bin/tsx -r dotenv/config scripts/run-expansion-pipeline.ts --mode=exploitation --worker-only --queue=SEARCH_INDEX --limit=${process.env.SEARCH_INDEX_QUEUE_DRAIN_LIMIT || 1500} --max-batches=${process.env.SEARCH_INDEX_QUEUE_DRAIN_MAX_BATCHES || 16} --skip-metrics || true; sleep ${process.env.SEARCH_INDEX_QUEUE_DRAIN_INTERVAL_SECONDS || 300}; done'`,
    "./logs/maintenance-search-index-queue-drain-out.log",
    "./logs/maintenance-search-index-queue-drain-err.log",
    {
      PIPELINE_SEARCH_INDEX_CLAIM_LIMIT:
        process.env.PIPELINE_SEARCH_INDEX_CLAIM_LIMIT || "250",
      PIPELINE_SEARCH_INDEX_CONCURRENCY:
        process.env.PIPELINE_SEARCH_INDEX_CONCURRENCY || "6",
      DATABASE_POOL_MAX_MAINTENANCE:
        process.env.DATABASE_POOL_MAX_MAINTENANCE || "3",
    }
  ),
  buildMaintenanceShellApp(
    "maintenance-storage-lifecycle",
    `-lc 'sleep ${process.env.STORAGE_LIFECYCLE_INITIAL_DELAY_SECONDS || 600}; while true; do timeout ${process.env.STORAGE_LIFECYCLE_TIMEOUT_SECONDS || 1800}s node_modules/.bin/tsx -r dotenv/config scripts/apply-storage-lifecycle.ts --apply --vacuum --batch-size=${process.env.STORAGE_LIFECYCLE_BATCH_SIZE || 5000} --max-batches=${process.env.STORAGE_LIFECYCLE_MAX_BATCHES || 10} --inactive-canonical-retention-days=${process.env.INACTIVE_JOB_RETENTION_DAYS || 14} --target=old-unreferenced-inactive-canonical-jobs --target=old-unmapped-raw-jobs || true; sleep ${process.env.STORAGE_LIFECYCLE_INTERVAL_SECONDS || 86400}; done'`,
    "./logs/maintenance-storage-lifecycle-out.log",
    "./logs/maintenance-storage-lifecycle-err.log",
    {
      DATABASE_POOL_MAX_MAINTENANCE:
        process.env.DATABASE_POOL_MAX_MAINTENANCE || "2",
    }
  ),
];

const topPicksWorkerScript = path.join(
  __dirname,
  "scripts/top-picks-refresh-worker.ts"
);
const topPicksApps = fs.existsSync(topPicksWorkerScript)
  ? [
      withWorkerGroups(
        {
          name: "top-picks-refresh-worker",
          script: "node_modules/.bin/tsx",
          args: `-r dotenv/config scripts/top-picks-refresh-worker.ts --forever --limit=${process.env.TOP_PICKS_REFRESH_WORKER_LIMIT || 3} --concurrency=${process.env.TOP_PICKS_REFRESH_WORKER_CONCURRENCY || 1} --idle-sleep-ms=${process.env.TOP_PICKS_REFRESH_WORKER_IDLE_SLEEP_MS || 30000} --error-sleep-ms=${process.env.TOP_PICKS_REFRESH_WORKER_ERROR_SLEEP_MS || 60000}`,
          cwd: __dirname,
          autorestart: true,
          max_restarts: 10,
          min_uptime: "30s",
          restart_delay: 10000,
          output: "./logs/top-picks-refresh-worker-out.log",
          error: "./logs/top-picks-refresh-worker-err.log",
          log_date_format: "YYYY-MM-DD HH:mm:ss",
          merge_logs: true,
          env: {
            ...process.env,
            NODE_ENV: process.env.NODE_ENV || "production",
            DATABASE_PROCESS_ROLE: "maintenance",
            DATABASE_POOL_MAX_MAINTENANCE:
              process.env.DATABASE_POOL_MAX_MAINTENANCE || "2",
            DATABASE_POOL_CONNECTION_TIMEOUT_MS:
              process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "30000",
          },
          max_memory_restart: "768M",
        },
        ["top-picks", "maintenance"]
      ),
    ]
  : [];

const steadyWorkerApps = [
    {
      __workerGroups: ["ingestion"],
      name: "ingest-daemon",
      script: "node_modules/.bin/tsx",
      args: `-r dotenv/config scripts/ingest-daemon.ts --interval=${process.env.INGEST_DAEMON_INTERVAL_MINUTES || 15} --force`,
      cwd: __dirname,
      // Restart policy
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 10000, // 10s between restarts
      // Logs
      output: "./logs/daemon-out.log",
      error: "./logs/daemon-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      // Environment
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || "production",
        DATABASE_PROCESS_ROLE: "daemon",
        DATABASE_POOL_MAX_DAEMON:
          process.env.DATABASE_POOL_MAX_DAEMON || "3",
        DATABASE_POOL_CONNECTION_TIMEOUT_MS:
          process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "30000",
        INGEST_GROWTH_MODE: process.env.INGEST_GROWTH_MODE || "1",
        JOOBLE_ENABLED: "false",
        SOURCE_JOOBLE_ENABLED: "false",
        INGEST_JOOBLE_ENABLED: "false",
        ADZUNA_ENABLED: "false",
        SOURCE_ADZUNA_ENABLED: "false",
        INGEST_ADZUNA_ENABLED: "false",
        INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS:
          process.env.INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS || "true",
        OFFICIAL_COMPANY_EIGHTFOLD_FETCH_DETAILS:
          process.env.OFFICIAL_COMPANY_EIGHTFOLD_FETCH_DETAILS || "false",
        INGEST_CAPACITY_SCALE: process.env.INGEST_CAPACITY_SCALE || "1",
        INGEST_SOURCE_POLL_CONCURRENCY:
          process.env.INGEST_SOURCE_POLL_CONCURRENCY || "3",
        INGEST_STEADY_DISCOVERY_LIMIT:
          process.env.INGEST_STEADY_DISCOVERY_LIMIT || "10",
        INGEST_STEADY_VALIDATION_LIMIT:
          process.env.INGEST_STEADY_VALIDATION_LIMIT || "20",
        INGEST_STEADY_SOURCE_POLL_LIMIT:
          process.env.INGEST_STEADY_SOURCE_POLL_LIMIT || "35",
        INGEST_STEADY_REDISCOVERY_LIMIT:
          process.env.INGEST_STEADY_REDISCOVERY_LIMIT || "5",
        INGEST_STEADY_URL_HEALTH_LIMIT:
          process.env.INGEST_STEADY_URL_HEALTH_LIMIT || "3000",
        INGEST_BURST_DISCOVERY_LIMIT:
          process.env.INGEST_BURST_DISCOVERY_LIMIT || "10",
        INGEST_BURST_VALIDATION_LIMIT:
          process.env.INGEST_BURST_VALIDATION_LIMIT || "20",
        INGEST_BURST_SOURCE_POLL_LIMIT:
          process.env.INGEST_BURST_SOURCE_POLL_LIMIT || "35",
        INGEST_BURST_REDISCOVERY_LIMIT:
          process.env.INGEST_BURST_REDISCOVERY_LIMIT || "5",
        INGEST_BURST_URL_HEALTH_LIMIT:
          process.env.INGEST_BURST_URL_HEALTH_LIMIT || "5000",
      },
      // Memory guard — restart if daemon leaks past 512MB
      max_memory_restart: "512M",
    },
    {
      __workerGroups: ["source-workers"],
      name: "ingest-poll-worker",
      script: "node_modules/.bin/tsx",
      args: `-r dotenv/config scripts/ingest-recovery-worker.ts --role=poll --interval=${process.env.INGEST_POLL_WORKER_INTERVAL_SECONDS || 60}`,
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 10000,
      output: "./logs/poll-worker-out.log",
      error: "./logs/poll-worker-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || "production",
        DATABASE_PROCESS_ROLE: "recovery_poll",
        DATABASE_POOL_MAX_RECOVERY_POLL:
          process.env.DATABASE_POOL_MAX_RECOVERY_POLL || "3",
        DATABASE_POOL_CONNECTION_TIMEOUT_MS:
          process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "30000",
        INGEST_GROWTH_MODE: process.env.INGEST_GROWTH_MODE || "1",
        JOOBLE_ENABLED: "false",
        SOURCE_JOOBLE_ENABLED: "false",
        INGEST_JOOBLE_ENABLED: "false",
        ADZUNA_ENABLED: "false",
        SOURCE_ADZUNA_ENABLED: "false",
        INGEST_ADZUNA_ENABLED: "false",
        INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS:
          process.env.INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS || "true",
        OFFICIAL_COMPANY_EIGHTFOLD_FETCH_DETAILS:
          process.env.OFFICIAL_COMPANY_EIGHTFOLD_FETCH_DETAILS || "false",
        INGEST_CAPACITY_SCALE: process.env.INGEST_CAPACITY_SCALE || "1",
        INGEST_SOURCE_POLL_CONCURRENCY:
          process.env.INGEST_SOURCE_POLL_CONCURRENCY || "6",
        RECOVERY_WORKER_SOURCE_POLL_LIMIT:
          process.env.RECOVERY_WORKER_SOURCE_POLL_LIMIT || "160",
        INGEST_STEADY_URL_HEALTH_LIMIT:
          process.env.INGEST_STEADY_URL_HEALTH_LIMIT || "3000",
        INGEST_BURST_URL_HEALTH_LIMIT:
          process.env.INGEST_BURST_URL_HEALTH_LIMIT || "5000",
      },
      max_memory_restart: "512M",
    },
    {
      __workerGroups: ["source-workers"],
      name: "ingest-high-yield-source-poll",
      script: "bash",
      args: `-lc 'sleep ${process.env.HIGH_YIELD_SOURCE_POLL_INITIAL_DELAY_SECONDS || 120}; while true; do timeout ${process.env.HIGH_YIELD_SOURCE_POLL_TIMEOUT_SECONDS || 300}s node_modules/.bin/tsx -r dotenv/config scripts/run-high-yield-source-poll-pass.ts --growth-only --limit=${process.env.HIGH_YIELD_SOURCE_POLL_LIMIT || 24} --concurrency=${process.env.HIGH_YIELD_SOURCE_POLL_CONCURRENCY || 4} --min-age-minutes=${process.env.HIGH_YIELD_SOURCE_POLL_MIN_AGE_MINUTES || 90} --min-recent-created=${process.env.HIGH_YIELD_SOURCE_POLL_MIN_RECENT_CREATED || 2} --min-last-created=${process.env.HIGH_YIELD_SOURCE_POLL_MIN_LAST_CREATED || 1} --min-total-created=${process.env.HIGH_YIELD_SOURCE_POLL_MIN_TOTAL_CREATED || 10} --lookback-hours=${process.env.HIGH_YIELD_SOURCE_POLL_LOOKBACK_HOURS || 24} --max-runtime-ms=${process.env.HIGH_YIELD_SOURCE_POLL_MAX_RUNTIME_MS || 120000} || true; sleep ${process.env.HIGH_YIELD_SOURCE_POLL_INTERVAL_SECONDS || 600}; done'`,
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 10000,
      output: "./logs/high-yield-source-poll-steady-out.log",
      error: "./logs/high-yield-source-poll-steady-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || "production",
        DATABASE_PROCESS_ROLE: "recovery_poll",
        DATABASE_POOL_MAX_RECOVERY_POLL:
          process.env.DATABASE_POOL_MAX_RECOVERY_POLL || "3",
        DATABASE_POOL_CONNECTION_TIMEOUT_MS:
          process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "30000",
        INGEST_GROWTH_MODE: process.env.INGEST_GROWTH_MODE || "1",
        JOOBLE_ENABLED: "false",
        SOURCE_JOOBLE_ENABLED: "false",
        INGEST_JOOBLE_ENABLED: "false",
        ADZUNA_ENABLED: "false",
        SOURCE_ADZUNA_ENABLED: "false",
        INGEST_ADZUNA_ENABLED: "false",
        INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS:
          process.env.INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS || "true",
        INGEST_SOURCE_POLL_RECOVERY_CONCURRENCY:
          process.env.INGEST_SOURCE_POLL_RECOVERY_CONCURRENCY || "2",
        HIGH_YIELD_INCLUDE_WORKDAY:
          process.env.HIGH_YIELD_INCLUDE_WORKDAY || "0",
      },
      max_memory_restart: "512M",
    },
    {
      __workerGroups: ["source-workers"],
      name: "ingest-retention-source-poll",
      script: "bash",
      args: `-lc 'sleep ${process.env.RETENTION_SOURCE_POLL_INITIAL_DELAY_SECONDS || 240}; while true; do timeout ${process.env.RETENTION_SOURCE_POLL_TIMEOUT_SECONDS || 300}s node_modules/.bin/tsx -r dotenv/config scripts/run-high-yield-source-poll-pass.ts --retention --limit=${process.env.RETENTION_SOURCE_POLL_LIMIT || 200} --concurrency=${process.env.RETENTION_SOURCE_POLL_CONCURRENCY || 10} --min-age-minutes=${process.env.RETENTION_SOURCE_POLL_MIN_AGE_MINUTES || 2880} --max-runtime-ms=${process.env.RETENTION_SOURCE_POLL_MAX_RUNTIME_MS || 240000} || true; sleep ${process.env.RETENTION_SOURCE_POLL_INTERVAL_SECONDS || 180}; done'`,
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 10000,
      output: "./logs/retention-source-poll-out.log",
      error: "./logs/retention-source-poll-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || "production",
        DATABASE_PROCESS_ROLE: "recovery_poll",
        // Retention gets a larger poll pool than the high-yield lane's 3: the DB
        // has ample headroom (~17/100 connections) and the constraint is poll
        // distribution, not capacity.
        DATABASE_POOL_MAX_RECOVERY_POLL:
          process.env.RETENTION_DATABASE_POOL_MAX_RECOVERY_POLL || "8",
        DATABASE_POOL_CONNECTION_TIMEOUT_MS:
          process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "30000",
        JOOBLE_ENABLED: "false",
        SOURCE_JOOBLE_ENABLED: "false",
        INGEST_JOOBLE_ENABLED: "false",
        ADZUNA_ENABLED: "false",
        SOURCE_ADZUNA_ENABLED: "false",
        INGEST_ADZUNA_ENABLED: "false",
        INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS:
          process.env.INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS || "true",
        INGEST_SOURCE_POLL_RECOVERY_CONCURRENCY:
          process.env.INGEST_SOURCE_POLL_RECOVERY_CONCURRENCY || "4",
      },
      max_memory_restart: "512M",
    },
    {
      __workerGroups: ["source-workers"],
      // Expands the company-owned ATS frontier from known company pages and
      // live job/source URLs. This is deliberately separate from generic web
      // search: it discovers only normalized structured boards, then hands
      // them back to the existing validation and promotion gates.
      name: "ingest-ats-frontier-expansion",
      script: "bash",
      args: `-lc 'sleep ${process.env.ATS_FRONTIER_EXPANSION_INITIAL_DELAY_SECONDS || 900}; while true; do timeout ${process.env.ATS_FRONTIER_EXPANSION_TIMEOUT_SECONDS || 900}s node_modules/.bin/tsx -r dotenv/config scripts/expand-ats-frontier.ts --company-limit=${process.env.ATS_FRONTIER_EXPANSION_COMPANY_LIMIT || 2000} --url-limit=${process.env.ATS_FRONTIER_EXPANSION_URL_LIMIT || 12000} --page-scan-limit=${process.env.ATS_FRONTIER_EXPANSION_PAGE_SCAN_LIMIT || 240} --page-discovery-concurrency=${process.env.ATS_FRONTIER_EXPANSION_PAGE_CONCURRENCY || 6} --promotion-threshold=${process.env.ATS_FRONTIER_EXPANSION_PROMOTION_THRESHOLD || 0.78} --rotation-window-minutes=${process.env.ATS_FRONTIER_EXPANSION_ROTATION_WINDOW_MINUTES || 180} || true; sleep ${process.env.ATS_FRONTIER_EXPANSION_INTERVAL_SECONDS || 10800}; done'`,
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 10000,
      output: "./logs/ats-frontier-expansion-out.log",
      error: "./logs/ats-frontier-expansion-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || "production",
        DATABASE_PROCESS_ROLE: "recovery_discovery",
        DATABASE_POOL_CONNECTION_TIMEOUT_MS:
          process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "10000",
        INGEST_GROWTH_MODE: process.env.INGEST_GROWTH_MODE || "1",
        JOOBLE_ENABLED: "false",
        SOURCE_JOOBLE_ENABLED: "false",
        INGEST_JOOBLE_ENABLED: "false",
        ADZUNA_ENABLED: "false",
        SOURCE_ADZUNA_ENABLED: "false",
        INGEST_ADZUNA_ENABLED: "false",
      },
      max_memory_restart: "384M",
    },
    {
      __workerGroups: ["source-workers"],
      name: "ingest-source-candidate-scheduler",
      script: "node_modules/.bin/tsx",
      args: `-r dotenv/config scripts/run-expansion-pipeline.ts --mode=exploration --schedule-only --skip-seed --limit=${process.env.SOURCE_CANDIDATE_SCHEDULER_LIMIT || 300} --idle-sleep-ms=${process.env.SOURCE_CANDIDATE_SCHEDULER_INTERVAL_MS || 300000} --error-sleep-ms=${process.env.SOURCE_CANDIDATE_SCHEDULER_ERROR_SLEEP_MS || 120000} --forever --skip-metrics`,
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 10000,
      output: "./logs/source-candidate-scheduler-out.log",
      error: "./logs/source-candidate-scheduler-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || "production",
        DATABASE_PROCESS_ROLE: "recovery_discovery",
        DATABASE_POOL_CONNECTION_TIMEOUT_MS:
          process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "10000",
        INGEST_GROWTH_MODE: process.env.INGEST_GROWTH_MODE || "1",
        JOOBLE_ENABLED: "false",
        SOURCE_JOOBLE_ENABLED: "false",
        INGEST_JOOBLE_ENABLED: "false",
        ADZUNA_ENABLED: "false",
        SOURCE_ADZUNA_ENABLED: "false",
        INGEST_ADZUNA_ENABLED: "false",
      },
      max_memory_restart: "384M",
    },
    {
      __workerGroups: ["source-workers"],
      name: "ingest-source-candidate-discovery-drain",
      script: "node_modules/.bin/tsx",
      args: `-r dotenv/config scripts/run-expansion-pipeline.ts --mode=exploration --worker-only --queue=SOURCE_DISCOVERY --limit=${process.env.SOURCE_CANDIDATE_DISCOVERY_DRAIN_LIMIT || 120} --max-batches=${process.env.SOURCE_CANDIDATE_DISCOVERY_DRAIN_BATCHES || 2} --idle-sleep-ms=${process.env.SOURCE_CANDIDATE_DISCOVERY_DRAIN_INTERVAL_MS || 60000} --error-sleep-ms=${process.env.SOURCE_CANDIDATE_DISCOVERY_DRAIN_ERROR_SLEEP_MS || 120000} --forever --skip-metrics`,
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 10000,
      output: "./logs/source-candidate-discovery-drain-out.log",
      error: "./logs/source-candidate-discovery-drain-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || "production",
        DATABASE_PROCESS_ROLE: "recovery_discovery",
        DATABASE_POOL_CONNECTION_TIMEOUT_MS:
          process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "10000",
        PIPELINE_SOURCE_DISCOVERY_CLAIM_LIMIT:
          process.env.PIPELINE_SOURCE_DISCOVERY_CLAIM_LIMIT || "80",
        PIPELINE_SOURCE_DISCOVERY_CONCURRENCY:
          process.env.PIPELINE_SOURCE_DISCOVERY_CONCURRENCY || "6",
        INGEST_GROWTH_MODE: process.env.INGEST_GROWTH_MODE || "1",
        JOOBLE_ENABLED: "false",
        SOURCE_JOOBLE_ENABLED: "false",
        INGEST_JOOBLE_ENABLED: "false",
        ADZUNA_ENABLED: "false",
        SOURCE_ADZUNA_ENABLED: "false",
        INGEST_ADZUNA_ENABLED: "false",
      },
      max_memory_restart: "384M",
    },
    {
      __workerGroups: ["source-workers"],
      name: "ingest-source-candidate-validation-drain",
      script: "node_modules/.bin/tsx",
      args: `-r dotenv/config scripts/run-expansion-pipeline.ts --mode=exploration --worker-only --queue=SOURCE_VALIDATION --limit=${process.env.SOURCE_CANDIDATE_VALIDATION_DRAIN_LIMIT || 120} --max-batches=${process.env.SOURCE_CANDIDATE_VALIDATION_DRAIN_BATCHES || 3} --idle-sleep-ms=${process.env.SOURCE_CANDIDATE_VALIDATION_DRAIN_INTERVAL_MS || 60000} --error-sleep-ms=${process.env.SOURCE_CANDIDATE_VALIDATION_DRAIN_ERROR_SLEEP_MS || 120000} --forever --skip-metrics`,
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 10000,
      output: "./logs/source-candidate-validation-drain-out.log",
      error: "./logs/source-candidate-validation-drain-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || "production",
        DATABASE_PROCESS_ROLE: "recovery_validation",
        DATABASE_POOL_CONNECTION_TIMEOUT_MS:
          process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "10000",
        PIPELINE_SOURCE_VALIDATION_CLAIM_LIMIT:
          process.env.PIPELINE_SOURCE_VALIDATION_CLAIM_LIMIT || "80",
        PIPELINE_SOURCE_VALIDATION_CONCURRENCY:
          process.env.PIPELINE_SOURCE_VALIDATION_CONCURRENCY || "6",
        SOURCE_CANDIDATE_PREVIEW_LIMIT:
          process.env.SOURCE_CANDIDATE_PREVIEW_LIMIT || "5",
        SOURCE_CANDIDATE_PREVIEW_TIMEOUT_MS:
          process.env.SOURCE_CANDIDATE_PREVIEW_TIMEOUT_MS || "15000",
        INGEST_GROWTH_MODE: process.env.INGEST_GROWTH_MODE || "1",
        JOOBLE_ENABLED: "false",
        SOURCE_JOOBLE_ENABLED: "false",
        INGEST_JOOBLE_ENABLED: "false",
        ADZUNA_ENABLED: "false",
        SOURCE_ADZUNA_ENABLED: "false",
        INGEST_ADZUNA_ENABLED: "false",
      },
      max_memory_restart: "512M",
    },
    {
      __workerGroups: ["source-workers"],
      name: "ingest-source-candidate-promotion",
      script: "bash",
      args: `-lc 'sleep ${process.env.SOURCE_CANDIDATE_PROMOTION_INITIAL_DELAY_SECONDS || 180}; while true; do timeout ${process.env.SOURCE_CANDIDATE_PROMOTION_TIMEOUT_SECONDS || 240}s node_modules/.bin/tsx -r dotenv/config scripts/source-candidate-promotion-plan.ts --apply --no-report --limit=${process.env.SOURCE_CANDIDATE_PROMOTION_LIMIT || 1000} --max-promote=${process.env.SOURCE_CANDIDATE_PROMOTION_MAX_PROMOTE || 12} --max-validate=${process.env.SOURCE_CANDIDATE_PROMOTION_MAX_VALIDATE || 120} --ats-validation-share=${process.env.SOURCE_CANDIDATE_PROMOTION_ATS_VALIDATION_SHARE || 0.6}; sleep ${process.env.SOURCE_CANDIDATE_PROMOTION_INTERVAL_SECONDS || 300}; done'`,
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 10000,
      output: "./logs/source-candidate-promotion-out.log",
      error: "./logs/source-candidate-promotion-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || "production",
        DATABASE_PROCESS_ROLE: "recovery_validation",
        DATABASE_POOL_MAX_RECOVERY_VALIDATION:
          process.env.DATABASE_POOL_MAX_RECOVERY_VALIDATION || "2",
        DATABASE_POOL_CONNECTION_TIMEOUT_MS:
          process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "10000",
      },
      max_memory_restart: "384M",
    },
    {
      __workerGroups: ["source-workers"],
      name: "ingest-validation-worker",
      script: "node_modules/.bin/tsx",
      args: `-r dotenv/config scripts/ingest-recovery-worker.ts --role=validation --interval=${process.env.INGEST_VALIDATION_WORKER_INTERVAL_SECONDS || 120}`,
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 10000,
      output: "./logs/validation-worker-out.log",
      error: "./logs/validation-worker-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || "production",
        DATABASE_PROCESS_ROLE: "recovery_validation",
        DATABASE_POOL_CONNECTION_TIMEOUT_MS:
          process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "10000",
        INGEST_GROWTH_MODE: process.env.INGEST_GROWTH_MODE || "1",
        JOOBLE_ENABLED: "false",
        SOURCE_JOOBLE_ENABLED: "false",
        INGEST_JOOBLE_ENABLED: "false",
        ADZUNA_ENABLED: "false",
        SOURCE_ADZUNA_ENABLED: "false",
        INGEST_ADZUNA_ENABLED: "false",
        INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS:
          process.env.INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS || "true",
        INGEST_CAPACITY_SCALE: process.env.INGEST_CAPACITY_SCALE || "1",
        INGEST_SOURCE_VALIDATION_QUEUE_CONCURRENCY:
          process.env.INGEST_SOURCE_VALIDATION_QUEUE_CONCURRENCY || "6",
        RECOVERY_WORKER_VALIDATION_LIMIT:
          process.env.RECOVERY_WORKER_VALIDATION_LIMIT || "160",
        DATABASE_POOL_MAX_RECOVERY_VALIDATION:
          process.env.DATABASE_POOL_MAX_RECOVERY_VALIDATION || "2",
      },
      max_memory_restart: "512M",
    },
    {
      __workerGroups: ["source-workers"],
      name: "ingest-discovery-worker",
      script: "node_modules/.bin/tsx",
      args: `-r dotenv/config scripts/ingest-recovery-worker.ts --role=discovery --interval=${process.env.INGEST_DISCOVERY_WORKER_INTERVAL_SECONDS || 120}`,
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 10000,
      output: "./logs/discovery-worker-out.log",
      error: "./logs/discovery-worker-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || "production",
        DATABASE_PROCESS_ROLE: "recovery_discovery",
        DATABASE_POOL_CONNECTION_TIMEOUT_MS:
          process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "10000",
        INGEST_GROWTH_MODE: process.env.INGEST_GROWTH_MODE || "1",
        JOOBLE_ENABLED: "false",
        SOURCE_JOOBLE_ENABLED: "false",
        INGEST_JOOBLE_ENABLED: "false",
        ADZUNA_ENABLED: "false",
        SOURCE_ADZUNA_ENABLED: "false",
        INGEST_ADZUNA_ENABLED: "false",
        INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS:
          process.env.INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS || "true",
        INGEST_CAPACITY_SCALE: process.env.INGEST_CAPACITY_SCALE || "1",
        INGEST_DISCOVERY_QUEUE_CONCURRENCY:
          process.env.INGEST_DISCOVERY_QUEUE_CONCURRENCY || "6",
        RECOVERY_WORKER_DISCOVERY_LIMIT:
          process.env.RECOVERY_WORKER_DISCOVERY_LIMIT || "60",
        RECOVERY_WORKER_REDISCOVERY_LIMIT:
          process.env.RECOVERY_WORKER_REDISCOVERY_LIMIT || "80",
        DATABASE_POOL_MAX_RECOVERY_DISCOVERY:
          process.env.DATABASE_POOL_MAX_RECOVERY_DISCOVERY || "3",
      },
      max_memory_restart: "512M",
    },
];

// Continuous supply-growth lanes: proactive ATS slug-probe discovery
// (coverage + repair) and the zombie-source circuit-breaker sweep. Opt-in:
// set INGEST_AUTO_DISCOVERY_ENABLED=1 to enable. Kept off by default so a
// deploy never starts hitting external ATS endpoints or mutating source
// state until retention/health is confirmed stable.
function buildAutoDiscoveryShellApp(name, args, output, error) {
  return withWorkerGroups({
    name,
    script: "bash",
    args,
    cwd: __dirname,
    autorestart: true,
    max_restarts: 10,
    min_uptime: "30s",
    restart_delay: 10000,
    output,
    error,
    log_date_format: "YYYY-MM-DD HH:mm:ss",
    merge_logs: true,
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || "production",
      DATABASE_PROCESS_ROLE: "recovery_discovery",
      DATABASE_POOL_MAX_RECOVERY_DISCOVERY:
        process.env.DATABASE_POOL_MAX_RECOVERY_DISCOVERY || "2",
      DATABASE_POOL_CONNECTION_TIMEOUT_MS:
        process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "30000",
    },
    max_memory_restart: "384M",
  }, ["source-workers"]);
}

const autoDiscoveryApps =
  process.env.INGEST_AUTO_DISCOVERY_ENABLED === "1"
    ? [
        buildAutoDiscoveryShellApp(
          "ingest-slug-probe-repair",
          `-lc 'sleep ${process.env.SLUG_PROBE_REPAIR_INITIAL_DELAY_SECONDS || 300}; while true; do timeout ${process.env.SLUG_PROBE_REPAIR_TIMEOUT_SECONDS || 3600}s node_modules/.bin/tsx -r dotenv/config scripts/probe-ats-slugs.ts --mode=repair --limit=${process.env.SLUG_PROBE_REPAIR_LIMIT || 300} --concurrency=${process.env.SLUG_PROBE_CONCURRENCY || 3} --apply || true; sleep ${process.env.SLUG_PROBE_REPAIR_INTERVAL_SECONDS || 21600}; done'`,
          "./logs/slug-probe-repair-out.log",
          "./logs/slug-probe-repair-err.log"
        ),
        buildAutoDiscoveryShellApp(
          "ingest-slug-probe-coverage",
          `-lc 'sleep ${process.env.SLUG_PROBE_COVERAGE_INITIAL_DELAY_SECONDS || 1800}; while true; do timeout ${process.env.SLUG_PROBE_COVERAGE_TIMEOUT_SECONDS || 7200}s node_modules/.bin/tsx -r dotenv/config scripts/probe-ats-slugs.ts --mode=coverage --limit=${process.env.SLUG_PROBE_COVERAGE_LIMIT || 600} --concurrency=${process.env.SLUG_PROBE_CONCURRENCY || 3} --apply || true; sleep ${process.env.SLUG_PROBE_COVERAGE_INTERVAL_SECONDS || 1800}; done'`,
          "./logs/slug-probe-coverage-out.log",
          "./logs/slug-probe-coverage-err.log"
        ),
        buildAutoDiscoveryShellApp(
          "ingest-zombie-sweep",
          `-lc 'sleep ${process.env.ZOMBIE_SWEEP_INITIAL_DELAY_SECONDS || 900}; while true; do timeout ${process.env.ZOMBIE_SWEEP_TIMEOUT_SECONDS || 1800}s node_modules/.bin/tsx -r dotenv/config scripts/sweep-zombie-sources.ts --limit=${process.env.ZOMBIE_SWEEP_LIMIT || 500} --apply || true; sleep ${process.env.ZOMBIE_SWEEP_INTERVAL_SECONDS || 43200}; done'`,
          "./logs/zombie-sweep-out.log",
          "./logs/zombie-sweep-err.log"
        ),
      ]
    : [];

module.exports = {
  apps: selectWorkerApps([
    ...steadyWorkerApps,
    ...autoDiscoveryApps,
    ...maintenanceApps,
    ...topPicksApps,
    ...overnightAccelerationApps,
  ]),
};
