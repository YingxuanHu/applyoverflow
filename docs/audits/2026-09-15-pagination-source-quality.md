# Pagination and source-quality audit

## Observed production evidence

- `cmu0igwkma6fm0uozk7ag554o` links to We Work Remotely, whose public Apply now link leads to `/job-seekers/account/register`. This is a board-registration gate, not an employer application login.
- The same Pinterest title already has an official canonical, `cmrxy777y1zbh3ilkq3ccsmtf`, pointing to `https://www.pinterestcareers.com/jobs/?gh_jid=8071670`, located in Palo Alto / Remote, US. The board copy incorrectly presents worldwide availability. Its two WWR source mappings do not include the official employer mapping.
- Laportefr's refrigeration roles use separate Greenhouse requisitions. The two Brossard entries point to `5396389008` and `5396402008`; the other cities also have distinct requisition IDs. No duplicate apply URL keys were found in the bounded LIVE Laporte query. Distinct requisitions must not be merged solely by company/title/location.
- A read-only mapping audit found identical custom-site posting IDs attached to up to six canonical records, sometimes across different employers. The connector's fallback ID encoded only the first 48 Base64 characters of `URL|title`, so long URLs shared IDs regardless of their suffix. These are identity collisions, not proof that the affected canonicals represent the same job.

## Implemented

1. Key the browser count provider by normalized filter constraints, viewer and viewer-state version, not page number or whether a count has arrived. Retain resolved counts and in-flight requests across pagination and sorting. Filter/user-state changes still invalidate them.
2. Use client-side page-jump forms and full adjacent-page prefetch. Pending links keep stable dimensions and show a spinner. Prefetch is enabled in production; these local timings were measured in development without production prefetch.
3. Avoid scanning and transferring up to 8,001 candidate IDs for broad structured searches before each page. A cached planner estimate selects whether a selective probe is useful. Estimates never supply displayed totals or truncate matches; final predicates still evaluate every constraint.
4. Group same-company, exact-title rows on each page, preserving each original requisition, location, action state and detail link. Expand/collapse and keyboard navigation retain access to all entries. This is presentation grouping, not global deduplication or cross-page consolidation.
5. Exclude known registration-gated WWR destinations from canonical public visibility, raw ranked queries and exact counts. The summary refresh uses the same canonical policy. Source/link resolution prefers a direct employer mapping over a board when available. Verified ATS destinations are still usable even when discovered through a board. No general ban on legitimate employer accounts.
6. Hash the complete custom-site identity instead of truncating its encoded prefix. Preserve requisition IDs, meaningful URL parameters and distinct titles on shared career pages. Existing URL-based matching remains in place for ingestion continuity.
7. Add explicit refrigeration/HVAC/building-services/thermal engineering classification evidence, including a regression with a stale SWE role-family hint.

## Verification

- 924 unit tests passed, including count keys, identity collision reproduction, grouping, gated links, classification and conservative deduplication. Focused tests were rerun after the final identity refinement.
- TypeScript and scoped ESLint passed; `git diff --check` passed.
- An 8,055-row local fixture passed raw-SQL/Prisma parity for counts, ordering, two-page uniqueness, status filters, viewer PASS exclusions and gated-board visibility.
- Browser fixture: 120 local jobs, 50 per page. Pagination retained the count with an intentionally uncached count endpoint. No additional requests on Next/Next/page jump. React development Strict Mode made two initial requests; none were caused by navigation.
- Local browser transitions: 375/171 ms for company search; 574/324 ms for Canada plus the user's role/experience filter combination, restricted to the fixture company and sorted newest. These are local observations, not a production latency guarantee or p95 benchmark.
- Expanded groups exposed all 50 original entries; collapsed view had 48 rows for a three-posting group. Selection, detail URL, keyboard navigation and selected-entry visibility after collapse passed. Desktop panels had matching heights; 390px mobile viewport had no document overflow.
- Screenshots: `output/playwright/pagination-grouped-desktop.png` and `output/playwright/pagination-grouped-mobile.png`.

## Rollout and remaining data work

Production inspection was read-only. This patch has not been deployed and does not delete or merge canonical jobs, saved jobs, applications or packages.

After deployment, refresh the public summary and recheck the exact user search on production. The summary metric remains `JobFeedSummaryCache.liveJobCount`; lifecycle counts are not a replacement.

Existing refrigeration labels need bounded metadata reclassification/reindexing; changing extraction rules alone does not rewrite stored labels. Inspect the dry-run from `scripts/backfill-job-metadata.ts` before applying a narrowed repair.

Historical custom-site collisions need fresh source evidence. Re-fetch and reconcile the affected URLs with the new identity code before retiring superseded mappings. Do not blindly normalize from potentially overwritten raw snapshots, or bulk-merge matching posting IDs: the audit demonstrates those IDs can cross employer boundaries. Preserve user-linked records and use existing canonical/source repair tooling only on reviewed IDs.

Grouping currently operates within each page. Broader cross-page employer/title consolidation would change pagination and count semantics and needs a dedicated persisted grouping design. Distinct requisitions remain intentional, even where their text is similar.
