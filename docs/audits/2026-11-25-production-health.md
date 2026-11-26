# Production health check: November 25, 2026

Production was reachable and ingesting jobs during this check. That does not
verify host health, backup recovery, or public-launch readiness.

## Verified

- `GET /api/health` returned `200 ready` on `e371a27` in 255-324 ms. The
  readiness route checks database connectivity, not disk, backups, or queue lag.
- The ingestion status reported a successful run at 7:19 p.m. Toronto time,
  424,044 jobs in the cached live count, and 20,619 reported active sources.
  Those figures do not establish source-by-source freshness or listing quality.
- Anonymous browse, title search, and location search returned results. The
  default feed took 88-351 ms. Keyword and location probes ranged from 81 ms to
  11.9 s; repeated searches were faster. These are individual smoke requests,
  not a latency percentile or load test.
- The sign-in, extension guide, and extension setup pages loaded. Signed-out
  export, resume, and ingestion-control endpoints rejected access. HTTPS
  returned HSTS; sign-in CSP was report-only.
- The production download ZIP contained extension `0.16.2`. The public Chrome
  Web Store listing reported `0.15.1`. No signed-in extension test or submission
  was performed.
- The running revision and the subsequent monitoring-only `main` revision
  `4e10b8a` both passed their main-push Verify runs. The release lockfile's new
  advisories were remediated in the candidate lockfile, which audited clean.
  This does not patch the app that is still running in production.

## Open operational checks

1. **Verify backups and storage first.** Read the current host alert state,
   backup result and verified backup receipt; check space on both filesystems
   and confirm the database/runtime paths are on the attached mount. No host
   access was available during this check. Do not infer backup freshness from
   HTTP readiness or transplant October disk readings. A verified receipt does
   not replace the isolated restore rehearsal in the recovery runbook.
2. **Close the external alerting gap.** The last 30 GitHub Public Health runs
   passed, but intervals were about 8.2 hours at the median and up to 12.2 hours
   despite the 15-minute cron configuration. Keep the existing check as a
   secondary signal; configure a separate off-host uptime monitor with a
   measured delivery interval. The latest GitHub probe sent no email; host
   warning codes and receipt remain unverified.
3. **Investigate slow search with host evidence.** Compare slow query logs,
   waits, and query plans for fresh title/location requests alongside worker
   activity. Confirm the bottleneck before changing ranking, indexes or query
   budgets. Do not benchmark against production.
4. **Finish the release and signed-in checks.** Deploy the dependency patch
   only after exact-revision CI and storage preflight pass. Recheck sign-in,
   saved jobs, onboarding, and autofill using the published Chrome build. Keep
   launch on hold pending isolated restore and capacity evidence.
