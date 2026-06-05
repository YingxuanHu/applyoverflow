/**
 * PM2 ecosystem configuration for the ingestion daemon.
 *
 * Start:   npx pm2 start ecosystem.config.cjs
 * Stop:    npx pm2 stop ingest-daemon
 * Restart: npx pm2 restart ingest-daemon
 * Logs:    npx pm2 logs ingest-daemon
 * Status:  npx pm2 status
 */
const overnightAccelerationEnabled =
  process.env.INGEST_OVERNIGHT_ACCELERATION === "1";

function buildOvernightApp(name, args, output, error, extraEnv = {}) {
  return {
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
  };
}

function buildOvernightShellApp(name, args, output, error, extraEnv = {}) {
  return {
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
  };
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
        "-lc 'while true; do timeout 360s node_modules/.bin/tsx -r dotenv/config scripts/run-high-yield-source-poll-pass.ts --limit=45 --concurrency=4 --min-age-minutes=120 --max-runtime-ms=150000; sleep 900; done'",
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

module.exports = {
  apps: [
    {
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
          process.env.INGEST_STEADY_URL_HEALTH_LIMIT || "1",
        INGEST_BURST_DISCOVERY_LIMIT:
          process.env.INGEST_BURST_DISCOVERY_LIMIT || "10",
        INGEST_BURST_VALIDATION_LIMIT:
          process.env.INGEST_BURST_VALIDATION_LIMIT || "20",
        INGEST_BURST_SOURCE_POLL_LIMIT:
          process.env.INGEST_BURST_SOURCE_POLL_LIMIT || "35",
        INGEST_BURST_REDISCOVERY_LIMIT:
          process.env.INGEST_BURST_REDISCOVERY_LIMIT || "5",
        INGEST_BURST_URL_HEALTH_LIMIT:
          process.env.INGEST_BURST_URL_HEALTH_LIMIT || "1",
      },
      // Memory guard — restart if daemon leaks past 512MB
      max_memory_restart: "512M",
    },
    {
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
          process.env.INGEST_SOURCE_POLL_CONCURRENCY || "2",
        RECOVERY_WORKER_SOURCE_POLL_LIMIT:
          process.env.RECOVERY_WORKER_SOURCE_POLL_LIMIT || "80",
        INGEST_STEADY_URL_HEALTH_LIMIT:
          process.env.INGEST_STEADY_URL_HEALTH_LIMIT || "1",
        INGEST_BURST_URL_HEALTH_LIMIT:
          process.env.INGEST_BURST_URL_HEALTH_LIMIT || "1",
      },
      max_memory_restart: "512M",
    },
    {
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
          process.env.INGEST_SOURCE_VALIDATION_QUEUE_CONCURRENCY || "3",
        RECOVERY_WORKER_VALIDATION_LIMIT:
          process.env.RECOVERY_WORKER_VALIDATION_LIMIT || "80",
        DATABASE_POOL_MAX_RECOVERY_VALIDATION:
          process.env.DATABASE_POOL_MAX_RECOVERY_VALIDATION || "2",
      },
      max_memory_restart: "512M",
    },
    {
      name: "ingest-discovery-worker",
      script: "node_modules/.bin/tsx",
      args: `-r dotenv/config scripts/ingest-recovery-worker.ts --role=discovery --interval=${process.env.INGEST_DISCOVERY_WORKER_INTERVAL_SECONDS || 180}`,
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
          process.env.INGEST_DISCOVERY_QUEUE_CONCURRENCY || "2",
        RECOVERY_WORKER_DISCOVERY_LIMIT:
          process.env.RECOVERY_WORKER_DISCOVERY_LIMIT || "30",
        RECOVERY_WORKER_REDISCOVERY_LIMIT:
          process.env.RECOVERY_WORKER_REDISCOVERY_LIMIT || "15",
        DATABASE_POOL_MAX_RECOVERY_DISCOVERY:
          process.env.DATABASE_POOL_MAX_RECOVERY_DISCOVERY || "2",
      },
      max_memory_restart: "512M",
    },
    ...overnightAccelerationApps,
  ],
};
