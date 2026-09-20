# Chrome Web Store Release Preparation

Candidate: 0.5.2 (local patch; Store draft remains 0.5.0). This is an implementation checklist and listing draft, not a
claim that the extension is published or approved.

## Draft Created September 20, 2026

- Store-assigned ID: `mhkkioknljkgnhgnhcamilkgbadjnmil`.
- The publisher account is active and 0.5.0 is uploaded as a draft, not submitted.
- Listing description, category, language, homepage and technical privacy
  disclosures are saved. The existing brand icon and a real 1280x800 settings
  screenshot are uploaded. Owner certifications, a verified publisher contact
  email and reviewer access still require completion before submission.
  No legal certification was accepted.
- The owner subsequently reported completing privacy certifications and contact
  email verification. That completion has not yet been independently rechecked
  in the dashboard. No review submission or publication occurred in this patch.
- The dashboard public key is recorded in `extensions/chrome/store-release.json`.
  `npm run extension:build -- --store-test` verifies its derived ID and makes an
  isolated unpacked candidate. It never overwrites the consumer preview download.
- Production's exact allowlist contains this ID and the existing preview ID.
  Do not link to a consumer Store installation until Google approves the listing.
- Real Chrome Store-ID consent, selected-history/stale-version checks, resume
  approval, exact PDF bytes, one-time redemption and revocation passed against
  production. The resume callback was intercepted for this Store-ID check;
  actual MV3 attachment/Undo passed with the byte-identical preview runtime.
  The new Store ID's optional-site permission check still needs human approval.

## 0.5.2 Compatibility Follow-Up

- The owner approved using their profile for testing and reported signing back
  into TD. Native Chrome control subsequently returned no accessibility controls
  or screenshot, including after session recovery; live Fill/Undo is not verified.
  No employer application was submitted and no personal profile was changed.
- Read-only inspection of Fastbreak AI's live Workable application confirmed
  stable first-name, last-name and email identifiers without autocomplete tokens.
  Added a narrow adapter for those fields; compound phone/country, address search,
  custom questions, photo and resume widgets remain manual.
- Workable automatic detection uses one new optional host permission, never an
  all-sites grant. Existing grants continue working. Update the privacy notice,
  reviewer notes and Store draft before requesting review; the owner must approve
  Workable access in Chrome before testing automatic hints there.
- Generic contact detection now accepts valid section/recipient autocomplete
  prefixes and multiline street addresses. Unsupported/custom answers remain
  manual. Filling reports specific missing profile facts without exporting values
  in status messages, and revalidates every write/Undo after synchronous DOM changes.
- Added intercepted compatibility and safety fixtures with detection/fill budgets.
  These do not demonstrate universal platform compatibility or prove faster
  performance than Simplify. Authenticated TD/iCIMS testing remains a release gate.
- The owner reported completing a TD Fill test after reloading 0.5.2, and approved
  Workable access. No result screenshot was supplied and native controls remained
  unavailable, so neither the live field values nor the Workable permission grant
  is independently verified. Approval alone is not a granted browser permission.
- A cold real-backend browser run exposed lost clicks in Profile reference before
  hydration. Tabs and copy controls now follow the existing hydration-readiness
  pattern; the native disclosure remains usable. A server-rendering regression
  test verifies readable facts and disabled script-dependent controls.
- Final verification: 995/995 unit tests, TypeScript, scoped ESLint, package
  integrity, basic/expanded contact adapters, compatibility, readiness, resume
  and Undo checks passed. The compatibility fixture measured 6 ms detection p95
  across 20 scans and 109 ms filling; these exclude real network latency.
- The real local-backend MV3 workflow passed after the hydration fix: cancellation,
  reconnect, current saved profile facts, contact Fill/Undo/refill, profile
  reference, explicit resume choice/cancellation, exact file transfer and
  disconnect/revocation. Its disposable account and file were removed afterward.
- Rebuilt 0.5.2 candidates are about 114 KB. The actual Chrome worker history
  regression also passed for Workday/iCIMS fixtures, including selected-entry
  export, safe Undo, explicit tracking, replay rejection and account cleanup.
  Employer forms/APIs were intercepted; these are not authenticated tenant tests.
  Production and the uploaded Store draft remain unchanged.

## 0.5.1 Detection Patch

- The installed Store-ID unpacked copy was disconnected and had only the
  ApplyOverflow host grant; automatic ATS hints were therefore off. This is now
  explicit in separate Profile and Site access statuses.
- TD's authenticated My Information step was inspected without filling or
  advancing it. Its email is static text. The Workday adapter now recognizes
  the dedicated apply container without requiring an editable email; existing
  per-field identity and password-page exclusions still apply.
- Question-only and history-only steps retain the on-page entry point. Session
  changes notify existing hints without transmitting profile data.
- A live TD popup stalled while initialization awaited other tabs. Tab
  notifications and reinjection are now best-effort rather than blocking
  readiness; passive page scans also time out after 2.5 seconds.
- Live read-only verification after reload: TD detected six empty contact fields
  and eight questions; Canonical Greenhouse detected four contact fields, a
  resume upload and 24 questions. Both popups showed Not connected / Toolbar only.
  Actual profile-backed filling still requires connection and permission consent.
- Basic fill, resume, Undo, expanded adapters, readiness UI, package integrity
  and 14 focused unit checks passed locally. A fresh headless MV3 run could not
  approve Chrome's optional-site prompt; native permission and authenticated
  employer filling must not be claimed from those fixture results.
- The real MV3 Workday/iCIMS selected-history, Undo and explicit tracker flow
  passed using intercepted fixture APIs in the dedicated browser-test profile.
- 0.5.1 was rebuilt and reloaded into the existing unpacked Store-ID extension.
  Production and the uploaded Store draft were not updated. No employer
  application was submitted, no real fields were filled, and no AI answer
  generation was added. The observed Canonical application explicitly prohibits
  AI-generated answers; its custom responses must remain the applicant's own.

## September 20 Follow-Up Verification

- Confirmed the user's installed Store-ID extension now has supported-site
  permission. Closed an abandoned Chrome identity window that had navigated to
  Jobs, then completed real production consent; the popup reports Connected.
- Found that the consent page's Cancel link navigated to Jobs without returning
  to Chrome. The local patch returns a state-bound cancellation, displays active
  approval status when reopening the popup, and expires abandoned waits after
  five minutes without processing late callbacks. These web fixes are not deployed.
- Passing local real-backend integration uses a temporary account with confirmed
  contact facts and a synthetic resume, not the unconfigured localhost admin
  profile. It covers cancellation/reconnect, profile-backed fill, Undo/refill,
  question review, profile reference, resume cancel/approve, exact bytes and
  revocation. The wrapper deletes the test account and file afterward.
- Readiness, basic/expanded adapters, resume, Undo, cross-origin MV3 frames,
  Workday/iCIMS fixture history, 15 focused unit checks, TypeScript and scoped
  ESLint passed. Current Store test ZIP is about 113 KB; permissions are unchanged.
- Remaining: uninterrupted live profile-backed TD/Greenhouse testing and
  authenticated iCIMS verification. No real employer fields were filled, resumes
  attached or applications submitted during this follow-up. Do not infer live
  tenant compatibility from fixture success. Store publication is still pending.
- The production profile has full name/email/phone, but separate given/family
  name and address fields are empty. Name splitting is intentionally not guessed.
  Live Fill/Undo and completing those profile fields are awaiting owner confirmation.
- The full MV3 detection run passed on the three supported ATS fixtures, with
  405-414 ms detection and 204-239 ms filling, zero unsafe changes and no page
  errors. These are synthetic local timings, not production latency measurements.

## Package and Identity

1. Run the verification commands in `extensions/chrome/README.md` and build the
   matching website/backend revision. No new database migration is needed for
   0.5; the three assistant migrations from 0.3 must already be present.
2. Run `npm run extension:test:package`. The production preview retains its
   stable unpacked identity; `output/extension/store.zip` has no development key,
   uses only `https://applyoverflow.com`, and does not replace the preview ZIP.
3. In the verified developer account, upload the Store ZIP as a **draft**. Record
   the assigned extension ID; never guess it or enable every extension ID.
4. Confirm the Store ID in the dashboard. Explicitly add only the approved ID to
   `APPLICATION_EXTENSION_IDS`, retaining the preview ID while testing the beta.
   To test an unpacked candidate with the assigned identity, use the dashboard's
   public key in an isolated build and verify that Chrome displays the same ID.
   Do not put account credentials or private signing keys in Git.
5. Deploy the matching backend/data-use page before sharing 0.5. Verify the public
   disclosure URL, exact redirect allowlist, sign-in consent, resume approval,
   revoke, and rejected-token behavior with that identity.
6. Only after approval, point the consumer install action at the actual listing.
   Keep the developer ZIP clearly labeled as a preview during the transition.

The Store upload/publishing identity is separate from the existing production
preview ID `jmkdjgbpikdhflpknomggmlccccgkbbp`.

## Listing Draft

Name: **ApplyOverflow Assistant**

Short description:
> Fill confirmed contact details and review application questions. Never submits applications.

Detailed description:
> ApplyOverflow Assistant helps you complete supported job application forms
> using the profile and resumes you have already reviewed in ApplyOverflow.
>
> Connect your account, then choose Fill contact details on a recognized
> Greenhouse, Lever or Ashby form. Optional on-page hints can also find supported
> embedded forms. Existing answers are kept, and Undo is available for unchanged
> contact fields. Choose resume opens a separate confirmation where you select
> one file for that application. Review questions opens your ApplyOverflow
> application workspace rather than a large browser sidebar.
>
> History & tracking lets you fill one selected profile entry into an existing
> empty work or education row, or explicitly confirm an application you submitted
> and save it in your private tracker. Workday/iCIMS adapters are in beta. Other
> HTTPS application sites can use conservative toolbar inspection; a job does
> not need to have been opened from ApplyOverflow.
>
> The current release does not automatically answer custom questions, make legal
> or demographic choices, add history rows, click Next, or submit applications.
> Unsupported dates and ambiguous fields stay manual. Selected education/history
> entries support exact-match, reversible ARIA single-select dropdowns; other
> custom dropdowns stay manual.
> Check all fields and the employer's upload status
> before submitting. Employers may autosave data before submission; Undo cannot
> retract information already received by an employer.
>
> An ApplyOverflow account and an explicit connection are required. Site access
> for automatic hints is optional. Disconnect at any time in the extension or
> ApplyOverflow's Application assistant settings.

## Permissions and Data Disclosures

| Permission | Purpose |
| --- | --- |
| `activeTab` | Inspect/fill a supported top-level form after an explicit toolbar action. |
| `scripting` | Run the packaged inspector in the selected supported document; no remote executable code. |
| `storage` | Session-scoped connection credential and local hint preference; no Chrome profile sync. |
| `identity` | Sign-in/consent and separate resume-approval redirects with state and PKCE. |
| `https://applyoverflow.com/*` | Authenticate and call the narrow extension API. |
| Optional Greenhouse, Lever, Ashby, Workday, iCIMS and Workable host patterns | Show local form hints after the user grants access, including matching frames. No arbitrary employer-parent host permission. |

Public data-use notice: `https://applyoverflow.com/extension/privacy` after deploy.
It covers contact facts, account identity, selected work/education entries,
resume transfers, selected employer URLs/titles, explicit application tracking
and captured question labels, saved reviews, remembered answers, retention
and deletion limits. Detection stays local; Review deliberately transmits the
selected application URL/title/labels. Do not declare that the extension handles
"no personal data" or "no website content" in the dashboard.

The implementation has no advertising, third-party analytics or remote-code
execution. The developer must complete the Store's actual privacy questionnaire,
Limited Use certification and legal disclosures accurately. This technical
notice is not a substitute for owner/legal review or required developer contact
information.

## Submission Gates Still Requiring an Owner

- Verified Chrome Web Store developer account and its required registration.
- Actual support contact, publisher identity and approved privacy/legal wording.
- Store-assigned ID, narrowly enabled on the production server.
- Real product screenshots in the dashboard's required sizes. Use the production
  candidate, with synthetic personal data and no tokens or real resumes visible.
- Reviewer access/instructions supplied privately through the dashboard. Do not
  publish a production password in this document or the listing. The reviewer
  must be able to exercise connect, fill, resume consent and disconnect without
  submitting an application to a real employer.
- Recheck the current dashboard requirements before submission, then wait for
  Google's review. Store approval is not implied by a passing local test.

Primary references:
[publishing](https://developer.chrome.com/docs/webstore/publish),
[extension identity](https://developer.chrome.com/docs/extensions/reference/manifest/key),
[user-data policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).
