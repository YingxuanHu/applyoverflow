# Profile History and Overall Regression Verification

Local work on `dev`, baseline `13edb0d50b872ba6d982599503eec93b83f7fc8f`.
This batch was not committed, deployed, or published to the Chrome Web Store.

## Implemented

- Shared optional work/education dates in onboarding and Profile: start, end,
  current status, year-only or year/month precision. Unknown months stay unknown.
- Existing free-text dates remain editable without automatic conversion.
  Invalid years, contradictory current/end dates and reversed ranges are rejected.
- Completion updates JSON and derived profile text consistently. Draft setup
  remains isolated until completion and survives defer/resume.
- Resume imports preserve structured dates and do not merge separate nonempty
  periods at the same employer/title or school/degree. Matching remains
  conservative; semantically equivalent free-text ranges are not fully parsed.
- Onboarding/profile controls wait for hydration. Saving Profile no longer
  remounts the editor, collapses its active section or erases success feedback.
- Editing an answer resets its copied state. Review suggestions cross the React
  server/client boundary as a plain object rather than an unsupported
  null-prototype dictionary.
- Session header access is outside the authentication catch. Next.js can now
  propagate its request-time rendering signal instead of failing the production
  build with an unauthorized error while prerendering onboarding.

No schema migration, production write, real employer upload, or submission was
performed in this batch. Only synthetic local users/jobs/documents were used.

## Verification

| Check | Result |
| --- | --- |
| Unit suite | 956 tests, 27 suites, all passed |
| TypeScript and scoped ESLint | Passed |
| Production build | Passed in an isolated source copy using the local database |
| Search contracts | 18 query cases and 2 serialization checks passed |
| Onboarding/Profile browser | Manual setup, date validation, year precision, defer/resume, completion callback, legacy text, profile save/reload and mobile geometry passed |
| Application review browser | Custom answer edit/copy/save/reload passed; authorization answer remains manual; tracker stays PREPARING |
| Existing UX browser suite | Picks evidence/feedback/Undo, scroll restore, responsive layout, saved-search CRUD, cross-account isolation, session persistence, discovery cutoff, requirements, snapshot invalidation, preflight, empty-cache handling and worker completion passed |
| Tracker browser | Views, inline status, timeline event, reminder create/edit validation, failed-save draft recovery, add dialog, description retry and mobile geometry passed |
| Resume/onboarding import integration | Draft isolation/conflict checks and distinct employment periods passed |
| Assistant database integration | PKCE/replay/ownership, capture dedupe, stale revisions, sensitive-answer exclusions, scoped suggestions, status preservation and revocation passed |
| Resume/storage integration | Single-use grants, binding/ownership/replay/expiry/revocation, changed/missing files and bounded reads passed |
| Extension contact/resume fixtures | Known fields, preserved values, controlled-input resets, exact PDF/DOCX bytes and no Next/Submit passed |
| Real Chrome + local backend | Connection consent, contact filling, canceled resume choice, explicit resume choice/file transfer and disconnect passed |
| MV3 detection fixtures | Two consecutive final runs passed all three providers, zero unsafe fills or page errors |

One earlier MV3 run timed out opening the review tab. No deterministic defect was
reproduced; failure diagnostics now include the indicator state and API counts.
Two reruns passed. Treat this as a remaining test-stability observation, not proof
of universal reliability.

## Measurements

Controlled local fixtures, not production-load benchmarks:

- Visible delayed-form detection: Greenhouse 390-402 ms, Lever 409-421 ms,
  Ashby 411-414 ms; all below the one-second test budget.
- Contact filling with fixture API: 206-264 ms.
- Tracker full-page load: 967 ms; client view switch: 32 ms; status update: 93 ms.
- Search query cold/warm example: 175 ms cold; 1-9 ms warm on the tiny fixture set.
- Desktop and 390px history-editor screenshots were inspected; no horizontal
  overflow or overlapping date controls. Browser runs used the built app for
  final web checks to avoid development HMR/compilation affecting results.

Logs and screenshots are ignored under `output/playwright/assistant-*`,
`profile-history-*`, `ux-*` and `application-*`. Repro entry points:
`npm run test:unit`, `tests/e2e/profile-onboarding.ts`,
`tests/e2e/ux-workflows.ts`, `tests/e2e/search-filters.ts`,
`tests/integration/profile-setup-import.ts`,
`tests/integration/application-assistant.ts`,
`tests/integration/application-extension-browser.ts`, and
`npm run extension:test:detection` / `extension:test:resume` / `extension:test`.
Database/browser scripts require the local environment and their loopback-only
test guards; do not point them at production.

## Still Open

- Stable history entry IDs and per-field confirmation/provenance before repeated
  employment or education autofill. This batch only edits and stores dates.
- Country-specific authorization review, custom comboboxes, embedded forms,
  Workday/iCIMS and unsupported custom employer sites.
- Broader real-world read-only compatibility coverage and the planned private
  beta fixture gate; these tests do not exercise every site or every app feature.
- Chrome Web Store publication and production rollout. Current ZIP installation
  remains an unpacked developer preview; no claim of a public store release.
