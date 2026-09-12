# ApplyOverflow Platform Audit

Audit window: September 11-12, 2026 (UTC). Local revision: `a86cf58` on `main`.

This is an implementation audit with browser tests and read-only production checks, not a completed security certification or a full rewrite. Application code, production data, and production services were not changed during this audit. Findings distinguish reproduced behavior from code-level risks and proposals.

## Executive Assessment

Keep the modular monolith, PostgreSQL, and existing worker model. The immediate problems are inconsistent policy enforcement, correctness gaps between shared components and their consumers, excessive work in request handlers, and insufficient deployment isolation. Moving to microservices would not fix these issues.

The most important fixes are:

1. Upgrade the vulnerable framework and enforce resource budgets at the service boundary.
2. Apply the intended job-scope policy during intake and publication.
3. Make full descriptions lossless; separate summaries from original content.
4. Separate shared job data from per-user state in the feed cache.
5. Make mobile job selection navigate to a visible detail view.
6. Add behavioral integration tests and a health-gated deployment pipeline.

### Availability Caveat

Production responded during the earlier inspection. Final HTTPS and SSH checks timed out around September 12, 03:20-03:23 UTC, while a control request to GitHub succeeded. This establishes a current reachability problem from the audit machine, not its cause or a confirmed global outage. No restarts were attempted. Check the provider console, host/network health, and independent uptime monitoring before deploying.

## High-Priority Findings

### F01 - P1: The Deployed Framework Has an Applicable Security Advisory

**Evidence:** `package.json:142` pins Next.js `16.2.7`; the production container reported the same version. The application uses App Router and Server Actions.

The Next.js maintainers describe an unauthenticated CPU-exhaustion issue affecting this configuration and versions below `16.2.11` on the 16.x line. See the [official Server Actions denial-of-service advisory](https://github.com/vercel/next.js/security/advisories/GHSA-m99w-x7hq-7vfj). No exploit request was sent.

The saved `npm audit --omit=dev` snapshot reported 39 vulnerable package entries: 1 critical, 27 high, 9 moderate, and 2 low. These are dependency findings, not 39 proven exploitable paths. The audit suggested Next `16.3.5`; select and test a supported patched version against the full advisory set before release.

Better Auth `1.6.14` also needs review and updating. Its [magic-link/email-OTP account-takeover advisory](https://github.com/better-auth/better-auth/security/advisories/GHSA-qq9h-g4jm-xgf3) requires plugins that are not enabled in the inspected configuration, so this audit does not claim that specific takeover is reachable.

**Fix:** Targeted framework/auth updates, locked dependencies, authentication regression tests, and a production-build smoke test. Do not apply `npm audit fix --force` indiscriminately. Remove development tooling from the web runtime image.

### F02 - P1: Excluded Job Categories Are Defined but Not Enforced

**Evidence:** `src/lib/ingestion/normalize.ts:597` defines `EXCLUDED_TITLE_PATTERNS`, but `normalizeSourceJob` at line 658 never applies it. The definition and its tests exist without an intake call site. `src/lib/queries/jobs.ts:312` returns an empty global visibility predicate. Default visibility does not enforce the North America/white-collar product policy.

**Reproduction:** Valid source payloads titled `Forklift Operator II`, `Grocery Clerk Part Time Day`, and `310T Apprentice Mechanic` all matched the exclusion patterns and were still accepted by normalization.

**Production observation:** The public feed sample included grocery/food-service and forklift roles. It also included a job located in Kediri, Indonesia and a job located in King Abdullah Economic City. These are concrete product-scope violations, not merely weak recommendation scores.

**Impact:** Users see irrelevant inventory; ranking and supply metrics can look healthy while useful coverage is worse. Tightening publication policy can legitimately reduce the public count, so a falling count alone is not proof that ingestion is failing.

**Fix:** A single explicit eligibility policy used by normalization and publication, with structured geography and auditable rejection reasons. Preserve TECH, FINANCE, and all supported GENERAL knowledge-worker roles. Test ambiguous roles and unknown locations separately. Assess existing inventory in a non-destructive report before changing publication status; retain saved jobs, submissions, and packages.

### F03 - P1: AI Server Actions Bypass API Quotas

**Evidence:** `src/app/profile/resume-builder-actions.ts:310` exposes `generateResumeEntryVariation`. It authenticates, validates ownership, and checks readiness, but calls AI generation at line 373 without the quota checks used by AI API routes. `requireAiFeatureAccess` is an access check, not a cost budget. The completion provider does not enforce a shared budget either.

The PDF generation action also needs a concurrency budget. A timeout bounds one operation, not the number of concurrent operations. `src/lib/api-rate-limit.ts:26` stores counters in a process-local map; multiple processes have independent allowances and restarts reset them.

**Impact:** Authenticated users can consume unbounded paid-generation capacity or contend for CPU through an unmetered transport. Scaling web replicas also changes effective API limits.

**Fix:** Enforce an atomic per-user usage budget, global cost/concurrency ceiling, and bounded queue inside the AI/document service used by both routes and Server Actions. Use shared state with explicit fail behavior. Keep transport-level burst limits as an additional defense.

**Validation status:** Confirmed by call-path inspection; no paid-generation or overload attack was performed.

### F04 - P1: The SSRF Guard Does Not Pin the Validated Address

**Evidence:** `src/lib/ingestion/net/ssrf-guard.ts:275` validates the hostname's DNS answers, then line 277 calls `fetch` with the original URL. The connection resolves the hostname independently. The import action in `src/app/applications/[id]/actions.ts:618` can fetch a user-supplied application URL through this path.

Existing private-address and redirect checks are useful, but checking one DNS answer does not constrain the destination of the subsequent connection. A changing DNS answer can undermine the intended boundary.

**Fix:** Connect through a server-side HTTP dispatcher that pins an approved resolved address while preserving Host/TLS hostname verification. Revalidate each redirect, restrict unexpected ports, and add network-level egress restrictions. Test rebinding using a controlled resolver/fetch test double, not production internal endpoints.

**Validation status:** Code-level check/use gap; exploitation was not attempted.

### F05 - P1: Full Job Descriptions Can Silently Lose Requirements

**Evidence:** `src/lib/job-description-format.ts:1200` calls the summary builder before producing display blocks. The builder limits sections, list items, paragraph count, and paragraph length. Compaction removes additional short entries and trims text. Both the master-detail view and the full detail page use the helper.

**Reproduction:** A description containing ten distinct mandatory requirements parsed into ten list items but rendered only six; the tenth requirement was absent. The UI calls this a job description, not a limited summary.

There is also a presentation regression: `src/components/jobs/job-feed-master-detail.tsx:279` renders `<ul>` without `list-disc`. Browser computed styles reported `list-style-type: none`, so the new bullet layout is displayed as indented prose.

**Fix:** Separate a lossless sanitized full-description representation from an optional, clearly labeled summary. Preserve qualifications, compensation, deadlines, and source wording. Restore bullet markers. Add content-preservation tests, including short but important requirements. Do not use destructive summarization as a formatting operation.

**Deployment status:** The inspected production component/formatter differed from local `main`; this recent formatting change was not present in the inspected deployed files.

## Correctness, Privacy, and Performance Findings

### F06 - P2: Wishlist Mutations Leave the Feed Cache Stale

**Evidence:** `src/lib/queries/jobs.ts:2899` keys cached feed payloads by user and filters, with a five-minute TTL. The payload contains saved/applied state. `src/app/api/jobs/[id]/save/route.ts:11` and the underlying saved-job helpers do not invalidate that cache.

**Reproduction:** Warm the local feed API, save a previously unsaved fixture, then fetch its detail and the cached feed. Save returned 201; detail returned `isSaved: true`; the feed returned `isSaved: false`. The fixture was unsaved afterward. Immediate selection away and back in the same mounted UI passed because client state is updated locally; the confirmed problem is a subsequent cached response.

**Fix:** Cache shared candidate IDs and public job summaries independently from a small user-specific overlay. Fetch or version saved/applied state after mutations. Personalized ordering, hidden-applied filters, and profile-dependent matching must retain their own user/version keys. Never share private payloads across users.

### F07 - P2: Read Paths Repeatedly Write User Profiles

**Evidence:** `src/lib/current-user.ts:126` delegates profile resolution to `syncProfileForAuthUser`. `src/lib/user-profile-sync.ts:23` unconditionally updates an existing profile after lookup, even when name/email/auth ID have not changed. Feed/auth/rate-limit paths can repeat session and profile resolution within one request.

**Impact:** A browsing request can produce avoidable database writes, WAL, index activity, and connection occupancy before reaching a feed-cache hit.

**Fix:** Make normal profile retrieval read-only. Sync on user creation/account changes, or only when actual fields differ. Deduplicate session/profile resolution within the request, without globally caching a user's identity. Measure query counts for the complete request, including middleware and quota checks.

### F08 - P2: Feed Responses Include Every Full Description

**Evidence:** `src/lib/queries/jobs.ts:211` includes full descriptions in the card selection. A production default-page API sample returned 50 rows and 368,629 decoded response bytes; descriptions accounted for 289,586 characters. Only one detail is visible at a time.

**Timing samples:** The default request completed in about 783 ms. One software-engineer title query took about 5.48 seconds. These are individual requests, not p95 measurements or a load test; they identify investigation targets, not a proven database root cause.

**Fix:** Return a minimal list DTO and fetch/cache the selected detail separately, optionally prefetching adjacent selections. Keep instant first-job display with a small initial detail payload. Inspect query plans for representative selective and broad filters before adding indexes or changing database technology.

### F09 - P2: Detail Rendering Can Wait on External Description Repair

**Evidence:** `src/components/jobs/job-description-section.tsx:42` awaits external description fetching when stored text is poor. `src/lib/job-description-fetch.ts` uses uncached requests, 15-second attempt timeouts, and retries. Multiple candidates are considered. A slow source can put roughly two attempt windows on the render path; this is not a strict end-to-end bound, particularly for DNS.

**Fix:** Repair and persist descriptions in a bounded background worker with source/content-version keys and negative caching. Render available stored content immediately and isolate optional enrichment behind a loading boundary. Do not repeatedly recrawl employer sites on user navigation.

### F10 - P2: AI Search Silently Loses Some Constraints

**Evidence:** `src/components/jobs/jobs-search-form.tsx:500` consumes `searchResult.params`, ignoring exclusions, soft preferences, and warnings. `src/app/jobs/top-picks/page.tsx:509` forwards title, company, location, work mode, and experience only.

**Reproduction:** The parser interprets "software engineer in Toronto paying over $120k posted this week" into location, function, salary, and recency parameters. The Picks query does not receive the latter three. "Marketing jobs but not sales" produces an exclusion that the shared form does not apply.

**Fix:** Define one typed filter contract shared by the interpreter, URL, filter UI, and each query. Either implement each constraint on Picks or explicitly show that it is unsupported. Display interpretation chips and warnings. Test the resulting query behavior, not just parser output or URL strings.

### F11 - P2: Recovery Links Can Be Written to Logs

**Evidence:** `src/lib/auth-password-reset.ts:69` logs the email address and complete reset URL when delivery fails. The account-email-change flow has similar fallback logging in `src/lib/auth.ts`. There is no production-only redaction guard on these messages.

**Fix:** Log an opaque event ID and delivery failure category, not bearer links. Development-only previews must be explicitly gated. Add log-redaction tests without generating real customer recovery links.

### F12 - P2: Storage Deletion Failures Are Swallowed

**Evidence:** `src/lib/storage/index.ts:271` awaits `Promise.allSettled` without examining rejected results. Account deletion in `src/lib/auth.ts:100` also ignores failed document deletions.

**Impact:** An account or database record can be deleted while its uploaded documents remain in object storage, with no durable retry recorded.

**Fix:** Use a durable deletion outbox with idempotent retries and monitoring. Preserve a cleanup task until storage confirms deletion. Account deletion can be asynchronous, but its completion state must not imply the files have already been removed.

**Validation status:** Failure-path code inspection only; no account or production document was deleted.

## User Experience Findings

### F13 - P2: Mobile Selection Updates Content Outside the Viewport

**Evidence:** `src/components/jobs/job-feed-master-detail.tsx:59` becomes a stacked list/detail layout below the desktop breakpoint; selecting a row only updates React state at line 76.

At 390 x 844, after selecting a job, the detail panel started at approximately y=1212 and was below the viewport. There was no focus transfer, scroll-to-detail, or mobile detail navigation. A tap can appear to do nothing.

**Fix:** On mobile use list-to-detail navigation or a full-height detail sheet with an obvious back action. Restore the previous list position on return. Preserve the split view on desktop.

**What passed:** At 1440 x 1000 both panels measured 832 px; at 1280 x 720 both measured 640 px. No horizontal page overflow occurred at the three tested sizes. Do not treat desktop panel-height alignment as an outstanding regression based on these tests.

### Other UX Improvements

- Reduce duplicated company, salary, and work-style metadata in the detail header so more description is visible immediately.
- Give the result list more first-viewport space; operational feed statistics and repeated headings consume considerable height.
- Keep meaningful empty states distinct: incomplete profile, loading, failed refresh, no matches, and genuinely empty inventory.
- The local empty-profile Picks gate was clear and did not remain on an endless initial spinner. Generation for a ready profile still needs an end-to-end worker test.
- `src/app/documents/resume-builder/page.tsx:65` nests a `main` landmark within the application layout's `main`; the browser detected two. Use a section for the inner surface and test keyboard/focus behavior across dialogs.
- Use semantic headings and actual list markers consistently across full-page and split-view descriptions.

## Deployment and Capacity

Earlier read-only production snapshot, not current availability:

| Observation | Value |
| --- | --- |
| Public-board metric | `JobFeedSummaryCache.liveJobCount = 516,412` |
| Metric timestamp | September 11, 22:50:48 UTC |
| Root filesystem | 150 GB total; 122 GB used; 23 GB available; 85% used |
| Attached filesystem | 69 GB total; 28 GB used; 38 GB available; 42% used |
| PostgreSQL logical database size | Approximately 124 GB across its storage layout |
| Docker images | 11.15 GB; 3.373 GB reported reclaimable |
| Docker build cache | 0 bytes |

The database size overlaps filesystem usage and must not be added to it. The attached volume has useful headroom but cannot hold a blind copy of the entire reported database. Move only measured candidates with a verified migration/rollback procedure, or provision appropriate capacity first. Do not solve the space issue with unbounded pruning or `VACUUM FULL`.

App, Caddy, PostgreSQL, and workers were running in the earlier snapshot; the maintenance worker included the top-picks process. PostgreSQL did not show a connection-saturation event in that sample. One worker/DB CPU sample was busy, but it is insufficient to establish sustained overload. Staging also shares the host.

**Release discrepancy:** Production component hashes and source contents differed from `main`. The remote deployment is an rsynced directory without `.git`, so its revision cannot be reliably identified by running `git rev-parse` there. Add a build SHA to the image, health response, and logs.

**Deployment risks:** `Dockerfile:1` uses a shared web/worker runtime, copies the full dependency tree, installs Chromium, and does not switch to a non-root user. The compose configuration lacks app/worker resource budgets and an application readiness check. `deploy/single-vps/rebuild.sh:64` force-recreates selected services, including Caddy by default, without a health-gated traffic switch and rollback.

**Fix:** Separate lean web and browser-worker images; run non-root; allocate CPU/memory/connections per process; build immutable SHA-tagged images outside the production data host; validate readiness before switching traffic; keep a known-good rollback image. Keep operational changes separate from UI deployments.

## Recommended Code Structure

Keep existing Prisma models and route entry points. Refactor incrementally around behavior, rather than moving files solely to reduce line counts.

| Boundary | Responsibility |
| --- | --- |
| Authentication/session | One request-scoped identity resolution, read-only profile lookup, ownership enforcement |
| Job scope policy | North America/occupation scope, publication eligibility, explicit reasons |
| Job read model | Typed filters, query planning, public card DTOs, detail retrieval |
| User job state | Saved/applied/hidden overlays and transactional mutations |
| Recommendations | Profile versioning, refresh scheduling, shared filter contract |
| Description content | Pure parsing/sanitization, lossless full display, optional summary |
| Source enrichment | Network fetch, repair queue, retry and content-version persistence |
| AI/documents | Shared quotas, concurrency limits, generation and deletion outboxes |

`src/lib/queries/jobs.ts` is about 3,720 lines and mixes selection, predicates, search paths, ranking, caching, and result hydration. Start by extracting pure filter normalization and DTO construction behind existing exports, then separate shared candidate queries from user overlays. Large ingestion/discovery and tracker modules need the same ownership-based treatment, but not all in one release.

### Scalable Read Path

1. Normalize a filter request into a canonical typed key, including visibility policy and data version.
2. Reuse a shared candidate-ID/card cache for non-personalized queries; coalesce simultaneous misses.
3. Fetch the current user's small saved/applied overlay in one bounded query.
4. Apply separately versioned personalized ranking where required. Do not force personalized results into a global cache.
5. Load the selected description separately; persist enrichment outside requests.
6. Bound database connections across every web replica and worker. Add a read replica or search index only after query-plan and traffic measurements justify it.

Different users do not need separate copies of the job table. They need shared searchable job data, correctly isolated personal state, and an explicit budget for expensive personalized work.

## Verification Performed

| Check | Result |
| --- | --- |
| `npm run test:unit` | 738 passed; 0 failed |
| `npm run typecheck` | Passed |
| `npm run lint` | 0 errors; 2 unused-parameter warnings |
| Local sign-in | Passed with the existing development account |
| Jobs default selection and switching | Passed |
| Wishlist save/remove and same-view reselection | Passed; fixtures restored |
| Cached wishlist response after mutation | Failed as described in F06 |
| Title search and remote filter | Passed on fixture data |
| Default filter badge | No erroneous default count in the tested local view |
| Shared AI-search control | Passed after correcting the test selector |
| Picks for incomplete profile | Correct profile-readiness gate |
| Applications, notifications, documents, profile, settings | Authenticated navigation smoke checks passed |
| Resume builder | Rendered; duplicate-main accessibility issue observed |
| Desktop/mobile geometry | Desktop equality passed; mobile discoverability issue reproduced |
| Initial browser runtime errors | None observed |
| Production private endpoints | Resume list, settings export, and Picks status returned 401 unsigned |
| Production jobs page | Redirected unsigned visitor to sign-in |
| Production jobs API | Public read worked, consistent with its configured policy |
| Final production reachability | HTTPS and SSH timed out from this machine |

Two initial browser script failures were test issues: the AI submit button has the accessible name `Run AI job search`, not `Search jobs`, and a broad `main` lookup was ambiguous on the resume builder. Follow-up checks used the correct selectors. The nested landmarks remain an accessibility finding; the selector failure itself is not a broken feature.

Tests do not prove the absence of vulnerabilities. There is no checked-in end-to-end suite or CI workflow in the inspected tree. A meaningful subset of unit tests asserts source text, so passing tests can miss a policy helper never being called. New integration tests should exercise normalization-to-publication, cache invalidation, AI limits through both transports, filter parity, and description content preservation.

### Scope Limits

- Production inspection was read-only and unsigned at the browser/API layer. Authenticated interactive tests used local fixture data.
- No real applications were submitted; no paid AI generation, password reset email, destructive account operation, or production exploit was triggered.
- No production load test, restore drill, DNS-rebinding exploit, or full ready-profile recommendation-worker cycle was performed.
- Local wishlist test mutations were reversed. A local behavior event can remain from the save test.
- The production build was not rerun in this audit; unit tests, lint, and typechecking are not substitutes for a release build.
- Final connectivity failures prevented a fresh end-of-audit host/queue snapshot. Earlier successful measurements are timestamped and must not be presented as current health.

## Delivery Order

1. Resolve the current production reachability uncertainty. Independently verify host and network health; do not infer a root cause from the timeouts.
2. Security patch: framework/auth dependencies, shared AI budgets, recovery-link redaction, pinned-address egress, durable deletion retries.
3. Correctness patch: scope enforcement, full-description preservation, filter parity, and saved-state cache invalidation, each with regression tests.
4. UX patch: mobile detail navigation, description list styling, compact detail headers, and landmark cleanup.
5. Efficiency patch: read-only identity resolution, minimal feed payloads, async enrichment, shared candidate caching, and measured query improvements.
6. Release engineering: CI behavioral tests, immutable builds, visible revision, isolated worker resources, readiness checks, rollback, and a staging-only workload test with realistic filters.

Each phase should be independently reviewable and deployable. Do not combine a database storage migration, ingestion-policy change, authentication upgrade, and large UI rewrite in one release.
