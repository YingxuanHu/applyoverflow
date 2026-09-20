# Chrome Web Store Release Preparation

Candidate: 0.5.0. This is an implementation checklist and listing draft, not a
claim that the extension is published or approved.

## Draft Created September 20, 2026

- Store-assigned ID: `mhkkioknljkgnhgnhcamilkgbadjnmil`.
- The publisher account is active and 0.5.0 is uploaded as a draft, not submitted.
- Listing description, category, language, homepage and technical privacy
  disclosures are saved. The existing brand icon and a real 1280x800 settings
  screenshot are uploaded. Owner certifications, a verified publisher contact
  email and reviewer access still require completion before submission.
  No legal certification was accepted.
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
| Optional Greenhouse, Lever, Ashby, Workday and iCIMS host patterns | Show local form hints after the user grants access, including matching frames. No arbitrary employer-parent host permission. |

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
