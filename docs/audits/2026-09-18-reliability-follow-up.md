# Indexing, Poll Fairness and Extension Click Reliability

Local patches on `dev`, following the September 18 production check and profile
history batch. No production writes, restarts, concurrency increases, commits or
deployments were performed. Existing uncommitted preview work is preserved.

## Findings and Fixes

### Invalid JSON during feed indexing

The sampled canonical record `cmr9dqw6913r014mx294kt681` has valid source text,
but its description has the first UTF-16 code unit of an emoji at offset 3999.
`buildSearchText()` used `slice(0, 4000)`, leaving a lone high surrogate. JSON
serialization succeeds in JavaScript, but PostgreSQL rejects that JSON value.

The cutoff now omits an incomplete trailing pair. It retains the original size
budget, complete emoji and all source description data. It changes only the
search projection; visibility, scope and quality gates are unchanged. This
particular record is in Berlin, so its repair is not evidence of recovering a
missing eligible North American listing.

The unit regression failed before the fix. The database integration explicitly
reproduces PostgreSQL's JSON rejection and verifies that the corrected projection
writes successfully. TOAST reuse, out-of-order writes and canonical-version
guards still pass.

### Overdue poll starvation

Read-only production inspection found eligible, validated TC Energy and S&P
Global Workday polls more than a day overdue with zero attempts, no cooldown,
and priority 70. The seven-day retention quota does not cover this interval;
fresh high-priority work can continue outbidding them. The `spgi_internal` board
also warrants separate public-board eligibility review; its name is not proof
that the jobs are publicly applicable, and this patch does not change source
classification.

After the existing retention allocation, 20% of remaining slots (minimum one)
now goes to eligible polls at least 24 hours overdue, oldest first. Empty quota
slots return to the ordinary priority pass. Total batch size is unchanged.
Targeted source claims bypass the quota. Validation, quarantine/disabled state,
source cooldowns, connector-family exclusions, SKIP LOCKED, and downstream
runtime admission controls remain intact. This does not override a legitimate
rate limit or guarantee successful polling of blocked sites.

A read-only candidate SELECT used the existing
`SourceTask_kind_status_notBeforeAt_priorityScore_idx` in production. The sample
took 627 ms with cold reads; this is a single observation, not a sustained
throughput benchmark. No index or database migration is needed.

### Extension review clicks

The indicator rebuilt all its DOM nodes whenever scan state changed. A newly
mounted employer question between pointer-down and pointer-up detached the
Review button. The forced regression reproduced this on the old bundle.

The indicator now keeps stable controls and updates their visibility/state in
place. Tests insert a question while pressing Review, then finish the press.
Mouse and Space-key paths successfully open review on the three supported ATS
fixtures. Controls remain keyboard-accessible and synthetic clicks cannot
trigger privileged actions. Unchanged status text is not rewritten on every
scan, avoiding redundant live-region updates.

## Verification

- 959 unit tests across 27 suites passed.
- TypeScript, scoped ESLint, diff checks and production build passed.
- `tests/integration/feed-index-writes.ts`: invalid JSON reproduction, valid
  Unicode projection, unchanged source text, TOAST reuse and stale-writer guards.
- `tests/integration/overdue-poll-claims.ts`: actual claim SQL exercised against
  connection-local temporary tables; cutoff, oldest ordering, attempt tracking,
  no repeated claim, disabled/unvalidated/quarantined/cooling sources and excluded
  connector families. Shared queued work is untouched.
- `extension:test:detection`: all three ATS fixtures passed with the mid-press
  regression; final form detection was 399-429 ms, below the one-second budget.
  No unsafe fills, page errors or Next/Submit actions.
- `extension:test` and `extension:test:resume`: existing-answer preservation,
  exact resume bytes, no overwrite, navigation binding, ambiguous/disabled fields
  and controlled-field reset checks passed.
- Desktop/mobile indicator screenshots inspected under `output/playwright/`.
- Real Chrome + the compiled local backend: explicit connection approval, PKCE,
  authenticated contact fill, resume cancellation, explicit file selection,
  exact attached bytes and disconnect revocation passed. No Next/Submit actions.
- Preview ZIP rebuilt with the stable indicator (101,053 bytes). This only
  refreshes the local download artifact, not production or the Web Store.

The first end-to-end attempt against `next dev` hit the extension's 20-second
network limit while the API route compiled. The compiled local build avoids that
development-only delay; the production timeout was not increased. Switching the
isolated Chrome profile to another local port also revealed a cached worker
configuration. The harness now clears only that test profile's service-worker
cache before launch, preserves its supported-site permission grants, recognizes
both email-field labels, and records failure screenshots with query strings
omitted from diagnostic logs. The final compiled-build run passed without
changing product authentication or consent behavior.

The database integration scripts require loopback DATABASE_URL and an empty
DATABASE_URL_DO_PRIVATE. All fixture writes are local. Logs are ignored under
`output/playwright/reliability-*`.

## Rollout Boundary

These fixes are not live yet. The ingestion/search changes are independent of
the extension preview's migrations and can be reviewed as a separate release
batch. Do not deploy the entire dirty worktree merely to apply them. After a
reviewed deployment, verify that the failed projection completes and overdue
eligible polls receive attempts without increased 429s or memory pressure.
The extension ZIP still needs normal preview/private-beta checks before a Web
Store release; this does not add unsupported ATS or employment-history autofill.
