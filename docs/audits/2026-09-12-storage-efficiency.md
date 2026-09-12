# Storage efficiency: keep the product, remove avoidable growth

## Scope and evidence

Repository audit and local verification, September 12, 2026. Two SSH attempts
to `root@5.78.195.237` timed out. Production usage, growth rate, reclaimable GB,
database bloat, and current mount/log settings are **not measured**. No production
files, records, services, schedules, indexes, or backups were changed.

The repository has useful foundations: canonical deduplication, separate raw
and normalized ingestion records, a denormalized feed index, a guard against
rewriting unchanged raw payloads, object-backed document storage, guarded
inactive-job retention, object-storage backups, and a dedicated web image.
These are not all wasteful duplicates: the feed index avoids expensive joins,
and original provider evidence supports source repair and reclassification.

## Improvements implemented in this checkout

1. **Bounded container logs.** Production and staging services use Docker's
   `local` logging driver with five 20 MB files and compression. This bounds
   retained container log data at approximately 100 MB per container before
   compression, plus overhead. It is a size limit, not a promise of 14 days
   of history. Existing containers require recreation to adopt it.
   [Docker documentation](https://docs.docker.com/engine/logging/drivers/local/).
2. **One worker log copy.** With `APPLYOVERFLOW_CONTAINER_LOGS=1`, PM2 file sinks
   are `/dev/null`, but its event bus still streams stdout and stderr through
   `pm2-runtime` to Docker. Host-based PM2 retains its original configuration.
   Use `docker compose logs` for retained container logs after deployment;
   old bind-mounted log files are not deleted by this patch. Historical
   `pm2 logs` file tails are no longer the container log archive.
   [PM2 logging](https://pm2.keymetrics.io/docs/usage/log-management/).
3. **Smaller worker runtime contents.** A worker-files build stage excludes
   the second `node_modules` copy, `.next/standalone`, and compiler cache.
   The dependency/browser installation layer remains cacheable; source,
   Prisma, scripts, data, public assets, and the normal `.next` build remain
   available, including staging's `next start`. The separate production web
   target is unchanged. Final image-size savings require a real Docker build.
4. **Exclude test output from releases.** `output` and `.playwright-cli` are
   excluded from both Docker build context and production/staging rsync.
   Previously uploaded artifacts are not deleted automatically.
5. **Correct, validated backup staging.** Backup and restore share the same
   Compose-resolved directory. Relative paths are resolved against the Compose
   directory. Hetzner paths automatically require their volume to be mounted;
   custom paths can specify `DB_BACKUP_VOLUME_MOUNT`. Missing mounts, symlink
   escapes, and wrong filesystems fail before staging data. A backup lock
   prevents overlapping dumps. Restore no longer evaluates dotenv as shell
   code or recreates dependencies for the downloader; its downloaded file is
   removed only after successful restore/migration unless local retention is
   enabled. Failed restores retain their downloaded file.
6. **Read-only diagnosis.** `report-storage.sh` reports root/volume capacity,
   inodes, directory usage, Docker usage, log drivers, actual database mounts,
   WAL, largest tables/TOAST/indexes, dead-tuple estimates, compression settings,
   and exact-definition duplicate-index candidates. Host sections are bounded
   to 30 seconds; SQL is a read-only transaction with 8-second statement and
   1-second lock limits. No full-table job counts, payload contents, or secrets.

These changes do not reduce job supply, description length, ingestion cadence,
search capabilities, recommendation caches, saved jobs, submissions, packages,
or user documents. They do not change the prior description-repair work.

## Larger database opportunities, in order

### 1. Measure retention and write churn

`scripts/apply-storage-lifecycle.ts` has targets for URL checks, ingestion runs,
and completed/failed tasks, but the scheduled PM2 command intentionally enables
only old unreferenced inactive canonical jobs and old unmapped raw jobs. This
means growing diagnostics are not covered by that schedule. Do not enable all
targets blindly: failed tasks may remain retryable, and history may support
source health or ranking decisions.

Define a separate operational-history policy after measuring its size and
checking every consumer: preserve the latest evidence per job/URL and recent
failure details; retain small daily per-source aggregates longer than verbose
events; never expire pending/running/retryable work. Use bounded batches, low
lock/statement timeouts, and pause under database pressure. Keep the existing
saved/submission/package protections and LIVE/AGING/STALE exclusions.

Unchanged raw payloads already skip content rewrites, but each poll updates
freshness, and feed repair sees canonical `updatedAt` changes. The feed upsert
can consequently rewrite wide search/metadata values and indexed ranking fields.
Measure updates, HOT updates, WAL bytes, autovacuum cadence, and changed-content
ratio before separating content changes from freshness-only updates. Do not
disable freshness tracking or make the public board stale to save writes.

### 2. Remove redundant evidence, not useful read indexes

`JobRaw.rawPayload` contains the normalized envelope and provider metadata;
`NormalizedJobRecord.metadataJson` copies provider metadata again; both normalized
and canonical records carry descriptions. The feed also stores a bounded search
representation (currently the first 4,000 description characters, not a second
complete description). Measure TOAST bytes and sample payload composition first.

The candidate design is a content-hashed immutable source payload referenced by
the raw record, with normalized records retaining extracted fields/provenance
instead of another full provider response. Start with reference sharing in
PostgreSQL or lossless compression; archive older immutable payloads to object
storage only after all re-normalization and repair readers support hydration.
Use versioned hashes, checksums, idempotent uploads, reconciliation, and protected
references before any local payload removal. Keep recent repair inputs local.

Do **not** move canonical descriptions or feed fields behind a remote object
fetch on the user request path. Keep job browsing, filtering, full descriptions,
and Picks on the fast PostgreSQL read path. Dropping evidence now would undermine
the just-implemented accurate source-description recovery.

### 3. Audit indexes and PostgreSQL maintenance

The feed has many filter/ranking indexes. Remove only confirmed redundant
indexes after comparing definitions, constraints, representative query plans,
and usage over a complete workload window. Zero scans after a restart/statistics
reset is not sufficient evidence. The new report only proposes candidates.

Normal vacuum reuses dead-row space and sometimes truncates free tail pages;
deleting records does not imply an equal immediate reduction in `df`. Dead-row
statistics are not an exact measurement of bloat. `VACUUM FULL` needs a rewrite,
extra disk, and exclusive locks; do not use it for emergency online cleanup.
[PostgreSQL vacuum documentation](https://www.postgresql.org/docs/18/routine-vacuuming.html).

Compression must be benchmarked rather than assumed: PostgreSQL supports TOAST
compression, but a column compression setting does not rewrite existing values.
LZ4 is not guaranteed to produce the smallest size for every payload. Compare
size, CPU, and read latency on representative descriptions/raw JSON before a
bounded migration. [PostgreSQL TOAST](https://www.postgresql.org/docs/18/storage-toast.html).

### 4. Put bytes on the appropriate disk

Moving bytes from root to the attached volume relieves root pressure; it does
not reduce total storage or eliminate a single-host failure domain. The current
tablespace policy already places designated indexes on the volume and reserves
space for dumps. Verify actual volume size and latency rather than relying on
the old 69 GB comment in that script.

Keep latency-sensitive database data/indexes where measured I/O supports the
search SLA. Use the attached volume for backup staging and potentially cold
payloads/build cache; use external object storage for durable backups and files.
Do not move all of Docker or the database live without a tested migration and
rollback plan. Avoid putting a nearly-full database and its only backup on the
same device. Maintain verified external recovery copies and test restoration.

`DB_BACKUP_KEEP_LOCAL=0` already removes each successful uploaded dump. Old
retained dumps, host cron logs under `/var/log`, abandoned multipart uploads,
unused images, and old bind-mounted PM2 logs still need a reviewed retention
policy; the new container limits do not cover those. Never prune Docker volumes.

## Baseline and acceptance gates

Run on the VPS once connectivity is restored:

```sh
bash /opt/autoapplication/deploy/single-vps/report-storage.sh
```

Collect comparable daily snapshots for at least a week, covering ingestion,
deployments, and backups. Suggested initial operational targets, not measured
current performance:

| Measure | Acceptance gate |
| --- | --- |
| Root and attached volume | At least 20% free, plus room for the largest concurrent dump/build/WAL operation; increase the reserve if that operation is larger |
| Capacity forecast | Investigate when projected time to 85% usage falls below 30 days; use several daily samples and account for deploy/backup spikes |
| Search/detail/Picks latency | Same dataset and workload, warm p95 no more than 10% worse than the pre-change baseline; test cold-start separately |
| User data and public results | No lost saved jobs, submissions, packages, documents, or descriptions; same filter/result behavior on a frozen dataset |
| Public pool metric | Use only `JobFeedSummaryCache.liveJobCount` when comparing `/jobs` counts |
| Ingestion | No reduction in coverage, freshness, or source repair success rate |
| New worker image | Compare unique/shared Docker layers before/after, not summed virtual image sizes |
| Source archive | Checksum verified, recoverable original payload, and successful re-normalization before local eviction |
| Backups | Upload success, tested restore, missing-mount failure, and capacity reserve all verified before retention cleanup |

## Verification and rollout limits

- 794 unit tests passed, including isolated PM2 stdout/stderr streaming with no
  worker log files, mount/path failure cases, and retention guard regressions.
- Production and staging Compose configurations validated with Docker Compose.
- SQL inventory executed successfully against local PostgreSQL in read-only mode.
- Shell syntax, focused lint, and diff whitespace checks passed.
- Full Docker build, actual Linux volume mount/unmount integration, remote
  backup/restore, and production latency/capacity measurements remain unverified:
  local Docker is stopped and production SSH is unreachable.

No deployment or storage migration performed. Log limits apply only when each
container is recreated; do not restart PostgreSQL merely to adopt log settings
outside an appropriate maintenance window. Preserve verified old backups until
the new backup/restore path is proven on the real host.
