# Ingestion Workflow Audit

Date: 2026-09-12

## Scope and Evidence

Traced source registry admission, poll queues, connector fetches, raw storage,
normalization, cross-source matching, lifecycle reconciliation, feed indexing,
and the count displayed by `/jobs`. Changes are local and not deployed.
Production SSH to the configured VPS timed out. Local data and fixtures are not
evidence of current production source coverage or growth.

The existing design already includes discovery, validation, family admission
caps, provider backoff, and reserved retention polling. Increasing every worker's
concurrency would not address the correctness failures below.

## Findings Fixed

| Failure | Effect | Change |
| --- | --- | --- |
| Connectors could return `metadata.error` without throwing, and ingestion recorded SUCCESS. | False successful polls reset failure state and advance source success timestamps. | Persist useful partial results, then fail the run. Existing source backoff receives the error. Store `fetchFailed` and `partialFetch` run diagnostics. |
| SmartRecruiters detail fetching used a tech/finance-oriented title allowlist and case-sensitive country codes. | Many GENERAL roles received category labels instead of actual descriptions. | Use shared excluded-role and geography policies. Eligible marketing, sales, HR, legal, customer-success and other knowledge-worker roles receive detail requests. Explicit foreign countries and excluded titles still avoid detail requests. |
| One SmartRecruiters detail rejection failed `Promise.all` for the entire source. | Other successfully fetched positions were discarded. | Retain successful rows; mark incomplete snapshots non-authoritative; stop new batches after throttling or other non-missing-detail failures. Continue past individual 404/410 details. |
| SmartRecruiters pagination lacked progress and response-shape checks. | Repeated or malformed pages could waste the run or discard earlier pages. | Deduplicate listing IDs, reject stalled pagination, preserve earlier pages after later-page failure, and explicitly report exhaustion. Validate detail posting identity. |
| New cross-source cluster/similarity matches bypassed the existing seniority-conflict guard. | Distinct junior/mid/senior vacancies could be merged. | Apply the guard in both candidate queries and scoring; make bounded candidate selection deterministic. Exact posting identity remains stronger than inferred seniority. |
| Raw envelopes omitted structured work mode and employment type. | Replays lost provider facts; field-only changes looked unchanged. | Persist both fields and include them in existing change detection. Timestamp-only refreshes remain unchanged. |
| Direct ingestion ran normalization twice, separately for staged and canonical records. | Duplicate extraction/classification work and opportunity for fact divergence. | Normalize the persisted raw payload once and reuse the result for staging and canonical ingestion. Other staged callers retain their existing normalization path. |
| Feed indexing ran before final lifecycle state and was skipped for unchanged refreshes. | Revived jobs could remain hidden, while lifecycle/index state drifted. | Reconcile then publish each usable row, including unchanged and explicitly dead postings. Reconcile removed/reassigned mappings too. Earlier rows stay published if a later row fails. |
| Supply reporting used broader feed-index counts for public target calculations. | Internal lifecycle changes could be mistaken for the public-board trend. | Headline `JobFeedSummaryCache.liveJobCount`, expose its computation time, warn after 15 minutes, label internal diagnostics non-public, and remove the unsupported public growth ETA. |

SmartRecruiters' public API distinguishes posting lists from posting details;
the latter includes titled description sections with HTML formatting. The
connector now preserves those sections through the shared HTML-to-text parser,
without generating or inventing description content.
[Posting endpoints](https://developers.smartrecruiters.com/docs/endpoints),
[Posting objects and sections](https://developers.smartrecruiters.com/docs/objects).

## Verification

| Check | Expected | Result |
| --- | --- | --- |
| GENERAL-role detail fixture | All six supported role fixtures get full descriptions | 6/6; one listing request and six detail requests |
| Single missing detail in ten listings | Other rows survive; no authoritative snapshot | 9 retained; `exhausted=false` |
| Throttled first detail batch | Do not start the next batch | At most eight detail requests; seven successful rows retained in fixture |
| Later malformed/repeated listing page | Preserve earlier unique rows and terminate | Passed |
| Distinct known seniority, same stripped title/location | Do not merge via cluster or similarity | Both paths passed; exact-identifier matching retained |
| Raw replay and field-only edits | Same normalized facts; detect changed work mode/type | Passed |
| Real local PostgreSQL integration | New jobs, unchanged revival, field edits and closure reach the feed index | Passed |
| Partial/429 source results | FAILED run, successful rows retained, unseen mappings preserved | Passed |
| Invalid later row | Earlier usable job is already in the feed | Passed |
| Local seven-run integration fixture | Exercise actual persistence, not mocked Prisma | Approximately 0.75 seconds with a warm local database; no real provider requests |
| Unit suite, typecheck, scoped lint | No regressions in automated checks | 805 unit tests passed; TypeScript and scoped ESLint passed |

The integration timing is a regression baseline, not a production throughput
claim. Tests delete only their uniquely named local fixtures. No live jobs,
saved jobs, submissions, packages, or production storage were cleaned up.

Commands:

```sh
npm run test:unit
npx tsc --noEmit
node --env-file=.env.local --import tsx tests/integration/ingestion-feed.ts
node --env-file=.env.local --import tsx scripts/report-supply-health.ts --json
```

## Rollout and Remaining Checks

1. Deploy through the normal release process after reviewing the existing dirty
   worktree. These changes need no schema migration of their own. Other pending
   project changes do have migrations and must be reviewed independently.
2. Expect one re-normalization on the next poll of old raw records because the
   two newly persisted fields were previously absent. Do not run an unbounded
   whole-database repair or raise concurrency at the same time.
3. Run the existing `supply:health`, source-efficiency and priority-company
   coverage reports in production. Compare public summary snapshots over time,
   and inspect per-source successful, failed, partial, fetched, accepted, created,
   and deduplicated counts separately. Counts of lifecycle transitions are not
   a substitute for public-board history.
4. The high-yield pass still excludes SmartRecruiters by default; the regular
   source poller has bounded SmartRecruiters admission. Verify its production
   queue progress and runtime before increasing its budget. No new unverified
   sources were enabled in this patch.
5. Target zero erroneous source invalidations from missing detail pages, zero
   lost successful rows in partial-fetch tests, feed publication within the
   processing run, and a public summary cache age below 15 minutes. Monitor
   source freshness against configured cadence, especially high-value sources
   approaching the 14-day evidence window.
6. This prevents new seniority-conflict merges; it does not retroactively split
   historical merged jobs. Such a repair needs an evidence audit and explicit
   handling of saved jobs and application associations.
7. Long-running connector cancellation still honors the existing runtime abort.
   Large boards need production timing and checkpoint-coverage checks before
   changing cursor semantics or admitting additional sources. Full production
   coverage and the contribution of each defect to the decline remain unverified.
