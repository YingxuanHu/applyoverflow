# Embedded Application Forms and Release Readiness

Date: September 19, 2026. Candidate: 0.4.0, based on `1918a20`.
This batch is local and uncommitted. It has not changed production or published
an extension. Production previously received 0.3 and its migrations.

## Implemented

- Optional detection now runs in supported Greenhouse, Lever and Ashby frames,
  not just the top page. No additional origins or broad parent-site permission.
  An installed top-frame-only registration upgrades without regranting access.
- Embedded hints begin in normal flow above the form, rather than below the
  visible page in a tall iframe. Direct pages keep their floating hint.
- Greenhouse `embed/job_app` requires one valid tenant and one numeric token.
  Direct/embedded URLs share a question-review identity, but a resume grant stays
  bound to the exact selected URL, session and document.
- Fill, undo and resume actions target the original iframe document. Replacing
  that frame while the profile request is pending cannot fill the new document.
- Turning off site access removes hints and pauses detection. Existing permitted
  frames can receive the re-enable signal without access to their parent site.
- Custom combobox/listbox labels can be reviewed in the web workspace. No custom
  dropdown answers are filled. Value-bearing/self-referencing labels and
  ambiguous multiple references are excluded from capture.
- Public `/extension/privacy` data-use notice, linked from connection consent,
  settings and the extension. Verified signed-out rendering at desktop and 390px.
- Separate `--store` package with fixed production origin and no preview key.
  `--store --local` and `--store --publish` fail closed. No new dependencies or
  runtime permissions; ZIP about 100 KiB. Listing/permission draft and owner gates
  are in `docs/extension-web-store.md`.

## Verification

- 964 unit tests passed (27 suites), including embedded tenant/region identity,
  exact company-logo mapping and existing salary extraction regressions.
- TypeScript and scoped ESLint passed. Optimized isolated Next.js build passed.
  The first isolated build lacked a required build-time database URL; it was
  rerun with a loopback-only placeholder, not production credentials.
- Contact, resume and Undo browser suites passed across the three adapters:
  selected file bytes, existing answers/files, hidden/disabled/ambiguous controls,
  replacement/navigation, user edits and zero Next/Submit actions.
- Real MV3 iframe fixtures passed registration upgrade, trusted-click enforcement,
  parent/sibling isolation, review privacy, Undo, delayed-response replacement,
  390px layout, initial visibility in a 2400px-tall frame and permission revoke/re-enable. An initial headless review-tab
  wait timed out; the rerun passed with failure diagnostics added.
- Real MV3 direct-form detection regression passed: Greenhouse 413ms, Lever 405ms,
  Ashby 409ms; click-to-fill 860ms, 231ms and 217ms, respectively. These are
  synthetic single-run timings with mocked API responses, not production p95s.
- Local database resume integration passed exact embedded URL binding, rejected
  direct/other-tenant URLs, ownership, PKCE, one-use races, expiry, revocation,
  document revision and cleanup.
- Real Chrome MV3 with the optimized local backend passed sign-in, connection
  consent, iframe contact fill/Undo, question review, profile copying, 320px review,
  resume cancellation, explicit file choice and approval, exact-byte attachment,
  disconnect and revoked-token rejection. Parent fields were untouched; no employer
  Next/Submit was invoked. Disposable account, resume and connections were removed.
  The first development-server run was interrupted because route compilation took
  30-50 seconds. Subsequent built-server testing exposed a test-harness window-size
  issue: the mobile review check resized Chrome's shared window before pointer
  actions in another tab's iframe. Restoring the window size fixed the test; no
  weaker permission or programmatic untrusted-click bypass was introduced.
  Final cleanup queries confirmed zero fixture users and documents remaining.
- Live read-only Bevi/Greenhouse embedded URL detected three empty contact fields
  and a resume field. The compact hint was visually inspected. No real employer
  fields, files or submission controls were changed.

Artifacts (ignored) are under `output/playwright/assistant-04-*`,
`assistant-frames-final.log`, `assistant-embedded-*`, and `assistant-data-use-*`.
The completed authenticated browser flow is recorded separately in
`assistant-embedded-backend-built.log`, not the interrupted development-server run.

## Logo Evidence

Added only the exact **Mahindra Group** + `jobs.mahindracareers.com` association
to `mahindra.com`. Mahindra's own [careers page](https://www.mahindra.com/career)
links to that host (Find A Job and M&M Limited Apply Now). The production logo
endpoint returned a visually verified red Mahindra mark, 32x32 PNG, 167 bytes.
Unrelated subsidiaries and lookalike hostnames do not inherit this mapping.

The existing bounded memory cache and browser caching remain unchanged. No
server-side image files, per-job logos or new image storage were added. This
does not assert universal logo coverage or change job-region eligibility.

## Remaining Work

- Deploy website/backend and 0.4 preview together; previous backends reject
  Greenhouse embedded URLs for review and resume grants. Installed unpacked
  previews require manual reload and employer-page refresh.
- Chrome Web Store publication still needs the developer account, assigned ID,
  verified contact/legal disclosures, listing assets, reviewer access and review.
- Workday, iCIMS, custom-domain adapters, structured employment/education repeaters
  and custom-select filling remain unsupported. Existing manual profile reference
  remains available. This is not universal autofill compatibility.
- Continue bounded salary repairs only with source evidence. Dillon job 4253
  currently states `$140,000 - $170,000` but its JSON-LD has no salary currency;
  no currency rewrite was performed from location alone. The previously completed
  Sun Life/Bevi repairs were not repeated.
- Large PostgreSQL table-body relocation remains a separately planned maintenance
  operation; this batch made no infrastructure or production data changes.
  Final read-only disk check: root 150 GiB, 123 GiB used, 22 GiB available (85%);
  attached volume 148 GiB, 49 GiB used, 92 GiB available (35%).
