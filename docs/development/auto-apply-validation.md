# Auto Apply Release Validation

The workspace is `/applications/auto-apply`, alongside the application tracker.
Matches reuse Picks for you and explicit profile requirements. Review preparation
does not submit anything. Final submission requires current employer readiness,
document review and a second explicit approval for one application. Login,
CAPTCHA, unsupported steps, declarations and unknown outcomes remain visible gates.

## Repeatable Release Checks

```sh
npm run test:unit
npm run extension:test:workspace
npm run extension:test:submission
npm run extension:test:structure
npm run extension:test:workday
npm run extension:test:questions
npm run extension:test:package
NODE_PATH=./node_modules/next/dist/compiled DATABASE_URL_DO_PRIVATE= DOTENV_CONFIG_PATH=.env.local node --conditions=react-server --import tsx -r dotenv/config tests/integration/auto-apply-workspace.ts
TEST_APP_URL=http://127.0.0.1:3004 npm run test:auto-apply:ui
```

The UI test requires a running app and local database. It creates and deletes a
synthetic account and job. Recommendation refresh and extension transport are
fixtures in this test, not evidence of ranking or employer filling. The separate
MV3 test exercises the packaged service worker, actual employer DOM writes,
same-account handoff, stale revisions, readback, confirmation and duplicate locks.
All its HTTP is intercepted; its final submission is a synthetic DOM event.

The UI benchmark records 17 checkpoint screenshots, visible state, API statuses
and response timings, browser errors and a Playwright trace. It checks desktop,
390px and 320px widths, queue idempotence/removal/requeue, consent cancellation,
permission recovery, independent edits, navigation protection, stale approval,
readiness failure, expired approval, final confirmation, unknown-outcome retry
blocking, saved requirements, extension reconnection and expired web sessions.

Reports live under ignored `output/playwright/auto-apply/`. CI runs this demo
against the production build and retains synthetic screenshots/traces for 14 days.
Checkpoint duration includes navigation, assertions and capture overhead; it is
not a service latency SLA. API timings are recorded separately for each checkpoint.
Never run this recorder on private production accounts or publish private traces.

## Validation On 2026-10-12

- All 1,071 unit tests passed, as did typecheck, production build, package tests,
  database ownership/queue tests, real MV3 workspace test, submission regressions,
  structural history tests and 22 offline Workday cases. Lint has two existing
  unused-variable warnings and no errors.
- The production-build local UI demo passed 17/17 checkpoints in 9.4 seconds,
  with zero browser errors. The median checkpoint was 245ms and p95 was 2,458ms.
  This is synthetic test-machine performance, not production user performance.
- A fresh public benchmark attempted 60 employers across ten platform families.
  It detected 43 forms, of which 38 were measurable post-fill forms. Independent
  contacts retained 159/183 values (86.9%); planned values retained 266/291 (91.4%).
  These broad scores include inaccessible/gated controls, not just successful
  forms. They do not establish full application completion.
- The benchmark caught an unmatched saved job-source choice with an instructional
  suffix. The shared matcher now accepts bounded source-only suffixes, preserves
  ambiguous choices, and checks conditional details against the actual selection.
  The same live Lever form then retained 8/8 planned and 4/4 independent values.
- Two address catalogs did not offer the synthetic address. A numeric salary
  control rejected a currency/period string. Five Workable forms required privacy
  dialog action. Other attempts encountered expired/unavailable forms or access
  gates. These are unresolved coverage boundaries, not claimed successes.
- Six additional public Workday employers all stopped at sign-in. No authenticated
  Workday completion is claimed by this release's public run.
- The 24-case live AI quality evaluation could not run: local configuration lacks
  `OPENAI_API_KEY`. Its failed report is retained, not counted as a pass. Existing
  deterministic answer-validation tests passed; they do not replace a model run.
- No real employer application was submitted, no private resume was uploaded,
  and no real credentials were used by these benchmarks.

See [the compatibility benchmark](autofill-benchmark.md) for public sampling,
network guards, independent contact oracles and interpretation of gates. Require
separate authorized live checks for authenticated steps and actual uploads.
