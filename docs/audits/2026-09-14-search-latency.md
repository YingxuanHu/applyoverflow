# Search Latency Follow-Up

Status: subsequently committed and deployed in `61ec780`. The measurements below describe the pre-release investigation; see the [production release follow-up](2026-09-14-production-release.md) for deployed browser timings and remaining bottlenecks.

## Diagnosis

Broad searches were waiting for an exact filtered count before returning usable jobs. A production `engineer` count performed 101,443 canonical primary-key lookups and took 16,816 ms in one read-only diagnostic. Disabling nested loops inside that diagnostic transaction reduced the query to 7,724 ms, but increased shared-block reads from 247,846 to 426,872. That alternative was not shipped: it is still slow and increases database pressure.

The Toronto row lookup separately took 5,790 ms in a traced request. A simple raw-query replacement did not improve it (7,629 ms versus Prisma's 6,650 ms in another comparison). Materializing every geographic match before validating all of them also remained slow, at 6,186 ms.

The successful query shape orders matching index rows first and validates canonical visibility through a correlated lateral lookup. PostgreSQL can stop after enough visible jobs have been found. The read-only production prototype returned the same 51 ordered IDs as the original query within one repeatable-read snapshot, taking 900 ms. A subsequent EXPLAIN ANALYZE took 582 ms and performed only 66 canonical lookups, using about 1.5 MB of sort memory and no temporary-file writes.

These are individual query measurements, not end-to-end deployed timings or p95 estimates. All production diagnostics were SELECTs or EXPLAINs in bounded, read-only transactions. No permanent database settings, schema changes, migrations, or restarts were made.

## Implementation

- Extract one feed-index filter plan shared by row retrieval and exact counts. Structured filters, salary currency conversion, geographic expansion, status, public visibility, PASS exclusions, and hide-applied behavior remain in that shared plan.
- Let the Jobs page defer uncached exact totals. Render usable rows, details, filters, and Next immediately; a single authenticated request updates the headline and both pagination controls. Existing `getJobs` and `/api/jobs` callers keep synchronous exact totals by default.
- Reuse exact-count cache entries across pages and sorts, still isolated by viewer/version. Infer the exact total only when the first filtered page contains the entire result set. Never show a fabricated `50+` or substitute the public pool as a matching count.
- Bound newly started optional count queries to two active queries per process and a 25-second database statement timeout; the endpoint also has a 30/minute per-user request limit. Identical cacheable requests share an in-flight count, including existing synchronous counts. Responses are private/no-store; a busy or failed count leaves results usable with an explicit retry control. There is no automatic retry loop or unbounded work queue.
- Abort browser count requests when their query is replaced and ignore late completions. Page bounds update when the exact count arrives, including returning an out-of-range page to the last valid page without discarding filters.
- Use ordered-candidate SQL for scoped geographic searches and selective title/company searches. Keep LIMIT/OFFSET outside all canonical/public/viewer checks and preserve every deterministic sort tie-breaker.
- Fix selective-search pagination: do not slice candidate IDs before removing hidden, stale, expired, or passed jobs. Also avoid a LIVE-only probe when searching an explicit archived status.
- Compile geographic SQL from the existing location predicate, preserving country/subdivision constraints, compound AND matching, alternative-place OR matching, and literal wildcard escaping.
- Wrap long unbroken titles and company names inside the mobile job-detail header.

The public pool continues to use `JobFeedSummaryCache.liveJobCount`. The changes add no persistent logo files, database projections, indexes, or denormalized datasets. Existing bounded in-process caches are reused.

## Verification

- 890 unit tests passed, including exact/unknown headline semantics and count concurrency-slot release after errors.
- TypeScript, scoped ESLint, and diff whitespace checks passed.
- An isolated production-mode build passed. The user's existing localhost servers were not restarted or overwritten.
- The 8,055-row local integration suite passed: broad title/company/location/combined query parity against Prisma, both first pages, complete sort ordering, visibility and viewer exclusions, deferred/cached totals, all three pages of a selective query, explicit archived status, and geographic SQL equivalence including escaped wildcard and injection-shaped input. Fixtures clean up only their own IDs.
- Production-mode browser tests passed for count-independent rows/details/Next, failed-count retry, late-response isolation, authenticated/private counts, exact page bounds, out-of-range recovery without losing filters, and mobile title wrapping/layout. Verified no remaining search-fixture rows after cleanup.
- Existing production-mode Jobs and full multi-account UX regressions passed, covering search/filter drafts and navigation, AI response races, Picks refresh/feedback, saved searches, cross-account access, applications, reminders, and description recovery. Final local application fixture timings were 995 ms to load, 19 ms to change views, and 188 ms to update status; these are not production-load measurements.

The dev server hit recompilation timeouts and an intermittent 500 during browser runs. These were not counted as passes; the stable isolated optimized build was used for final verification.

Commands:

```sh
npm run test:unit
npx tsc --noEmit
DATABASE_URL_DO_PRIVATE= DATABASE_PROCESS_ROLE=web DOTENV_CONFIG_PATH=.env.local node --import tsx -r dotenv/config tests/integration/ranked-search.ts
DATABASE_URL_DO_PRIVATE= DATABASE_PROCESS_ROLE=web DOTENV_CONFIG_PATH=.env.local TEST_APP_URL=http://127.0.0.1:3017 node --import tsx -r dotenv/config tests/e2e/deferred-search-count.ts
TEST_APP_URL=http://127.0.0.1:3017 node tests/e2e/jobs.mjs
DATABASE_URL_DO_PRIVATE= DATABASE_PROCESS_ROLE=web DOTENV_CONFIG_PATH=.env.local TEST_APP_URL=http://127.0.0.1:3017 node --import tsx -r dotenv/config tests/e2e/ux-workflows.ts
```

Screenshots: `output/playwright/search-count-pending.png` and `output/playwright/search-count-mobile.png`. Their job counts come from synthetic local fixtures, not production supply measurements.

The temporary optimized build and port-3017 test server were removed after verification. The existing development server on port 3001 remains available.

## Remaining Work

The broad exact count is still expensive; it is now optional and bounded instead of blocking the Jobs page. Legacy synchronous API callers, full-text internal queries, source/discovery canonical fallbacks, deep offsets, and complex filter/sort combinations still need production-scale latency/concurrency profiling. A compact visibility projection should only be reconsidered with measured storage/write costs and a reliable consistency design.

After an authorized deployment, measure real user-visible result-ready time and count-ready time separately, including p50/p95, rapid query changes, and concurrent ingestion. Recheck ordinary signed-in Jobs and Picks flows on production before calling the performance issue resolved there.
