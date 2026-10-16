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

Use `--decline-optional-cookies` to reject optional cookies in a visible cookie
dialog with one unambiguous decline/reject-all button. The runner records this
action, never accepts cookies or agreements, and leaves other dialogs untouched.
The option is part of the harness hash so runs with different setup cannot resume
one another.

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

## Placeholder And Repeated-Record Coverage

```sh
npm run extension:test:unlabelled
node scripts/test-application-extension-unlabelled.mjs --live
```

The deterministic suite runs in CI on an unlisted employer domain. It covers
grouped name fields identified by placeholders, paragraph section labels, a
hidden resume dropzone, the international telephone country widget, sibling Add
buttons, unlabelled subsequent history rows, and unformatted month pickers.
It also checks disabled options, existing user selections, unrelated contact
forms, reference fields, and repeated-run duplicate prevention. The packaged
origin-access suite exercises these placeholder layouts through the actual MV3
worker and on-page Autofill control on synthetic domains.

On October 15, 2026, the optional live test verified the real React form at
`https://recruiterflow.com/Plus10/jobs/114`. The previous inspector rejected the
whole application because the grouped First/Last Name inputs had no individual
labels. The candidate filled the five contact/phone controls and two synthetic
employment records, including current-role handling, start months and a past
role's end month. Values remained after rendering and a repeat run added no
duplicate rows. The resume target was detected, but no file was uploaded to this
live employer. All outbound requests were blocked before writing; there was no
submission. This is real-control verification, not a completed application or
proof that every site works. Screenshots are under ignored
`output/playwright/recruiterflow/`.

The fixes use field structure and component contracts, not a Recruiterflow
hostname entry. Browser permission still governs automatic appearance: users
must enable this site or all application sites, or invoke the toolbar with
temporary active-tab access. Detection never silently grants broader access.

## Repeated History Layouts

```sh
npm run extension:test:history-layouts
npm run extension:test:history-layouts -- --live
```

The CI suite exercises nested paragraph/heading wrappers, sibling Add controls,
and a cross-origin application frame on unfamiliar fixture domains. Each layout
must fill two employment and two education entries, including split dates,
current-role checkboxes, institution catalogs, and qualification-level choices.
It also tests retrying an unavailable school catalog without duplicating the
partially completed row, ambiguous options, manual-edit preservation, and keeping
the applicant's home city out of an employer-location field.

On 2026-10-15, the live mode verified the actual CareerPuck/Lyft embedded form at
`https://app.careerpuck.com/job-board/lyft/job/8888403002?gh_jid=8888403002`.
The candidate retained 17 history writes across two synthetic work records and
two synthetic education records. Schools, degree levels, disciplines, month/year
controls and current-role state were checked by DOM readback and screenshots.
A repeated run did not add duplicates. This uses the serialized runtime against
the real React controls, not the user's installed extension or private profile.
After form loading, only public school/degree/discipline catalog GETs are allowed;
all other requests and WebSockets are blocked before filling. No files are
uploaded and no application is submitted. Screenshots are under ignored
`output/playwright/history-layouts/`.

The new detection uses bounded, control-free heading wrappers and the nearest
single-kind repeater owner, not a CareerPuck hostname rule. Catalog fallback only
uses explicit degree levels or an institution name with a named faculty removed;
it does not fuzzy-match a different institution or discard a campus qualifier.
These checks establish coverage of these structures, not universal ATS support.

## Composite Controls And Hash Routes

```sh
npm run extension:test:composite
npm run extension:test:composite -- --live
```

The offline CI suite uses an unlisted employer domain. It covers hash-routed
vacancy identity, read-only dropdown inputs activated through their focusable
wrapper, pointer/mousedown selection, ARIA radio wrappers with hidden native
mirrors, and adjacent phone-country controls. Search filters reproduce a delayed
opening-state reset; country selection replaces the input with a new identity.
Assertions check retained values, accurate completion reporting, repeat runs,
explicit consent preferences, user-edit preservation, foreign-menu rejection,
pronoun equivalence, skills hints, and hidden resume-picker discovery.

On 2026-10-15, live mode verified these two actual application forms using the
serialized source runtime, not the installed extension or private user profile:

- InfoTrack on Rippling, job `148aa4f5-68f2-4061-be3f-92fbcdc94b51`: 13 retained
  field fills, including Canadian phone country, Toronto location, pronouns,
  sponsorship, hybrid-work selection, and the saved negative SMS choice. The
  hybrid answer is an explicit synthetic fixture preference; this test does not
  prove that profile-based reasoning can derive it.
- Pinnacle on OrangeHRM, vacancy `704`: 10 retained fills, including name parts,
  contact fields, skills, source, and work-authorization/sponsorship dropdowns.
  Fifteen other scanned fields remain empty/manual because the fixture has no
  supported answers for employer history, technical narratives, interests,
  availability, documentation promises, or retention consent. AI generation and
  the private-profile API are not exercised by this control test.

Screenshots were visually inspected and field states checked again after a
repeated run. Both resume targets were recognized, but no file was uploaded and
no application was submitted. After loading the form, all outbound requests are
blocked except public Google Maps GETs needed for the synthetic Toronto lookup;
WebSockets are blocked throughout. Reports and screenshots are in ignored
`output/playwright/composite-controls/`. A successful source test does not mean
the changes have been deployed, installed, or verified on every employer form.

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

### Prefilled History Validation On 2026-10-15

- Authenticated TD Workday test used the candidate's authorized account and
  "Use My Last Application" on requisition R_1507092. No application was
  submitted. The information step created an unsubmitted draft; subsequent
  history experiments blocked outbound requests except GET education catalogs.
- Tested the real My Experience controls by restoring captured on-form facts
  after controlled local clearing/corruption. Verified a date correction,
  missing field-of-study selection, automatic Add of a work record and an
  education record, retained dates, school/degree/major selections, and reruns
  leaving two work rows and two education rows without duplicates. Screenshots
  were inspected locally, not committed.
- This is source-runtime/control validation, not an installed-extension or
  production-profile end-to-end pass. The normal Chrome session was inaccessible
  while the Mac was locked. The retained TD facts are not asserted to be the
  user's latest ApplyOverflow profile; the tests did not validate resume
  extraction, upload, later questions, or submission.
- `npm run extension:test:reconciliation` adds eight offline cases for nested
  date ownership, opt-in prefill correction, trusted edits, ambiguous repeated
  identities, dependent current-role/end-date controls, undo, Enter-only search
  catalogs, immediate catalog commits, and scalar contact correction. These run
  in CI alongside the existing 22 Workday cases, not as additional live sites.
- "Update saved contact and history" is checked by default in both assistants.
  It corrects scalar/native-select contact facts and uniquely identified history
  records from saved profile data. Untouched prefills remain protected when it
  is unchecked. Ambiguous records, missing facts, session edits, selected
  multi-value history chips and unsupported contact dropdown replacements need
  review. Narrative answers outside matched history, consent and declarations
  are never rewritten by this correction pass.
