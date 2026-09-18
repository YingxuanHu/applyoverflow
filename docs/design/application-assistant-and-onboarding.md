# Application Assistant and New-User Onboarding

Status: first foundation batch implemented locally; extension not yet implemented or deployed.
Date: 2026-09-18.
Repository baseline: `fbf9d2b4f74ccf48680aa732cabad420c59c8e87`.

## Implemented in the First Batch

- Only newly created accounts receive a versioned onboarding marker. Existing accounts are not enrolled or redirected. Pending users retain their intended destination through sign-up, verification, and sign-in; deferred users can resume from Profile.
- Three compact steps: optional resume upload/manual entry, editable contact/history review, and desired roles/location. Additional address fields, education, projects, and summary stay expandable. Progress is saved on step navigation and Finish later, not continuously on each keystroke.
- Onboarding imports use the existing resume/document pipeline but save extracted facts to a review draft. The confirmed profile is updated only on completion. Revision checks reject stale tabs and simultaneous imports; failed transactional imports remove their uploaded object.
- Profile compatibility readers share the same runtime types. Optional mailing addresses survive edits; legacy date text is preserved. This is not yet the structured-date/stable-entry-ID contract proposed below.
- Job interests are separate from residence/contact details and now enter the existing Picks for you intent model. Existing users without explicit preferences retain prior inference behavior.
- A tested, pure answer-reuse policy requires approval and matching context. Company relationships/referrals, authorization, and narratives remain review-only; sensitive questions are never automatically reused. This policy is groundwork, not an exposed answer library or autofill engine.

No extension authentication, DOM filling, application answer-review workspace, AI narrative generation, per-field provenance, structured authorization editor, or production rollout is included in this batch. Existing application and submission workflows are unchanged.

Verification: see [foundation verification](../audits/2026-09-18-onboarding-foundation.md). Test only synthetic resumes/accounts; no employer submissions.

## Recommendation

Build a user-controlled application assistant, not an unattended application bot. A verified, reusable profile should power matching, documents, and an optional Chrome extension. Users choose the resume, initiate filling, review uncertain answers, and submit on the employer's site themselves.

Start with desktop Chrome and a small, explicitly supported set of applicant tracking systems (ATS). Keep ApplyOverflow useful without the extension and keep `/jobs` as the primary destination. Preserve the North America white-collar scope across TECH, FINANCE, and GENERAL; do not design onboarding around software engineers alone.

The essential investment is reliable profile data and trustworthy application state. Adding a browser panel before fixing those foundations would automate inconsistent information more quickly.

## What Simplify Demonstrates

Simplify documents a profile-backed extension that fills common fields, selects resumes, assists with custom questions, and connects applications to its tracker. Its documented page-level workflow ends with the user reviewing and submitting. Unsupported pages still have a copy-from-profile fallback. These are useful interaction patterns, not evidence that its advertised coverage or accuracy applies to us. [Official autofill guide](https://help.simplify.jobs/articles/2415391-using-copilot-to-autofill-applications).

Its signup flow collects goals and experience, can extract a profile from a resume, and also permits manual entry. Its extension settings expose controls for individual fields and additional automation. We should borrow the reusable-profile concept while making our first release more conservative. [Signup guide](https://help.simplify.jobs/articles/0738509-signing-up-for-simplify), [autofill settings](https://help.simplify.jobs/articles/8686025-manage-autofill-settings-in-the-simplify-extension).

This proposal is based on official documentation and repository inspection, not a hands-on evaluation of Simplify's extension. AI-generated answers, recruiter discovery, and universal ATS coverage are not prerequisites for our first release.

## Existing Foundation and Gaps

| Area | Verified current implementation | Required adjustment |
| --- | --- | --- |
| Account/profile | `src/lib/user-profile-sync.ts` creates or updates a profile from the authenticated user. | Add versioned onboarding progress, confirmed fields, and safe return-to-job navigation. |
| Profile shape | `src/lib/profile.ts` uses a single `time` string for history; `src/types/profile.ts` describes separate start/end dates. Skills also have object/string representations. | Establish one validated contract with compatibility readers before exposing data to an extension. |
| Readiness | `src/app/profile/page.tsx` computes completeness from seven sections, counting either email or phone as contact completion. | Replace a universal percentage with capability-specific readiness and application-specific missing fields. |
| Resume import | `src/lib/profile-resume-service.ts` extracts information and persists a merged profile. | Make imported values reviewable suggestions; do not treat extraction as user confirmation. |
| Work authorization | `UserProfile.workAuthorization` is a free-text string. | Introduce optional country-specific authorization and sponsorship answers; preserve unknown separately from no. |
| Documents | `Document`, `ResumeVariant`, resume-library entries, and resume-build snapshots already exist. | Reuse the library and versioned outputs; choose and pin a document for each attempt. |
| Application tracking | `TrackedApplication` supports a nullable `canonicalJobId`. | Reuse it for jobs found elsewhere without adding those jobs to the public feed. |
| Submission | `submitApplicationReview()` in `src/lib/queries/applications.ts` explicitly marks a manual submission and syncs tracking. | Never call this merely because autofill completed. Add attempt state and confirmed outcome handling. |
| Browser integration | No dedicated extension or DOM autofill subsystem was found. | Add a separately built MV3 client and a narrow, versioned API, not a server browser farm. |

Important ownership boundary: profiles/documents/packages use the profile ID, while tracked applications use the authenticated `User` ID. Extension endpoints must derive both from the authenticated principal, never accept a client-supplied owner ID.

## Proposed User Journey

### New users

1. **Bring your information.** Upload a resume or start manually. Parse once using the existing import pipeline. Autosave progress and allow leaving at any step.
2. **Check your details.** Review contact details and extracted employment/education. Highlight uncertain dates or missing data; do not ask users to retype an entire resume. Explicitly support no prior employment, career breaks, and nontraditional education.
3. **Choose your next role.** Ask for role interests, countries/locations, and work arrangement. Salary preferences and additional constraints are optional. Separate what the user wants from factual qualifications.
4. **Prepare to apply.** Select a default resume and offer country-specific authorization/sponsorship questions when relevant. Users may defer these. Offer extension installation and a synthetic practice form on supported desktop browsers.

The initial route should take minutes, not require every possible ATS question. "Finish later" returns to the intended job or `/jobs`. Email verification, social sign-in, tab closure, and returning on another device must preserve progress. Validate local return URLs rather than accepting arbitrary redirects.

Existing users get a dismissible setup checklist with their existing data prefilled, not a forced signup wizard. Mobile users can build a profile and browse without repeated desktop-extension prompts.

Readiness should say what actually works: contact details confirmed, resume chosen, employment dates need review, or work authorization not provided. Optional demographic information, a LinkedIn account, and previous employment must never be prerequisites for a good readiness score.

### On an employer application page

1. The user opens the extension from Chrome's toolbar. The panel identifies the company, role, destination domain, and support level before sharing information.
2. Show the chosen resume and one primary action: **Fill this page**. Advanced controls stay in a shallow settings area.
3. Fill confident, allowed fields. Preserve anything the user already entered. Report filled, unchanged, failed, and needs-review fields distinctly.
4. Present unresolved questions as a short review queue. Selecting an item focuses the corresponding form field. Answers with legal or personal implications require explicit review.
5. The user advances through the employer's pages and submits. The first release does not click Next or Submit, create employer accounts, handle passwords, or solve CAPTCHA.
6. After submission, confirm the outcome and update Applications once. Initially use a one-click user confirmation; verified success-page detection can later offer the same confirmation with context. Opening a job, filling a form, or clicking Submit is not proof of success.

Revised interaction direction: no persistent wide sidebar. Use a compact, user-opened extension control with Fill, a short status, and Review in ApplyOverflow. Resume choice, question suggestions, remembered-answer controls, and detailed review belong in the application's apply workflow. Do not automatically open new app tabs or cover employer inputs. Keep state bound to the current tab and document so switching jobs cannot fill the previous job's answers.

Unsupported sites retain copyable profile information and a selected-resume download. Display a clear limitation rather than a misleading successful-fill state. Filling writes information into the employer's page, which may autosave it before final submission; disclose this before the first fill.

### Changes inside ApplyOverflow

- Profile becomes the shared editing surface for personal facts, experience, and reusable application answers. Keep search preferences distinct from these facts.
- Documents keeps resume ownership; onboarding links to it instead of introducing another document manager.
- Job detail retains an obvious outbound action. Show extension support near that action only when verified; unknown support must not appear supported.
- Applications shows an in-progress attempt separately from Applied, with the selected document and a resume-on-employer-site link when available. Existing manual tracking remains intact.
- Settings gains connected extension devices, revocation, field permissions, and optional answer-reuse controls.
- Extension capability is separate from existing `auto-apply eligible`, `review required`, and `manual only` classifications. A supported ATS does not make every posting safe or eligible for automation.

## Canonical Profile Contract

Create a small shared, validated TypeScript contract consumed by the web app and extension, without Prisma, Node-only dependencies, secrets, or server configuration. Avoid restructuring the entire repository merely to share types.

- Stable entry IDs for experience, education, and projects; array positions are not identities.
- Structured dates with precision and a current-position flag. Preserve original date text when conversion is ambiguous; never invent January 1 or an employment end date.
- Names suitable for explicit review rather than splitting every full name by spaces. Country, locality, and phone country code should have structured representations while preserving the user's original input.
- Separate profile schema version, monotonic data revision, and per-field provenance/review metadata. `updatedAt` alone does not mean a field was confirmed.
- Separate known facts, job preferences, optional personal answers, and generated drafts. Preferred location is not permission to answer yes to relocation.
- Country-specific right-to-work, current sponsorship, and future sponsorship are different questions. A Canadian answer must not silently answer a US question.
- Preserve existing profile text projections for ranking/resume consumers. Migrate compatibly, with regression fixtures for every current producer and reader.

Import should propose a diff, preserving confirmed data until approved. Manual corrections made while an import is running must not be overwritten. Use revision checks for concurrent web/extension edits. Existing resume-build snapshots and historical application evidence must not silently change when the profile changes.

Do not require collecting full street addresses, birth dates, identity numbers, or demographic data upfront. Sensitive answers remain optional and unfilled by default. Store only what the user deliberately chooses to reuse, with deletion controls.

## Autofill Engine

Use a layered engine: platform detector, form extractor, typed field matcher, fill plan, executor, and verifier. Adapters should be bounded, versioned modules with capability tests. Existing ingestion connectors read job listings; they are not browser form adapters.

- Identify fields through semantic labels, autocomplete attributes, controls/options, and section context. Use platform-specific selectors where necessary, not fragile universal text matching alone.
- Prefer deterministic mappings for common facts. Ambiguous labels, conflicting options, and low-confidence matches go to review. Do not use an LLM to guess every input.
- Ignore hidden, disabled, unrelated, password, payment, and honeypot fields. Exclude consent/signature/attestation controls from automatic selection.
- Support text fields, selects, radios, checkboxes, dates, and repeatable sections incrementally. Verify framework-controlled forms accepted the value rather than only changing visible DOM text.
- Re-scan dependent fields after confirmed changes, with bounded observation and no busy polling. Treat cross-origin frames, shadow DOM, and multi-step rerenders as explicit capability cases.
- File attachment support must be demonstrated per adapter, including type/size constraints. Choose the exact resume before attaching; provide a manual download/upload fallback if attachment cannot be verified.
- Check tab, frame, document, and job identity immediately before execution. Navigation cancels stale plans. Browser-worker suspension and reloads must not replay writes automatically.
- Undo only changes made by this attempt when the field still contains the value we wrote. Do not erase later user edits. Explain that undo cannot retract data already autosaved by the employer.

Chrome service workers are not permanent processes; checkpoint minimal state and make event handling resumable rather than relying on global memory. [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

## Backend and State

Extend existing profile/document/tracking query helpers behind explicit `/api/extension/v1/...` routes. Proposed model boundaries, subject to a focused schema design:

| Data | Preferred home | Invariant |
| --- | --- | --- |
| Profile revision and field confirmation | Extend profile structure | One source of facts for web and extension |
| Onboarding progress | Profile-related state | Resumable, versioned, no redirect loop for existing users |
| Extension installation/session | New auth-related records | Revocable, narrowly scoped, bounded lifetime |
| Reusable answers | Profile-owned answer records | Exact context, approval, sensitivity, freshness, and edit history |
| Fill attempt | Small application-related record | Not a submission; idempotent events |
| Applied status | Existing application tracking | Explicit confirmation, no second tracker |

Attempt lifecycle: detected -> prepared -> filling -> review needed -> awaiting user submission -> confirmed submitted. Cancellation, failure, and unknown outcomes remain separate. These are attempt states, not a replacement for the user's recruiting stages such as Interviewing or Offer.

Use an idempotency key per attempt and stable provider/job identity where available. For externally discovered jobs, normalized URL matching must preserve job identifiers while removing known tracking parameters. Company/title alone is not sufficient to merge applications. Existing nullable canonical links allow private tracking without creating public ingestion records.

Show a duplicate warning and an explicit retry/reapply path instead of silently overwriting history. When multiple tabs refer to the same job, pending writes and confirmation events should converge safely. Return actionable conflict responses rather than dropping updates.

Pin a profile revision and document version for an attempt. Preserve document references and user-approved application evidence according to retention policy; do not copy the full profile, resume binary, or page HTML into every event. Previously applied records remain understandable after the user edits their profile.

## Authentication, Privacy, and Permissions

- Connect through ApplyOverflow's existing web login and explicit extension approval. Spike a standards-based authorization-code flow with PKCE, one-time codes, state validation, and exact registered extension redirects. Reuse a maintained auth implementation where possible; do not embed a client secret or collect the website password in the extension. Chrome provides a web-auth flow API, but it does not supply our server-side authorization policy. [Chrome identity API](https://developer.chrome.com/docs/extensions/reference/api/identity).
- Scope access to the current user's autofill projection, selected documents, and application-attempt updates. Do not grant general account/admin access. Rotate and revoke credentials; prevent replay and cross-account document access.
- Begin with user-invoked `activeTab` access. Request optional site permissions only for verified adapters where necessary, including separately approved frame origins. No default all-sites monitoring, cookie-reading permission, or debugger permission. Temporary access has navigation limits, so reactivation must be an ordinary UI state. [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).
- Keep credentials and profile caches in trusted extension contexts. Send content scripts only the field values required for the confirmed plan. Validate every message against the sender, frame, document, and expected action; never expose an arbitrary URL-fetch proxy to a page.
- Use memory/session storage for sensitive working data, not Chrome Sync. Any persistent device credential requires an explicit storage threat model and restricted access; extension storage is not a hardware secret vault. Clear caches on logout/account switch and reject revoked access server-side. [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage).
- Fetch selected documents through authenticated, short-lived delivery. Never reveal account tokens or reusable document URLs to employer scripts. Validate document ownership at download time.
- Treat page content and question text as untrusted input. Optional future AI suggestions cannot issue browser commands, override safeguards, or manufacture credentials and experience. Preview generated answers before use.
- Bundle executable adapter code in the extension. Server flags may disable capabilities, but must not become a remote-code interpreter. [Manifest V3 security requirements](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security).
- Prepare a privacy policy, permission explanations, deletion behavior, and Web Store disclosures before public distribution. Review individual platform constraints; blocked automation receives a manual fallback, not a bypass. [Chrome Web Store data requirements](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

Identical question text is not necessarily reusable context. "Why do you want to work here?" is company-specific; salary depends on currency, period, and location; authorization depends on jurisdiction. Reuse approved factual answers only with compatible context. Narrative answers should be reviewed drafts, not silently copied between employers.

## Performance and Storage

The browser should perform form detection and filling. Do not add a server-side Playwright session for each applicant. Existing ingestion workers must not acquire this interactive workload.

- Sync a compact profile projection by revision/ETag, not the entire account on every field or keystroke.
- Reuse object-stored documents. Download only the chosen file when needed, with bounded transient caching; do not create a new VPS file per attempt.
- Keep ordinary filling independent of AI calls. AI question assistance comes later, with explicit user action, quotas, and timeouts.
- Collect redacted counts, latency, adapter version, and error categories. Do not log field values, full URLs containing tokens, full DOM, screenshots, or resume contents by default.
- Provisional diagnostic policy: 30-day metadata retention with bounded events per attempt and aggregate counters afterwards. Validate the policy during privacy review; application records are user data, not disposable diagnostics.
- Limit local caches, request bodies, retries, and uploaded file sizes. Bound observers to the active form and disconnect when no longer needed.

## Release Gates

These are proposed targets, not measured capabilities. Establish baselines with consenting testers before promising user-facing performance.

| Measure | Initial gate |
| --- | --- |
| Onboarding | Median <= 5 minutes to a confirmed basic profile and chosen resume for users with a readable resume; report upload/parser latency separately |
| Supported-field accuracy | >= 99% correct values among automatically filled common factual fields in the supported fixture suite; report by field family and platform |
| Supported-field coverage | >= 90% of eligible common fields with confirmed available data; publish exclusions rather than counting skipped fields as successes |
| Local response | p95 scan < 1 second and fill < 3 seconds for a 30-field supported fixture after data loads; measure upload/network/AI separately |
| Time saved | Median >= 50% reduction versus manual entry on the same supported workflows, including correction and review time |
| Safety | Zero observed unauthorized submissions, silent overwrites, wrong-account fills, sensitive-field inference, or credential leaks in release tests; any occurrence blocks release |
| Tracker correctness | Zero duplicate or falsely-applied records in retry, reload, validation-failure, and multi-tab fixtures |
| Regression | Existing feed, ranking, resume generation, manual tracking, and authentication tests pass unchanged or with explicit compatible updates |

Use at least 30 distinct fixtures across the initial adapters, including dynamic groups, iframe permissions, validation failures, stale profiles, no work history, long/international names, partial dates, expired auth, offline transitions, and switch-account/navigation races. Also test screen readers, keyboard-only use, zoom, dark mode, and narrow panel widths. Synthetic fixtures and controlled live checks should not create real applications or upload personal data to real employers.

Private beta measurement must include attempted, unsupported, and abandoned sessions, not only successful fills. High precision on a hand-picked happy path is not broad website coverage.

## Implementation Sequence

1. **Foundation and contract.** Audit all profile readers/writers; unify schemas with compatibility fixtures, stable IDs, structured dates, provenance, and revision control. Define onboarding progress and attempt/submission boundaries. No extension permissions or production automation yet.
2. **Onboarding.** Ship resume-review/manual-entry paths behind a flag. Preserve signup callbacks, support new and existing users, reuse Documents, and validate completion/resumption with representative personas.
3. **One-platform vertical slice.** Build the separate MV3 package, secure connection, compact controls, web-based review, selected-resume access, deterministic basic filling, manual confirmation, and tracker integration. Exercise against controlled fixtures before live use.
4. **Private beta on two or three platforms.** Greenhouse, Lever, and Ashby are candidates, not a coverage commitment. Choose order from our actual outbound application destinations and implementation tests. Add explicit support levels and per-adapter disable switches.
5. **Complex workflows and question assistance.** Expand to systems such as Workday only after evaluating login, repeatable sections, and multi-page behavior. Add context-aware saved answers and optional grounded AI drafts after core reliability meets the gates.
6. **Public release and maintenance.** Complete store review/disclosures, staged rollout, support reporting, version compatibility, and scheduled adapter regression checks. Maintain old-client API compatibility during store-update delays.

The first engineering batch should be profile-contract tests and the onboarding data model, not a large UI rewrite. The first product milestone is one trustworthy end-to-end application workflow, not the largest list of supported websites.

## Decisions to Validate During the First Spike

- Which ATS represents the largest share of real outbound applications, not simply the most ingestion connectors?
- What fraction of existing profiles have parseable dates and a downloadable selected resume?
- Can the current auth stack supply the chosen extension authorization flow safely without a parallel identity system?
- Which recurring questions justify storing reusable answers, and which should always remain per application?
- Do compact extension controls stay usable on narrow employer pages and at 200% zoom, without covering the form or scattering review across tabs?
- What build tooling gives isolated extension output and fixture testing without disrupting the current Next.js deployment? Evaluate maintained MV3 tooling before choosing; no repository-wide build migration is assumed.

Default proposed scope: desktop Chrome, user-initiated filling, human final submission, optional onboarding completion, private tracking of external jobs, and no paid AI dependency for basic autofill. Implementation status is tracked above; no production migration or deployment has been performed.
