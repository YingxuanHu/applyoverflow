# Profile fact intents: 0.11.5

## Scope

Shared extension-side fixes for applicant location, alternative professional
links, custom control ownership, and false user-edit detection. No backend or
profile schema changes are included. This is not universal form support.

- Resolve fact intents independently of ATS names and field IDs. Compose
  geographic components and allowed professional-link alternatives instead of
  adding whole-label exceptions for individual employers.
- Project an intent into text, native selections, datalists, or associated custom
  dropdowns. Require a committed choice, not merely matching search text.
- Permit bounded single-control ownership when a widget omits ARIA references;
  do not bypass invalid explicit references or borrow unrelated options.
- Support plain-text editable textboxes and semantically labelled search inputs.
- Compare committed values before protecting a user edit. Focus and navigation
  are not edits; real changes and deliberate clears remain protected by Autofill
  and Undo, including native and custom choice controls.
- Distinguish non-submitting default buttons outside forms from actual submit
  buttons. Explicit submit/form attributes remain blocked.

## Verification

- 44 new network-isolated browser scenarios pass, including exact reported
  labels, unrelated domains, widget variants, source/option ambiguity, ownership,
  actual trusted edits and submit prevention.
- Production ZIP runtime passes those 44 scenarios and 34 discovery scenarios.
- Full shared extension suite passes, including its 200-case context suite,
  custom choices, history, contact scope, compound controls, education and
  malformed employer validation tests.
- Core autofill and semantic extension suites pass.
- 1,227 unit tests pass. Typecheck passes. Lint has zero errors and the two
  existing unused-variable warnings in ai-access.ts and auth-password-reset.ts.
- Production package: 172,822 bytes. Production, store and store-test package
  checks pass. Extension ID, origin and permissions are unchanged.

## Live browser checks

Used the existing signed-in account and previously authorized profile/resume on
two fresh employer tabs. Inspected the actual employer form after Autofill, not
just the extension's progress count. No applications were submitted. Only the
two temporary test tabs were closed afterward; existing user tabs were retained.

### Achievers / Lever

https://jobs.lever.co/achievers/8a27486d-aa52-4a24-9222-bca5c6e9824c/apply

- Clicked into blank Current location and tabbed away before Autofill.
- Observed saved city/province/country in that field, contact details, LinkedIn,
  Other as the job source, the uploaded resume and explicitly saved voluntary
  choices on the employer form.
- Reported 8 filled and 10 left empty. Current company was later populated by
  the employer's resume parser; this is not counted as an extension success.
- Remaining gaps include unresolved employment-country context, hybrid schedule
  wording, an unsuccessful programming-language answer generation and screening
  questions without sufficiently supported answers. Background-check and
  future-contact consent were not accepted automatically.

### Sentry / Ashby

https://jobs.ashbyhq.com/sentry/68757804-a892-40ed-8ea7-f2d13500f29c/application

- Observed a committed custom location selection, both LinkedIn and GitHub,
  contact details, uploaded resume, saved voluntary choices and generated
  profile-backed prose in the employer's Why Sentry textarea.
- Final installed build reported 9 filled and 6 left empty.
- Remaining: missing pronouns; insufficient evidence for a specific architectural
  decision story; privacy acknowledgement; no exact match for the saved race
  choice; hybrid weekday preference; sponsorship wording using "the location
  where this job is posted". The last item is a backend meaning-matching gap,
  not proof that the profile lacks sponsorship information.
- Default-button ownership is fixed and fixture-tested, but it does not fix
  those backend question-matching gaps by itself.

## Delivery state

Installed and reloaded version 0.11.5 in the user's existing unpacked Chrome
extension. Chrome visibly confirmed the version and reload. The previous 0.11.4
folder was backed up, and all 14 generated files were copied and verified.

No production web deployment or public download update was performed for this
change. These live results do not certify other employers, authenticated ATS
flows, closed shadow roots, inaccessible frames, or arbitrary rich editors.
