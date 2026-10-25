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
- After the application release, root remained at **5% used / 137 GiB free**;
  attached storage was **54% used / 174 GiB free**, including the retained rollback
  images. User/profile/document/submission counts remained **15/15/16/4**; the
  migration count increased to **68** after the onboarding-events migration.

The obsolete root runtime copies have been removed. Never remove the live
mounted paths or attempt to roll back to the old root storage. Cutover evidence
was copied off-host into private operational output, not committed to source.

## Monitoring And Exposure

- Host monitoring runs every five minutes with the owner recipient persisted in
  its cron configuration. A test reached **SMTP acceptance**, with no pending
  delivery. Inbox receipt has not been confirmed. The load condition recovered;
  the latest check still reports a missing new-format verified-backup receipt
  and partial supply-health reporting. Feed, flow, cadence and retention-lane
  report queries exceeded their 25-second budgets. These are not cleared merely
  because the storage migration passed.
- The GitHub `public-health-alerts` environment is restricted to `main`; its five
  SMTP secrets are configured without exposing their values. External workflow
  run **40219771427** passed, including one explicit test alert accepted by SMTP.
  This is not inbox-receipt confirmation or a real host-outage rehearsal.
- The co-hosted staging site's public proxy now returns **403**, verified
  externally. Production remains available. Staging containers and data were
  preserved; only public routing was disabled.

## Code And Local Verification

- Patched framework/runtime dependencies; `npm audit --omit=dev` reports **zero
  known dependency vulnerabilities**. Production now runs **Next.js 16.4.3**.
- Latest local full unit run: **1,249 passed, zero failed** including the
  deployment-finalization regression. Typecheck and lint passed in the application
  release CI (one pre-existing unused-variable warning).
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
  The final application release, **d58f6b1211ba00418b79365d0b612158b46a7e55**,
  passed the complete main-push Verify workflow **40221044730**. PRs #29 and #30
  were merged after verification. The onboarding fixture now waits for visible,
  ready form controls; the MV3 workspace fixture selects the session-bound tab,
  not a potentially racing installation tab. Three local onboarding and six
  local workspace runs passed, plus the connected-account recovery scenarios.
- Backup tools require integrity manifests and isolated restore targets. A
  fresh new-format verified backup and full restoration remain unverified here.
- Production readiness now reports **d58f6b1211ba00418b79365d0b612158b46a7e55**.
  Web and all three worker labels match; backup-runner uses the same verified
  worker image. Candidate HTTP-transport and PDF-generation checks passed before
  restart. PostgreSQL retained its **17:40:26** start time through this app release.
- The remote health check consumed the tail of the SSH script, skipping release
  finalization despite exit code zero. Finalization was then executed explicitly
  under the migration lock: health and image labels checked, Caddy validated and
  reloaded, old backup-runner retained, new runner promoted, transport aliases
  removed. PR #31 fixes stdin isolation and tests success and fail-closed errors.
  This operations-only follow-up does not change the running application revision.
- Live unauthenticated checks passed: health 200/ready, resume and export APIs
  401, Jobs redirecting to sign-in, sign-in 200 with report-only CSP, staging 403.
  The deletion-retry supervisor is online. The downloaded extension is **0.16.1**
  and its SHA256 matches the deployed container; installed Chrome and Web Store
  versions were not changed. Production signed-in browser verification remains
  incomplete because the Mac was locked.

## Remaining Launch Gates

1. Rehearse host restart and controlled rollback; mount checks and retained
   images alone are not those rehearsals. Preserve the enforced CI release gate.
2. Verify actual alert receipt and a real external outage/recovery sequence.
3. Restore a real backup on an isolated, adequately sized host, verify database
   and document recovery, and measure RTO/RPO. Daily backups are not PITR.
4. Measure representative capacity, background-work contention, and public-feed
   quality, including the timed-out health-report sections. A tiny HTTP fixture
   is not production capacity evidence.
5. Finish signed-in journey, ownership, installed-extension compatibility, and
   provider security checks. Do not promise every employer website is proven.
