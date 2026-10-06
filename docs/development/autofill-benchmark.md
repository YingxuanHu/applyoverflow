# Autofill Compatibility Benchmark

The deterministic extension tests run on every pull request. The live benchmark
is a separate, manually triggered GitHub Actions workflow because employer forms
expire, change, require accounts, and sometimes block automated browsers.

## Run Locally

```sh
npm run extension:test:modern
npm run extension:benchmark -- --discover --limit 400 --concurrency 3 --run baseline
npm run extension:benchmark -- --limit 400 --concurrency 3 --run candidate --min-forms 200 --min-retention 0.95 --min-planned-retention 0.90
```

Discovery uses the repository's ATS tenant inventories and public posting APIs.
It samples distinct employers using a stable hash, not a short hand-picked list.
Greenhouse, Lever, Ashby, SmartRecruiters, Teamtailor, Jobvite, Workable, Recruitee,
and Rippling are discovery families. Public iCIMS career boards are also probed,
but a board probe is not proof of an authenticated application workflow.
North American office roles are preferred; worldwide fallbacks test form
compatibility only and do not alter the product's ingestion scope.

Use `--manifest path/to/manifest.json` to reuse a sample, `--output directory` for
an isolated report directory, and `--extend --discover-only` to add missing
families. Run names cannot contain paths. Existing reports cannot be overwritten.
`--resume` requires the same sample, limit, and source hash; changed source needs
a new run name. Concurrency is bounded to six browser contexts.

## What Is Measured

- Detection, known-field retention, timing, gates, and errors by platform.
- Actual post-fill DOM values after rendering, not only internal success flags.
- A separate contact-value oracle counts canonical labelled controls even when
  the extension fails to detect them. It verifies exact values, formatted phone
  digits, and an unambiguous city/region/country selection.
- Repeated work and education records are exercised where a supported section
  exists. Their counts and warnings are recorded separately from contact scores.
- A source hash covers the serialized detector/writers and answer-planning code.
  A separate harness hash covers the runner and history date normalization.
- Minimum detected-form, contact-oracle, and planned-value retention thresholds
  fail the process and CI. Planned values include explicit common preferences,
  not just contact fields; neither score proves all application questions.

Reports are JSONL, a summary JSON, discovery/manifest JSON, and bounded failure
screenshots under ignored `output/playwright/autofill-benchmark/`. A missing
answer is not automatically a bug: unknown facts and legal attestations must stay
manual. Review raw labels and retained values before changing mapping rules.

## Safety And Limits

The bulk runner uses a synthetic profile, explicitly saved test preferences, and
synthetic history. It never signs in, creates accounts, uploads files, calls the
AI service, clicks final submission, or accepts terms. Before writing values it
blocks network traffic except read-only catalog/search GETs, blocks WebSockets,
and installs a submission guard. Any submission attempt fails the run.

Authentication and CAPTCHA gates are reported, never bypassed. An accessible
form, an attempted URL, and a fully completed application are different metrics.
The contact oracle is deliberately narrow: it does not establish correctness of
all narrative answers, sensitive questions, uploads, or multi-step workflows.
Test those separately with authorized accounts and review the visible form.

The modern-control fixtures cover owned/nested/virtualized dropdowns, selected
chips versus query text, split month/year dates, repeated-record idempotency,
unknown-platform form detection, invalid employer validation patterns, explicit
messaging preferences, professional URL variants, and foreign-contact exclusion.
The existing history, semantic-draft, resume, frame-routing, and undo suites remain
part of release verification. Keep captured private sessions and credentials out
of the benchmark, repository, and CI artifacts.
