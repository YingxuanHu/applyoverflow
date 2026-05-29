/**
 * PM2 ecosystem configuration for the ingestion daemon.
 *
 * Start:   npx pm2 start ecosystem.config.cjs
 * Stop:    npx pm2 stop ingest-daemon
 * Restart: npx pm2 restart ingest-daemon
 * Logs:    npx pm2 logs ingest-daemon
 * Status:  npx pm2 status
 */
module.exports = {
  apps: [
    {
      name: "ingest-daemon",
      script: "node_modules/.bin/tsx",
      args: `-r dotenv/config scripts/ingest-daemon.ts --interval=${process.env.INGEST_DAEMON_INTERVAL_MINUTES || 5} --force`,
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
          process.env.DATABASE_POOL_MAX_DAEMON || "8",
        DATABASE_POOL_CONNECTION_TIMEOUT_MS:
          process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "10000",
        INGEST_GROWTH_MODE: process.env.INGEST_GROWTH_MODE || "1",
        JOOBLE_ENABLED: "false",
        SOURCE_JOOBLE_ENABLED: "false",
        INGEST_JOOBLE_ENABLED: "false",
        INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS:
          process.env.INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS || "true",
        OFFICIAL_COMPANY_EIGHTFOLD_FETCH_DETAILS:
          process.env.OFFICIAL_COMPANY_EIGHTFOLD_FETCH_DETAILS || "false",
        INGEST_CAPACITY_SCALE: process.env.INGEST_CAPACITY_SCALE || "1",
        INGEST_SOURCE_POLL_CONCURRENCY:
          process.env.INGEST_SOURCE_POLL_CONCURRENCY || "32",
        INGEST_STEADY_DISCOVERY_LIMIT:
          process.env.INGEST_STEADY_DISCOVERY_LIMIT || "25",
        INGEST_STEADY_VALIDATION_LIMIT:
          process.env.INGEST_STEADY_VALIDATION_LIMIT || "50",
        INGEST_STEADY_SOURCE_POLL_LIMIT:
          process.env.INGEST_STEADY_SOURCE_POLL_LIMIT || "100",
        INGEST_STEADY_REDISCOVERY_LIMIT:
          process.env.INGEST_STEADY_REDISCOVERY_LIMIT || "10",
        INGEST_STEADY_URL_HEALTH_LIMIT:
          process.env.INGEST_STEADY_URL_HEALTH_LIMIT || "1",
        INGEST_BURST_DISCOVERY_LIMIT:
          process.env.INGEST_BURST_DISCOVERY_LIMIT || "25",
        INGEST_BURST_VALIDATION_LIMIT:
          process.env.INGEST_BURST_VALIDATION_LIMIT || "50",
        INGEST_BURST_SOURCE_POLL_LIMIT:
          process.env.INGEST_BURST_SOURCE_POLL_LIMIT || "100",
        INGEST_BURST_REDISCOVERY_LIMIT:
          process.env.INGEST_BURST_REDISCOVERY_LIMIT || "10",
        INGEST_BURST_URL_HEALTH_LIMIT:
          process.env.INGEST_BURST_URL_HEALTH_LIMIT || "1",
      },
      // Memory guard — restart if daemon leaks past 512MB
      max_memory_restart: "512M",
    },
    {
      name: "ingest-poll-worker",
      script: "node_modules/.bin/tsx",
      args: "-r dotenv/config scripts/ingest-recovery-worker.ts --role=poll --interval=5",
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
          process.env.DATABASE_POOL_MAX_RECOVERY_POLL || "8",
        DATABASE_POOL_CONNECTION_TIMEOUT_MS:
          process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS || "10000",
        INGEST_GROWTH_MODE: process.env.INGEST_GROWTH_MODE || "1",
        JOOBLE_ENABLED: "false",
        SOURCE_JOOBLE_ENABLED: "false",
        INGEST_JOOBLE_ENABLED: "false",
        INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS:
          process.env.INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS || "true",
        OFFICIAL_COMPANY_EIGHTFOLD_FETCH_DETAILS:
          process.env.OFFICIAL_COMPANY_EIGHTFOLD_FETCH_DETAILS || "false",
        INGEST_CAPACITY_SCALE: process.env.INGEST_CAPACITY_SCALE || "1",
        INGEST_SOURCE_POLL_CONCURRENCY:
          process.env.INGEST_SOURCE_POLL_CONCURRENCY || "24",
        RECOVERY_WORKER_SOURCE_POLL_LIMIT:
          process.env.RECOVERY_WORKER_SOURCE_POLL_LIMIT || "250",
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
      args: "-r dotenv/config scripts/ingest-recovery-worker.ts --role=validation --interval=10",
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
        INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS:
          process.env.INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS || "true",
        INGEST_CAPACITY_SCALE: process.env.INGEST_CAPACITY_SCALE || "1",
        INGEST_SOURCE_VALIDATION_QUEUE_CONCURRENCY:
          process.env.INGEST_SOURCE_VALIDATION_QUEUE_CONCURRENCY || "12",
        RECOVERY_WORKER_VALIDATION_LIMIT:
          process.env.RECOVERY_WORKER_VALIDATION_LIMIT || "250",
        DATABASE_POOL_MAX_RECOVERY_VALIDATION:
          process.env.DATABASE_POOL_MAX_RECOVERY_VALIDATION || "4",
      },
      max_memory_restart: "512M",
    },
    {
      name: "ingest-discovery-worker",
      script: "node_modules/.bin/tsx",
      args: "-r dotenv/config scripts/ingest-recovery-worker.ts --role=discovery --interval=15",
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
        INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS:
          process.env.INGEST_SKIP_GENERIC_COMPANY_SITE_POLLS || "true",
        INGEST_CAPACITY_SCALE: process.env.INGEST_CAPACITY_SCALE || "1",
        INGEST_DISCOVERY_QUEUE_CONCURRENCY:
          process.env.INGEST_DISCOVERY_QUEUE_CONCURRENCY || "6",
        RECOVERY_WORKER_DISCOVERY_LIMIT:
          process.env.RECOVERY_WORKER_DISCOVERY_LIMIT || "80",
        RECOVERY_WORKER_REDISCOVERY_LIMIT:
          process.env.RECOVERY_WORKER_REDISCOVERY_LIMIT || "50",
        DATABASE_POOL_MAX_RECOVERY_DISCOVERY:
          process.env.DATABASE_POOL_MAX_RECOVERY_DISCOVERY || "3",
      },
      max_memory_restart: "512M",
    },
  ],
};
