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
  fail the process and CI. The form minimum counts measurable post-fill forms,
  not login screens or forms lost to a blocked candidate auto-save.
  Planned values include explicit common preferences,
  not just contact fields; neither score proves all application questions.

Reports are JSONL, a summary JSON, discovery/manifest JSON, and bounded failure
screenshots under ignored `output/playwright/autofill-benchmark/`. A missing
answer is not automatically a bug: unknown facts and legal attestations must stay
manual. Review raw labels and retained values before changing mapping rules.

## Safety And Limits

The bulk runner uses a synthetic profile, explicitly saved test preferences, and
synthetic history. It never signs in, creates accounts, uploads files, calls the
AI service, clicks final submission, or accepts terms. Before writing values it
blocks network traffic except read-only catalog/search GETs and the verified
Ashby location-autocomplete GraphQL query (never mutations), blocks WebSockets,
and installs a submission guard. Any submission attempt fails the run.

Authentication and CAPTCHA gates are reported, never bypassed. An accessible
form, an attempted URL, and a fully completed application are different metrics.
The contact oracle is deliberately narrow: it does not establish correctness of
all narrative answers, sensitive questions, uploads, or multi-step workflows.
Test those separately with authorized accounts and review the visible form.

The modern-control fixtures cover owned/nested/virtualized dropdowns, selected
chips versus query text, split month/year date commitment, repeated-record idempotency,
unknown-platform form detection, invalid employer validation patterns, explicit
messaging preferences, professional URL variants, foreign-contact exclusion,
and international phone widgets that must preserve the saved country code.
The existing history, semantic-draft, resume, frame-routing, and undo suites remain
part of release verification. Keep captured private sessions and credentials out
of the benchmark, repository, and CI artifacts.

## Workday Coverage

```sh
npm run extension:test:workday
npm run extension:benchmark -- --platform workday --discover --limit 100 --jobs-per-employer 3 --output output/playwright/workday-benchmark --run public
```

Workday discovery uses the existing employer inventory and public CXS job-search
API, with up to five postings per employer. The public runner opens only the
Apply Manually entry point. It never creates accounts, reuses private credentials,
uploads files, advances application steps, or submits applications. Reports
separate sign-in, employer server errors, and active application steps. A green
public access-probe run is not certification of authenticated Workday autofill.
Read-only nested source catalogs are allowed. Candidate auto-saves remain blocked;
if that removes the form, the report marks `write-gated` and excludes its unmeasurable
retention from scores. This is a test restriction, not evidence of an extension failure.
Use `--profile-country CA` for the Canadian synthetic profile or the default US
profile. A profile hash prevents resuming a run with different test data.

The offline Workday suite runs on every pull request and exercises asynchronous
and native controls, job-country-specific eligibility answers, repeated histories,
date parts, education, edit preservation, and declaration/submission boundaries.
Fixture cases are not counted as live employers. Signed-in testing needs a
separate authorized account for each employer and approved resume uploads. Record
which steps were actually filled and passed the employer's validation; reaching
the first contact page does not establish full application completion.

### Validation On 2026-10-06

- Public baseline: 200 application URLs across 68 hosts and 74 tenant/site pairs.
  There were 188 sign-in gates, one expired posting with a login gate, six
  measurable guest contact forms, four forms lost to blocked candidate auto-saves,
  and one unavailable form. Some sampled boards are internal-facing; counts are
  URL probes, not externally eligible employers or completed applications.
- On the six measurable forms, all 42 independent contact-oracle values were
  retained. Only 54 of 60 planned values were retained; source choices remained
  incomplete. This narrow result does not establish full Workday compatibility.
- Authenticated Autodesk checks covered four postings: three fresh contact forms
  each filled eight saved-profile/source fields, while the existing draft passed
  contact validation and filled four missing work descriptions. Existing split
  month/year dates were retained; they were not counted as new fills. One contact
  form needed a second scan after asynchronous initialization.
- The history-step validation reported only the missing required resume. Later
  questions, disclosures, review, and real resume upload were not verified. Missing
  employer-specific preferences and conflicting duplicate education dates remain
  explicit blockers. The Workday skills prompt remains an unverified compatibility
  gap rather than a claimed success.
- The source planner now supports Website/Other Website and Job Site/Job Sites,
  including a saved Other choice whose details explicitly say ApplyOverflow.
  Autodesk's source selection was verified with the authorized profile. A separate
  Clio source-only check committed Other and retained it, with every personal field
  empty and no submission. The three Clio full-profile candidate retests were
  write-gated by the safety guard and did not meet the measurable-form threshold.
- All 22 offline Workday cases passed. They cover controlled widgets and safety
  boundaries, not additional live employers. No application was submitted.

Raw public evidence is under ignored `output/playwright/workday-expanded/`.
Never store authenticated HTML, cookies, credentials, or private profile values
with the public benchmark evidence.
