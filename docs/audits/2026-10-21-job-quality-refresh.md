# Job Quality And Refresh Audit

## Scope And Evidence

Production was inspected on October 21, 2026. This audit concerns job ingestion,
publication and availability, not the browser extension. The user approved an
isolated release and non-destructive repair of the feed.

- The 20:38 UTC feed summary reported 668,276 visible jobs. The 1,068,970 canonical
  LIVE records and 834,365 LIVE index records are different populations; neither
  is the user-visible count.
- Ingestion was active: 15,375 canonical jobs were created in the preceding day,
  with 490 LIVE additions in the preceding hour. These are throughput measures,
  not proof that every job remains open.
- An exported sample of 300 newest-posted indexed LIVE records had 28 publication
  failures under the revised checks. This is not a random population estimate.
  Of these 300, 292 had source evidence within three days; three had evidence
  older than 14 days or none.
- Thirty GET checks across distinct hosts found 13 ALIVE, nine SUSPECT, four
  BLOCKED and four DEAD classifications. The four DEAD classifications were
  three generic-careers redirects and one excluded registration-gated board,
  not four confirmed employer closures. The 13 unverified results are not
  evidence of closure.
- Workable overdue-source samples were queued behind a shared HTTP 429 provider
  cooldown, scheduled for October 22 at 06:59 UTC. Cooldowns must not be bypassed
  to inflate freshness. Company-page sources also have a substantial recovery
  backlog, including blocked and quarantined sources.

Local evidence: `output/audits/2026-10-21-production-jobs.json` and
`output/audits/2026-10-21-live-job-quality.json`. These contain public posting
metadata, not candidate profiles or credentials.

## Changes

- HEAD success means reachable, not confirmed open. It cannot renew live evidence.
- Posting identity must occur in page content; merely retaining the requested
  URL, a tracking ID, a partial ID or a different redirect's ID is insufficient.
- Embedded applications retaining a requisition parameter without readable
  posting content remain unverified rather than being labelled closed.
- Job-specific content is not mistaken for a generic careers page just because
  shared navigation includes search or talent-community links. Postal codes and
  salary fragments in URL slugs are not treated as requisition identifiers.
- Blocking and server-error responses cannot turn incidental closure text into
  a confirmed dead posting.
- URL rechecks have a six-hour minimum interval and prioritize never-checked
  records instead of leaving null timestamps behind all checked records.
- Publication requires a substantive description (at least 80 text characters),
  not HTML padding or a short summary substituted for a missing description.
- Clear frontline, production, manual and retail roles are excluded, retaining
  explicit office/knowledge-work exceptions and the GENERAL job category.
- The repair command uses exactly the ingestion publication gate. Dry-run is
  the default; `--apply` changes only index visibility. Canonical and index
  version checks prevent stale assessments from overwriting newer ingestion.
  Saved jobs, source mappings and application history are not deleted.

## Repeatable Checks

Run against the intended environment; never substitute a staging database URL
for production or copy production credentials into audit artifacts.

```bash
node --import tsx scripts/audit-live-job-quality.ts --sample-size=300 --live-checks=30
node --import tsx scripts/repair-job-feed-visibility.ts --dry-run --max-batches=1
node --import tsx scripts/repair-job-feed-visibility.ts --apply --batch-size=100 --max-batches=50
node --import tsx scripts/refresh-job-feed-summary.ts
```

The audit accepts `--input=<exported-json>` for offline publication analysis and
`--fail-on-issues` for an explicit quality gate. A failure can mean unverified,
not necessarily closed. Repair output includes the last cursor, skipped
concurrent changes and whether the scan completed. Resume bounded runs with
`--after=<lastId>`; a bounded incomplete run is not a full-feed audit.

## Production Release

Production is running `07bf22913875b9b3f6fa3a4f41f4614580ed04ff`, tagged
`production-job-quality-2026-10-21-r3`. This detached release is based on the
previously deployed `96d0322`, with only the job-quality changes cherry-picked.
The earlier `production-job-quality-2026-10-21` tag identifies a superseded build
candidate; that candidate was not promoted to production.

Three application links that redirected to generic careers pages were repaired
using verified-live employer detail pages: Westinghouse, Teradyne and Dufry.
Each repaired record was checked in production for LIVE index and canonical
status, ACTIVE link validation and no dead signal. This restores a usable
job-specific destination, not a guarantee of automatic application support.

## Repair Results And Remaining Work

- Sequential committed batches assessed 25,000 index records and hid 7,485
  records failing the shared publication policy. A separate priority pass
  re-assessed and hid 29 failing records in the newest-postings sample, for
  **7,514 index records hidden in total**. All concurrency guards passed for
  those committed changes. These are index visibility changes, not 7,514
  confirmed employer closures; some records were already filtered from the
  public feed by other query conditions.
- No canonical jobs, source mappings, saved jobs or application history were
  deleted. The three employer URL repairs are separate from these hide counts.
- The following read-only sample of 300 newest-posted indexed LIVE jobs had
  **zero publication-gate failures**; 296 had source evidence within three days.
  This is a bounded sample, not a population-wide certification.
- Its 30 cross-host application-page GET checks found **20 ALIVE, six SUSPECT,
  three BLOCKED and one ERROR**, with no DEAD classifications. Ten destinations
  remain unverified. Do not mark them closed merely because verification failed.
- The full historical index sweep **is not complete**. One 500-row batch hit a
  statement timeout and another hit a lock timeout; those entire statements
  rolled back. Smaller 100-row bounded runs completed. Database observations
  showed substantial disk-read waits, so the repair did not remove production
  query limits or force locks to finish a much larger sweep.
- The last committed scan cursor is `cmpq1mb1g04sf15p9y1fii11z`. Continue in
  bounded, monitored maintenance passes, preserving the shared gate and version
  guards. New ingestion/index writes already use the deployed policy. No
  background one-off repair process was left running.
- Recomputing the public feed summary after repair reported 666,116 visible
  jobs and 11,026 additions today. Counts also change with concurrent ingestion
  and expiration; the difference from the earlier snapshot is not solely the
  effect of this repair.

```bash
node --import tsx scripts/repair-job-feed-visibility.ts --apply \
  --batch-size=100 --max-batches=50 --after=cmpq1mb1g04sf15p9y1fii11z
```

Local evidence: `output/audits/2026-10-21-feed-repair-part{1,2,3,4}.log`,
`output/audits/2026-10-21-priority-repair-retry.log` and
`output/audits/2026-10-21-post-repair-audit.json`. Each run's counts are cumulative
within that run; sum only its last successful batch, not all intermediate lines.

## Verification

- Main code: 1,099 unit tests passed, scoped ESLint passed, TypeScript passed.
- Isolated release based on deployed `96d0322`: 1,088 unit tests passed.
- Main commits: `aea21ea`, `59df384`, `246e792`; deployed release: `07bf229`.
- Production image compilation, TypeScript, static generation, 16 guarded HTTP
  tests, PDF parser and PDF generation smoke tests passed. All 63 migrations
  were already applied; this release required no schema migration.
- The public health endpoint reports ready at the deployed revision. The app
  passed its container health check and all three workers remained running;
  ingestion logs show active source polls. An unauthenticated
  `/jobs` request redirects to sign-in; authenticated feed UI was not claimed
  as tested by that check.
- Actual repair SQL was exercised against temporary production-database
  fixtures inside a rolled-back transaction: an unchanged failing record was
  hidden, while newer canonical/index records were preserved.
- GitHub runs 39674377511 and 39675936730 failed the unrelated extension
  workspace fixture on `Unexpected API: onboarding-event`. The release excludes
  the newer onboarding/extension commits and all unrelated uncommitted changes.
  The same failure was verified in pre-existing run 38934704020.

Live employers can change between checks. Provider-blocked pages and the source
recovery backlog remain limitations; this audit does not certify every listing
as independently verified open.
