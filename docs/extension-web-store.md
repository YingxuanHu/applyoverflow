# Chrome Web Store Release Preparation

Current submission: 0.15.1, **Pending review**, with automatic publication after
approval enabled. The extension is not published or approved yet. Historical release notes
below are retained for audit purposes and must not be copied into the current
listing unchanged.

## October 12, 2026 Review Submission

- `npm run extension:test:package` passed for the production, Store and Store-ID
  test variants. `npm run extension:build -- --store` regenerated the upload at
  `output/extension/store.zip`: version 0.15.1, 171,161 bytes, no preview key or
  local origin. The consumer preview download was not changed.
- Production's running application allows both the preview ID and the recorded
  Store ID `mhkkioknljkgnhgnhcamilkgbadjnmil`. No allowlist expansion was needed.
- `https://applyoverflow.com/extension/privacy` returned HTTP 200 without sign-in.
- After the owner completed Google reauthentication, the existing item was
  inspected: its unpublished draft was 0.5.0. The Store ZIP was uploaded to that
  same item, and Package now reports 0.15.1. The current listing, single purpose
  and permission explanations were saved; the required host and optional custom
  HTTPS access are described accurately.
- Saved data-use categories are personally identifiable information, health
  information (optional disability answers), authentication information, location,
  web history (application context), user activity and website content. The
  existing three owner certifications were already checked. The owner explicitly
  reconfirmed the updated disclosures and approved submission for public release.
- Distribution is Public / All regions / Free of charge. The private reviewer
  username, password and instructions were initially empty. At the owner's
  request, a separate email/password reviewer was created at their alternate
  address, with synthetic contact details, professional history and a clearly
  labelled synthetic PDF. The existing Google-linked personal account was not
  modified. The reviewer has no ops access; sensitive-answer and automatic
  default-resume sharing remain off. Its credentials and instructions were saved
  only in the dashboard's confidential Test instructions section. The local
  credential receipt is ignored by Git and restricted to mode 0600.
- Production reviewer verification passed: actual email/password sign-in,
  Documents UI upload, primary-resume metadata, identical PDF download bytes and
  no browser JavaScript errors. A real 0.15.1 Store-ID MV3 browser run also passed
  connection consent, token exchange, authenticated contact retrieval and
  disconnect. No employer application or file transfer was performed.
- Captured a new 1280x800 screenshot of configured production settings with the
  connected synthetic reviewer and uploaded it to the Store draft. The earlier
  disposable local screenshot was not used because its deployment has extension
  connections disabled. The owner removed the old 0.5.0 image; the remaining
  current screenshot and listing were saved before submission.
- Google confirmed "Your extension was submitted for review" and the dashboard
  changed to **Pending review**. The submission dialog's automatic publication
  checkbox was enabled, matching the owner's explicit approval for public release.
  Google review and actual public availability remain pending. Do not advertise
  the Store installation as available until publication is verified.
- Screenshots and review access must use synthetic information. Do not expose
  the owner's personal account, profile, resume, passwords or production logs.
- The release's public compatibility benchmark and synthetic UI/model tests are
  documented in `docs/development/auto-apply-validation.md`. They do not establish
  universal compatibility or authenticated Workday application completion.

### Current Listing Text

Name: **ApplyOverflow Assistant**

Short description:
> Autofill applications from your profile. Review and approve each supported submission.

Single purpose:
> Help applicants complete job application forms using their confirmed ApplyOverflow profile and review each supported submission.

Detailed description:
> ApplyOverflow Assistant helps you prepare job applications using the profile
> and resumes you have reviewed in ApplyOverflow.
>
> Fill supported contact details, professional links, education and work history.
> Prepare professional answer drafts using your background and the job
> description, then review and edit those answers directly on the employer form.
> Optional saved personal answers are used only when you explicitly enable them;
> the assistant does not infer demographic information or accept legal
> declarations for you.
>
> Attach your chosen resume after approval, or explicitly enable your default
> resume for Autofill. Follow field-level progress and recovery messages without
> re-entering your profile in the popup.
>
> The Auto Apply workspace in ApplyOverflow lets you queue matches, prepare an
> application and review supported fields. On compatible single-page forms,
> submission requires a separate readiness check, document review and your
> explicit approval for that application. Autofill alone never submits.
> There are no unattended batch submissions or automatic retries when the
> employer's acceptance cannot be verified.
>
> An ApplyOverflow account and an explicit extension connection are required.
> Site access is optional: use the toolbar for the current page, or enable
> on-page assistance for permitted application sites. Compatibility depends on
> the actual form controls. Login, CAPTCHA, unsupported controls, missing facts
> and legal declarations can require your action; not every site or field is
> supported. Always review AI drafts, answers and upload completion before
> submitting.
>
> Employers may autosave entered values or begin receiving an uploaded file
> before submission. Undo cannot retract information already received by an
> employer. Disconnect at any time through the extension or ApplyOverflow's
> Application assistant settings.

### Current Privacy And Permission Notes

- Single purpose and permission explanations must reflect the current package:
  `activeTab`, `scripting`, `storage`, `identity`, first-party ApplyOverflow host
  access and optional application-site access, including a user-enabled HTTPS
  grant for custom employer forms. Do not describe the permission scope as only
  three named ATS providers.
- Connection credentials are kept in trusted extension local storage, not
  session-only storage or Chrome profile sync. The package contains no remotely
  downloaded executable code; first-party API responses and AI answer text are
  data, not scripts to execute.
- Disclose contact/profile data, professional history, user-provided documents,
  authentication information and the relevant employer-page content. Explicit
  optional sensitive-profile preferences need matching data-use disclosures.
  Do not select a blanket "no personal data" or "no website content" declaration.
- Professional answer drafting sends a question, bounded job-description
  context and relevant professional profile evidence to OpenAI through
  ApplyOverflow. Contact details and optional demographic answers are excluded
  from that evidence. Do not claim the complete extension has no AI data flow.
- Keep the Store declarations consistent with the public data-use page. Owner
  certifications and publisher/legal details need the owner's review; these
  technical notes do not accept a legal agreement on their behalf.

### Reviewer Instructions

Provide any dedicated synthetic reviewer account only in the dashboard's private
Test instructions field. Do not put credentials in this repository or in the
public listing. Verify its sign-in and profile/resume setup before submission.

1. Install the Store candidate and use Connect to sign into the dedicated
   ApplyOverflow test account, then approve the connection.
2. Review Profile and Application assistant settings. Optional sensitive
   preferences and default-resume sharing remain off unless explicitly enabled.
3. Open a supported application form and click Autofill. Employer sites may
   receive field values or a resume before submission; use only the synthetic
   review profile and do not submit an application to a real employer.
4. Confirm supported values are inserted, professional drafts are editable on
   the employer form, and the assistant reports filled/unchanged/empty fields.
5. Open Applications > Auto Apply to inspect matching requirements, the review
   queue, preparation consent and connection/recovery states. Final employer
   submission is a separate, explicit action; do not exercise it on a real job.
6. Disconnect the extension and confirm account access requires reconnection.

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

The 0.6.1 candidate supersedes the contact-only flow with one Autofill action.
Before Store submission, update the listing and re-review privacy certifications:
Autofill shares confirmed profile facts (including optional preferred name and
pronouns), bounded history, and exact employer/question answers explicitly enabled
for reuse. Default resume sharing is a separate Profile opt-in. Optional demographic
and country-specific work-eligibility answers now have a separate Profile opt-in,
with exact-question/option matching and no inference. Update the Store data-use
disclosures and owner certifications for these optional sensitive fields before
submitting this build. They are not used in AI or ranking. Legal agreements and
unsupported sensitive questions remain manual; nothing is submitted. Previous
0.5.x listing text below is historical and must not be submitted unchanged.

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

Short description for the approved-submission pilot (0.13.0):
> Autofill from your profile. Review and approve each supported application submission.

Before uploading 0.13.0, replace the historical detailed listing below and
re-review privacy disclosures for the separate approval-gated submission action.
Autofill itself still never submits; the pilot never performs unattended batches,
CAPTCHA bypass or automatic retries. See `extensions/chrome/README.md` for its
readiness gates and duplicate-attempt storage.

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
| Optional Greenhouse, Lever, Ashby, Workday, iCIMS, Workable and HiBob host patterns | Show local form hints after the user grants access, including matching frames. No arbitrary employer-parent host permission. |

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
