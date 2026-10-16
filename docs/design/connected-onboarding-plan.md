# ApplyOverflow Connected Onboarding Plan

Design proposal, October 15, 2026. Scope: website and Chrome extension onboarding. No application implementation or publishing is included in this phase.

## Diagnosis

**The main problem is not an insufficiently detailed wizard. It is that the product has several different completion boundaries, but presents them as one setup process.**

Today, clicking **Confirm details** saves a draft. Those details become available to autofill only after **Finish setup** on the later Job interests step. Installing the extension, signing into the website, connecting the extension, confirming extracted information, and approving resume sharing are also separate events. The current interface does not consistently explain which has happened or what the user can do next.

The recommendation is an **intent-aware website setup flow with a short, explicit extension connection at the end**. Confirm reviewed profile details before optional job preferences. Keep lengthy setup in a normal browser tab, preserve the original application context in the extension, and return users to that application for their first real autofill. Website-first users should remain free to go directly to `/jobs` without installing anything.

Do not introduce another onboarding database, a required tour, a universal readiness score, or a promise to automate every application.

## Audit

### Existing strengths

| Foundation | Verified behavior | Design implication |
| --- | --- | --- |
| Authentication and destinations | Email verification and optional Google authentication exist. Local callback validation rejects external redirects and unsafe paths. New-account enrollment is separate from existing accounts. | Preserve these boundaries; carry a small setup intent through them. |
| Profile review | Setup imports are isolated from the canonical profile until confirmation. Revision checks and transactions protect simultaneous imports and stale saves. Manual entry is supported. | Extend the existing draft and confirmation model, rather than replacing it. |
| Minimal requirements | Completion currently requires a name and valid contact email, not a resume, work history, social links, or demographic answers. | Keep basic setup short and inclusive. Browsing jobs requires no profile-completion gate. |
| Explicit connection | The extension uses an authorization code with PKCE, state checking, session ownership, revocation, and explicit connection consent. | Retain the short consent ceremony after setup. |
| Resume controls | File delivery is separately authorized and bound to the connection, application context, and selected document revision. | A primary resume is not equivalent to permission to upload it. |
| Recovery and permissions | Structured recovery actions, version checks, optional site permissions, and toolbar-triggered operation already exist. | Improve orchestration and copy instead of building a second recovery system. |
| Test foundation | There are onboarding, import-isolation, extension-package, connection, permissions, and browser fixtures. | Extend these with end-to-end onboarding assertions and account-switch cases. |

Relevant implementation: [setup state](/Users/alvinhu/projects/autoapplication/src/lib/profile-setup.ts), [setup actions](/Users/alvinhu/projects/autoapplication/src/app/onboarding/actions.ts), [resume import](/Users/alvinhu/projects/autoapplication/src/lib/profile-resume-service.ts), [connection queries](/Users/alvinhu/projects/autoapplication/src/lib/queries/application-assistant.ts), and [resume delivery](/Users/alvinhu/projects/autoapplication/src/lib/queries/extension-resume.ts).

### Confirmed gaps

1. **Confirmation happens too late.** The Your details button says Confirm details, but advances with a draft save. Canonical profile updates happen only on the final step. Finish later correctly preserves draft isolation, but may leave users believing their new details are usable. [Button](/Users/alvinhu/projects/autoapplication/src/components/profile/profile-setup.tsx:514), [transaction](/Users/alvinhu/projects/autoapplication/src/app/onboarding/actions.ts:70).
2. **The installation does not introduce the product.** `onInstalled` initializes detection but opens no welcome or resumable setup destination. The popup connection action immediately begins authorization, which has an application-enforced five-minute timeout. New-user authentication and setup can be interposed in that journey. [Installation](/Users/alvinhu/projects/autoapplication/extensions/chrome/background.mjs:132), [authorization](/Users/alvinhu/projects/autoapplication/extensions/chrome/background.mjs:204).
3. **Connection labels do not describe profile readiness.** The popup's Profile row describes connection status, not whether imported facts were confirmed. The server's `connection-status` response does not establish that the connected extension account matches the website's current account. Settings connection rows are historical server records, not current-browser proof. [Popup](/Users/alvinhu/projects/autoapplication/extensions/chrome/popup.html), [endpoint](/Users/alvinhu/projects/autoapplication/src/app/api/extension/v1/[action]/route.ts).
4. **Some recovery paths lose intent.** Google authentication failure uses a generic sign-in URL. Password-recovery links do not carry the local callback consistently. The successful main authentication paths already preserve it. [Google error callback](/Users/alvinhu/projects/autoapplication/src/components/auth/google-auth-button.tsx:25), [password recovery link](/Users/alvinhu/projects/autoapplication/src/components/auth/sign-in-form.tsx:155).
5. **Interrupted edits are not continuously saved.** Setup saves on navigation and Finish later. Closing the tab between those actions can lose edits. When the canonical profile changes elsewhere, the setup page hides the old draft in favor of current profile data; it does not offer a scoped reconciliation view. [Setup component](/Users/alvinhu/projects/autoapplication/src/components/profile/profile-setup.tsx), [stale-profile handling](/Users/alvinhu/projects/autoapplication/src/app/onboarding/page.tsx:29).
6. **Import and attachment eligibility differ.** Import accepts several document/image types up to 10 MB; extension sharing currently accepts PDF/DOCX up to 5 MB. A successful import therefore does not prove that the same file can be attached. Review-only import still creates the resume-library document and can make the first document primary, without confirming extracted facts or authorizing sharing. [Import service](/Users/alvinhu/projects/autoapplication/src/lib/profile-resume-service.ts), [sharing rules](/Users/alvinhu/projects/autoapplication/src/lib/extension-resume.ts).
7. **Some supported data cannot be corrected in setup.** The schema includes phone country and education field of study, but the current setup UI does not expose them. These should appear only when relevant, not become required steps. [Schema](/Users/alvinhu/projects/autoapplication/src/lib/profile-setup.ts), [editor](/Users/alvinhu/projects/autoapplication/src/components/profile/profile-setup.tsx).
8. **Distribution guidance is outdated.** Website extension settings instruct users to install a preview ZIP and say it is not a Web Store release. The popup has a literal Preview label. The local Store release file still says draft. These do not match the verified publication state below. [Settings](/Users/alvinhu/projects/autoapplication/src/app/settings/extension/page.tsx), [popup](/Users/alvinhu/projects/autoapplication/extensions/chrome/popup.html), [Store metadata](/Users/alvinhu/projects/autoapplication/extensions/chrome/store-release.json).

### Verified publication and production unknowns

On October 15, the authenticated [developer dashboard](https://chrome.google.com/webstore/devconsole/bc942b2e-6cb7-4b96-96a9-233eed03cffe/mhkkioknljkgnhgnhcamilkgbadjnmil/edit/status/published) showed **Published - public**, and its Published package showed **0.15.1**. The [public listing](https://chromewebstore.google.com/detail/applyoverflow-assistant/mhkkioknljkgnhgnhcamilkgbadjnmil) offered **Add to Chrome**, listed version 0.15.1, and displayed an October 13 update date. Public Store installation is therefore an appropriate default recommendation now.

The listing still includes a screenshot of preview ZIP installation instructions. Replace that screenshot alongside the onboarding release; do not use publication as proof that all public guidance is current.

Still unverified for this proposal: the exact website commit serving production; which package/version an individual browser has installed; production authentication/email-delivery reliability; actual onboarding abandonment and timing; accessibility on target devices; and current field coverage on live employer forms. Repository tests were inspected, not executed in this design phase. Store publication does not establish these other facts.

## Options and Recommendation

| Approach | Benefits | Costs and risks | Decision |
| --- | --- | --- | --- |
| One linear website wizard for everybody | Few branching screens; mostly reuses the existing flow. | Delays immediate autofill behind job interests; makes extension setup look mandatory; poor fit for existing profiles. | Reject as the default. Reuse its components, not its sequence. |
| Extension-owned onboarding in a popup or extension tab | Immediate installation context; browser permissions are local. | Duplicates profile/auth UI; popup closure interrupts work; accessibility and mobile support diverge; still needs website authentication. | Use the extension only for browser-local status and handoff. |
| Intent-aware website setup plus brief connection consent | Reuses profile/auth code; accommodates verification and long imports; preserves website-first discovery; supports clear account matching. | Needs a narrow setup bridge, safe return context, and explicit readiness rules. | **Recommended.** These are bounded changes that resolve the underlying handoff problem. |

Infer intent from the entry point: website, extension installation, or toolbar invocation on an application. Do not add a mandatory What brings you here question. Offer a secondary Browse jobs action when intent changes. Treat intent as navigation context, never as authorization to share data or submit.

The only website destination added should be a small `/extension/setup` coordinator. It reuses authentication and `/onboarding`; it is not another profile editor. Keep `/extension/connect` for final authorization and `/settings/extension` for ongoing connection management.

## Recommended Journeys

### A. Extension first with a new account

**Intent:** get useful autofill without understanding the product architecture first.

1. A genuine first installation opens `/extension/setup` in a normal tab. Show a short explanation and Set up autofill. Sign in is secondary. Updates, browser restarts, and development reloads do not reopen welcome.
2. Authentication keeps extension intent. Email verification may take as long as necessary; no extension authorization timer has started. On return, the normal website session resumes setup.
3. Offer Upload resume and Enter details manually. Neither resume upload nor work history is required. Account name/email prefill editable contact fields; the contact email can differ from the login email.
4. Review and confirm contact facts plus any imported sections the user chooses to review. Use reviewed details commits only that reviewed scope. Optional job preferences are not on this critical path.
5. Show the signed-in account and Connect extension. A short identity/consent flow runs now. Resume sharing remains a separate, default-off choice; it is not hidden inside connection approval.
6. After verified connection, offer Return to application if a valid context exists. Otherwise, Find jobs goes to `/jobs`, with concise toolbar guidance available in the popup.

**Required now:** authentication and explicit connection approval; name and valid contact email to label basic contact autofill available. **Deferrable:** all other profile information, documents, site-wide access, goals, and optional answers. Leaving preserves acknowledged drafts and completed milestones; it does not silently approve them.

### B. Extension first with an existing account

**Intent:** connect existing information, not create it again.

The normal website session identifies the account. Show a compact summary of saved contact details, pending import changes, and resume sharing status. Reuse canonical profile data without re-enrolling the account in the new-user wizard. Primary action is Connect extension when useful information is already saved; Review imported details is secondary unless no usable facts exist.

A legacy saved profile is labeled Saved profile, not newly reviewed today. Pending imports never replace it until explicitly confirmed. If the extension is already verified for this same account, skip consent and continue to the application. If accounts differ, require an explicit switch or a website account change; never silently overwrite the extension connection.

### C. Website first with a new account

**Intent:** find relevant work, potentially before preparing applications.

After authentication, offer optional resume import or manual contact review, with Browse jobs available immediately. On review confirmation, show the existing optional Job interests editor, then `/jobs`. Skip for now must not undo confirmed profile details or require installing the extension. Preserve a valid internal job/detail destination when the user arrived from one.

Introduce the extension near an application action or in Profile, not as a blocking feed interstitial. Use examples across finance, operations, marketing, research, and technology. LinkedIn, GitHub, a portfolio, a degree, and prior employment remain optional. Career changers may specify desired roles independently of current employment.

### D. Already on an employer application

**Intent:** finish this form with minimal interruption.

When the user invokes the extension, capture the tab/document/application identity before opening website setup. Display the employer domain in the extension's local return control. Do not reload, clear, or navigate the original application tab during setup.

Complete only missing milestones in the website tab. After connection, Return to application focuses the still-valid original tab. The user then clicks Autofill; completion of setup does not initiate data transfer to an employer automatically. If the original page changed or closed, offer Open your application rather than guessing a replacement job or replaying a stale fill.

Installing directly from the Store does not prove which employer tab the user intended. Do not infer a return target by scanning unrelated open tabs. Capture it only from a deliberate extension invocation or an existing validated application workflow.

### E. Returning with unfinished setup

**Intent:** continue without retyping or being trapped in onboarding.

Resume from the first unfinished milestone relevant to the current task, not necessarily the last numerical step. An already-confirmed contact profile with unreviewed work history can still be used for contact autofill. Profile shows Review imported details; the popup offers that only when useful for the current form.

Pending and deferred users can browse jobs. Explicitly reopening setup restores the acknowledged draft and review state. A concurrent Profile edit produces a comparison of affected sections before confirmation; never silently discard the draft or overwrite newer canonical values. Users can keep current saved values and discard an imported section, or review and apply the draft against the new revision.

### F. Mobile or unsupported browser

**Intent:** prepare a profile or discover work on the current device.

All website setup and `/jobs` functionality remains available. Do not attempt extension detection or install prompts in unsupported environments. Say Desktop Chrome needed for the extension and make Browse jobs the primary action. An optional link to extension setup can be revisited on desktop; do not claim the extension will install on another device.

On supported desktop Chrome, detection failure is still not proof of absence. Users may have blocked messaging, an older package, or another browser profile. Offer toolbar verification instead of repeated installation loops.

## Screen Specifications

Use the existing application shell, restrained headings, ordinary forms, and compact status rows. Do not create a marketing landing page, multiple floating checklist cards, or a mandatory carousel. Maintain one visually primary action. Keyboard focus, inline errors, and live status announcements are part of the specification.

### 1. Extension welcome and setup coordinator

- **Purpose:** connect installation to the account and saved profile.
- **Content:** product identity; one short website/extension explanation; Account, Details, Connection progress labels; current verified state when available.
- **Primary:** Set up autofill, or the next incomplete milestone when returning.
- **Secondary:** Sign in for a new visitor; Browse jobs; compact help.
- **Required input:** none.
- **Completion:** a server-authenticated website session exists; merely detecting the extension does not complete connection.
- **Destination:** authentication, profile review, or final connection depending on state.

### 2. Authentication and verification

- **Purpose:** establish the account that owns the profile.
- **Content:** contextual heading; ordinary email/password or configured Google sign-in; editable account choice; verification status and resend cooldown.
- **Primary:** Create account, Sign in, or Continue after verified sign-in, according to the actual state.
- **Secondary:** switch sign-up/sign-in; resend verification; change email; password recovery.
- **Required input:** existing authentication requirements only. Do not ask for profile history here.
- **Completion:** verified authenticated session, not a verification email being sent.
- **Destination:** the safe internal setup destination. Cross-tab verification resumes through that destination; user may need to sign in after verification under the current auth policy.

### 3. Prepare your details

- **Purpose:** choose an efficient input method without requiring a document.
- **Content:** optional resume upload, accepted import formats/limits, or existing saved-profile summary. Explain that import produces a draft.
- **Primary:** Upload resume for a new empty profile; Continue with saved details for an existing usable profile.
- **Secondary:** Enter details manually; Browse jobs / Finish later.
- **Required input:** none to skip; valid file only if uploading.
- **Completion:** import saved as a review draft, or manual-entry path selected.
- **Destination:** profile review. A parser failure retains manual entry and a specific retry action.

### 4. Review profile details

- **Purpose:** make reviewed facts usable now, independently of optional later steps.
- **Content:** name and email prefilled; optional phone/country and current location; imported section counts with Awaiting review labels. Expanded education includes field of study. Preserve history date precision and unknown values.
- **Primary:** Use reviewed details.
- **Secondary:** edit/review another section; Save draft and leave; discard an imported section without deleting the stored resume.
- **Required input:** name and valid contact email for basic-contact confirmation. Other sections are validated only when selected for confirmation; an incomplete education record must not block contact confirmation.
- **Completion:** server acknowledges the exact reviewed scope and new canonical revision. Contact fields displayed in the main editor are included by the primary action. Imported history sections must be opened and explicitly marked reviewed before inclusion; collapsing them does not count as review.
- **Destination:** extension connection for autofill intent; optional job interests for website intent. Unreviewed sections remain drafts with a visible reminder, not silently committed or deleted.

### 5. Optional job interests

- **Purpose:** improve discovery without blocking basic autofill.
- **Content:** existing target-role and location controls; clarify that desired location is distinct from residence and work authorization.
- **Primary:** Save interests and browse jobs.
- **Secondary:** Skip for now.
- **Required input:** none. Save only user-entered preferences; do not infer relocation consent from a preferred city.
- **Completion:** preferences saved or explicitly deferred; either outcome preserves previously confirmed facts.
- **Destination:** `/jobs` or the preserved internal job destination. Extension-first users encounter this later in Profile, not before their first fill.

### 6. Connection approval

- **Purpose:** authorize this extension to use the selected account.
- **Content:** account identity, concise permission disclosure, existing separate resume/optional-answer controls, and a clear account-change path.
- **Primary:** Connect extension.
- **Secondary:** Cancel; use another account through normal website sign-in.
- **Required input:** explicit approval and any required fresh authentication. Resume sharing and broad site access are not prerequisites.
- **Completion:** code exchange succeeds and the server validates the extension credential. A website success redirect alone is insufficient.
- **Destination:** setup coordinator with a fresh account-match check. Cancellation returns to a resumable state without losing profile work.

### 7. Resume sharing when needed

- **Purpose:** distinguish a saved file from permission to attach it.
- **Content:** selected filename, attachment eligibility, current sharing setting, and destination application when requested from a form.
- **Primary:** existing per-file Use this resume approval; or explicitly enable default sharing in the corresponding existing settings flow.
- **Secondary:** Not now; choose another document; manual upload fallback.
- **Required input:** explicit user choice. Do not precheck default sharing after import.
- **Completion:** current file is eligible and authorization is recorded. Upload completion is a separate later result.
- **Destination:** original form or setup coordinator. Contact filling remains available when no file is chosen.

### 8. Connected and ready to continue

- **Purpose:** close the website-to-extension handoff without overstating capability.
- **Content:** verified account; Basic contact autofill available when true; separate resume and optional on-page-assistant rows.
- **Primary:** Return to application when the captured tab still matches; otherwise Find jobs.
- **Secondary:** Review profile; optional toolbar/pinning help.
- **Required input:** none.
- **Completion:** focus succeeds or the user goes to the feed. This is not recorded as an autofill success.
- **Destination:** original application or `/jobs`, never an automatically submitted application.

### 9. Popup and first real use

- **Purpose:** make the current page actionable.
- **Content:** verified connected account, current-form status, resume choice, then progress/results. Replace the misleading Profile connection label with Account. Do not put another profile questionnaire in the popup.
- **Primary:** Autofill when runnable; otherwise the single recovery action from the state table.
- **Secondary:** open Profile; change resume; optional Enable on this site when the user wants persistent assistance.
- **Required input:** deliberate Autofill invocation; any missing sharing approval remains explicit.
- **Completion:** actual writes verified on the employer form. Report Filled, Already complete, Left unchanged, and Needs your input separately; distinguish failed writes from absent facts.
- **Destination:** stay on the employer form for editing and review. Existing submission review/approval remains separate. Do not mark an application applied because fields were filled.

### 10. Profile and extension settings

- **Purpose:** manage the relationship after first use.
- **Content:** pending imported changes, saved-profile capabilities, Store installation/update link, current-browser verification, and separately labeled other connection sessions.
- **Primary:** context-specific Review imported details, Connect this browser, or Manage connection.
- **Secondary:** revoke a named connection; preview-build installation in an explicitly labeled developer/testing section.
- **Required input:** none to inspect; explicit confirmation for changing connections or sharing.
- **Completion:** server/browser acknowledgment of the selected action, with success or specific recovery feedback.
- **Destination:** remain in settings or return to the originating task through the validated handoff.

## Readiness and Action Rules

Readiness is a set of independent capabilities, not one status flag. The following table is ordered by precedence for an attempted autofill. Lower-priority issues stay as secondary rows rather than creating competing primary buttons. Website-only discovery is never blocked by these extension states.

| Observed state | Truthful label | Primary action | What stays possible |
| --- | --- | --- | --- |
| Mobile/unsupported browser | Extension needs desktop Chrome | Browse jobs | Full website profile and document preparation |
| Browser detection cannot run | Can't check this browser | Open the extension in Chrome | Website use; do not infer uninstall |
| Supported detection probe gets no response | Extension not detected in this browser | Get the Chrome extension | Secondary Already installed? Open it from the toolbar |
| Installed package lacks required protocol | Extension update needed | View update steps | Saved profile and website remain intact; do not reinstall by default |
| No authenticated website account | Sign in to continue setup | Sign in | No new sharing or connection granted |
| Extension detected, no credential | Account not connected | Connect extension | Profile can be prepared first |
| Browser credential differs from current website account | Extension is connected to another account | Review account connection | No automatic switch; no other-account details returned to website |
| Credential expired/revoked | Reconnect to continue | Reconnect | Confirmed profile and acknowledged drafts retained |
| Verification service unavailable | Connection couldn't be verified | Retry connection check | No false Connected badge; browsing and editing remain available |
| Connected, no usable confirmed contact facts | Add details for autofill | Review your details | Connection remains valid; no demand for complete history |
| Contact available, new import still draft | Basic contact autofill available; imported details await review | Autofill on an eligible form | Use current canonical data only; Review imported details is secondary |
| Current credential verified, no website-account comparison | Connected as the extension account | Autofill on an eligible form | Popup may identify its own account; website must not claim an account match |
| Fresh comparison verifies same current account | Connected to this account | Continue to application / Autofill | Profile readiness and per-form support remain separate |
| No resume chosen or sharing disabled | Resume sharing off | Autofill available details | Choose resume is secondary; contact/history need not wait |
| Imported resume cannot be attached | Saved for import; attachment needs PDF or DOCX up to 5 MB | Autofill available details | Choose eligible resume or upload manually |
| Persistent on-page access disabled | Open from Chrome's toolbar | Autofill on explicit active-tab invocation | Optional Enable on this site; no compulsory all-sites permission |
| Permission needed for a specific embedded frame | Access needed for this form | Allow access to the named site | Denial leaves a manual fallback; no broad permission escalation |
| No form visible yet | Open the application form | Check this page again | User may click Apply on the employer site; no claim of unsupported platform solely from absence |
| Form exists but cannot be safely handled | This form needs manual completion | Open your profile | Preserve entered data; explain known blocker instead of implying missing profile |
| Eligible form and verified facts available | Ready to fill available details | Autofill | Optional fields can remain absent; review and submission stay separate |

A successful ping means only that an expected extension answered. A stored server connection row means only that an authorization record exists. Neither establishes current-browser authentication, account equality, profile review, permission, or form support.

## First Use and Copy

### Choose real application guidance first

| Method | What it establishes | Decision |
| --- | --- | --- |
| Short walkthrough | Explains toolbar and review steps, but demonstrates no working integration. | Keep two or three contextual hints, not a mandatory tour. |
| Practice form | Can demonstrate real extension mechanics if wired correctly; cannot establish compatibility with arbitrary employers. | Follow-up only if users without an application fail to reach first use. |
| Guidance on the user's real application | Establishes useful value on the task that brought them here. | First release default. Require deliberate Autofill and report actual outcomes. |

For users without an application, send them to `/jobs`, not a forced synthetic exercise. Give toolbar/pinning help once, dismissibly. The current detector excludes ApplyOverflow's own origin, and the website bridge is restricted to the application workspace. A future `/extension/practice` cannot simply reuse generic detection by removing those restrictions.

If practice is later justified, implement an exact-path, top-frame, user-invoked practice capability using the real detector/planner/executor on an isolated synthetic form. Restrict its bridge messages, disable submission and real tracking, and keep practice telemetry separate. Prefer synthetic sample data and no file upload; label the result Practice completed, never First application completed. A purely visual simulation must instead say Interactive preview and must not count toward integration success.

### Suggested copy

| Surface | Copy |
| --- | --- |
| Welcome heading | Set up ApplyOverflow for job applications |
| Welcome explanation | Keep your profile and resumes in ApplyOverflow. Use the Chrome extension to fill available details on employer application forms. You review before submitting. |
| Welcome progress | Account / Your details / Connect |
| Extension-context sign-up | Create an account to save the details your extension will use. |
| Extension-context sign-in | Sign in to use your saved profile with this extension. |
| Verification | Verify your email, then return here to continue. Your setup progress will still be here. |
| Resume import finished | Imported as a draft. Review the details you want to use. |
| Draft save acknowledgment | Draft saved. These changes are not used for autofill yet. |
| Review primary action | Use reviewed details |
| Partial confirmation | Contact details saved for autofill. Your imported work history still needs review. |
| Optional goals | What jobs would you like to see? You can change this later in Profile. |
| Connection success | Connected to your ApplyOverflow account. Return to your application to autofill. |
| Existing account | Use your saved profile. No need to upload it again. |
| Unfinished setup | Your draft is saved. Continue reviewing it, or use your current saved profile. |
| Resume distinction | Saving a resume does not enable automatic attachment. Choose how to share it when you apply. |
| First-use hint | Open ApplyOverflow from Chrome's extensions menu. Select Autofill, then review the fields on the form. |
| Pinning hint | For easier access, pin ApplyOverflow in Chrome's extensions menu. |
| Form result example | 8 filled / 3 already complete / 2 need your input |
| Unsupported form | We couldn't safely fill this form. Your profile is still available to use manually. |
| Timeout | Connection timed out. Your saved details are safe. Try connecting again. |
| Account mismatch | This browser's extension is connected to another account. Choose which account to use before continuing. |

Avoid Ready for every application, Setup 100% complete, and profile-completeness percentages in this flow. Do not present consent as a routine completion checkbox. Short instructional copy here is purposeful onboarding guidance, not a repeated description of interface features.

## Architecture and Change Map

### One profile with explicit confirmation boundaries

Keep the canonical `UserProfile`, existing profile/document queries, and `UserPreference` onboarding record. Extend the current state under the existing key with a versioned, backward-readable schema. Track confirmed scope/revision, remaining draft sections, and independently deferred goals. Do not use `status: complete` as an extension readiness signal.

Introduce a scoped confirmation action, such as `confirm-reviewed`, separate from draft save, defer, and job-goal save. It must:

1. Derive ownership from the current session, validate payload limits and the selected review scope, and lock the profile using the current transaction pattern.
2. Compare both draft revision and canonical profile revision. A stale tab cannot mark an old snapshot reviewed or overwrite changes from Profile.
3. Commit only explicitly reviewed fields/sections. Preserve omitted canonical values, document-sharing flags, optional answers, and unreviewed drafts. Treat intentional deletion separately from an omitted field.
4. Use existing normalization and profile text projections for downstream compatibility. Do not serialize the entire review draft over the canonical profile for contact-only confirmation.
5. Return acknowledged canonical/draft revisions and actual capabilities. Update the UI to Saved for autofill only after that response.

Contact is one review unit; imported experience, education, projects, and skills are separate units for the first release. Whole-section review is acceptable initially if the UI shows the section's records and count. Do not invent dates or fill missing education to make a section pass. More granular per-record review is a follow-up, not a prerequisite for contact activation.

Existing saved profiles remain usable without retrospective forced review. New imported suggestions remain draft-only. Existing version-one deferred drafts retain that meaning on migration. Deploy compatible readers before enabling new writes, reject obsolete writes with a reload recovery, and test rollback so an older writer cannot discard new confirmation metadata.

Add bounded, serialized draft autosave after a short idle interval and on intentional navigation. Show Saving, Draft saved, and Couldn't save distinctly. Drain pending saves before confirmation/import; use returned revisions rather than racing requests. Do not rely on an unload request to guarantee persistence. If saving fails, keep the editor open with the unsaved changes and explicit retry/leave behavior. Never put profile contents in URLs, analytics, or unscoped browser storage.

### Browser-specific state and safe handoff

Separate account-owned progress from extension-owned browser state. The website owns the draft, confirmed profile, documents, and goals. The extension owns installation/version, current credential, site permissions, and temporary return context.

Add a **separate, narrow setup bridge**. Reuse validation primitives, not the application workspace command surface. Restrict it to the exact production origin and `/extension/setup` path, expected extension ID/build, top frame, current document, bounded payloads, protocol version, nonce, and a small action allowlist. Development origins/preview IDs stay behind explicit development configuration. Chrome's [messaging guidance](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) supports treating incoming messages as untrusted; page messages must never become an arbitrary API proxy.

Proposed actions: detect protocol; request account-match verification; begin connection from a deliberate click; return to a locally bound application after confirmation. No generic open-URL, fill, upload, submit, credential, or workspace-operation actions are exposed to setup.

For account matching, use a short-lived, single-use server challenge bound to the authenticated website session. The extension answers through its bearer-authenticated API; the server compares principals and returns match/mismatch/unverified to the same website session. Use an expiring server-side record, not a client-supplied account ID. Bind it to the bridge protocol and expected client, rate-limit it, and expire it on logout or account change. A mismatch response must not reveal the other account's profile/email to the website. No extension token crosses the page bridge.

Before a sensitive continuation, revalidate rather than trusting a stale green badge. Signing out or switching accounts invalidates website readiness and any pending match proof. Switching an extension account cancels pending resume requests/return operations and clears account-scoped caches through existing cleanup. The popup can identify its own verified account without claiming equality to a separate website session.

On an explicit toolbar invocation, store a bounded return context in trusted extension storage: tab identity, document/application binding, normalized permitted application URL, expiry, and an opaque handle. The website receives only the handle, not an employer URL or authorization secret. Use the existing site-normalization rules, reject token-bearing/unsafe URLs, and keep context out of analytics. A stale or changed tab fails closed. Across restart, restore only minimal pending context and require a fresh tab/application check plus user action; do not persist live form values or replay writes.

Preserve `getSafeSignInCallback` and `setupReturnPath`. Authentication callbacks stay internal. Email verification on another device may recover account setup, but cannot recover or control a tab on the original browser without a new local check.

### Keep the short authorization flow short

First install opens the ordinary setup tab only when `onInstalled.reason` is `install`; update/startup still only initialize supported detection behavior. Chrome distinguishes these installation reasons, including development reload behavior. [Runtime API](https://developer.chrome.com/docs/extensions/reference/api/runtime).

Do not generate the PKCE/state flow until the user starts final connection. If the website session expires during consent, support brief reauthentication; if account creation or extended setup is needed, cancel/exit that attempt and return to the normal setup tab before restarting. Preserve the existing five-minute timeout rather than increasing it to accommodate resume editing. Authorization success must still verify state, exchange the code once, and acknowledge the connection. [Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity).

If an older extension cannot initiate the new bridge action, explain Open the extension and choose Connect. Do not show new capabilities based only on the website release. A refreshed website and an installed 0.15.1 package must continue to work during staged rollout.

### Concrete file map

| Area | Reuse and modify | Genuinely new work |
| --- | --- | --- |
| Entry and auth | [home](/Users/alvinhu/projects/autoapplication/src/app/page.tsx), [sign-in](/Users/alvinhu/projects/autoapplication/src/app/sign-in/page.tsx), [sign-up](/Users/alvinhu/projects/autoapplication/src/app/sign-up/page.tsx), [auth components](/Users/alvinhu/projects/autoapplication/src/components/auth), [return-path helpers](/Users/alvinhu/projects/autoapplication/src/lib/auth-return-path.ts): contextual copy, preserve callbacks through errors/recovery, keep validation. | Small validated entry-intent contract; no second auth system. |
| Setup routing | [query](/Users/alvinhu/projects/autoapplication/src/lib/queries/profile-setup.ts), [onboarding page](/Users/alvinhu/projects/autoapplication/src/app/onboarding/page.tsx): select the next relevant milestone, permit browse/defer, reconcile changed profile. | `/extension/setup` coordinator and explicit unsupported-browser branch. |
| Profile review | [state/schema](/Users/alvinhu/projects/autoapplication/src/lib/profile-setup.ts), [actions](/Users/alvinhu/projects/autoapplication/src/app/onboarding/actions.ts), [editor](/Users/alvinhu/projects/autoapplication/src/components/profile/profile-setup.tsx): scoped confirmation, optional goals, saved-draft semantics, phone country and major. | Version-compatible review-scope metadata and a small pure readiness/action reducer. |
| Resume import | [route](/Users/alvinhu/projects/autoapplication/src/app/api/profile/resumes/route.ts), [service](/Users/alvinhu/projects/autoapplication/src/lib/profile-resume-service.ts), [sharing query](/Users/alvinhu/projects/autoapplication/src/lib/queries/extension-resume.ts): retain isolation and revision guards; show import/attachment distinction. | Shared eligibility presentation from existing rules, not a new upload store. |
| Connection and settings | [connect route/actions](/Users/alvinhu/projects/autoapplication/src/app/extension/connect), [consent component](/Users/alvinhu/projects/autoapplication/src/components/applications/extension-consent.tsx), [settings](/Users/alvinhu/projects/autoapplication/src/app/settings/extension): short consent, verified status, Store-first installation. | Expiring account-match challenge and authenticated readiness projection via existing extension API/query boundaries. |
| Extension lifecycle | [background](/Users/alvinhu/projects/autoapplication/extensions/chrome/background.mjs), [popup](/Users/alvinhu/projects/autoapplication/extensions/chrome/popup.mjs), [popup markup](/Users/alvinhu/projects/autoapplication/extensions/chrome/popup.html), [recovery](/Users/alvinhu/projects/autoapplication/extensions/chrome/recovery.mjs): first-install welcome, setup/resume action, accurate labels, return focus. | Separate setup bridge module and bounded local return-context store. Keep [workspace bridge](/Users/alvinhu/projects/autoapplication/extensions/chrome/workspace-bridge.mjs) restrictions intact. |
| Profile continuation | [Profile](/Users/alvinhu/projects/autoapplication/src/app/profile/page.tsx): pending-import action and capability-based continuation. | No parallel dashboard or mandatory profile score. |
| Packaging/public guidance | [build script](/Users/alvinhu/projects/autoapplication/scripts/build-application-extension.mjs), [release metadata](/Users/alvinhu/projects/autoapplication/extensions/chrome/release.json), [Store metadata](/Users/alvinhu/projects/autoapplication/extensions/chrome/store-release.json), [release guide](/Users/alvinhu/projects/autoapplication/docs/extension-web-store.md): channel-aware labels and consistent instructions. | Coordinated Store screenshots and a verified-public-release record distinct from candidate package metadata. |
| Persistence/measurement | [Prisma schema](/Users/alvinhu/projects/autoapplication/prisma/schema.prisma): reuse UserPreference, UserProfile, ExtensionConnection. | Minimal expiring challenge storage and, if no suitable event sink exists at implementation time, a bounded onboarding-event model. No new general-purpose analytics platform. |

Use authenticated Server Actions for account draft/confirmation mutations and no-store Route Handlers for bridge/API status. Revalidate affected profile destinations after successful confirmation, not before persistence. Follow the installed [Server Action guide](/Users/alvinhu/projects/autoapplication/node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md) and [Route Handler guide](/Users/alvinhu/projects/autoapplication/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md); do not rely on older Next.js assumptions.

## Recovery Specification

| Interruption | Preserve | Specific next action |
| --- | --- | --- |
| Welcome tab closed | Browser-local setup intent; any saved account progress | Popup offers Continue setup; do not reopen tabs repeatedly. |
| Editor tab closed | Last acknowledged server draft; canonical facts unchanged | Reopen saved step. Warn before intentional navigation when unsaved work remains; do not promise unacknowledged keystrokes survived. |
| Upload/parse failure | Existing canonical profile and previous draft; clean failed transactional uploads | Retry import or Enter details manually. Distinguish unsupported file, limit, parsing, and network failure. |
| Session expires during editing | Acknowledged account draft; unsaved editor content remains in that tab only | Open safe reauthentication, then recheck account/revision before saving. Never carry account A's draft into account B. |
| Consent cancelled or timed out | Confirmed details and draft progress | Connect again, not repeat setup or sign out and back in. |
| Optional host permission denied | Connection and profile; current form untouched | Use toolbar when allowed, or manual fallback for denied frame access. |
| Service worker/browser restarts | Existing credential and only bounded local setup context | Reverify connection and tab identity; no automatic fill/replay. |
| Two setup tabs/profile edited elsewhere | Both acknowledged versions; no silent last-write-wins | Review changed sections, select which to keep, then confirm against latest revision. |
| Different website/extension accounts | Each account's own data and connection | Choose account explicitly; invalidate old verification/handoff. |
| Old extension/new website | Canonical profile and legacy connection flow | Show version-specific update guidance; restart only the failed handoff. |
| Form closed/navigated during setup | Saved profile and connection | Open an application and invoke the toolbar again. Never navigate an unrelated tab. |
| Site/form unsupported | All user-entered employer fields | Manual completion using Profile; do not report missing profile facts as the cause. |

## Delivery Phases

### First release

Ship a complete installation-to-use journey, not an isolated welcome page.

| Change | Friction removed | Why now |
| --- | --- | --- |
| Confirm reviewed details before optional goals; preserve unreviewed drafts | Users complete review but autofill still sees old information. | This is the central correctness dependency. |
| Normal-tab setup, first-install welcome, popup continuation | New users do not understand the account requirement or lose setup when the auth timer expires. | Necessary for extension-first activation. |
| Intent-preserving auth/error/recovery paths | Verification and recovery discard the original task. | A happy-path-only release is incomplete. |
| Narrow setup bridge, account verification, validated return-to-tab | Wrong-account uncertainty and lost employer context. | Needed to connect the products without weakening authorization. |
| Independent capability labels and one next action | Connection, profile, resume, and permissions appear interchangeable. | Prevents false readiness and unnecessary setup. |
| Bounded draft autosave and revision reconciliation | Tab changes lose work or hide imported drafts. | Supports the deliberately interruptible normal-tab flow. |
| Store-first, release-aware instructions | Public users are told to install a development ZIP. | Publication is already verified; current guidance is misleading. |
| Contextual first-use hints and outcome metrics | Users reach Connected but not a useful result. | Establishes a measurable complete journey without a new simulator. |

Release in compatible batches: server readers/actions/status first with new UI disabled; then website coordinator and backward-compatible fallbacks; then reviewed extension package; then coordinated copy/screenshots and gradual enablement. Gate browser actions by negotiated protocol/version, not publication date. Preserve the preexisting changes in `docs/extension-web-store.md` when implementation starts.

### Follow-up based on observed behavior

- Add a real, isolated practice form only if users without an employer context consistently fail to reach first use. Measure actual extension execution separately from employer coverage.
- Add per-record review/diff tools if large imported histories dominate review time. Contact confirmation should already be independent.
- Improve cross-device continuation if verification/device switching causes measurable drop-off. Never attempt to transfer browser credentials or control another device's tabs.
- Refine optional resume-sharing prompts and import/attachment explanations from abandonment data. Do not make broader sharing the default to improve conversion.
- Expand contextual readiness for common profile gaps when field-level aggregate results support it; do not turn every missing employer answer into a mandatory onboarding question.

### Later experiments

Test an optional intent selector only if inferred-intent misrouting is common. Test placement of optional interests before versus after first job engagement for website-first users. Test practice versus contextual help for no-application extension installs. Do not experiment with hiding consent, automatic employer submissions, or silently using unreviewed facts.

## Measurement

Use a small first-party, allowlisted event endpoint with bounded payloads, rate limits, and deduplication. Existing job behavior signals require a job and application events require an application; neither should receive fabricated records for onboarding. A minimal dedicated event table is preferable to abusing those models. Propose 30-day raw metadata retention and aggregate reporting thereafter, subject to the existing privacy policy review.

| Event | Emit only when | Safe dimensions |
| --- | --- | --- |
| `setup_opened` | Welcome/coordinator or setup genuinely renders | Entry intent, supported-browser category, new/returning |
| `authentication_completed` | Server recognizes authenticated session for this journey | Auth method category, verification path, entry intent |
| `profile_import_attempted/completed/failed` | Attempt begins; acknowledged draft exists; or categorized failure | File type/size bucket, duration bucket, error category; no filename |
| `profile_details_confirmed` | Scoped canonical transaction commits | Reviewed section names/count buckets, remaining draft flag |
| `extension_connection_completed` | Token exchange and current verification succeed | Channel, package/protocol version, resumed/new |
| `setup_step_deferred` | User deliberately skips an optional step | Step identifier; not failure |
| `autofill_attempted/completed` | Actual user-triggered extension run begins/ends | Adapter family or generic, coarse form capability, count buckets, duration, error categories |
| `first_real_autofill_succeeded` | First qualifying verified employer-form result | Same bounded metadata; no job URL, question text, answer, or contact data |
| `recovery_shown/completed` | Categorized blocker shown; the next action actually resolves it | Recovery category, package version, duration bucket |
| `first_job_engaged` | First intentional job-detail open, save, or application action | Action category; reuse existing job instrumentation where possible |

**Successful real autofill:** an explicitly invoked, authenticated extension run on an employer application changes at least one previously empty eligible field using permitted confirmed data, and the executor verifies that the control retained the intended value/selection after its normal settling/rerender checks. Exclude practice, simulations, mere clicks, connection success, all-already-complete runs, and submission events. Verify selections semantically, not just a DOM write. Track resume attachment acceptance separately because assigning a file is not proof of completed upload.

One filled field measures first value, not high coverage. Also report verified-filled / eligible-empty-with-available-data, unsupported-control counts, genuine missing-data counts, protected-user-edit counts, and write failures. Include unsupported attempts in the overall attempted-run denominator; never hide them by reporting only successful adapters. Do not infer correctness from an unchanged visually populated field alone.

For **extension-first**, measure setup opened -> authentication -> confirmed usable details -> verified connection -> first successful real autofill. Existing-account users may legitimately skip import/reconfirmation; segment them. Report total elapsed and active setup time separately, with import/email waiting visible.

For **website-first**, measure authentication -> first intentional job engagement, with profile confirmation and optional extension adoption as separate branches. A user who browses jobs without installing the extension is not a failed activation. Count optional-step deferral separately from error or abandonment.

Use a short-lived random journey identifier before sign-in and a pseudonymous account-scoped correlation afterward. Keep credentials, profile contents, filenames, full employer URLs, and DOM/screenshot contents out of events. Analytics failure must never block setup. No performance or conversion target is claimed as a measured baseline yet.

## Acceptance Criteria

1. First installation opens exactly one welcome tab. Updates, worker startup, and browser restart do not repeat it. Closing it leaves Continue setup in the popup.
2. Website-first users reach `/jobs` or their original safe internal destination without a resume, work history, social profile, job preferences, or extension.
3. An extension-first new user can authenticate, import or enter details, confirm them, connect, and return to a valid original application. The authorization timer runs only during final connection.
4. Use reviewed details updates exactly the reviewed canonical scope. Deferring goals never retracts it. Saving a draft never changes autofill's source facts.
5. Existing usable profiles do not require another upload or new-user wizard. Pending imports remain separate. Legacy profiles are not falsely labeled recently reviewed.
6. A contact-only confirmation succeeds even when unreviewed optional history is incomplete. No resume, demographic, eligibility, or marketing choice is silently made to complete setup.
7. Account A's draft, document, readiness proof, and return operation cannot be reused after switching to account B. A ping or stale connection row never produces a same-account badge.
8. Resume saved, attachment eligible, sharing allowed, and upload accepted are distinguishable. Sharing refusal does not block ordinary contact autofill.
9. Permission refusal, connection cancellation, timeout, and network failure have a specific recovery action and do not erase saved profile work or repeatedly reopen tabs.
10. Original employer tabs retain entered values and are never reloaded by onboarding. Missing/stale return contexts cannot focus or mutate an unrelated tab.
11. Multiple setup tabs and concurrent Profile edits cannot silently overwrite each other. Saved-state messages correspond to acknowledged server revisions.
12. Unsupported browser, detection unavailable, extension not detected, expired credential, and unsupported form have distinct explanations/actions.
13. First-use results distinguish verified writes, existing values, protected edits, unavailable facts, and compatibility failures. No onboarding action submits or marks an application applied.
14. Store and preview channels have accurate labels/instructions. A new website supports installed older clients with truthful fallbacks until their actual capabilities are known.
15. At 320, 390, 768, and 1440 CSS-pixel widths, controls and messages remain usable without horizontal overflow. Keyboard-only navigation, 200% zoom, focus restoration, live statuses, and error associations work.

## Validation Plan

| Layer | Extend existing coverage | What it proves and does not prove |
| --- | --- | --- |
| Pure unit tests | [profile setup tests](/Users/alvinhu/projects/autoapplication/tests/profile-setup.test.ts), recovery/version tests; new readiness reducer cases | State precedence, safe paths, schema migration, confirmation scope, account-match/unknown states. Does not prove browser installation or OAuth. |
| Database/import integration | [import tests](/Users/alvinhu/projects/autoapplication/tests/integration/profile-setup-import.ts), extension resume/connection integration | Draft isolation, scoped canonical updates, revision conflicts, ownership, single-use challenges, document consent and cleanup. Use disposable local data. |
| Website browser tests | [onboarding E2E](/Users/alvinhu/projects/autoapplication/tests/e2e/profile-onboarding.ts) | All six journeys with controlled auth/import failures, cross-tab edits, reload/defer, mobile sizing, accessible states. Mocked extension responses prove website handling only. |
| Mocked extension UI | [readiness script](/Users/alvinhu/projects/autoapplication/scripts/test-application-extension-readiness.mjs) | Popup/on-page rendering, recovery labels, no competing actions, busy states, small viewports. Its mocked Chrome API is not evidence of a real MV3 handoff. |
| Real packaged extension in isolated Chromium | [connection script](/Users/alvinhu/projects/autoapplication/scripts/test-application-extension-connection.mjs), package/origin/frame/workspace tests | Actual worker, storage, messaging, permission and consent behavior against a local backend and controlled application fixtures. These are real-extension tests on synthetic forms, not live-employer coverage. |
| Authenticated normal Chrome release check | Installed Store build plus production website with a dedicated consenting test account | Actual install/update channel, first-install welcome, browser-profile boundary, normal Google/email auth, account matching, return focus. Record exact website revision and installed extension version. |
| Consented real employer check | One direct application, one embedded form, one multi-step application, and one manual/unsupported case | Real first-use handoff and observed fill results on those particular forms. No submission, no blanket compatibility claim, and no reuse of personal data without appropriate consent. |

Build fixture personas for a new graduate without work history, a finance professional, a nontechnical career changer, an existing user with a complete profile, and a user with partial imported data. Include no resume, import-only file format, eligible resume with sharing off, different contact/login emails, Canadian and US locations, and unknown optional eligibility answers.

Run fault scenarios at each boundary: close welcome, close editor after acknowledged save, abort import, stale revision, verification in another tab, Google error, password reset, consent denial, five-minute timeout, backend outage, permission denial, account switch, worker restart, extension update, original-tab navigation, and both Store/preview packages present. Assert the visible primary action and stored state after every transition, not only the final page.

Capture desktop/mobile screenshots and action/result traces using synthetic data. For normal Chrome and consented employer checks, inspect actual fields and record redacted counts plus capability labels, never profile values or reusable credentials. A trace with a clicked button but no verified field change is a failed or unresolved test, not a pass.

Release gate: all journey and safety assertions pass; no wrong-account data use, unreviewed-data use, unauthorized sharing/submission, lost acknowledged draft, or false connection/readiness claim. Report live-site limitations explicitly. This gate evaluates onboarding and handoff quality; it does not certify universal autofill coverage.

## Remaining Product Decisions

The architecture does not depend on answers to these questions; the proposed defaults are usable for implementation planning.

1. **Distribution audience:** is the public Store package now the only normal-user installation path? Recommended default: yes; keep unpacked previews only in clearly labeled testing/developer guidance.
2. **Optional on-page assistance:** should the first release offer Enable on this site immediately after the first successful toolbar fill, or leave it in the popup? Recommended default: a dismissible offer after demonstrated value, never a required setup step or all-sites default.
