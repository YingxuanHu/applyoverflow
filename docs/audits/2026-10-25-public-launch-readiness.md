# ApplyOverflow Public Launch Readiness

Assessment date: October 25, 2026. Production observations were taken around 16:00-16:15 UTC.

This is the pre-hardening baseline. See [the execution record](2026-10-25-launch-hardening.md)
for subsequent changes and verified runtime status. The owner has deferred public
launch until isolated recovery testing is funded.

## Decision

**Not ready for an unrestricted public launch or a substantial acquisition campaign.** The site is already online, but availability today is not evidence that it can safely handle growth. A deliberately limited beta is the appropriate next stage **after the immediate disk and dependency risks are addressed**. Keep autonomous submission more restricted than discovery and assisted filling.

The foundation is substantial: authentication controls, account-scoped document access, shared generation budgets, guarded outbound requests, lifecycle-aware job ingestion, a real compatibility harness, and a large regression suite. This is not a recommendation to rewrite the application or adopt microservices. The priority is operational safety, enforced release verification, measured capacity, and complete user journeys.

No responsible assessment can promise every employer website or every user situation will be bug-free. A credible promise is: supported behavior is measured, unsupported behavior is explained, user work is preserved, and failures are detected and repaired systematically.

## Scope And Evidence

- Reviewed representative authentication, storage, resume parsing, database, extension recovery, deployment, monitoring, backup, benchmark, and CI code.
- Inspected production health, installed Next.js version, disk and memory usage, container statistics, database configuration, backup logs/schedule, and the latest supply-health report using read-only operations.
- Inspected GitHub's latest Verify failure and effective protection of `main`.
- Ran the local unit suite: **1,107 tests passed, 0 failed**. A focused 53-test security/recovery subset also passed; those tests are included in the full-suite count, not additional coverage.
- Ran `npm audit --omit=dev --json`: **24 vulnerable package entries: 2 critical, 18 high, 4 moderate**. These are dependency findings, not 24 proven remotely exploitable vulnerabilities.
- Production health returned revision `983698526368fedfd19fc816b30b4b61d2a3f4af`; current main is `6f68c613813652eda81cbf54ea888fdd68efab59`. There are also pre-existing uncommitted extension changes. Source, deployed backend, downloaded package, and installed extension must not be treated as the same release.
- Historical browser benchmark artifacts were inspected, not rerun. There was **no fresh full signed-in user-journey pass, load test, penetration test, restore rehearsal, employer submission, or production mutation** in this assessment.

## Prioritized Findings

### F01 - Critical: Production root storage is almost exhausted

**Verified runtime:** `/dev/sda1` reports 150 GB total, 143 GB used, **1.2 GB available**, rounded to 100% utilization. The attached volume reports 148 GB total, 62 GB used, 79 GB available. PostgreSQL's active data directory is `/var/lib/postgresql/18/docker`.

**Evidence:** `deploy/single-vps/docker-compose.yml:24` mounts the main cluster in a Docker named volume; lines 26-29 explicitly leave the primary cluster on root and move selected indexes to the attached volume. The host monitor repeatedly logs the root-disk alarm.

**Impact:** Database growth, WAL, temporary files, or ordinary container writes can exhaust the remaining space and interrupt writes, login, application tracking, or recovery. The attached volume does not automatically absorb root writes. Suppressing the root warning would hide a real risk.

**Required:** Inventory storage growth and peak temporary/WAL requirements; reduce nonessential growth; provision enough attached capacity for the cluster, migration overhead, and backup staging; migrate the growth-heavy data with a verified backup and rollback procedure, or use a suitably sized managed database. Verify mount persistence and permissions. Do not perform an unplanned live directory move, destructive prune, or space-intensive `VACUUM FULL`.

**Exit evidence:** Root and database storage have documented headroom and growth alerts; a load/maintenance cycle cannot consume the reserve. Proposed initial operating target: at least 20% usable headroom on growth volumes, adjusted to actual write and maintenance bursts.

### F02 - High: Production runs a framework version covered by current security advisories

**Verified runtime:** Next.js **16.3.5**, React 19.2.4. `package.json:185` pins the same Next.js version. Server Actions are used, for example in `src/app/profile/actions.ts:1`.

The upstream advisory published October 14 identifies unauthenticated requests against App Router applications with Server Actions as capable of blocking request processing through CPU exhaustion. Version 16.3.5 is within the affected range; the fix for this advisory starts at 16.4.1. [Next.js advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r).

**Impact:** This application matches the documented feature configuration for an availability vulnerability. No exploit was run. Other audit entries, including critical Next.js findings, require feature-specific reachability analysis; they are not proof that this deployment is exploitable through every listed path.

**Required:** Upgrade to a currently patched compatible release, synchronize framework tooling, rebuild the actual production image, rerun auth/rendering/extension/PDF checks, and verify the running version. The audit currently suggests 16.4.3. Triage the remaining dependency graph separately, including worker dependencies. Move build-only CLI packages out of runtime dependencies where appropriate. Do not use an indiscriminate forced major upgrade as the fix.

**Exit evidence:** No unaddressed reachable high/critical advisory in the released artifacts, with documented exceptions for findings shown not to be reachable. Add scheduled dependency scanning and an urgent-patch procedure.

### F03 - High: Failing CI and unprotected main do not enforce a release gate

**Verified GitHub:** Latest Verify run `39897473928` failed at `extension:test:workspace` with `Unexpected API: onboarding-event`. The six most recent inspected Verify runs failed. GitHub returned "Branch not protected" for classic protection and an empty effective rules array for `main`.

**Evidence:** [Failing run](https://github.com/YingxuanHu/applyoverflow/actions/runs/39897473928); `scripts/test-auto-apply-workspace.mjs:47`; `.github/workflows/verify.yml:53`. Later integration, typecheck, lint, build, and browser checks do not run after that failing step. `deploy/single-vps/rebuild.sh:111` performs useful candidate runtime checks, but does not require a successful full GitHub verification of the release SHA.

**Impact:** A passing local unit suite does not prevent shipping an integration regression. A test mock that is out of date is still a broken release gate, not a reason to bypass the gate.

**Required:** Correct the test/API contract without weakening its assertions. Require successful PR checks and an enforced merge policy. Build immutable release artifacts once, promote the same artifacts through staging and production, record backend/extension/schema compatibility, and allow emergency bypass only through an explicit audited procedure. Add the search/location and activity browser checks to the required suite where missing.

**Exit evidence:** The exact release passes the complete pipeline, can be traced to the deployed image/package, and has a tested rollback path.

### F04 - High: Backup creation works; recovery objectives are not demonstrated

**Verified runtime:** The daily 07:15 UTC backup job ran October 25 and logged successful object-storage upload. The dump began at 07:15 and upload began around 08:47; the log was updated around 09:03. Backup creation alone takes material time. PostgreSQL `archive_mode` is **off**, so this instance is not providing continuous WAL archiving for PITR.

**Evidence:** `deploy/single-vps/backup-to-storage.sh`; `deploy/single-vps/restore-from-storage.sh:65` takes a pre-restore backup, then lines 70-80 restore into the target database with `--clean` and apply migrations. The script does not quiesce app/workers and does not request fail-fast/transactional restore. No current timed restore-drill result was established in this assessment.

**Impact:** Daily logical backups leave approximately a backup interval of potential data loss, plus completion/failure lag. A failing restore can leave a partially restored target even though the script exits unsuccessfully. A successful upload does not prove the account data, documents, permissions, and application all recover together.

**Required:** Restore an actual backup into an isolated new database/host, check integrity and key user journeys, reconcile object storage, and measure recovery time. Define separate database and document recovery plans. Test loss of the whole VPS, not just the app container. Verify backup access, retention, encryption, and protection from accidental deletion; these provider-side properties were not verified here. For production cutover, stop writers or restore to a new target and switch traffic through a controlled procedure.

**Proposed objectives, not current guarantees:** RPO <=15 minutes for account/application data and RTO <=2 hours. If the dataset cannot support those economically, choose and disclose a different objective based on a measured drill. PITR or a managed database may be the most direct route. Keep periodic logical backups as a complementary recovery mechanism.

### F05 - High: User-facing capacity has not been established

**Verified runtime sample:** 4 CPU cores, about 7.6 GiB RAM, approximately 2.8 GiB available, about 3.0 GiB swap occupied, load averages around 4.3-4.7. Swap occupancy does not by itself prove active thrashing. Web, production database, ingestion, source workers, maintenance, staging, and a build service share the host. Container samples are not a traffic benchmark.

**Evidence:** `deploy/single-vps/docker-compose.yml:40`, `:63`, `:85`, `:107`; `src/lib/db.ts:108` defines useful role-specific pool defaults, including six web connections. `src/lib/resource-budget.ts:6` provides shared limits of eight simultaneous AI operations and two PDF operations. These are configured safeguards, not measured throughput.

**Impact:** Background polling, backup I/O, parsing, and foreground searches compete for resources. There is no defensible current answer to "how many concurrent users can it serve?" A fast `/api/health` response is only a successful `SELECT 1`, not a search or application-workflow benchmark (`src/app/api/health/route.ts:9`).

**Required:** Load-test a production-shaped isolated dataset and workload; measure throughput and p50/p95/p99 latency while ingestion and backup-like I/O run. Reserve resources for interactive work, enforce container/worker budgets, move builds and eventually staging off the production host, and use queue/backpressure states for expensive work. Size aggregate connection pools across all worker processes before adding replicas. Keep the modular monolith until measurement justifies architectural changes.

### F06 - High: Detection exists, but alert delivery and journey observability are incomplete

**Verified:** Health alarms are written locally every five minutes. `MONITOR_ALERT_WEBHOOK_URL` is absent in the inspected compose production environment; delivery through a separate environment or external monitoring provider was not established. Do not interpret this as proof that no external service exists.

**Evidence:** `deploy/single-vps/monitor-health.sh:124` always logs, while lines 127-132 notify only with a configured webhook. The script cannot report a dead host from that same host. `src/lib/onboarding-events.ts:3` is a useful privacy-bounded event schema, but its existence on main is not evidence of deployed end-to-end instrumentation. No general frontend/backend exception-monitoring integration was located in the reviewed source.

**Impact:** You can learn about a broken workflow from the next frustrated user rather than from a useful alert. Raw local logs do not tell you completion rate by platform, extension version, field family, and failure cause.

**Required:** Verify an off-host uptime and synthetic-journey monitor, test actual alert receipt, centralize structured redacted errors, attach correlation/run/release IDs, and report user-visible success and recovery rates. Alert on backup age/failure, error-rate changes, latency, disk growth, queue age, freshness failures, and spending. Use deduplication and recovery notifications, not endless identical disk messages.

### F07 - High: Broad autofill tests are not full-application reliability evidence

**Historical evidence:** `output/playwright/autofill-benchmark/release-0151-summary.json`, dated October 13, attempted 220 URLs and measured 157 forms. It recorded 97.59% contact-oracle retention and 97.39% planned-value retention, with **zero authenticated applications and zero completed applications**. Do not add counts from successive reruns as distinct sites or apply these scores to today's different code.

**Evidence:** `docs/development/autofill-benchmark.md:35` explains the metrics. Lines 59-70 explicitly exclude sign-in, file uploads, AI calls, and full multi-step verification from the bulk runner. `.github/workflows/autofill-benchmark.yml:3` is manually triggered. The documented Workday results at `docs/development/autofill-benchmark.md:213` distinguish many login probes from a small number of measurable forms and partial authorized checks.

**Impact:** A high retention score can coexist with a broken resume upload, undiscovered education row, unusable reconnect flow, or low-quality narrative answer. Tests that import the runtime directly do not establish that the packaged extension, real worker, backend contract, permissions, and account all work together.

**Required:** Keep the safe bulk harness, but add packaged-extension end-to-end suites, independent field inventories, history/attachment completion checks, labeled answer-quality evaluations, permission/version-upgrade tests, and an authorized authenticated ATS matrix. Measure detection, answerability, correctness, persistence, and completed workflow separately. Unknown or gated forms must remain visible in the denominator/report, not disappear into a favorable score.

### F08 - High: Feed freshness and label completeness need a dedicated quality gate

**Verified report:** The October 25 16:06 UTC supply-health report is complete and the public summary cache reports **515,430 live jobs**. Its broader internal diagnostic set reports 241,796 of 792,617 LIVE records with source evidence older than 14 days (30.5%). Only 297,471 of 592,261 diagnostic-visible records have a filter-grade role-category label (50.2%). The pending connector-poll queue includes work due the previous day.

**Important scope:** The report explicitly says these diagnostic sets are **not the filtered public `/jobs` pool**. These numbers do not establish that 30.5% of public listings are expired or that half of public filters fail. They identify a substantial verification and labeling backlog requiring a public-pool-specific audit.

**Evidence:** `scripts/report-supply-health.ts:314`, `:532`, `:557`; production `logs/supply-health-2026102516.json`.

**Required:** Measure freshness and taxonomy completeness on the exact public query predicates; manually validate a stratified sample of displayed listings. Prioritize retaining trustworthy supply over expanding source counts. Revalidate availability before queueing/submission, separate temporary source failures from confirmed closure, and preserve saved/application history when removing a job from discovery. Audit country-wide and multi-city filters against independently labeled jobs, including remote eligibility restrictions. Unknown metadata must not silently become a confident mismatch or a promise of eligibility.

### F09 - Medium: Infrastructure failures can be presented as authentication failures

**Evidence:** `src/lib/current-user.ts:67` resolves the session, but its catch-all at lines 101-102 returns `null` for any exception, including a persistent database/auth-service error after retry.

**Impact:** Callers can interpret an infrastructure outage as "not signed in." Repeated login instructions will not fix a database outage and can make recovery feel arbitrary. This is a code-level failure-path concern, not a newly reproduced production incident or authentication bypass.

**Required:** Preserve the distinction between expired/revoked identity and temporary service failure. Return an actionable unavailable/retry state for the latter; retain drafts, avoid clearing valid connection state, and verify recovery after services return.

### F10 - Medium: Untrusted document parsing lacks a demonstrated independent resource boundary

**Evidence:** `src/lib/profile-resume-service.ts:155` rejects empty/over-10 MB files; `:183` calls ingestion inline. `src/lib/resume-ingestion.ts:552` parses DOC/DOCX/PDF inputs without a visible per-document process deadline, decompression budget, or memory-isolated worker. PDF generation separately uses a timeout and no-shell-escape; that does not bound resume parsing.

**Impact:** Byte-size checks alone do not bound parser CPU, page complexity, or archive expansion. A malformed or unusually complex document could monopolize resources. No malicious-document exploit was attempted.

**Required:** Add file-signature validation, bounded parser jobs in an isolated resource-limited process, page/decompression limits, hard timeouts, cancellation, and retryable status. Test corrupt, encrypted, scanned, oversized, and adversarially complex files without running them against production. Evaluate quarantine/malware controls appropriate to files shared with employers.

### F11 - Medium: Privacy copy and security hardening need release-level review

**Evidence:** `src/app/extension/privacy/page.tsx:34` says existing answers stay unchanged, while `extensions/chrome/popup.html:33` enables "Update saved contact and history" by default and the history implementation supports corrections. The privacy notice also describes older question/popup flows. This is an observable source-level documentation mismatch; this assessment did not verify the currently installed extension's configuration.

Both the homepage and health endpoint return HSTS, nosniff, frame protection, and a referrer policy. Neither inspected response included a Content Security Policy. No XSS exploit was established.

**Required:** Align privacy disclosures and store claims with the exact released behavior, correction defaults, retention, AI processing, diagnostics, and submission controls. Test export/deletion including document cleanup and restored-backup reconciliation. Introduce CSP in report-only mode before enforcement, remove production-unneeded local trusted origins, verify explicit origin/CSRF checks on cookie-authenticated mutation routes, require MFA for operator/cloud/GitHub accounts, and audit production credential scope. Provider IAM, bucket public-access settings, encryption controls, and all tenant-isolation routes still need independent verification.

Use the [OWASP ASVS](https://asvs.owasp.org/) as a versioned verification checklist, rather than treating this review or a dependency scan as a security certification.

## Controls Worth Preserving

- Verified-email login, session lifetime policy, fresh-session requirements for sensitive operations, and reset-driven session revocation (`src/lib/auth.ts:191`, `src/lib/auth-session-policy.ts`).
- Document downloads scoped to both document ID and current account (`src/app/api/profile/documents/[id]/download/route.ts:20`). This is a sampled check, not an all-routes authorization audit.
- Canonical authentication origins do not trust caller-controlled Host/Origin headers (`src/lib/runtime-origin.ts:17`).
- Outbound fetches validate destination IPs, pin approved DNS results, and recheck redirects (`src/lib/ingestion/net/ssrf-guard.ts:188`, `:279`).
- Shared database-backed AI/PDF budgets and expiring concurrency leases (`src/lib/resource-budget.ts:19`). Request-rate limits also exist, although burst counters in `src/lib/api-rate-limit.ts:26` are process-local and need distributed enforcement when scaling.
- Non-root standalone web runtime with a healthcheck (`Dockerfile:33`), loopback-only database publication, and bounded container logs. Worker isolation should be evaluated separately; the runner stage does not declare the web stage's non-root user.
- Application submission is distinct from filling, and uncertain results should not be blindly retried. Preserve that safety boundary.
- Source mappings, deduplication, freshness checks, quality gates, and separate public/auto-apply pools already exist. Improve their operational evidence rather than replacing them with raw job-count targets.

## Capacity Qualification

Do not use registered-user count as a capacity claim. Define peak request rate, concurrent active sessions, expensive searches per second, document jobs/minute, AI jobs/minute, queue delay, and background ingestion load.

1. Create an isolated production-shaped test environment with synthetic account data and representative public-job cardinality/indexes. Do not copy private resumes into ordinary CI artifacts.
2. Exercise a workload such as 60% discovery/search/filter, 20% details/pagination, 10% saved/applied writes, and 10% profile/extension planning. Measure upload/parsing/PDF/AI separately as well as in the combined workload. Replace these starting proportions with observed usage.
3. Ramp through 5, 10, 25, 50, then 100 concurrent sessions only while safe. Test cold and warm caches, ingestion-on versus ingestion-off, backup-like I/O, and delayed dependencies. Stop when a defined latency/error/resource threshold is exceeded.
4. Run steady-load, spike, and soak scenarios. This should be a repeatable performance program, not one benchmark screenshot. [k6 testing guidance](https://grafana.com/docs/k6/latest/testing-guides/automated-performance-testing/).
5. Publish the highest **measured** sustainable rate and reserve headroom; launch well below it. Add workers/instances only when the measured bottleneck and connection budget justify them.

Proposed acceptance targets, not current results:

| Area | Initial target |
| --- | --- |
| Interactive search/filter server latency | p95 <=2 seconds, p99 <=5 seconds under the agreed peak mix |
| Ordinary saved/applied/profile writes | p95 <=1 second, immediate pending feedback, no full-feed reset |
| Unexpected service errors | <0.5% of requests, excluding expected validation/auth/rate limits |
| Expensive parsing/generation | Acknowledgment within 1 second, visible status and cancellation; measured completion budget by document/job type |
| Recovery | No lost confirmed write or duplicate submission after retry tests |
| Resource margin | At least 30% capacity margin at the launch traffic cap, plus measured storage reserve |

Numbers should be adjusted from real measurement; do not advertise them until proven. A small invite cohort is a support strategy, not evidence that the server can handle that many simultaneous users.

## User Workflow Quality System

### Define The Journey And Recovery At Every Step

The primary flow should remain **Jobs -> matching/filtering -> job details -> assisted application -> review -> confirmed tracking**. Auto Apply is a Jobs mode for eligible opportunities, not an unrelated second discovery system. Every job retains an explicit `auto-apply eligible`, `review required`, or `manual only` status with a reason.

Use one location model throughout search, filters, preferences, URLs, saved searches, and recommendations. Multiple locations mean OR across the selected places; keyword/function constraints combine with that selection. A country includes its cities and remote jobs explicitly eligible in that country, not every remote job globally. Preserve query, scroll position, selected job, and filters after save/mark-applied/back navigation.

For each action define loading, success, empty, validation, partial-success, service-error, cancellation, and recovery states. A spinner without a deadline/retry path is not a completed design. Confirm mutations; undo reversible actions; never promise undo can retract information already sent to an employer.

### Required Journey Matrix

| Journey | Cases that must be exercised | Success/recovery evidence |
| --- | --- | --- |
| Sign-up/sign-in | Google, password, duplicate email, expired verification, failed email delivery, reset, revoked session, account switch | Correct account, clear next action, no false logout on outage |
| Onboarding/profile | Empty/partial/full profile, multiple schools/jobs, conflicting dates, skipped optional data, refresh halfway | Draft survives; reviewed facts remain authoritative; no accidental overwrite |
| Resume | All supported formats, corrupt/encrypted/scanned/large file, parse timeout, failed storage, default change, concurrent upload | Real stored/downloadable file; no orphaned primary state; retry without duplicates |
| Search/filters | Toronto + Seattle, Canada, remote Canada vs US-only, synonyms, unknown metadata, conflicting filters, empty result, pagination/back | Query matches independent expected jobs; selections/counts/history stay consistent |
| Save/hide/applied/report | Double click, slow request, failed write, another tab update, expired posting, undo | Immediate feedback, rollback on failure, no expensive page-wide reset |
| Extension setup | Fresh install, site-only/all-site access, restart, sleeping worker, old extension/new backend and reverse, expired token, account switch | Correct permission and account; a working reconnect/update action |
| Scalar/custom fields | Native select, controlled input, searchable and virtualized dropdown, radio buttons, checkbox, iframe, shadow DOM, delayed rerender | Readback after rerender proves correct committed value, not just a keystroke |
| Histories | Zero/one/many records, prefilled old data, split dates, current job, add/save, required missing fact, repeated Autofill, undo | All supported records committed once; no invented dates or duplicate rows |
| Attachments | Native/hidden/custom dropzone, delayed upload, rejection, existing different resume, lost network | Employer UI confirms the intended filename and completed upload |
| Generated answers | Skills/experience reasoning, eligibility by job country, word limits, conflicting evidence, missing experience, hostile job text | Grounded evidence; full question addressed; sensitive/legal facts never invented |
| Review/submission | Required missing field, expired job, CAPTCHA, duplicate click, timeout after submit, uncertain confirmation | Explicit approval; never auto-retry an uncertain submission; truthful status |
| Accessibility/mobile | Keyboard, screen reader labels, focus return, 200% zoom, narrow viewport, long text | No unreachable controls, hidden errors, or overlapping content |
| Dependency failure | API 401/403/409/413/429/500, DB restart, AI/storage timeout, extension worker restart | Preserved work, meaningful recovery, retry only when safe |
| Account lifecycle | Export, deletion, session revoke, cleanup retry, backup restore | Correct ownership and eventual cleanup, no cross-account cache leakage |

Use a small base of independently authored personas: Canadian and US residents, distinct country-specific work permissions, different career levels, multiple histories, missing optional facts, accessibility needs, and non-tech white-collar roles. Use pairwise combinations for broad coverage and exhaustive combinations for identity, ownership, consent, and submission safety.

### Test Layers And Frequency

- **Each PR:** fast unit/property tests, real-database authorization/transaction checks, packaged-extension deterministic browser fixtures, critical website journeys, accessibility checks, screenshots/traces on failure, dependency/secret checks. Source-text assertions supplement but cannot replace interaction tests.
- **Nightly, once authorized/configured:** stratified public ATS compatibility sample and external website synthetics. Reuse the existing synthetic/no-submission harness. Track unreachable and auth-gated sites separately.
- **Each extension release:** fixed regression corpus plus a fresh holdout sample across ATS families and unknown domains. Verify the built ZIP/installed extension hash, permissions, worker lifecycle, and supported backend versions.
- **Weekly or before major changes:** authorized authenticated multi-step ATS tests, real attachment verification with dummy documents, manual usability sessions, narrative-answer quality evaluation. Do not distribute a personal profile over hundreds of sites or submit dummy applications.
- **Before capacity changes:** load/soak and failure-injection tests in isolation.
- **At least monthly initially:** timed restore and rollback rehearsal, alert delivery test, privacy/access review.

These are proposed schedules, not automations created by this assessment.

### Autofill Scorecard

Report by platform, control family, profile completeness, and release:

1. Accessible application forms / attempted URLs, with login/expiry/CAPTCHA/network gates visible.
2. Detected eligible controls / independently inventoried eligible controls.
3. Correct retained values / answerable controls, including missed controls in the denominator.
4. Wrong writes, overwritten user edits, wrong-account values, and fabricated facts as separate safety metrics.
5. Completed work/education rows and verified uploaded files, not just text-field counts.
6. Time to a review-ready application, unresolved required fields, and manual corrections needed.
7. End-to-end completion of the installed extension + backend + employer UI; distinguish source-runtime fixtures.

Suggested launch gates: >=95% eligible-field completion and >=99% factual correctness on the supported, independently labeled corpus, zero known identity/consent/submission safety failures, and >=99% verified upload success on supported tested widgets. These are targets to establish, not existing results or a promise across all websites. Track confidence intervals and worst-performing families rather than letting easy contact fields hide failures.

Narrative answers need a separate human-reviewed rubric: factual support, relevance to every part of the question, technical specificity, concise structure, compliance with length limits, and no invented achievements. Keep deterministic exact facts separate from generated prose. Use redacted evidence and a held-out question set; an LLM rating its own output is insufficient.

### Continuous Improvement Loop

Add an unobtrusive "Report a problem" action to website errors and the extension. Capture only a user-reviewed diagnostic bundle: run ID, released versions, stage, control kind, normalized failure code, timings, and permission state. Strip query tokens and personal values. Screenshots/full URLs require explicit review and consent; do not record raw resumes, answers, passwords, or browsing history by default.

Every actionable report follows the same path:

1. Triage by impact: data exposure/wrong submission first; unavailable core workflow next; isolated compatibility or cosmetic issue after that.
2. Reproduce on a sanitized fixture or authorized test account.
3. Add a regression that fails before the fix; include neighboring controls and retry cases.
4. Fix the shared contract where possible, not just a hostname special case.
5. Run the affected layer plus critical journeys, release to a small cohort, and watch real success/error metrics.
6. Confirm the user can finish their original task; close with the shipped version and cause.

Unknown custom controls will continue appearing. Use the pipeline **discover -> classify -> obtain evidence -> plan -> act -> verify -> explain/recover**. Keep platform adapters as narrowly scoped exceptions behind common contracts. A universal fuzzy matcher is not a permanent solution: a plausible answer in the wrong field is worse than a clear manual fallback.

## Release And Incident Discipline

- Separate deploy, expose, and expand. Use server-side feature flags/kill switches for risky generation/submission behaviors, with safe extension-version negotiation. Do not remotely inject executable extension code.
- Use additive database migrations first. Keep the previous web image compatible during rollout; test migration recovery separately from image rollback.
- Record a release manifest with source SHA, image digest, extension version/hash, migration version, CI run, benchmark corpus/hash, and known limitations.
- For each staged rollout, define automatic stop conditions: auth failure spike, incorrect writes, unconfirmed uploads, latency/error regression, or queue backlog growth. Revert/disable the affected feature without erasing user work.
- Have short runbooks for root full, database unavailable, bad migration, broken auth/email, storage outage, compromised token, AI cost spike, and employer form change. Name an owner and escalation path.
- Hold a weekly quality review of completion funnels, support reports, compatibility regressions, freshness/label coverage, costs, and restore evidence. Stop expansion when reliability consumes the agreed error budget.

## Marketing Recommendation

**Do not buy broad traffic yet.** Acquisition will amplify the same intermittent workflow failures and increase support load. First make a narrow, useful workflow reliable, then expand the audience.

### Positioning

Suggested message: **"Find relevant North American jobs, reuse your profile, and spend less time on repetitive applications while staying in control."** Lead with saved time and job quality, not "applies everywhere automatically" or guaranteed employment outcomes. Keep the full TECH/FINANCE/GENERAL product scope, but use a focused initial audience for learning.

A sensible starting hypothesis is Canadian/US software and data job seekers, because the existing evidence and founder network are strongest there. Validate that hypothesis with interviews; do not infer market demand from the volume of scraped jobs. Include a small finance/general cohort to reveal workflow assumptions early.

### Acquisition Sequence

1. Recruit roughly 20-50 opt-in design partners through existing university/alumni networks, professional communities, career coaches, and direct introductions. This is a manageable support cohort, not a server-capacity claim. Observe several new users without guiding every click.
2. Publish short, honest demos of profile setup, relevant-job discovery, repeated history filling, editable answers, and clear fallback. Show what is supported and what still needs review. Use dummy applicant data.
3. Improve the Chrome Web Store listing with accurate current screenshots, a concrete first-use outcome, and understandable permission/privacy explanations. Google explicitly recommends accurate listings and screenshots reflecting the current product. [Chrome listing guidance](https://developer.chrome.com/docs/webstore/best-listing).
4. Build useful search-intent content and small community partnerships: location/remote eligibility guidance, application workflow examples, and researched job-search guides. Avoid mass-generated low-value pages, fake testimonials, unsolicited bulk outreach, or promises unsupported by benchmarks.
5. Expand referrals and partnerships only after users repeatedly complete the core workflow. Consider a wider launch or paid experiments after retention, support demand, reliability, and unit economics are measured.

### Measure Outcomes, Not Install Count

Track the funnel: qualified visitor -> verified account -> confirmed profile -> connected extension -> first successful real fill -> review-ready application -> subsequent useful session. Measure median time saved against a manual baseline and user-reported corrections. Track 7/28-day retained job-search activity, successful applications assisted per active user, support incidents per 100 sessions, and inference/storage cost per activated user. Segment by acquisition channel and ATS family.

The initial business goal should be "users reach value without founder intervention," not "hundreds of registrations." Interview drop-offs and users who uninstall. Once they reliably succeed, request voluntary honest reviews without rewards tied to positivity.

## Ordered Hardening Plan

| Batch | Scope | Completion evidence |
| --- | --- | --- |
| 1: Immediate risk | Root/database storage headroom; framework/dependency patch; verify real alert delivery | Running patched image, measured storage reserve, delivered test alert |
| 2: Release safety | Repair CI, protect main, compatible version manifest, staged immutable deployment | Entire release pipeline green; rollback rehearsal |
| 3: Recovery and capacity | Isolated restore, RPO/RTO decision, resource budgets, realistic load/soak | Restore report and measured peak capacity, not estimates |
| 4: Workflow completeness | Installed-extension end-to-end matrix, uploads/histories, error recovery, search data quality | Independent field/journey scorecard and fresh release evidence |
| 5: Controlled beta | Privacy-aligned diagnostics, observed onboarding, quality dashboard, incident loop | Repeat successful unassisted journeys and stable reliability window |
| 6: Broader acquisition | Expand cohort/channels with limits and support coverage | Retention/time-saved/unit-cost evidence; no unresolved launch blockers |

Do not combine all these changes into an opaque release. Security fixes can be expedited, but still need targeted verification and an explicit rollback. Broader marketing should follow the gates, not a promised calendar date.

## Unverified Items Before A Final Go/No-Go

- Provider IAM, backup object immutability/versioning/encryption, bucket exposure, and host compromise recovery.
- Full tenant-isolation and CSRF testing of every mutation/download endpoint; independent penetration testing.
- Real concurrent capacity, p95/p99 user latency, sustained dependency costs, and queue fairness.
- A timed successful restore of this dataset plus its documents and a tested migration rollback/forward-fix.
- Current released/installed extension compatibility across authenticated ATS journeys, uploads, and AI answer quality.
- Fresh production browser checks across desktop/mobile/accessibility journeys; this assessment's unit run does not replace them.
- Current store approval/publication status, legal/privacy compliance, employer automation terms, and complete cross-border data-processing requirements. These were not audited and should not be inferred from earlier publishing work.

Only this assessment document was added. Production, repository settings, existing working changes, and user accounts were not modified.
