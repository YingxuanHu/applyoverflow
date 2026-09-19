# Assistant 0.5 and Job Supply Audit

Status: implemented and tested locally on `dev`; not committed, deployed or
published by this work. Existing 0.4 embedded-form/privacy/logo changes are
preserved. Production observations below were read-only on September 19, 2026.

## Assistant Changes

- Workday and iCIMS contact adapters, plus conservative generic HTTPS form
  inspection from an explicit toolbar action. Applications do not need to start
  from ApplyOverflow. Automatic hints remain restricted to optional, approved ATS
  host access; arbitrary websites are not watched in the background.
- Workday matches both the older automation attributes and the exact paired
  label/ID/name patterns observed on a live Colliers application. Its application
  identity survives locale, step and human-readable location URL changes.
- Work/education exports only the entry the user selects. It fills an existing,
  unambiguous empty row, respects saved date precision, supports exact native
  dropdown options, and preserves existing values. It never adds rows or clicks
  Next/Submit. Unsupported custom controls stay manual.
- Explicit `I applied` confirmation can save independently discovered jobs to
  the private application tracker. No public job is created. Exact canonical
  matches can be linked; ambiguous matches remain private. Repeated confirmation
  is serialized and idempotent; later application statuses are not regressed.
- Tracking preview is bound to the selected tab/page, short-lived and single-use.
  Recent inspected job context can survive same-origin confirmation navigation.
  Disconnect, unauthorized responses and account changes clear this session data.
- Undo preserves user edits, checks document/group identity, and expires after
  ten minutes. Updated consent/data-use text covers history and external tracking.
- Production-preview and Store packages are approximately 108 KiB. Neither embeds
  account credentials. A separate Store package omits the preview identity key.

## Verification and Limits

| Check | Result |
| --- | --- |
| Unit suite | 979 tests, 27 suites, no failures |
| TypeScript and changed-file ESLint | Passed |
| Greenhouse/Lever/Ashby contact, resume and Undo suites | Passed; no automatic submission or existing-value overwrite |
| Expanded Workday/iCIMS/generic DOM fixtures | Passed, including selected history, ambiguous rows, native selects, date precision and navigation races |
| Real MV3 browser: embedded forms | Passed with API fixtures; frame permission, trusted click, document isolation, mobile and revoke/re-enable checks |
| Real MV3 browser: history/tracking | Passed with API fixtures; selected export, safe Undo, explicit confirmation, replay protection and account cleanup |
| Local database integration | Assistant ownership/PKCE/revision/idempotence and resume suites passed |
| Package validation | Passed for fixed production origin, narrow permissions and separate Store identity |
| Ingestion-to-feed database integration | Passed for partial-fetch/429 safety, unchanged revival, field updates and closures |

Live browser inspection used the public
[Colliers Analyst application](https://colliers.wd3.myworkdayjobs.com/en-US/Colliers-External-Career-Site/job/Toronto-Ontario-Canada/Analyst_JR18080).
After Apply / Apply Manually, the real extension detected seven empty contact
fields. No personal information was filled and no application was submitted.
The test exposed Workday's newer field IDs and location-path rewrite; both now
have regression tests. Screenshot: `output/playwright/assistant-live-workday.png`.

The live [Cadmus iCIMS board](https://careers-cadmusgroup.icims.com/jobs/search)
was accessible, but Apply led to an account/login gate with hCaptcha. No gate was
bypassed and no employer account was created. iCIMS autofill and later Workday
history steps remain fixture-verified, not universally verified on real forms.

The compact 320px popup was visually checked with the real packaged assets:
`output/playwright/assistant-expanded-popup.png`. History/tracking is collapsed
by default; core fill/resume/review actions remain visible.

A full production Next build and deployed 0.5 end-to-end flow are still release
gates. Local privacy page returned 200; unauthenticated history API returned 401.
The existing local development server was left running at `http://127.0.0.1:3004`.

## Release Gates

1. Review/commit this batch, build the matching backend and deploy it before
   sharing the 0.5 ZIP. No new schema migration is required; existing assistant
   migrations from 0.3 must be present.
2. Test the deployed dedicated account through connection, selected history,
   external tracking, resume sharing, revocation and rejected-token behavior.
3. An owner must provide the verified Chrome Web Store developer account,
   publisher/support/legal details and private reviewer access. Upload as a draft,
   obtain the actual assigned ID, narrowly allowlist it, and complete Google's
   review. See `docs/extension-web-store.md`; publication is not complete.
4. Broaden real-form verification for authenticated Workday/iCIMS history and
   custom dropdowns. Do not advertise universal autofill or automatic submission.

## Production Supply Findings

Public board count: **489,649**, from `JobFeedSummaryCache.liveJobCount`, computed
at `2026-09-19T16:09:45.012Z`. This is the public `/jobs` metric, not the broader
canonical lifecycle count. A single snapshot does not establish a growth trend.

Six-hour ingestion-run counters, sampled around 16:09 UTC:

| Family | Runs / failed | Fetched | Accepted | Created | Updated |
| --- | ---: | ---: | ---: | ---: | ---: |
| Greenhouse | 891 / 1 | 100,450 | 77,866 | 98 | 77,768 |
| iCIMS | 256 / 27 | 44,157 | 28,494 | 107 | 28,387 |
| Oracle Cloud | 512 / 1 | 38,770 | 19,707 | 170 | 19,537 |
| Official company | 102 / 1 | 30,200 | 21,345 | 14 | 21,331 |
| Lever | 364 / 2 | 30,163 | 24,756 | 31 | 24,725 |
| Ashby | 552 / 2 | 28,710 | 25,294 | 46 | 25,248 |
| SmartRecruiters | 143 / 49 | 25,417 | 10,707 | 32 | 10,675 |
| Workday | 285 / 129 | 21,869 | 13,216 | 317 | 12,899 |
| Company JSON | 510 / 188 | 13,941 | 9,103 | 173 | 8,930 |
| Workable | 60 / 52 | 1,327 | 1,147 | 21 | 1,126 |

These are repeated internal run outcomes, not unique public job counts. Accepted
updates preserve freshness and must not be interpreted as failed conversion.
The supply-health report now exposes accepted/rejected/deduped counts alongside
created/updated counts to make that distinction explicit.

### Implemented Reliability Fixes

- PM2 was monitoring the `tsx` CLI parent (~25 MiB), while its poll-worker child
  used ~752 MiB. The source-worker cgroup recorded two OOM kills. The four core
  workers now launch directly with Node + `--import tsx`; an isolated real PM2
  test verifies managed PID equals the TypeScript process PID. The poll restart
  threshold is configurable, default 1,024 MiB, rather than an ineffective 512
  MiB wrapper threshold. This is not a host memory reservation. Roll out with
  measured container headroom; do not increase concurrency at the same time.
- Discovery previews fetched each board twice for samples and normalization.
  They now use one snapshot, preserving metadata, limits and error behavior.
- iCIMS listing HTTP errors, unrecognized pages, failed detail requests, repeated
  pagination and safety-cap exhaustion can no longer masquerade as complete
  snapshots. Partial useful records can be ingested without expiring unseen
  records or advancing a successful-poll clock. Cancellation propagates.
- iCIMS validation accepts the newer div-based listing layout. Encoded pagination
  links are followed, overlapping IDs are fetched once, single-object JSON-LD
  locations are supported, and `UNAVAILABLE` address placeholders are omitted
  without guessing a city or remote arrangement.

### Verified Coverage Gap

Production contained a Cadmus company record but no matching direct source.
Its public iCIMS board yielded 14/14 detail pages in a bounded fetch; all 14 passed
the current North American white-collar normalizer. Roles included emergency
management, policy/exercise planning, program administration/business development,
data analysis and technology. This does not prove 14 net-new public jobs after
cross-source deduplication.

Cadmus is now in the existing enterprise seed catalog with the verified direct
board URL and a discovery regression test. It has not been inserted or polled in
production by this work. Roll it through existing validation and ingestion after
release; do not bypass source health or job-quality checks.

### Next Supply Batch

1. **Restore dependable refresh first.** Roll out actual-process supervision;
   monitor real RSS, cgroup OOM counters and poll throughput for 24 hours. Audit
   remaining shell-wrapped high-yield/retention workers separately.
2. **Coordinate rate limits by upstream host.** Workable had 51 HTTP 429 failures
   in six hours; only 8 of 261 active sources had refreshed in 24 hours. Add shared
   Retry-After-aware cooldown rather than starting more simultaneous requests.
3. **Resume expensive boards.** RBC Workday and multiple SmartRecruiters/iCIMS
   boards exceeded runtime budgets. Add bounded checkpoints for listing/detail
   progress, retaining the rule that incomplete snapshots cannot expire jobs.
4. **Recover structured sources selectively.** Of validated company-site sources,
   2,679 READY structured-sitemap sources had never succeeded, versus 1,460 READY
   HTML-fallback and 221 READY unknown-route sources. The generic company-site
   skip flag currently excludes all these routes. Do not enable all of them at
   once: sample verified structured feeds, assess extraction completeness and
   reserve a bounded first-poll quota before expanding. The flag was not changed.
5. **Expand diverse direct employers.** Seed official boards across consulting,
   finance/insurance, public sector, nonprofit/research, legal, HR, marketing,
   operations and customer success, as well as technology. Verify each employer
   and measure unique accepted postings, not candidate URL count. The legacy
   default ATS search queries remain heavily software-engineering weighted.

Initial acceptance criteria for that batch: zero erroneous expiry from partial
fetch fixtures; zero OOM kills during the measured 24-hour rollout; no repeated
request to a host inside its server-directed cooldown; successful first poll for
at least 90% of a small verified-source cohort within 24 hours; and 90% of healthy
retained-job sources refreshed within 72 hours. Track public cache count, source
failure/acceptance rates, unique creations, freshness updates and sampled duplicate
rate together. These are proposed rollout targets, not measured achievements.

## Salaries and Storage

No additional production salary records were changed. The extreme legacy Job
Bank rows inspected need source evidence; the first official source returned
410 Gone. Dividing a suspicious annual number by 2,080 would be a guess, not a
verified repair. Repair only from a recoverable authoritative page or a preserved
source payload with explicit amount, currency and pay period. Earlier verified
Sun Life/Bevi repairs are separate from this batch.

At the production check, root was 85% used with about 22 GiB available; the attached
volume was 35% used with about 92 GiB available. Extra volume capacity does not
remove root-filesystem risk. Continue using the established volume-backed backup,
rollback/archive and release-checkpoint directories. No files, backups or database
tables were moved/deleted here; further database relocation needs a maintenance
plan, not a live ad-hoc move.
