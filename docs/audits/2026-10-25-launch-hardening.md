# Launch Hardening Execution Record

This is implementation evidence following `2026-10-25-public-launch-readiness.md`,
not a replacement for its launch gates. Times below are UTC. Unverified controls
must not be described as deployed or as public-launch approval.

## Authorized Operations

- Owner expanded the attached block volume to 400 GB.
- Owner approved a database maintenance window of up to 60 minutes.
- Owner approved parallel implementation and delegated the alert destination.
- Operational alerts will use the existing account notification email. No account
  records, employer answers, credentials, or raw logs belong in those messages.
- Owner explicitly deferred public launch until isolated recovery testing is
  funded. No paid recovery/load-test machine is authorized. Continue maintaining
  the existing service; do not interpret hardening or local tests as launch
  approval.

## Storage

- Expanded the mounted ext4 filesystem online: approximately 394 GiB usable.
- Root before cutover: 150 GiB total, 143 GiB used, 1.3 GiB available.
- Inventory includes both `/var/lib/docker` and `/var/lib/containerd`, not only
  the PostgreSQL heap. Existing external tablespace paths remain unchanged.
- Verified an off-host dump object completed at 09:03:09, size 19,224,706,886
  bytes. This was metadata inspection, **not a successful restore rehearsal**.
- Live precopy completed; this copy was never treated as a usable database.
- Maintenance began at **16:55:56**. All recorded containers, containerd tasks,
  daemon processes, and nested runtime mounts stopped before cold synchronization.
- Cold Docker and containerd copies passed checksum comparison at **17:40:19**;
  the cutover completed at **17:40:27**, with public readiness restored at
  **17:40:37**. Maintenance took approximately 45 minutes.
- All ten previously running containers were restored. User/profile/document/
  submission/migration counts remained **15/15/16/4/67**. Ownership conflicts,
  unbound profiles, invalid indexes, and database checksum failures were zero.
- Both runtime paths now use persistent bind mounts on the attached volume.
  Services require both mounts and verify their filesystem identity before
  starting. Unit verification passed; **an actual host reboot was not tested**.
- After verification, the guarded reclamation script removed only obsolete
  runtime copies hidden underneath those mounts. Root now has approximately
  **137 GiB available (5% used)**; attached storage has approximately **180 GiB
  available (53% used)**. The external PostgreSQL tablespace is unchanged.

The obsolete root runtime copies have been removed. Never remove the live
mounted paths or attempt to roll back to the old root storage. Cutover evidence
was copied off-host into private operational output, not committed to source.

## Monitoring And Exposure

- Host monitoring runs every five minutes with the owner recipient persisted in
  its cron configuration. A test reached **SMTP acceptance**, with no pending
  delivery. Inbox receipt has not been confirmed. Active conditions include
  load and a missing new-format verified-backup receipt; these are not cleared
  merely because the storage migration passed.
- The GitHub `public-health-alerts` environment is restricted to `main`; its five
  SMTP secrets are configured without exposing their values. External workflow
  execution and delivery must still be verified after merge.
- The co-hosted staging site's public proxy now returns **403**, verified
  externally. Production remains available. Staging containers and data were
  preserved; only public routing was disabled.

## Code And Local Verification

- Patched framework/runtime dependencies; `npm audit --omit=dev` reports **zero
  vulnerabilities**. This does not mean production already runs those versions.
- Local full unit run: **1,246 passed, zero failed** after the implementation
  batches. Typecheck and lint passed (one pre-existing unused-variable warning).
- Standalone resume parsing and preview smoke tests passed. A Linux/amd64 web
  image diagnostic also passed native rendering and 11 parser-security tests;
  this working-tree diagnostic is not the final immutable release image.
- Authentication dependency outages now have retryable responses instead of
  being translated into logout. Report-only CSP is observation, not enforcement.
- Parsing has isolated processes, deadlines, bounded concurrency, signature and
  archive checks, memory monitoring, restricted environment, and cancellation.
  It is not a malware sandbox or a kernel-enforced memory cap.
- Exact-commit CI verification is required for the release scripts. Pipeline
  repair and real GitHub enforcement are separate from a local test pass. Main
  branch protection now requires the successful `application` check, up-to-date
  branches, pull requests and resolved conversations, including for admins.
  PR #29 passed the complete Verify workflow at `8819e86` (run `40215965770`).
  Subsequent proxy changes still require verification for the final release SHA.
- Backup tools require integrity manifests and isolated restore targets. A
  fresh new-format verified backup and full restoration remain unverified here.
- The production application still runs revision `9836985` at this checkpoint;
  repository changes and local diagnostic images are not deployed app evidence.

## Remaining Launch Gates

1. Pass the complete CI pipeline for the exact committed release, promote the
   same checked images, verify the running revision, and enforce merge checks.
2. Verify external outage notification execution and actual alert receipt.
3. Restore a real backup on an isolated, adequately sized host, verify database
   and document recovery, and measure RTO/RPO. Daily backups are not PITR.
4. Measure representative capacity, background-work contention, and public-feed
   quality. A tiny HTTP fixture is not production capacity evidence.
5. Finish signed-in journey, ownership, installed-extension compatibility, and
   provider security checks. Do not promise every employer website is proven.
