# Production Release and Bottleneck Follow-Up

Date: September 14, 2026. This follows the search, logo and production-workflow audits from the same date. Earlier audit observations remain historical baselines, not statements about the current deployment.

## Releases

- `61ec780`: reviewed the accumulated UX, search, logo and application changes; committed as Yingxuan Hu and pushed to both `dev` and `main`. Built and started the production app and its three worker groups. App health, candidate HTTP-transport tests and PDF generation passed.
- `70c159c`: bounded supply diagnostics, repaired monitoring and reduced ingestion write/storage churn. Pushed to both branches, built and started on production; the running app reports this exact `BUILD_SHA`. Candidate transport tests, PDF smoke, migrations and app health passed again.
- Builds use the existing attached-volume-backed BuildKit builder with a memory limit. PostgreSQL, Caddy and staging were not restarted. Exact prior-production image references were retained for rollback; no blanket image/volume pruning was performed.

## Operational Changes

1. Supply reporting previously started 13 large queries concurrently against a two-connection maintenance pool. It now runs deferred queries serially, each in a read-only transaction with a 25-second statement timeout and one-second lock timeout. Failures preserve successful sections in an explicitly partial report; unavailable metrics are null, not zero. The public headline remains `JobFeedSummaryCache.liveJobCount`.
2. Reports now distinguish recent source outcomes by connector family, database failures, runtime budgets, upstream timeouts, blocked responses and invalid endpoints. These are non-public ingestion diagnostics, not public-board counts.
3. Captures create their directory before allocating a temporary file, refuse overlap with `flock`, enforce a total runtime bound, validate JSON and replace the previous artifact atomically. Monitoring alerts on missing/old or partial captures.
4. A zero-match `grep` under `pipefail` made the health monitor exit before reporting disk warnings. Zero Caddy errors now count as zero; Docker-inspection failures also produce an alert. Index alerts omit already-resident indexes so the pending work is visible.
5. Removed only the legacy root cron entry trying to run the feed-summary script inside the standalone app container. The maintenance worker remains its owner. Backups, source captures and unrelated crontab entries were preserved; the previous crontab is backed up on the server.
6. The feed-repair selector repeatedly reconsidered recently hidden jobs using a coarse SQL visibility test that cannot reproduce the full product-scope gate. Deliberately hidden rows now have a one-day retry interval. Missing index rows and canonical updates remain immediately repairable. No lifecycle statuses or product-scope criteria were relaxed.
7. Successful URL-health checks retain a 240-character excerpt instead of 1,200 characters. Full failure/suspect/blocked evidence, outcomes, timestamps, URLs and metadata are preserved. Job descriptions and source payloads are unchanged; no existing history was deleted.

## Storage and Ingestion Evidence

- A bounded index-only tablespace pass completed eight moves, adding about 0.47 GiB to the attached-volume index tier. Busy indexes were deferred at a one-second lock timeout. The pass's nonzero exit indicated remaining policy work, not rollback of completed moves. The 18 GiB backup reserve was preserved. No table bodies moved and no `VACUUM FULL` ran.
- After that pass, root was approximately 90% full with 16 GiB available; the 69 GiB attached volume was 51% full with 33 GiB available, before the second build's temporary files.
- The second release temporarily took root to 92%. After verifying app health and preserving the original rollback references, removed only the four now-unused intermediate `61ec780` images created during this work. Docker image usage fell from 27.22 GB to 23.19 GB; root returned to 90%/16 GiB free and the attached volume to 51%/33 GiB free. Build cache is zero. Database volumes, backup-runner images, staging and original rollback images were preserved.
- The September 14 daily backup completed and confirmed upload. No local `.dump` files remained in the volume-backed backup directory.
- A 0.1% block sample of health-check history contained 610 ALIVE, 7,982 SUSPECT, 6,313 BLOCKED, 202 ERROR and 29 DEAD records. ALIVE excerpts averaged about 1,204 bytes. Truncating successful excerpts reduces that field by about 80%, not the whole database by 80%. Since most sampled rows were not ALIVE, this is a modest preventive improvement, not a solution to all existing table growth. Physical page sampling is not a statistically representative row sample.
- Before release, a two-hour ingestion sample showed productive Greenhouse, Oracle, Ashby and Lever ingestion alongside Workable/company-JSON failures. Several large sources timed out after updating hundreds of known jobs and creating few or no new jobs. Increasing worker concurrency on this memory- and I/O-constrained host would not address that write amplification.
- Non-public source diagnostics found 2,003 productive sources whose last successful poll was over seven days old, carrying 70,017 retained lifecycle jobs. These are not public-board totals. Recovery needs source-specific investigation and measured retention scheduling, not blanket reactivation or weaker expiration rules.

## Production Browser Verification

Used the authenticated, ordinary-permission audit account. No real applications were submitted and no external messages were sent.

| Check | Observation |
| --- | --- |
| Engineer search after first release | Usable rows in 1,450 ms; exact count separately returned in 17,515 ms; no page error |
| Five warm Jobs/title/Toronto navigations | 931, 797, 488, 509 and 548 ms to visible rows; all returned a full page; no page error |
| Toronto second-page navigation during build | 5,324 ms; changed first result, retained location filter, selecting a row updated the detail |
| Toronto second page after final restart | Cold 6,634 ms, then warm 618 ms; no page errors. A first engineer request in the new runtime took 2,375 ms |
| Clear all | Returned to `/jobs` without the prior location constraint |
| New-account Picks | Displayed the profile-completion state, not a false completed empty recommendation result |
| Applications at 390 px | Document width 390 px, no horizontal overflow; add dialog retained the company draft when role validation failed |
| Applications, Documents, Notifications, Settings at 390 px | 800, 681, 382, 677 ms respectively including a 200 ms stabilization wait; no page errors or horizontal overflow |
| Signed-in sign-in callback | `/sign-in?callbackUrl=%2Fapplications` correctly returned to Applications |
| Toronto logo coverage | After scrolling the entire first page, 45/50 jobs had loaded logos; compact 28 px slots with 26 px images |

These are small browser samples, not established p95 performance or concurrency SLOs. The first search no longer waits for the slow count. Exact counts and some uncached pagination remain bottlenecks. The build temporarily drove available memory below 200 MiB and exhausted swap; samples during that period are explicitly labeled.

Logo initials remained for Vitrolife Group, Trader Interactive (two jobs), Acumetis and Banyan Software in this Toronto sample. Acumetis's logo endpoint returned 404. Those cases require verified employer/source mappings or a successful upstream asset, not guessed logos. The earlier 98/100 logo audit used a different dated sample and must not be presented as the current universal coverage. No persistent logo files or database image blobs were introduced.

Screenshots: `output/playwright/production-release-search-20260914.png` and `output/playwright/production-applications-mobile-release-20260914.png`.

## Verification

- 890 unit tests passed before the UX release; 896 passed after the operational changes.
- TypeScript, scoped ESLint, shell syntax and diff checks passed.
- The 8,055-fixture ranked-search integration passed before release, including visibility, viewer exclusions, complete pagination and geographic parity.
- The feed-repair SQL integration passed: newly hidden rows excluded, old hidden rows retried, canonical changes and missing rows selected. Local-only fixtures cleaned up their own IDs.
- Supply report completed locally with `DATABASE_POOL_MAX=1`, including recent ingestion outcomes.
- Production capture at 17:47:59 UTC successfully wrote a validated partial report with 14 of 15 query sections. The retention-lane query hit its 25-second budget; other results were preserved instead of the entire report failing. The public cache reported **507,510** jobs, computed at 17:46:13 UTC, from `JobFeedSummaryCache.liveJobCount`. Recent outcomes included productive Greenhouse/Oracle/Ashby ingestion, company-JSON upstream timeouts, Workable blocked responses and large-source runtime-budget failures.
- Monitoring tests cover zero-error Caddy logs, failed Docker inspection, actionable index alerts, serial report sections, retained partial results, sanitized errors and surgical cron removal.
- The anonymous production exact-count endpoint returned HTTP 401. Authenticated sign-in callback routing passed. Build-time placeholder-secret warnings do not describe the running app: its configured production auth secret is 64 characters; no secret value was printed or changed.

## Remaining Work

Root capacity is still a risk. Further index moves need an off-peak window; table relocation or historical-health compaction requires an explicit maintenance/retention design that protects evidence and user records. Production builds compete with ingestion for memory, so an external build runner should be evaluated before adding more worker concurrency.

Measure individual source timeouts and unchanged-job write amplification using the restored reports before redesigning the ingestion fast path. The retention-lane diagnostic still needs an efficient historical-task query; its failure is now visible and bounded. A read-only activity check also found a long-running feed-index INSERT and a regular `VACUUM (ANALYZE)` waiting behind it, confirming active database maintenance/write contention. No unowned queries were canceled and no database settings were changed to hide the symptom.

Verify actual source recovery and public-board deltas over multiple cycles. Keep slow exact counts optional and bounded, and continue profiling complex filters and cold/deep pagination. Real outbound applications, payment/OAuth flows, OS microphone permissions and every external provider were not tested.
