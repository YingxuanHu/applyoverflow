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

- All 1,072 unit tests passed, as did typecheck, production build, package tests,
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
- The first local live AI evaluation could not run because local configuration
  lacks `OPENAI_API_KEY`. Its failed report is retained. A later isolated run with
  the configured production models passed all 24 cases, as detailed below.
- No real employer application was submitted, no private resume was uploaded,
  and no real credentials were used by these benchmarks.

See [the compatibility benchmark](autofill-benchmark.md) for public sampling,
network guards, independent contact oracles and interpretation of gates. Require
separate authorized live checks for authenticated steps and actual uploads.

## Expanded Public Baseline And Follow-Up

The expanded 0.15.0 baseline attempted 220 URLs across 219 employers and ten
platform families. It measured 156 post-fill forms: independent contacts retained
643/660 values (97.4%) and planned values retained 1,115/1,181 (94.4%). Counts still
include detected-but-unfillable controls and inaccessible forms in the relevant
denominators. There were zero submission attempts; this is not a complete-
application success rate.

After explicitly declining optional cookies, the five accessible Workable forms
retained 21/21 planned and 20/20 independent values. The benchmark now offers this
bounded setup action; it never accepts agreements or bypasses authentication.

The sample exposed three shared classification gaps addressed in 0.15.1:
equal-employment-opportunity headings were incorrectly treated as work history;
radio options named LinkedIn could inherit URL identity mappings; and an explicit
Website-or-LinkedIn alternative was not recognized as a professional URL. New
fixtures preserve foreign-contact exclusion and require saved disclosure choices.
Two live disclosure retests retained 17/17 planned and 8/8 independent values.
The same 220-URL candidate is evaluated separately against minimum form counts
and 95% contact and planned-value retention thresholds.

The final 0.15.1 candidate passed all three thresholds: 157 measurable forms,
648/664 independent contact values (97.6%) and 1,155/1,186 planned values (97.4%).
There were 24 explicit access gates and zero submission attempts. The sample and
synthetic profile were unchanged; privacy setup handling was made more robust,
and some live pages changed between runs, so this is not a controlled causal
performance experiment. The remaining gaps include unavailable forms, unknown
catalog entries, ambiguous options, unsupported controls and blocked dialogs.
These results do not certify every platform or every application field.

The 24-case live answer evaluation passed with the configured `gpt-5.4-mini` and
`gpt-5.4-nano` models. It covers evidence-grounded experience answers, hypothetical
technical explanations, finance/marketing questions, missing-fact abstention,
word limits and misleading question instructions. Median case time was 2,371ms
and p95 was 4,284ms. An independent disposable PostgreSQL container held only
synthetic evaluation budgets; the evaluator shared that container's loopback
network and received only the AI configuration, never production database
credentials. Both test containers and the temporary configuration were removed.
The synthetic report is retained under ignored
`output/evaluations/application-answers/production-model-96d0322.json`.

Production was deployed in three product batches and returned revision
`96d0322280c666ffd282d2dcc47d00ff23ed2ba4`; its public extension ZIP was verified as
0.15.1. During the final restart, 59/60 five-second health probes returned ready.
One response was empty or invalid JSON during container replacement; the next
probe was ready on the new revision. This deployment is not zero-downtime.
The normal Chrome extension was reloaded from the existing unpacked folder.
Chrome's extension details showed version 0.15.1 and the Reloaded confirmation.
The active-account production workspace connection was not independently
verified after that reload; earlier signed-in account access was confirmed.
