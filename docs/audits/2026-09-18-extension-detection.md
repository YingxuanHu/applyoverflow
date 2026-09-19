# Application Assistant 0.2 Verification

## Implemented

- Shared, strictly tenant/region-scoped URL identity across scanner, worker and
  server. Added direct Lever and Ashby support to Greenhouse.
- ATS-specific identity identifiers, real Lever required markers, and Ashby's
  div-based application container. No guesses from generic autocomplete fields.
- Opt-in host permissions for seven explicit ATS hosts, dynamic isolated scripts,
  small dismissible hint, delayed form/SPA detection, and permission revocation.
- Profile data is fetched only on Fill; existing values and unsupported controls
  are untouched. Late responses are bound to the original document and URL.
- Production/local ZIP builds, stable public preview identity, Settings download
  and install disclosure. No extension credentials or private signing key in ZIP.

## Measured

948 unit tests, TypeScript, changed-file ESLint, database integration and real
Chrome identity/contact-fill integration passed. The underlying app's full
production build was not run in this batch; generated extension bundles were
loaded and exercised directly in Chrome.

Controlled Chromium fixtures, not production throughput benchmarks:

| Provider | Delayed-form detection | Fill with fixture API | Expected fields |
| --- | --- | --- | --- |
| Greenhouse | 394 ms | 216 ms | 4/4 |
| Lever | 404 ms | 226 ms | 4/4 |
| Ashby | 400 ms | 214 ms | 2/2 |

The target is under one second from visible form readiness to indication, with
zero unsafe mutations. Cases passed: no hints before permission or on unsupported
forms/sites, SPA exit/re-entry, dynamic mounts, repeated fill, per-page dismissal,
permission revocation/re-enable, synthetic-click rejection, delayed-response URL
race, sensitive/manual controls, no existing answer upload, and no Next/Submit.

Real unpacked extension tests also passed Chrome identity consent/PKCE and an
authenticated hint-to-contact-API-to-field-fill flow using a temporary local
test account. The account, session and connection are cleaned up. No real employer
form was filled. Native Chrome Extensions-menu interaction separately verified
activeTab filling with automatic host permissions off.

Live read-only smoke check, September 18: Figma/Greenhouse detected four empty
contact fields, Palantir/Lever six, Notion/Ashby two. The actual isolated content
script displayed its hint on all three. These samples are not a claim of universal
compatibility. The user-facing full field list remains the employer's form.

The generated ZIP was served with HTTP 200 and application/zip locally, contains
only ten runtime files, and is approximately 97 KiB. Desktop and 390px screenshots
are in ignored `output/playwright/assistant-{indicator,install}-*.png` and
`assistant-live-*.png`.

## Release Boundaries

No commit, merge, deployment or Web Store publication in this batch. The public
preview ID must be explicitly enabled after backend migrations/deployment. Until
then the Settings page accurately reports that connections are unavailable.
Chrome Web Store approval is required for a normal consumer installation/update
flow; the ZIP is an unpacked developer preview, not a store listing.

Workday, iCIMS, custom employer domains, embedded frames, resume attachment,
repeated employment/education sections, custom comboboxes and automatic narrative
answers are not supported in this preview. They stay manual rather than falsely
showing a working-autofill indicator. Continue with separately tested adapters
and user-approved resume handling before widening coverage.
