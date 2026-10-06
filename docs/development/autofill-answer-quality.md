# Application Answer Quality

The extension inserts answers into employer controls. Its assistant displays
progress and unresolved fields, not a second questionnaire. These checks do not
certify every employer website or a fully completed application.

## Generation Contract

- Classify professional history, factual qualifications, hypothetical knowledge,
  and personal decisions separately. API authorization, race conditions and high
  availability are not work eligibility, demographics or applicant availability.
- Retrieve relevant structured experience/projects before applying the prompt
  budget. Include documented date ranges, never contact or eligibility details.
- Use the standard model for drafts and an independent review call. Review every
  personal claim, question relevance, completeness, technical correctness and
  whether missing information genuinely prevents an answer. Model review is a
  fallible safeguard, not an objective proof of truth.
- Require exact source excerpts for personal claims. Short skill sources must be
  quoted as-is, without fabricated punctuation. Conceptual explanations may use
  professional knowledge, clearly distinguished from past accomplishments.
- Enforce employer character/word limits and exact choice membership in code.
  Target below the limit rather than asking the model to count at the boundary.
- Repair once within a shared 26-second deadline; never insert unvalidated output.
  Recheck the profile revision and preserve edits made while generation runs.

## Repeatable Tests

```sh
npm run test:unit
npm run extension:test:matrix
npm run extension:test:semantic
npm run extension:test:workday
NODE_PATH=./node_modules/next/dist/compiled DATABASE_URL_DO_PRIVATE= DOTENV_CONFIG_PATH=.env.local node --conditions=react-server --import tsx -r dotenv/config tests/integration/extension-semantic-drafts.ts
DATABASE_URL_DO_PRIVATE= DOTENV_CONFIG_PATH=.env.local npm run extension:eval:answers
DATABASE_URL_DO_PRIVATE= DOTENV_CONFIG_PATH=.env.local npm run extension:eval:live-answers
```

Live evaluations require an API key supplied through secure local configuration
and a local test database. They use synthetic professional evidence only, record
failures as failures and exit nonzero. The 24-case corpus covers engineering,
finance, marketing, missing experience, exact qualifications, prompt injection,
and strict limits. Hard expectations supplement model review. An optional
`--only-failed` argument reruns failures for diagnosis; only a subsequent full run
can establish a full corpus pass. Reports are under ignored `output/evaluations/`.

The live-answer suite opens public Greenhouse, Lever, Ashby and Rippling forms,
blocks outbound requests before writing, generates an answer using the actual
question, and verifies both the control value and a fresh extension scan. It
captures screenshots with synthetic values and never uploads or submits. Expired
postings or gates fail the test; they are not silently replaced with fixtures.

The 28-case offline control matrix checks six radio layouts, exact selected options,
isolated versus ambiguous questions, edit preservation, idempotence and visual
required markers. A prefilled telephone dial code alone is not a complete number;
trusted edits to it are preserved. Employment-eligibility headings are not history
records. Current employer/title derive only from one explicitly ongoing
profile role. Other Website uses the saved portfolio/GitHub URL. These facts remain
read-only derived values, not arbitrary remembered profile columns.

## Coverage Boundaries

Run the [compatibility benchmark](autofill-benchmark.md) separately on hundreds of
URLs. Contact-oracle retention and known-plan retention are not questionnaire
completion scores. Record gates, unsupported controls, missing facts, AI-restricted
forms, conflicting histories and untested steps separately. Use `--current-role`
for a synthetic explicitly ongoing job when testing current-company fields.
Workday login and later-step tests require authorized accounts; public probes and
the 22 Workday fixtures do not prove authenticated completion.

## Audit On 2026-10-06

- Broad baseline and candidate each attempted the same 457 URLs across ten
  platform families and 456 employers. The candidate measured 329 post-fill forms,
  98.56% independent contact-value retention and 97.21% known-plan retention.
  Login gates, inaccessible/expired forms and other errors remain failures or
  gates, never completed applications. Mutable employer pages changed the number
  of measurable forms, so these aggregate scores are not a causal improvement
  claim. This run preceded the final current-role and telephone-prefix fixes.
- A later 35-employer, eight-family retest with an explicitly ongoing synthetic
  role measured all 35 forms: 159/160 independent contacts and 276/284 planned
  values retained. The independent oracle now also counts dial-code-only phone
  controls. Failures included unavailable location/address catalog choices,
  unmatched decline choices, and ambiguous repeated identity labels.
  Recruitee dial-code-prefilled numbers and the employment-visa question were
  filled and read back. A focused follow-up initially failed its 92% planned-value
  threshold (41/46). Investigation found an unsupported equivalent decline option
  and incomplete employer initialization in the benchmark. The equivalent is now
  accepted only for explicitly saved non-disclosure preferences; the runner waits
  up to five additional seconds for public initialization before enabling its
  write guard. The same focused set then passed at 44/46 planned values and 18/18
  independent contacts. Neither fix removes ambiguous controls from the denominator.
- Actual model evaluation passed 24/24 cases, including missing qualifications,
  adversarial claims, technical knowledge, documented history and strict limits.
  Actual employer-control insertion passed 4/4 across Greenhouse, Lever, Ashby and
  Rippling using synthetic evidence. These tests do not certify all questions on
  those four forms. No uploads or application submissions occurred.
- 1,053 unit tests, semantic/history browser tests, 22 offline Workday cases,
  modern-control tests and the packaged build passed. The optional cross-origin
  MV3 frame run stopped at Chrome's site-permission prompt; its completion is
  not claimed. The real connection test was not run because its local server and
  bundle origin prerequisites were absent. Neither limitation is hidden as a pass.
- See the compatibility benchmark's separate Workday audit for the public
  200-URL probes and limited authenticated Autodesk checks. Later authenticated
  steps, skills, real uploads and complete Workday applications remain unverified.
