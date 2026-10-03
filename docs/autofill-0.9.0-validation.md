# Autofill 0.9.0 validation

## Controlled live forms

Checked September 28, 2026 UTC. Tests load public employer pages, wait for visible
form controls, then block outbound employer traffic before inserting disposable
profile facts. Public Greenhouse education-option GETs are allowed; applications,
uploads, telemetry and WebSockets are blocked. Nothing is submitted.

| Employer / platform | Filled fields | Detected fields | History writes |
| --- | ---: | ---: | ---: |
| Mission Lane / Greenhouse | 20 | 27 | 0 |
| Florida Panthers / Greenhouse | 14 | 21 | 5 |
| Recursion / Greenhouse | 14 | 22 | 0 |
| Canonical / Greenhouse | 12 | 29 | 2 |
| Figma / Greenhouse | 11 | 17 | 0 |
| Filevine / Lever | 7 | 22 | 0 |
| BioAge / Rippling | 4 | 8 | 0 |
| Synpulse / HiBob | 11 | 18 | 10 |

History writes are reported separately and can overlap detected fields; do not
sum these columns into a completion rate. The recorded check durations include a
second idempotence check and screenshot (0.5-3.8 seconds), not production network
latency. Remaining fields include unknown facts, personal decisions, certifications,
unsupported widgets and draftable questions. These are not universal ATS claims.

The exact URLs, field states, actual DOM values and screenshots are written by
`tests/integration/extension-live-coverage.ts` to `output/playwright/coverage/`.
No real account profile is stored in those test artifacts.

## Native and API checks

- Native MV3 connected through Chrome identity to the authenticated local API.
- Mission Lane: actual source/relationship/sponsorship choices and professional
  link read back from the form. A real AI draft prepared from the database profile
  was reviewed and inserted into the employer textarea. A Canadian province did
  not become a US state, and unsupported management qualifications stayed blank.
- Synpulse: live AI technical answer and a personal-preference answer with an
  explicit note were inserted after review, respecting a 40-word/400-character
  limit; nine work/education fields were checked in this separate scenario.
- Browser restart retained the account grant; disconnect revoked it server-side.
- Default resume and per-file approval/cancel flows passed against isolated forms
  with an authenticated disposable account, not live employer uploads.
- Profile persistence and layout checked at 1440px and 320px.
- 1,015 unit tests passed, plus semantic, question, autofill, expanded, compatibility,
  native history, Undo, readiness and package suites. Typecheck and lint passed;
  lint retains two unrelated existing warnings.

## Boundaries

The controlled suite is not a replacement for testing the user's installed build
against production. Authenticated Workday/iCIMS histories, arbitrary async option
catalogs and custom upload widgets remain incompletely verified. An explicit
employer prohibition on AI-written answers disables drafting, not factual filling.
No eligibility, demographics, consent, referrals or experience are invented to
increase filled-field counts. New optional profile values require the user's choice.
