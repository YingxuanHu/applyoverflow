# Job supply and source coverage audit

Date: 2026-09-15. Production observations were read-only, approximately 16:29-16:45 UTC. Changes below are local and not deployed. No source was enabled, no production records were rewritten, and no service was restarted.

## Public count and the decline

All public counts below are `JobFeedSummaryCache.liveJobCount`, the filtered `/jobs` metric, not the canonical lifecycle count.

| Cache timestamp, UTC | Public jobs |
| --- | ---: |
| September 14, 17:46 | 507,510 |
| September 14, 23:04 | 478,982 |
| September 15, 04:04 | 465,300 |
| September 15, 06:03 | 464,661 |
| September 15, 16:45 | 467,218 |

The latest sample is down 40,292 (7.9%) from the September 14 audit snapshot, but up 2,557 from the morning low. The system is not simply losing that many stored jobs.

Historical supply captures at `/opt/autoapplication/logs/supply-health-*.json` show the following **non-public internal diagnostics** between September 14 at 18:06 and September 15 at 04:06:

- Canonical LIVE inventory increased from 777,218 to 778,429.
- LIVE feed-index inventory fell from 659,110 to 617,179.
- Hidden-but-canonical-LIVE inventory increased from 118,108 to 161,270.
- Inventory failing both freshness-evidence windows changed only from 185,361 to 185,423.

This strongly points to publication/index exclusions as the main overnight mechanism, rather than an equivalent wave of employer closures or a sudden freshness-window cliff. These are independently timed snapshots, not an exact transition ledger. Older partial reports store successful measurements under `sections.*.data`; unavailable sections must not be interpreted as zero.

A bounded diagnostic sample examined 300 recently indexed hidden records that still had recent source/alive evidence. It found 205 occupation exclusions, 86 geography exclusions, 3 non-job pages, and 6 data-quality rejections. This newest-first sample is **not random**, is not a public job count, and must not be extrapolated into a percentage of erroneous exclusions.

Two confirmed false positives in that sample also reproduce in the current local code:

- `Principal Wealth Advisor`: the word `principal` triggered the education exclusion.
- `Brisbane, CA`: Brisbane was classified as an unambiguous Australian city despite the California qualifier.

A separate bounded inventory query found one internal LIVE record with the first title pattern and five with the exact second location. These are candidate records for re-evaluation, not six guaranteed public additions. Other publication gates still apply. The sample also contained legitimate exclusions and ambiguous clinical/research roles that need separate review; this patch does not broadly admit them.

## Ingestion is active, but coverage is not complete

There are 31,176 source registrations linked to 25,498 company records. Registrations are not unique employer coverage: aliases, generic URLs, broken boards, and multiple ATS sources occur.

The source-worker PM2 processes were online with no restarts in the current container session. Automatic discovery and focused Adzuna polling were enabled. USAJOBS credentials were present and its sampled keyword lanes had successful runs. It is not a missing integration.

Across the seven-day ingestion sample, the overwhelming majority of accepted records updated existing canonicals. For example, September 14 recorded 567,063 accepted records, of which 7,404 created canonicals. These are **internal ingestion events**, not distinct public jobs. Reconfirmation is necessary; repeatedly refreshing a few productive boards is not a substitute for employer coverage.

Observed bottlenecks:

1. **Registry status overstates source health.** Of 20,735 sources in ACTIVE/PROVISIONED/DEGRADED, 5,121 had never succeeded and another 4,857 last succeeded more than seven days ago. The coverage report counted all of them as healthy. Repair discovery also excluded ACTIVE/PROVISIONED sources regardless of actual success, leaving a gap between coverage and repair lanes.
2. **Company-owned site coverage is weak.** Of 20,437 company-site registrations, 11,940 had never succeeded. In a 24-hour sample, CompanyJson had 732 failed runs out of 1,808, and CompanyHtml 268 out of 1,377. Across all families, aborted requests and HTTP 404s were prominent failures. A registered careers URL does not demonstrate a working extractor.
3. **Large boards repeatedly exceed a full-run budget.** SmartRecruiters had 188 failures in 442 runs. Several large boards reached their 90-second budget about 19-20 times in a day. Both focused Adzuna lanes also hit their 180-second budgets. Increasing frequency repeats the same incomplete work.
4. **Upstream throttling matters.** Workday had 287 failed runs out of 910, including 429s. Respect cooldowns; increasing concurrency is not an appropriate general fix.
5. **The queue has delayed work.** CONNECTOR_POLL had 2,586 pending tasks, with the oldest due about six hours earlier. A retention report showed 1,987 tracked successful retention polls in 24 hours, but only six were selected at seven-day-or-older age. Some old sources are broken or deliberately backed off; worker throughput alone cannot repair them.

At the disk sample, root was 90% used with 16 GiB available; the attached volume was 53% used with 31 GiB available. Broad crawling, duplicate page storage, or more worker concurrency should not be enabled blindly under that constraint.

## Specific coverage gaps

The registry already contains substantial Greenhouse, Ashby, Lever, Workday, OracleCloud, iCIMS, SuccessFactors, Workable, SmartRecruiters, and other ATS coverage. The generic company-site connector also supports structured JSON, HTML and sitemaps; independent company sites are not wholly unsupported.

The following is a **board-URL host-pattern audit**, not a complete platform census. Counts are source registrations, not job counts or verified distinct employers:

| Platform | Matching registrations | Successful within 7 days |
| --- | ---: | ---: |
| ADP | 457 | 0 |
| UKG/UltiPro | 57 | 0 |
| GovernmentJobs | 41 | 0 |
| Pinpoint | 10 | 3 |
| ApplicantPro | 7 | 2 |
| JazzHR/ApplyToJob | 6 | 1 |
| Dayforce | 6 | 0 |
| BambooHR | 5 | 1 |
| Paylocity | 3 | 0 |
| JobScore | 2 | 1 |
| Comeet | 2 | 0 |

Important concrete failures:

- Several ADP companies were registered against the same generic `https://workforcenow.adp.com/careers` URL. That is not an employer-specific board.
- Production SourceCandidate records with ADP `recruitment.html?cid=...&ccId=...` URLs had normalized keys containing neither employer nor career-center ID. Different employers consequently collide in the candidate registry. A later sighting can replace the associated company hint on the shared candidate.
- Sample GovernmentJobs company sources pointed at the platform-wide `/sitemap.xml`, not an employer-specific jobs inventory. Reachable or empty validation on that URL is not evidence of municipality coverage.

### External opportunities verified against primary sources

- **Ashby partner feed:** a dedicated JSON/XML feed with hourly updates and employer opt-in. This can complement per-employer discovery, but requires a partnership and does not include every employer automatically. [Ashby partner-feed documentation](https://developers.ashbyhq.com/docs/dedicated-partner-job-feeds).
- **Known ATS public postings:** retain efficient employer-scoped collection through documented interfaces such as [Ashby's public postings API](https://developers.ashbyhq.com/docs/public-job-posting-api) and [SmartRecruiters' Posting API](https://developers.smartrecruiters.com/docs/posting-api). API existence alone is not complete employer discovery or blanket data-redistribution permission.
- **Government sources:** USAJOBS is already present; review coverage by occupational series and pagination, not just more overlapping keyword queries. Its search API is intended to support job-board consumption. [USAJOBS Search API](https://developer.usajobs.gov/api-reference/get-api-search). Separately audit Canadian federal GC Jobs and provincial/municipal career portals; GC Jobs and Job Bank are separate sources. [Canada's jobs portal](https://www.canada.ca/en/services/jobs.html).
- **Independent career sites:** discover employer-owned job-detail pages through bounded sitemap/HTML traversal, and prefer their `JobPosting` JSON-LD when available. Google documents this publisher markup and sitemap freshness signals; this is not a general Google Jobs harvesting API. [Google JobPosting documentation](https://developers.google.com/search/docs/appearance/structured-data/job-posting).

University administration, nonprofit/policy, healthcare administration, and regional-government employers deserve explicit samples in the expansion plan. They are first-class GENERAL coverage, not an incidental by-product of technology-company discovery. Access terms, attribution and external application requirements must be checked per source. No authenticated scraping, rate-limit bypass, paid provider signup, or partnership contact was performed.

## Implemented locally

1. Fix the confirmed wealth-advisor and Brisbane false exclusions. Keep school-principal and Australian-location exclusions, with regression cases.
2. Share a seven-day successful-poll health predicate between coverage reporting and source-repair targeting. Require validated, non-disabled/non-quarantined sources; recent success can survive a temporary backoff.
3. Include stale ACTIVE and old never-successful sources in bounded repair selection. Respect provider cooldowns, disabled sources, active polling, healthy alternatives, and a 12-hour provisioning/new-lead grace period. Random sampling avoids deterministically selecting the same top failures each pass. Existing candidate validation/promotion checks remain in place.
4. Count first-party coverage through any active source mapping, not only the primary mapping; count each job once. Add read-only transaction and statement/lock time bounds to the coverage report, and explicitly label it non-public.
5. Preserve ADP employer/career-center query IDs in **discovery candidate identity only**. Ignore tracking parameters and leave canonical job URL/dedup keys unchanged. No schema or large storage addition.
6. Correct misleading expiry diagnostics: stale evidence alone no longer means "not a confirmed closure." Exclude recorded dead signals and passed deadlines from that bucket and label it as a current-record diagnostic, not causal history.

These changes do not split historical collided candidates, repair already-generic ADP URLs, add new platform adapters, re-index hidden production jobs, or redeploy workers. Those are explicit follow-on operations, not claimed outcomes of this patch.

## Next rollout and architecture work

1. **Canary the fixes:** deploy after review, re-evaluate a bounded set of affected existing jobs, and inspect titles/locations/descriptions on `/jobs`. Never bulk-resurrect REMOVED/EXPIRED records or weaken evidence windows just to increase the count. Preview repair targets before enabling the changed selector in production.
2. **Recover existing sources:** repair employer URLs and introduce resumable list/detail work for oversized boards. Persist completed work across runs and rotate cursors. Only a complete, successful membership snapshot may drive absence-based removals; timeout, partial page, or HTTP failure must not imply closure.
3. **Expand by measured employer coverage:** start with ADP and UKG/Dayforce, then GovernmentJobs/GC Jobs and Paylocity; follow with BambooHR/JazzHR/Pinpoint/Comeet and independent-site extraction improvements. Start each adapter with 25-50 verified North American employers across TECH, FINANCE and GENERAL. Reconstruct tenant-bearing URLs from original employer links, not the already-collapsed registry key.
4. **Use partnerships selectively:** pursue Ashby partner access and assess other licensed feeds on incremental eligible jobs per cost, not advertised global inventory. Preserve attribution and multi-source mappings; do not store repeated copies of unchanged descriptions.
5. **Make losses explainable:** add compact daily aggregates for public-feed additions, confirmed closures, stale evidence, geography/scope exclusions, quality failures, and dedup merges. Preserve a small audit sample per reason. Current snapshots cannot produce an exact historical public-count waterfall.

Suggested acceptance targets, not measured guarantees:

- At least 95% of established, pollable employer sources successfully refreshed within seven days; no unaccounted-for productive source beyond the evidence window.
- Pending poll age p95 below six hours, with provider cooldowns reported separately.
- At least 95% recall of eligible advertised jobs in the manually checked adapter sample, and zero wrong-employer attachments.
- A 100-job admission sample with at least 98% correct geography/occupation scope; all known false-positive fixtures must pass.
- Track new public jobs per request, CPU minute and stored byte, plus retained public jobs per refresh. Updates and dedup hits are not failures by themselves.
- No source expansion that worsens user-facing search latency or breaches disk headroom; keep large transient artifacts on the attached volume and bound raw retention.

## Verification

- Full unit suite passed after all changes: 917 tests, zero failures.
- TypeScript and scoped ESLint passed after all code changes.
- Real local PostgreSQL integration passed for stale/never-successful repair, healthy alternatives, provisioning grace, fresh leads, old promoted leads, provider cooldowns, disabled/active states, secondary source mappings, removed mappings and duplicate aggregator mappings. Fixtures removed only their own IDs.
- Production diagnostics used bounded read-only queries. No production mutation or rollout occurred.
