# F05/F08 Launch Evidence

These tools implement the missing measurement harness from the [October 25 audit](../audits/2026-10-25-public-launch-readiness.md). They do **not** establish production capacity, public-feed health, launch readiness, or compatibility with 200 employer sites. Fixture success verifies the harness only. No production query or load run is part of the tests below.

## Current Launch Decision

The owner deferred public launch on October 25 until isolated recovery testing is funded. **No paid infrastructure is authorized; continue only bounded local synthetic evidence.** F04 full-restore/recovery and F05 capacity remain blocked, and F08 production feed quality remains open. A synthetic query or HTTP fixture pass cannot clear those gates. Future isolated-run instructions below describe requirements, not authorization to provision or execute them now.

Production was reported offline for cutover at 17:12 UTC, since 16:55:56 UTC. Do not read production, SSH to it or probe its health until the owner confirms it is online. Production load remains prohibited. See the [local evidence record](synthetic-public-feed-evidence.md#launch-hold-and-current-authorization) for the gate distinctions and historical-report caveat.

## Ownership And Safety

- Entrypoints: `scripts/benchmark-launch-capacity.ts` and `scripts/report-public-feed-quality.ts`. No package scripts, CI, application code, deployment files, or extension changes are required.
- Never point either tool at production, a production replica, a tunnel to production, or staging sharing a production host/database/storage. The existing co-hosted staging deployment is **not** an eligible load target.
- Both configurations require `environment: local|staging`, `isolatedSyntheticData: true`, and `noProductionInfrastructure: true`. These are operator attestations, not automatic infrastructure discovery. Verify the entire request path and database before attesting.
- Local targets must use `127.0.0.1` or `[::1]`; staging can also use private IPv4 literals. Public IPs, DNS names, URL credentials for HTTP, wildcard allowlists, redirects and arbitrary routes are rejected. HTTPS uses normal certificate validation. Do not disable TLS verification; use a dedicated isolated-host tunnel when appropriate.
- HTTP uses only fixed anonymous GET `/api/jobs` cases. No cookies, authorization, user profiles/resumes, uploads, generation, submissions, redirects, retries, or employer requests. Even a read endpoint may write rate-limit counters/logs, hence the isolation requirement.
- The report ignores `.env`, `DATABASE_URL`, private production URL fallbacks, and the application's DB singleton. Its only connection variable is `LAUNCH_EVIDENCE_DATABASE_URL`. The exact credential-free target must match `allowedDatabaseTarget`; database names must match `launch_evidence_(fixture|staging)_...`. URL query overrides are rejected.
- Report connections use a pool of one, 2-second connection/acquisition limits, read-only repeatable-read transactions, a 0.5-second lock timeout, an 8 MiB `work_mem`, disabled parallel query workers, and a required 0.1-25-second statement timeout. Transaction timeout adds at most 3 seconds. Use a SELECT-only database role as defense in depth. No mutations or cache refreshes occur.
- JSON contains aggregate counts/timings, fixed workload names, thresholds and code fingerprints. It does not log targets, DB credentials, request/response bodies, job IDs, cookies, exception messages or SQL parameters. Keep configuration files and infrastructure manifests private when they contain internal targets.

## Repeatable Fixture Verification

From the repository root, with the existing dependencies installed:

```bash
node --import tsx --test tests/launch-capacity.test.ts tests/public-feed-quality.test.ts
```

The HTTP tests bind an ephemeral loopback server and verify allowlists, production denial, redirect non-following, stalled bodies, response size, independent IDs, nonempty results, status errors, p95/error-budget boundaries, rate/concurrency limits, ramp stop and incomplete sample failure. No network beyond local loopback is used.

The SQL test uses the already-installed `@electric-sql/pglite` dependency supplied transitively by Prisma. It executes the real SQL in in-memory PostgreSQL against independently written synthetic rows, not mocked query results. Keep this dependency available in the development install; a missing module is a failed prerequisite, not a skipped success. The fixture explicitly expects six public jobs from nineteen canonical rows. It checks company/link/status exclusions, exact 14/30-day and deadline boundaries, TECH/FINANCE/GENERAL, low confidence, failed classification, missing reasons and denormalized eligibility disagreement.

For an inspectable JSON HTTP fixture run, start this fixed-port server in one terminal:

```bash
node --import tsx scripts/fixtures/launch-capacity-server.ts
```

Then run in a second terminal:

```bash
node --import tsx scripts/benchmark-launch-capacity.ts --config=docs/development/launch-capacity.fixture.json
```

The server binds only loopback port 4319, refuses unknown routes, and exits after 120 seconds (or Ctrl-C). It refuses to replace an existing listener. The fixture config makes at most 150 requests and ordinarily finishes in about 15 seconds. Expected evidence level: `harness_verified_only`; both capacity-established flags remain false. This fixture is **not** Next.js or a production-shaped database.

Exit codes for both measurement entrypoints: **0** complete configured numerical checks passed; **1** a gate failed, sample was insufficient/truncated, or ramp stopped; **2** configuration/connection/query/execution failed. A partial/failed query never becomes a zero or a healthy report.

## F05 Isolated Application Run

1. Provision a separate host/database with synthetic accounts/jobs only, matching release build, schema/indexes, CPU/RAM, pool sizes and intended background processes. Do not copy user resumes or account/document tables. Record release SHA, image digest, schema revision, synthetic seed/version, row counts, hardware, cache state and effective worker/pool configuration in a private run manifest. Local development mode is not release-capacity evidence.
2. Create an independent expected-results inventory before running: for each fixed workload, record known synthetic IDs that must appear on page one and a positive minimum row count. Do not derive this inventory from the just-returned API response or the production classifier. Include TECH, FINANCE and GENERAL jobs, US/Canada, city and remote-restriction cases. Preserve unknowns rather than labeling them eligible.
3. Adapt `launch-capacity.fixture.json` to the isolated application's exact origin and allowlist, use `evidenceKind: isolated_application`, and supply those expected IDs. Start at low rate; do not bypass route rate limiting to get a favorable score. HTTP 429 counts as an error.
4. Run the same entrypoint with `--config=/absolute/path/to/private-config.json`. Start with a cold/restarted application, then repeat warm. The runner does not flush caches, start background work, seed databases, or discard cold requests. Label each run accurately.
5. Repeat with synthetic ingestion/revalidation and bounded backup-like I/O **on the isolated host**. Use separate fixed-duration operator jobs with cleanup; the harness does not spawn them. Record CPU, RSS/peak memory, memory pressure, swap-in/out, I/O latency, DB wait/connection use, queue age and worker restarts over the same interval. Do not interpret occupied swap alone as active thrashing.
6. Compare the same dataset, workload, release and thresholds across configurations. Keep failed stages and 429/timeouts in the denominator. Only then choose background concurrency, pool sizes and admission limits. A higher request-concurrency setting is not a count of simultaneous users.

Bounds: 1-5 stages, starting at concurrency 1 and increasing by at most 2x, maximum 16 in flight, 20 offered requests/second, 30 seconds/stage, 10 seconds/request including body consumption, 3,000 requests, 2 MiB/response, and 180 seconds maximum configured wall budget including drains. The pacing loop does not catch up with bursts after an event-loop stall. Each stage drains outstanding requests before the next. Workloads round-robin equally; the tool models bounded anonymous reads, not browser sessions or the full user journey.

p50/p95/p99 are nearest-rank client wall times including response validation and errors. Each workload and the aggregate must satisfy p95 and error budget, with the configured minimum sample count **per workload per stage**. Unserved arrival slots caused by a saturated concurrency cap fail the stage even when completed requests look fast. The ramp stops at the first failed stage. Offered rate and completed throughput are separate; low-rate runs are not saturation measurements. No warmup is silently excluded. The example's 1-second p95, 1% error budget and four samples/workload are smoke settings, not a statistically credible capacity SLO. Choose at least 30-100 observations/workload for a meaningful follow-up, repeat runs, and narrow the workload set/rate within the safety bounds as needed.

An application run says `bounded_public_read_workload_measured`. `productionCapacityEstablished` and `userJourneyCapacityEstablished` remain false: authenticated sessions, generation, PDF/parsing, saves, applications, extension journeys, sustained endurance and real background contention are not automatically measured.

## F08 Public Feed Report

Use a separately provisioned synthetic database with the current schema and deliberately reviewed fixtures. The sample JSON does not provision or seed it. The in-memory SQL unit test above needs no external database.

```bash
export LAUNCH_EVIDENCE_DATABASE_URL='postgresql://evidence_reader:LOCAL_ONLY_PASSWORD@127.0.0.1:5439/launch_evidence_fixture_test'
node --import tsx scripts/report-public-feed-quality.ts --config=docs/development/public-feed-quality.fixture.json
```

Replace credentials only for the isolated fixture. For a full isolated census, set `mode: census` in a private config. This can scan the isolated pool, but cannot exceed the query deadline. A row limit bounds returned qualifying rows, **not** the number of rows PostgreSQL may examine; neither mode is permission for a production scan. Increase neither timeouts nor privileges automatically on failure.

The denominator is the anonymous default feed-index public pool, using the exact `buildRawDefaultPublicFeedWhere(now, null)` predicate used by `/jobs`, including LIVE status in both index/canonical tables, both company exclusions, availability, bad/gated links, deadlines, source evidence and alive evidence. The report does not substitute the broader internal LIVE pool or the less restrictive summary-cache count. Viewer PASS/applied-state exclusions, nondefault statuses, canonical fallback, source/discovered-since filters, pagination/ranking and personalized picks are outside scope. `USE_JOB_FEED_INDEX=0` is rejected.

The SQL predicate is currently private to `src/lib/queries/jobs.ts`. `scripts/lib/public-feed-query-contract.ts` uses TypeScript AST extraction to reuse its exact declarations without importing DB/auth side effects or changing another owner's application files. It checks that the production consumers still call these builders, fingerprints the source/predicate, and fails if declarations/dependencies disappear. This is a temporary script-only adapter; after coordination, exporting pure builders would be preferable. Review predicate-path changes alongside the fixture, not just a snapshot update.

Reported measures:

- Source age buckets use `lastSourceSeenAt` directly, **not** `lastSeenAt` fallback. Exactly 7 days belongs to 0-7; exactly 14 days to 7-14. Missing, older-than-14-day and future timestamps are explicit. Alive-only visibility is separately counted. Stale source evidence is not proof of closure. Future source/alive/posting timestamps fail the integrity gate.
- Role filter coverage uses known non-unknown role categories, the application's confidence threshold and its actual filterable classification statuses. A role label alone is insufficient. Coverage and counts are stratified by US/CA/unknown, TECH/FINANCE/GENERAL/unknown and role; these are stored labels, not proof the classification is correct.
- Canonical/index LIVE counts describe the selected public pool, not the entire lifecycle inventory. READY_TO_APPLY, REVIEW_REQUIRED, MANUAL_ONLY, missing eligibility, missing reasons and index/canonical eligibility disagreement remain distinct. READY_TO_APPLY is a stored eligibility classification, **not** proof of current user-specific application quality or permission to submit.
- `sample` selects a bounded prefix by canonical ID and one sentinel row. It is deterministic, **not random or representative**. If truncated, `publicPoolCount` is null and exit code is 1, even when observed rates pass. Do not extrapolate prefix rates to the full pool. An exhausted sample or census gives an exact count at the report's captured time/transaction snapshot, for that isolated dataset only.
- Empty denominators have null rates and fail the gate. The example thresholds (15% stale-or-missing source, 90% role coverage, no missing eligibility reasons) are proposed checks, not previously achieved launch criteria.

## Independent Manual Oracle

SQL membership tests and metadata counts cannot prove real-world freshness, taxonomy correctness, geography or job quality. To close F08, a separately authorized reviewer must inspect an independently chosen stratified sample of displayed listings against original employer evidence, without taking the app's labels as truth. Keep a private inventory with sample ID, original listing/time, independently assessed role/scope, country/city/remote restrictions, open/closed/unknown, app prediction and adjudication. Include stale-but-alive-only, missing metadata, low confidence, every readiness status, TECH/FINANCE/GENERAL and source families; record actual stratum sizes and selection method. Do not count reruns as new sites or omit inaccessible/unknown listings from denominators.

Validate country-wide, multi-city and remote-restriction filters using independently labeled inclusions **and exclusions**, then manually reconcile false positives/negatives. This fixed HTTP smoke is not that semantic oracle. Public source checking is not automated here; it needs separate authorization and must not become a production load run. A production-quality claim also needs safely acquired production public-pool evidence at a known revision/time; a synthetic clone alone does not establish current production health. Both reports retain `independentOracle: not_run`/capacity disclaimers where applicable; no code toggles launch readiness green.

## Resource Budget Notes

Read-only review of `ecosystem.config.cjs` on October 25 found default PM2 restart thresholds totaling 1,024 MiB for one ingestion process, 6,016 MiB for eleven source processes, and 4,096 MiB for ten maintenance processes. These are restart thresholds, not reservations or aggregate ceilings. Many shell/tsx entries supervise a parent, not all descendants. The ingestion/poll workers have a 512 MiB old-space setting; native memory and other workers still count toward cgroup usage.

For **isolated rehearsal**, reasonable starting test ceilings are web 1 GiB, ingestion 1.25 GiB, source-workers 3 GiB, maintenance 1 GiB, with PostgreSQL sized separately from active connections/work memory and measured peaks. These plus DB/OS exceed a comfortable 7.6 GiB host budget; do not install them as a supposedly validated production configuration. Existing observations (PG ~878 MiB, web ~183 MiB, source ~1.9 GiB, ingestion ~673 MiB) are samples, not peaks. A source cap near 2 GiB risks OOM at essentially the observed working set.

CPU shares/PID bounds can be a first containment step, but do not prove throughput. Move build/staging contention off the production host before load rehearsal. Preserve retention/polling first; compare separating/slowing optional discovery/frontier/growth helpers and serializing feed repair/search-index/storage maintenance under measured foreground load. Keep overnight acceleration off unless separately budgeted. Aggregate DB pools across every process, including helper children. Decide any background-group changes only after matched load/queue-freshness/memory observations; no deployment or PM2 edits are included here.

## Verification Record

October 25 implementation check: the documented HTTP fixture CLI completed 120 requests across three stages, with zero errors and no unserved arrival slots. Its JSON is generated locally at `output/launch-evidence/capacity-fixture.json` (not a committed artifact), marked `harness_verified_only`. This says nothing about Next.js throughput or production capacity. The report CLI was also checked without its dedicated DB variable and refused to connect with exit 2; no external database report was run. The SQL fixture is the database-query validation for this change.

The subsequent [native synthetic evidence run](synthetic-public-feed-evidence.md) adds a disposable PostgreSQL cluster, 32,000 rows, full independent membership/ranking/quality oracles and bounded serial query measurements. It also records the saved production report inspection and exact remaining capacity blockers. It does not relax this harness's production restrictions or claim production-shaped capacity.
