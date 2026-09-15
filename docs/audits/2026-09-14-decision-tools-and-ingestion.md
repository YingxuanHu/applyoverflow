# Decision Tools and Ingestion Follow-Up

Status: release candidate, not deployed. The production browser benchmark below measures the existing release, not this patch.

## Implemented

- **Saved-job comparison:** `/applications/compare` compares two to four saved jobs. All lookups are scoped to the current profile, including IDs supplied in the URL. Salary retains its currency and source period; uncertain metadata is explicitly unconfirmed. On mobile, only the table scrolls horizontally and fact labels remain visible.
- **Meaningful change alerts:** a small versioned snapshot stores six decision facts, not another job description. Existing saved jobs get a silent baseline. The maintenance worker checks at most 200 jobs per pass, at most once per hour per updated job. Optimistic claims prevent concurrent workers from duplicating alerts. Changes within a rolling day update the same in-app notification. Applied jobs and inactive accounts do not receive wishlist alerts. No email is sent.
- **Incorrect-detail reports:** an authenticated, size-limited and rate-limited form sends an issue to `/ops/job-reports`. Repeated reports from one person cannot inflate issue priority or reopen a resolved report. Only the existing operations allowlist can review reports; both page reads and server actions check authorization. A report never directly changes source data. Resolution requires source verification.
- **Lower ingestion write amplification:** feed-index refreshes reuse unchanged large PostgreSQL values instead of repeatedly allocating their compressed storage. The duplicate create/update projection is now one typed projection. Older workers cannot overwrite a newer index or mark a newer canonical version as indexed. Source mapping reads no longer retrieve unused evidence payloads. Canonical lifecycle, public visibility, source mappings, eligibility, and saved/application records are preserved.
- **Source recovery diagnostics:** supply health includes a bounded shortlist of overdue productive sources with actionable reasons: cooldown, operator review, scheduled work, a waiting worker, an unusually long-running task, upstream access failure, or a missing poll task. It does not bypass cooldowns or re-enable sources automatically. The successful-poll retention query now has a matching partial-index script.
- **Storage controls:** maintenance VACUUM gets its own one-connection pool with database-enforced statement and lock timeouts; no `VACUUM FULL` or disabling autovacuum. Daily catalog telemetry keeps 90 compact snapshots and reports per-table growth without counting or copying job contents. Existing Docker log limits remain unchanged.
- **Off-VPS release builds:** `npm run deploy:build-local` builds linux/amd64 web and worker images locally and streams them through SSH. No image archive or build cache is written on the VPS. The release script verifies revision/platform, runs its existing transport and PDF smoke checks, applies migrations, then starts the selected services without rebuilding or recreating dependencies. Temporary transport aliases are removed only after health checks pass.
- **Repeatable search benchmark:** `npm run jobs:benchmark-search` performs at most 30 sequential navigations with a 1.5-second gap. It verifies job selection after rendering and reports first-visit/repeat result latency without waiting for exact counts or flushing database caches. Remote runs require explicit opt-in and a pre-authenticated storage-state file.

## Production Benchmark

September 14, 2026, approximately 20:21 UTC. Desktop Chromium, existing audit account, six routes over three rounds, 18 sequential navigations. No application submissions, source configuration changes, or server restarts.

| Search | First visit | Repeat visits |
| --- | ---: | ---: |
| Board | 942 ms | 435-488 ms |
| Engineer | 776 ms | 446-450 ms |
| Toronto | 529 ms | 436-462 ms |
| Toronto, page 2 | 2,219 ms | 491-492 ms |
| Remote analyst | 4,072 ms | 466-538 ms |
| Marketing, newest | 2,568 ms | 462-483 ms |

No navigation or selection errors. Median result-ready time was **488 ms** and sample p95 was **4,072 ms**, above the proposed **2,000 ms** budget. Selection responded in 26-105 ms. These are small-sample end-to-end measurements, not a load test or a guaranteed cold-cache experiment. The benchmark exits nonzero when the budget is missed. The temporary exported production session was deleted after the run.

## Verification

- All **909 unit tests** pass with `node --import tsx --test --test-concurrency=4 tests/*.test.ts`. The unconstrained run hit one subprocess timeout in an existing monitoring test; that test passed in isolation and in the bounded full run.
- Local PostgreSQL integration checks pass for external-value reuse, out-of-order index writes, canonical-version guards, silent alert baselines, concurrent alert claims, daily coalescing, applied-job exclusion, source-recovery classification, and dedicated session timeouts.
- Existing feed-repair and 8,055-row ranked-search parity tests pass, including visibility, ordering, pagination, and per-viewer exclusions.
- Browser checks pass for reporting, validation/deduplication, verified moderation, resolved-report non-reopening, comparison, explicit unknowns, private wishlist isolation, and desktop/mobile layout with pinned fact labels. Screenshots are under `output/playwright/job-comparison-*.png` and contain synthetic local data.
- An isolated optimized build, TypeScript, scoped ESLint, shell syntax, and whitespace checks pass. The final browser run uses the standalone build, with an ephemeral auth secret and an operations allowlist limited to the existing local test account. Existing localhost servers were not restarted. Deferred-count browser regressions also pass: usable rows before totals, failure/retry, late-response isolation, authenticated counts, exact pagination, and mobile layout.
- The full multi-account UX suite passes for Picks, saved searches, application tracking, reminders, description recovery, and authorization. Local tracker measurements were 1,048 ms to load, 21 ms to change views, and 289 ms to update status; these are not production timings.
- The partial-index script was tested only against local PostgreSQL. It creates a valid index when a tablespace is supplied and exits nonzero without one. Deployment shell tests verify image revision/platform rejection and preservation of smoke tests/migrations without a VPS build.

## Rollout

1. Deploy migration `20260915000000_job_decision_tools` before the web code and the two new maintenance processes. The existing release script performs that ordering. An app-only release will not start the new worker processes.
2. Test the off-VPS Docker build/SSH transfer on staging before production. Shell mocks do not prove an actual cross-platform image build or transfer. `LOCAL_RELEASE_BUILDER` may select a configured local Buildx builder; the release checkout must be clean. Runtime image layers still occupy VPS disk, so check free space and preserve rollback images.
3. In a low-load window, run `source-retention-index.sql` outside a transaction with `-v source_index_tablespace=applyoverflow_volume` only after checking the configured attached mount and preserving the existing backup reserve. For local tests use `pg_default`. If a concurrent build is interrupted, inspect and remove only its invalid index concurrently before retrying. Do not treat `IF NOT EXISTS` as proof that an index is usable.
4. Keep storage telemetry in the existing persistent `/app/logs` bind mount, or configure `STORAGE_GROWTH_HISTORY_DIR` to a persistent attached-volume directory visible to the worker. `STORAGE_VOLUME_PATH` must be a mount visible inside that process; do not assume a host path is mounted in the container. Host monitoring remains the source for attached-volume capacity until that is configured. Estimates and reusable dead space are not filesystem reclamation.
5. Re-run the browser benchmark after deployment. Supply `TEST_APP_URL`, `BENCHMARK_REMOTE=1`, and `BENCHMARK_STORAGE_STATE` pointing to a protected, temporary audit session. Never commit session files. Compare first visits and repeats separately.

## Still Open

- Cold combined-filter and page-two queries remain over budget. The write-amplification patch may reduce competing I/O, but its production effect has not been measured and it is not a claim that search latency is fixed.
- Review the recovery shortlist against active leases and upstream error evidence before requeueing anything. No bulk source re-enablement or policy bypass is included.
- The unchanged-ingestion lifecycle still has several database round trips. This patch reduces large-value rewrites, not all per-job work; further batching needs lifecycle and concurrent-update correctness tests.
- The new source-retention index has not been installed or benchmarked on production. Historical evidence compaction and additional tablespace moves remain separate, capacity-budgeted operations.
- No production deploy, destructive cleanup, backup deletion, unrelated service restart, or outbound notification was performed in this follow-up.
