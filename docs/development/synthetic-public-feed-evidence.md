# Synthetic Public Feed Evidence

## Launch Hold And Current Authorization

On October 25, 2026, the owner explicitly **deferred public launch until isolated recovery testing is funded**. No paid infrastructure is authorized. Current work is limited to bounded local synthetic evidence using existing resources; the future isolated-capacity procedure is not permission to provision infrastructure or run a restore/load rehearsal now.

At 17:12 UTC the owner reported production offline since 16:55:56 UTC for the storage cutover. Do not perform production reads, SSH checks or health probes until the owner confirms it is online. This is an operator-reported state, not a fresh availability measurement. Production load remains prohibited after that confirmation as well.

| Launch gate | Current evidence and remaining requirement |
| --- | --- |
| F04: Full restore/recovery | **Blocked/deferred.** Disposable synthetic cluster creation/cleanup is not backup restoration. No timed whole-host, database and document recovery or measured RPO/RTO is established by this work. A separately authorized, funded isolated recovery drill is still required. |
| F05: Capacity | **Blocked.** Local warm serial query measurements do not cover the candidate application, production-shaped data/hardware, concurrency or background contention. The exact blockers below remain unchanged. |
| F08: Public feed quality | **Open.** Synthetic oracles verify predicate/report behavior, not current production health or independent employer-listing truth. No new production evidence is authorized during the cutover. |

Passing local thresholds, successful cleanup, successful storage cutover or a successful application build cannot clear these gates or reverse the launch hold.

## What Was Actually Checked

On October 25, 2026, the production host was accessed only to list matching saved JSON reports in `/opt/autoapplication/logs` and read an allowlisted numeric/timestamp summary of the newest match. No credentials, environment files, database queries, load, employer forms or mutations were involved. No matching dedicated public-feed-quality report was found in that directory. This is not an assertion about every other directory or monitoring system.

The newest matching artifact at that earlier inspection was `supply-health-2026102516.json`, generated at **16:06:05.681 UTC**, complete, with public headline cache **515,430 jobs** computed at **16:01:36.066 UTC**. Its 792,617 LIVE records and 241,796 records with source evidence older than 14 days are **broader non-public diagnostics**, not a measured public-feed stale rate. This historical artifact is not a post-cutover availability check. The saved report does not close F08. No new production census was run, and no safety gate was bypassed during the storage cutover.

Local inventory, without starting builds or containers:

| Item | Observed |
| --- | --- |
| Node | 24.19.0 |
| Native PostgreSQL | Homebrew 17.9; `initdb`, `pg_ctl`, `postgres`, `psql` available |
| Docker | Existing local `desktop-linux` Unix socket; server 29.7.2 |
| Cached PostgreSQL images | 16-alpine and 17; no cached PostgreSQL 18 image |
| Local host | macOS arm64, 10 logical CPUs, 16 GiB RAM |
| Existing application build | `.next/BUILD_ID` modified October 15; not used as evidence for this release |
| Existing local database | Not connected to, seeded, migrated, reset or inspected |

The repository's `jobs:seed:local` path was deliberately not used: it modifies the configured local user database. The runner below always creates its own fresh cluster and never accepts a database endpoint. No image pull, heavy build, Next.js server or background worker was started.

## Repeatable Run

The development install supplies `pg` and PGlite transitively through Prisma. Native `initdb` and `pg_ctl` must be available on PATH. Missing prerequisites fail the command; there is no fallback to an existing database.

```bash
node --import tsx --test tests/synthetic-feed-evidence.test.ts
node --import tsx scripts/benchmark-synthetic-public-feed.ts --config=docs/development/synthetic-public-feed.fixture.json
```

To retain redacted JSON in the repository's ignored output directory:

```bash
mkdir -p output/launch-evidence
node --import tsx scripts/benchmark-synthetic-public-feed.ts --config=docs/development/synthetic-public-feed.fixture.json > output/launch-evidence/synthetic-public-feed.json
```

This is a **query-component measurement**, not the application HTTP capacity harness. Exit 0 means the independent synthetic oracle and configured component timing checks passed. It never means the production capacity gate passed. `capacityGate.status` remains `blocked`, with concrete blockers in the output. Exit 1 indicates component/sample checks failed; exit 2 indicates a setup, oracle, query or cleanup failure.

## Dataset And Independent Oracle

`scripts/fixtures/synthetic-public-feed.ts` defines 32 human-labeled cases independently of the application's query builders/classifier. The default run repeats each case 1,000 times, creating **32,000 canonical rows**, **32,000 index rows** and **32,000 eligibility rows**. Each row has fictional job text and an `example.test` URL; none is visited. Cases include TECH, FINANCE, GENERAL, US/Canada, qualified Toronto, multi-city alternatives, country-wide locations, country-restricted remote, explicit cross-border remote and unknown remote eligibility.

Twenty cases belong in the public pool. Twelve must remain excluded for lifecycle, index status, dead signals, broken/gated/generic links, bad company identities, low availability, stale evidence or absent evidence. Public cases deliberately include low role confidence, failed classification, unknown roles, stale-source/alive-only visibility, exact deadline/source boundaries, a missing readiness reason and a future source timestamp.

The benchmark reuses the current public SQL predicate, exported location SQL builder, filter confidence/status values, default ranking order, and the repository's live relevance index migration. It does not substitute a permissive `status = LIVE` query. The three-table schema is a **projection**, not the entire Prisma schema or all production indexes. Synthetic text/distribution, equal ranking scores, no table bloat, and warm caches are deliberate simplifications. Repeated equal-score rows exercise the unique-ID ranking tiebreaker but do not model realistic selectivity/ranking correlation.

For each workload, the runner compares **every matching ID** against a separately labeled expected set, then verifies the ranked first 21 IDs. It does not use returned results to generate the expected oracle. With the default configuration, expected counts are:

| Workload | Expected matches |
| --- | ---: |
| Public feed | 20,000 |
| Canada location | 11,000 |
| United States location | 10,000 |
| Toronto, ON | 4,000 |
| Toronto, ON or New York, NY | 8,000 |
| Remote Canada / Remote US | 3,000 each |
| Software engineering role | 6,000 |
| Finance/accounting role | 5,000 |
| Marketing role in GENERAL | 6,000 |

The full quality report must independently produce 20,000 public rows, 17,000 filter-grade roles, 1,000 old-source records, 1,000 missing-source records, 2,000 alive-only records, 1,000 missing eligibility reasons and 1,000 future source timestamps. **The quality gate is expected to fail** on these known defects. Oracle verification succeeding is not the same as declaring a flawed pool healthy. The report's real-world `independentOracle: not_run` remains correct; the extra synthetic oracle does not inspect employer truth.

## Safety And Cleanup

- Explicit local/synthetic/non-production attestations and `allowDisposableLocalPostgres: true` are required. Arbitrary target/connection options are rejected.
- `initdb` creates an owner-only temporary directory prefixed `launch-evidence-pg-`. The runner uses a new loopback port, disables Unix sockets, confirms the server's data directory matches that newly created directory, and only then creates `launch_evidence_fixture_synthetic`. A bind race fails; it never connects to the competing listener.
- Subprocess environments contain only PATH, private HOME/TMPDIR, locale and literal `NODE_ENV: test`. Clients use an explicit empty password and loopback-only non-TLS connections; production URL/password/SSL defaults are not inherited. Trust authentication is limited to the fresh, loopback-bound synthetic cluster, which contains no user information.
- Setup writes only this disposable cluster. Measurement uses a separate SELECT-only role and `default_transaction_read_only=on`; the runner verifies both. Bounds are 32-48,000 rows in complete 32-case sets, 3-20 repeated samples/workload, 0.1-5-second statement timeouts, one query client, 32 MiB shared buffers, 4 MiB work memory and a 120-second overall deadline. Setup statements additionally have 15-second server and 20-second client deadlines; cleanup is separately bounded.
- Date parameters are serialized explicitly as UTC. This avoids node-postgres formatting JavaScript Dates in the developer's local timezone before PostgreSQL compares timestamp-without-time-zone columns. The first native run correctly failed its oracle before this adapter issue was fixed; expected fixture sets were not changed to accept it.
- Cleanup checks `pg_ctl status`, attempts stop if running, and checks status again even when stop fails. Only documented stopped status permits removal. A running, timed-out or unverifiable postmaster **retains its directory and fails the run**. This also applies after failed startup/readiness. Cleanup tests simulate each failure path without touching a database. Do not blanket-delete matching temporary directories after an interrupted run; verify the specific retained cluster is stopped first.
- JSON is aggregate-only: no connection strings, credentials, bodies, raw SQL or job IDs. No external employer or other network requests occur. An uncatchable process kill can still interrupt cleanup; do not treat absence of JSON as successful cleanup.

## Observed Result And Capacity Blocker

The native verification on October 25 completed with all ten full-set/ranked-page oracles and all quality counts matching. It measured 200 repeated query pairs (ranked page plus first description), with zero errors; ten additional first-measured pairs are reported separately. All tables were already warmed by setup/ANALYZE/oracle scans. The disposable database occupied about **92 MB** and was verified stopped/removed afterward. At the 17:06 UTC run, workload p95s ranged from **1.35 to 3.03 ms**. These timings are only local, warm, serial component observations; reruns may differ.

The F05 capacity gate is **blocked**, specifically because:

1. No current release web build was run; the available October 15 build is not evidence for the changed October 25 working tree. Producing a new build is owned by the parent task and was not started here.
2. The dataset has 32,000 synthetic canonical rows / 20,000 public rows, versus the saved production diagnostic/public-headline scale of roughly 793,000 / 515,000. It does not match row widths, distributions, table bloat, source mappings, all indexes or account state.
3. Native PostgreSQL 17.9/macOS arm64 with 10 logical CPUs and 16 GiB RAM does not reproduce PostgreSQL 18 on the 4-core/7.6 GiB production host. No PostgreSQL 18 image was pulled.
4. No HTTP/auth/cache/rendering/Prisma application path, sustained concurrent load, background ingestion, backup I/O, resource pressure or queue-freshness contention was measured. Existing co-hosted staging remains ineligible for load tests under the production-isolation rule.

Closing F05 requires a separately isolated, production-shaped environment with the exact candidate build/schema, representative synthetic cardinalities and independent oracle, bounded mixed workload plus background contention, and CPU/RSS/swap/I/O/DB-pool measurements. These component results justify further testing, not a concurrent-user limit or production memory cap. Closing F08 still needs an authorized exact-public-pool snapshot and independent displayed-listing adjudication; the production saved report and these synthetic fixtures do not substitute for that.
