# Verified Backups And Isolated Recovery

## Scope And Status

These scripts implement logical-backup verification and an isolated database drill. They do not implement PITR, switch production traffic, run Prisma migrations, recover document objects, or prove application journeys or production permissions. A logical backup's recovery point is its snapshot, not its upload time. RPO/RTO remain unproven until an operator runs and reviews a real drill.

No production writes/stops, full backup download, restore, or alert send were performed while implementing this change. Parent/operator owns installation and execution. Do not rebuild images during the storage incident.

The reported legacy object is `database-backups/autoapplication/auto-autoapplication-20261025T084658Z.dump`, with HEAD size `19224706886` bytes and last modification `2026-10-25T09:03:09Z`. HEAD is not content integrity verification. This object has no new-format SHA256 manifest; follow the explicit legacy flow below or take a new verified backup.

## Install Without Rebuild

Install the checked-in files together under the existing deployment checkout:

- `scripts/db-backup-storage.ts`, `scripts/db-restore-storage.ts`
- `deploy/single-vps/backup-path.sh`, `backup-to-storage.sh`, `restore-from-storage.sh`
- `deploy/single-vps/restore-drill.sh`, `restore-drill-checks.sql`
- `deploy/single-vps/monitor-health.sh`, `scripts/send-health-alert.mjs`

The backup wrapper bind-mounts its current TypeScript sources into the existing backup runner image. The drill also mounts its verifier source and passes only storage credentials into its downloader. The SMTP path executes the checked-in helper source in the already-running maintenance worker, using that worker's existing SMTP configuration. None of these paths recreates dependent services.

Linux host requirements: Bash, Docker/Compose, `jq`, GNU `timeout`, `flock`, `realpath`, `stat`, `df`, `mountpoint`, `od`. Existing local images: `single-vps-backup-runner:latest` and `postgres:18-bookworm` (or explicit drill image overrides). Pre-stage approved images outside the operation. Do not source Compose dotenv files as shell programs.

In the production Compose environment, configure `DB_BACKUP_HOST_DIR` inside `DB_BACKUP_VOLUME_MOUNT`. The latter must be a real mounted filesystem distinct from root. Symlink escapes, absent mounts, and different-device staging fail closed. Relative host paths are resolved relative to the Compose directory, not repository root.

## New Backups

After cutover/capacity approval, operator command from the repository root:

```bash
bash deploy/single-vps/backup-to-storage.sh post-cutover
```

The wrapper requires 30 GiB free before dumping by default (`DB_BACKUP_MIN_FREE_BYTES` can impose a different measured requirement). It locks against another backup or drill. A successful dump is preserved on upload/verification failure; incomplete dumps are removed unless explicitly retained.

The uploader hashes the complete local dump, uploads it under a unique key, checks remote HEAD length, and streams the full remote body through SHA256 without creating a second local copy. The GET is pinned by version/ETag; multipart ETags are never treated as SHA256. Only matching bytes allow publication and read-back verification of `<key>.manifest.json`, then an atomic `latest-verified-backup.json` receipt in the staging directory. Retention runs only after verification. A provider-side retention error fails the run. A manifest is an integrity record, not a digital signature or proof of immutable/object-locked retention.

Verification adds one complete remote read and its network cost to each backup. No fixed completion time is promised.

## Verification Only

With the normal storage variables available to the process, this performs a full remote read but writes no dump and makes no database connection:

```bash
node --import tsx -r dotenv/config scripts/db-restore-storage.ts \
  --key="$EXACT_BACKUP_KEY" --verify-only
```

For lightweight capacity planning, `--inspect` reads the manifest and HEAD only. Its result explicitly says `metadata-only-not-content-verified`. A verified download requires `--download-only --output-file=/capacity-checked/path/exact.dump`; it verifies size/hash before atomically publishing the dump, refuses overwrites, and writes the manifest alongside it. Missing/invalid manifests, mismatched identities, truncated streams, corrupted content, and provider errors fail closed.

`--latest` requires `DB_RESTORE_SOURCE_DATABASE_NAME` and selects only `.dump` objects. An invalid newest backup is an error, not a silent fallback to an older backup. The drill deliberately requires an exact key.

### Explicit Legacy Verification

1. Locate the trusted original dump or a separately trusted SHA256/size record for that exact backup. Do not manufacture the expected SHA256 from the same unverified remote download. An ETag or HEAD size alone is insufficient.
2. When the original exists, compute its byte size and SHA256, then stream-verify the remote object against both:

```bash
EXACT_BACKUP_KEY=database-backups/autoapplication/auto-autoapplication-20261025T084658Z.dump
EXPECTED_SIZE="$(stat -c %s -- "$TRUSTED_ORIGINAL_DUMP")"
EXPECTED_SHA256="$(sha256sum -- "$TRUSTED_ORIGINAL_DUMP" | awk '{print $1}')"
node --import tsx -r dotenv/config scripts/db-restore-storage.ts \
  --key="$EXACT_BACKUP_KEY" --verify-only \
  --expected-size="$EXPECTED_SIZE" --expected-sha256="$EXPECTED_SHA256"
```

3. To use that trusted baseline for an eventual drill, create a private local manifest. `TRUSTED_BACKUP_STARTED_AT` must come from the original backup record, not the current verification time. The environment below is an operator example; no storage secrets should be printed:

```bash
umask 077
jq -n --arg bucket "$STORAGE_BUCKET" --arg key "$EXACT_BACKUP_KEY" \
  --argjson sizeBytes "$EXPECTED_SIZE" --arg sha256 "$EXPECTED_SHA256" \
  --arg createdAt "$TRUSTED_BACKUP_STARTED_AT" \
  '{schemaVersion:1,bucket:$bucket,key:$key,sizeBytes:$sizeBytes,sha256:$sha256,createdAt:$createdAt,database:"autoapplication"}' \
  > "$TRUSTED_MANIFEST_PATH"
```

4. Supply `DB_RESTORE_DRILL_MANIFEST="$TRUSTED_MANIFEST_PATH"` to the drill. It checks the manifest's bucket/key and hashes a fresh download again. This does not publish or bless a remote manifest, or rewrite the production backup-age receipt.

If no independent baseline exists, there is no automatic bypass. Take a new verified backup after storage is safe, or escalate recovery under an explicitly documented degraded-assurance procedure outside these scripts.

## Capacity And Timed Drill

Reported capacity at implementation: filesystem approximately 394 GiB, post-cutover free approximately 190 GiB, database size `155465979583` bytes (including tablespaces), compressed dump `19224706886` bytes. The drill budgets:

`dump bytes + measured database bytes * 1.25 + max(filesystem capacity * 0.20, 60 GiB)`

For this dataset that is approximately 278 GiB free on the stated filesystem. **The stated production host does not have sufficient spare capacity. Do not force a full drill there or reduce the reserve. Use a separately provisioned isolated host with adequate capacity.** Streaming directly into `pg_restore` is intentionally not used: restore must not begin before the full object passes integrity verification.

On a prepared host, after capacity approval:

```bash
CONFIRM_ISOLATED_RESTORE_DRILL=yes \
DB_RESTORE_DRILL_DATABASE_BYTES=155465979583 \
DB_RESTORE_DRILL_TIMEOUT_SECONDS=7200 \
bash deploy/single-vps/restore-drill.sh "$EXACT_BACKUP_KEY"
```

For legacy objects also set `DB_RESTORE_DRILL_MANIFEST`. `DB_RESTORE_DRILL_ENV_FILE` can point to an external-host Compose dotenv file with only required configuration/storage secrets; the downloader passes only the six `STORAGE_*` settings it needs. It never passes `DATABASE_URL` or production Postgres credentials to the drill target. External-host Compose configuration validation may require project interpolation values, but they must be local placeholders, never production database secrets.

Every run creates a random database/container namespace and a fresh data directory with an ownership sentinel. The target has `--network none`, no published ports, fresh local credentials, a 2 GiB hard memory/swap limit and one CPU. Restore uses `--exit-on-error --single-transaction --no-owner --no-privileges --no-tablespaces` in the new target; it never uses `--clean` or migrates a live database. The previous direct/in-place restore entry points are intentionally disabled; `restore-from-storage.sh <key>` delegates to this isolated path.

A five-second guard continuously checks mount presence and free bytes during download, restore, and checks. On reserve breach it terminates only this run's labeled containers. Overall timeout and signal cleanup also check exact names, labels, canonical path, filesystem, and sentinel before deleting drill data. Evidence is retained. If Docker is unavailable or ownership cannot be established, cleanup fails closed and evidence reports `cleanupComplete:false`; an operator must inspect the exact recorded namespace. Never use broad container/volume prune or glob-based manual deletion.

Evidence is retained in `$DB_BACKUP_HOST_DIR/restore-drills/ao-restore-drill-<token>/evidence.json`, including exact remote key/verification, image identity, total/download/restore/check durations, status, cleanup result, exact critical table counts, schemas/columns, constraint definitions, CHECK-violation counts, unvalidated constraints and invalid indexes. Partial/failure evidence is retained too. Successful completion does not claim an application cutover or document recovery.

Optional `DB_RESTORE_DRILL_BASELINE_FILE` is a JSON object mapping table names to expected exact row counts. Compare only to a baseline from the same backup snapshot. The operator reported live baseline (15 users, 15 profiles, 16 documents, 4 submissions, 67 migrations) is not automatically assumed to describe the older backup. Confirm table mappings and capture time before enforcing it.

## Host Alerts And SMTP

Host monitoring checks backup receipt age (default 26 hours), last-backup failure, missing attached mount, disk/memory/load, existing service/HTTP checks and supply report freshness. Alert identity is stable across changing numeric values. New conditions/recoveries notify immediately; unchanged conditions repeat after six hours by default. Failed delivery, including failed recovery notification, retries. State and pending delivery are stored atomically beside the log unless `MONITOR_STATE_FILE` is set.

Webhook is tried first; only HTTP 2xx counts as `webhook-accepted`. If webhook is absent/fails, SMTP is tried when `MONITOR_ALERT_EMAIL=alvin.hu@mail.utoronto.ca`. This is the sole allowlisted recipient. The host reads that setting without needing a worker restart. Existing `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` remain in `worker-maintenance`; they are not extracted, printed or passed on command lines. TLS and finite timeouts are required.

Parent/operator configuration in the deployment dotenv file:

```dotenv
MONITOR_ALERT_EMAIL=alvin.hu@mail.utoronto.ca
```

Install both the host monitor and `scripts/send-health-alert.mjs`. Then explicitly send one host test (implementation did not run this):

```bash
MONITOR_ALERT_EMAIL=alvin.hu@mail.utoronto.ca MONITOR_TEST_ALERT=1 \
APP_DIR=/opt/autoapplication \
bash deploy/single-vps/monitor-health.sh
```

Inspect the protected health log/state for `smtp-accepted` or `delivery-unverified`, then confirm actual receipt with the owner. SMTP acceptance is not proof of inbox delivery. Without configured/working transport the state remains `delivery-unverified`; local logs do not prove off-host notification. A dead host cannot send its own alarm.

### Shared Off-Host Helper Contract

The off-host monitor can reuse the installed Nodemailer helper, with SMTP secrets supplied by its own approved secret store:

```bash
printf '%s\n' '{"schemaVersion":1,"source":"external","kind":"test","active":[],"opened":[],"recovered":[]}' \
  | MONITOR_ALERT_EMAIL=alvin.hu@mail.utoronto.ca node scripts/send-health-alert.mjs
```

This command sends a real test; parent owns execution. The helper accepts only `schemaVersion`, `source` (`host`/`external`), `kind` (`alert`/`recovery`/`test`), and `active`/`opened`/`recovered` arrays. External codes: `public-health`, `public-http`, `tls-expiry`, `monitor-stale`. Host codes are enumerated in `ALERT_TEXT`. Arbitrary prose, hostnames, URLs, log snippets, unknown keys/codes and unapproved recipients are rejected. Message text is fixed and redacted; SMTP errors are reduced to a generic failure. The helper closes its transport and returns nonzero on refusal/failure. Deduplication/recovery state belongs to the calling monitor, not the mail helper.

## Local Verification

```bash
node --import tsx --test tests/backup-recovery.test.ts tests/restore-drill.test.ts \
  tests/backup-monitoring.test.ts tests/health-alert-email.test.ts \
  tests/production-monitoring.test.ts tests/storage-efficiency.test.ts
npx tsc --noEmit --incremental false --pretty false
```

These use fake storage streams, fake Docker/storage probes and fake SMTP transports. They test corrupt/truncated/interrupted downloads, no-overwrite publication, missing manifests, isolated cleanup, reserve refusal/continuous guard, fail-fast restore, dedup/recovery and SMTP fallback without contacting production or sending mail. Actual dump restore/schema compatibility, provider retention/encryption/immutability, real alert receipt and application/document recovery still require operator evidence.
