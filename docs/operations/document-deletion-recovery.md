# Document Deletion Retry and Restore Erasure

## Status and Source of Truth

Scheduled retry hardening is implemented in source; production installation and
observed execution are not verified here. Recovery testing is deferred by the
owner pending funding. Public launch remains deferred; no paid drill host was
provisioned and no full production restore was run.

The current implementation is a retry queue, **not a restore-safe erasure ledger**:

- `prisma/migrations/20260912194500_transactional_storage_deletions/migration.sql`
  enqueues `StorageDeletionTask` in the transaction deleting a `Document`,
  including account/profile cascade deletion. A rolled-back transaction does not
  leave an intent for the rolled-back deletion.
- `src/lib/storage/index.ts` also enqueues abandoned-upload cleanup before I/O,
  refuses deletion while a `Document` references the key, removes local and
  configured remote copies, and retains failed intents with a 15-minute delay.
  Successful deletion removes the queue row. Storage keys may contain personal
  information and must not appear in operational logs or public evidence.
- `scripts/retry-storage-deletions.ts` remains the maintenance entrypoint. The
  pre-existing PM2 cron entry has been replaced with the existing supervised
  maintenance shell-loop pattern, not a new external scheduler.
- `maintenance-storage-lifecycle` only runs its two explicit job-retention
  targets. It is separate from document deletion and is unchanged by this work.

## Retry Contract

`maintenance-storage-deletions` runs only in the `maintenance`/`all` worker
groups. It waits 120 seconds at startup, runs one pass, then waits 900 seconds
after that pass finishes. There is no overlapping pass within one loop.

Each pass selects at most 50 due intents in due-time/key order and performs
deletions sequentially. A conditional database update postpones an intent by
15 minutes before I/O. Other scheduled passes skip a claimed intent; a crash or
timeout does not discard it. This is not an exactly-once storage guarantee:
request-path deletion may overlap, and provider deletion must stay idempotent.
The existing `deleteFile` reference guard and success/failure handling remain
authoritative. Failed/referenced items stay queued; no attempt limit drops them.

A 120-second soft budget stops starting further work. The scheduled GNU `timeout`
sends TERM at 180 seconds and KILL after a further 10 seconds, including a stuck
storage request. These process limits are necessary: the soft budget alone does
not cancel in-flight I/O. A claimed item interrupted before deletion is due again
after 15 minutes. An already deleted object whose acknowledgement was interrupted
is retried idempotently.

Queue selection/claims and housekeeping use the existing bounded maintenance DB
client (one connection, 60-second statement and 1-second lock limits). Existing
storage deletion uses its own application client, limited to one maintenance
connection by this scheduler. The process deadline bounds that path as well.
Housekeeping selects/deletes at most 100 expired budgets and 100 expired leases;
expiration is rechecked during deletion to preserve renewed entries.

Logs contain aggregate selected/attempted/completed/failed/skipped/deferred,
pruned counts and deadline status, not object keys or provider error text.
`selected` is this batch, not total backlog. Failures/time-budget exhaustion exit
nonzero and the loop emits `storage-deletion-retry-pass-failed`. This change does
not configure a separate queue-age/backlog alert; repeated failures require
operator investigation and must not be treated as completed erasure.

### Operator Handoff

The parent installs/restarts the maintenance group only after cutover approval.
Do not run this mutating command against production during cutover or as part of
unit tests. It is the bounded one-pass command for an operator-approved target
whose DB and document-storage configuration have both been verified:

```sh
DATABASE_PROCESS_ROLE=maintenance DATABASE_POOL_MAX_MAINTENANCE=1 \
  timeout --kill-after=10s 180s \
  node_modules/.bin/tsx -r dotenv/config scripts/retry-storage-deletions.ts
```

Use a dedicated disposable database **and** a dedicated disposable bucket/local
upload directory for integration fixtures. Do not combine a restored database's
queue with production storage credentials. Unit tests below use injected in-memory
delegates and an intercepted shell loop; they never call the deletion CLI:

```sh
node_modules/.bin/tsx --test tests/storage-deletion-retry.test.ts \
  tests/inactive-job-retention.test.ts
npx tsc --noEmit --incremental false --pretty false
```

The existing `tests/integration/storage-deletion.ts` verifies transaction rollback,
cascade enqueue, reference protection and failure retention against a local test
database. It was not executed for this follow-up; unit evidence is not a substitute
for its real PostgreSQL trigger checks or an observed production retry pass.

## Restore-Erasure Requirements (Not Implemented)

A backup taken before an account/document deletion can restore those rows. It can
also restore an already completed retry intent or omit a later deletion entirely.
The restored queue alone cannot establish what must stay erased. A successful DB
restore or backup checksum does not prove privacy-safe recovery or PITR.

Before recovered data is allowed to serve users, the following work is required:

1. **Independent durable tombstones.** Define an append-only, access-controlled,
   encrypted deletion ledger outside the database rollback domain. Persist a
   unique event ID, monotonic sequence, committed deletion time, account/profile
   and document identifiers as applicable, scope/reason, and provider/bucket/key
   and version identity needed for deterministic erasure. Minimize and protect
   identifying fields; do not use email/name as an identity key. Account-wide
   deletion must cover all owned rows and artifacts, including those not present
   in the chosen backup.
2. **Transactional capture and delivery evidence.** Capture tombstone/outbox events
   in the same transaction as account/document deletion. Export idempotently to
   the independent ledger with durable acknowledgements and an auditable high-water
   mark. The design must handle DB loss after commit but before export; ordinary
   asynchronous export alone cannot prove absence of missing deletions. Define
   when erasure is acknowledged to the user, monitor export lag, and block restore
   release when the ledger's completeness cannot be established. Do not recycle
   the current transient `StorageDeletionTask` as the only ledger.
3. **Retention and version inventory.** Retain tombstones for at least the longest
   recoverability window across DB dumps/snapshots, replicas, document object
   versions, provider retention and copied backups, plus an approved safety margin.
   Confirm actual object versioning/delete-marker semantics and delete all retained
   versions in scope or enforce verified expiry. A successful unversioned delete
   is not evidence that historical versions are erased. Resolve retention/legal
   holds explicitly; neither this retry worker nor this plan certifies compliance.
4. **Restore fence and replay.** Keep recovered DB, application, workers and object
   writes isolated from live traffic and production credentials. Pin the exact
   backup identity and trusted ledger watermark. Replay all tombstones applicable
   to restored records through the approved cutover watermark, including unresolved
   older deletions, not merely events newer than the backup filename. Reconcile any
   concurrent deletions before lifting the fence. Unknown ledger coverage fails
   closed. Never execute a restored deletion queue against the production bucket
   during an isolated drill.
5. **Complete erasure scope.** Inventory actual schema ownership/cascades and
   external artifacts before implementing replay: `User`/`UserProfile`, `Document`
   and `DocumentAnalysis`, resume builds/variants, application packages/submissions,
   tracked-application attachments, sessions and extension connections/transfers,
   generated files, local copies, caches/search indexes and applicable logs. Verify
   account-wide deletion separately from single-document deletion; do not delete
   unrelated active users' data. Third-party submitted applications and client-side
   copies need a separately stated policy, not a claim of automatic recall.
6. **Idempotent reconciliation and release gate.** Replay into a fresh isolated
   target using synthetic tombstones and isolated object storage first. Test
   deletion after backup, multiple/duplicate events, successful deletion whose
   queue row is gone, failed storage deletion, account cascades, regenerated
   artifacts, process interruption and missing/stale ledger evidence. Verify erased
   identifiers are absent from restored rows and derived artifacts while unaffected
   fixtures survive. Record aggregate counts, exact backup/ledger identities,
   watermark, timings, failed checks and operator approval without personal data.
   Production writers remain stopped/fenced until replay and reconciliation pass.

No tombstone schema, independent export, replay tool, version purge, release gate,
funded full restore or end-to-end erasure recovery has been implemented or validated
by this change. Those are outstanding recovery work, not completed launch evidence.
