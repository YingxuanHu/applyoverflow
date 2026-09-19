# Application Assistant Preview

This is an unpacked Manifest V3 preview, not a Chrome Web Store release.
Version 0.5 supports direct Greenhouse (US/EU), Lever (US/EU), and Ashby pages,
plus recognized forms on those hosts embedded in an employer page. Greenhouse's
`/embed/job_app` requires both a company identifier and a numeric job token.
The popup has Connect, Fill contact details, Choose resume, and Review questions. An optional
small on-page hint appears only when unambiguous empty contact or resume fields are found;
there is no injected sidebar. New forms and SPA navigation are detected locally.
Undo contact fill appears after filling. Application assistant in each tracked
application also opens a copy-ready contact, work and education reference.

Workday and iCIMS have conservative beta adapters for known, labelled contact
fields and existing work/education groups. Generic HTTPS application forms can
be inspected through the toolbar, without coming from ApplyOverflow or granting
all-sites access. Generic contact fields require exact autocomplete semantics
and matching labels; unsupported fields stay manual. This is not a claim of
compatibility with every tenant or custom widget.

History & tracking expands to two secondary actions: choose one saved work or
education entry to fill an existing empty row; or use I applied to explicitly
confirm a submission and record it in your private tracker. Nothing is submitted
to an employer automatically. Neither feature depends on the public job board.

## Local Setup

1. Apply the additive Prisma migration to the local database and generate the client.
2. Run `npm run extension:build -- --local=http://127.0.0.1:3004` (substitute the running local port).
3. In Chrome's extension manager, enable Developer mode and load
   `output/extension/local` as an unpacked extension.
4. Add that extension's ID to the server's comma-separated
   `APPLICATION_EXTENSION_IDS` environment setting and restart the local server.
   The default is empty: no extension can connect until explicitly enabled.
5. Open the extension and connect through ApplyOverflow's sign-in and consent page.
   Put confirmed given/family names in Profile > Application details; names are
   never split or guessed from a full name.
6. Enable "Show autofill on supported sites" in the popup and approve Chrome's
   optional permission prompt. No automatic employer-site access is granted at
   install time. Without opt-in, the toolbar's one-time activeTab flow still works.
7. After replacing an unpacked preview with a newer build, click Reload on its
   Chrome extensions page and refresh existing employer tabs.

`npm run extension:build` builds a production-origin artifact under
`output/extension/production`, but does not deploy or register anything. Never
use a local build with real production credentials. Backend origin selection is
build-time only. Both builds produce ZIPs next to their unpacked folders.

`npm run extension:build -- --publish` also writes the production ZIP to
`public/downloads/applyoverflow-assistant.zip` (about 108 KiB, generated/ignored).
Normal app build/dev hooks generate it, and Settings > Application assistant
includes the download and expandable unpacked-install instructions. The ZIP
contains only runtime files, not source maps, secrets, or local configuration.

`npm run extension:build -- --store` builds a separate Store-upload candidate at
`output/extension/store.zip`. It omits the unpacked preview key and cannot use
localhost or replace the preview download. This does not publish anything. See
`docs/extension-web-store.md` for the listing draft, permission rationale and
release gates. Data-use disclosure is served at `/extension/privacy` without
sign-in and linked from consent, settings and the popup.

The production preview includes a **public** manifest key for stable unpacked ID
`jmkdjgbpikdhflpknomggmlccccgkbbp`. After reviewing the rollout, explicitly include
this ID in `APPLICATION_EXTENSION_IDS`; it is not enabled by this change. No
private signing key is stored. Web Store publication still requires a developer
account, privacy/permission review, and Google's approval. Replace the preview
identity with the assigned store identity when preparing that release. A ZIP is
not a one-click consumer installation or an automatically updated store release.

## Boundaries

- Undo: clears only contact fields filled in the same page within ten minutes,
  provided the control is unchanged and the user has not edited it. Replaced,
  hidden, disabled, ambiguous and edited fields are preserved. Undo is local,
  needs no server call and remains available if the connection expires. It does
  not detach resumes, retract employer autosaves or undo a submission. Temporary
  values live only in the current page's isolated script memory.
- Profile reference: copy one saved fact at a time in the web review workspace,
  including work/education dates at their original precision. Missing facts are
  omitted, repeated roles stay separate, and legacy date text is not guessed.
  This adds no extension profile/history permission, persistent copies or AI
  requests. Question drafts remain mounted while browsing reference sections.
- Contact fill: confirmed given name, family name, full name, email, phone, and
  professional links where supported. Identity fields require both known labels
  and the ATS's standard IDs/names. Ashby currently fills system name/email (and
  system phone when present), not arbitrary UUID-labelled contact questions.
  Blank/ambiguous/unconfirmed fields are skipped. Existing
  entries, hidden/disabled fields, custom answers, passwords,
  consent checkboxes, and legal/demographic choices are not overwritten.
- Resume attachment: Choose resume opens ApplyOverflow, where the user explicitly
  selects a saved PDF or DOCX of up to 5 MiB and confirms sharing it for the shown
  employer URL. No file is selected by default. Only that file is read, with no
  extra persistent copy. A native file field may begin uploading immediately.
  Existing files, ambiguous/replaced fields, unsupported formats, and Ashby's
  separate "autofill from resume" widget are not changed. The extension reports
  native file selection, not confirmed employer-side acceptance; check the
  employer's upload status. Contact filling never attaches a file implicitly.
- Review: sends the job URL, title, and up to 40 visible question labels, not
  existing form values. Creates a **Preparing** tracked application or extends
  an existing review, without changing an existing stage. Review and documents
  stay in the normal application workspace.
- Remembered answers require an explicit web save. They are exact-question,
  exact-employer suggestions, never auto-filled. Work authorization and sensitive
  answers must be entered directly on the employer site. Remove saved answers in
  Settings > Application assistant. User data export includes review drafts and
  remembered answers; account deletion cascades to them and connections.
- Embedded forms require optional access to the exact supported ATS host. Use
  the hint inside the form; the popup does not guess which iframe to fill.
  Embedded hints start above the form so they are visible even in tall frames;
  direct pages retain the floating bottom-corner hint.
  Grant access and reload the employer page when enabling hints for the first
  time. No permission to the parent employer site is requested. Each action is
  bound to the originating frame document; replaced frames reject late fills.
- Custom combobox/listbox question labels are available for web review, but
  their answers are not filled. Selected text, self-referencing labels and
  ambiguous multiple label references are excluded from capture.
- History: select one saved entry; one empty row must be unambiguous or focused.
  Populated rows and probable duplicates are preserved. Dates retain their exact
  precision; native degree/month selects require one exact match. Reversible
  ARIA history single-selects require an explicitly linked listbox, one exact
  match and an enabled blank option for Undo. Ambiguous or irreversible custom
  controls, multi-selects, current-role checkboxes, Add another and Next stay manual.
  Undo history preserves user edits and expires after ten minutes. Profile
  revision checks reject an entry selected before the profile changed.
- Tracking: I applied requires editable company/title review and an explicit
  confirmation. A recent application URL can be reused on a same-origin success
  page for thirty minutes after inspection. Previews expire after two minutes;
  disconnecting clears cached previews/URLs. No submission is inferred from
  filling, and repeat confirmations do not duplicate or regress an application.
- No generated answers, sensitive-choice filling, arbitrary cross-origin iframe
  access, custom question answering, or next-step/submission automation. Custom
  employer domains use the conservative toolbar fallback, not automatic hints.
- The DOM adapter can confirm an immediate input value but not an ATS's eventual
  server-side acceptance. Users must review the employer form themselves.

## Connection Security

`/api/extension/v1/...` is a narrow bearer-only API, separate from web sessions.
Connection uses explicit web consent, a fresh authenticated session, an exact
allowlisted Chrome redirect, a two-minute single-use code, state, and S256 PKCE.
Only code/token hashes are persisted. Access expires in eight hours at most and
is rejected when its originating web session expires, is revoked, or is signed
out. Settings and the popup both support revocation. There are no refresh tokens.

Resume sharing is a separate, single-file capability, not an expansion of the
connection's access to the document library. A ten-minute pending choice becomes
a two-minute S256 PKCE-protected, single-use approval after web confirmation.
It is bound to the connection, session, exact application URL, selected document,
and document revision. Ownership/session/revocation are checked again before
returning bytes. Only hashes of approval codes are stored. Consumed/cancelled
requests are removed; expired requests are pruned on subsequent requests and
connections cascade on deletion. No bytes are written to extension storage,
server temporary files, or logs. File transfer is bounded in memory and uses the
existing local-legacy/S3 storage reader. All attachment writes in tests use
synthetic employer pages, not real applications.

Credentials live in trusted `chrome.storage.session`, never sync storage or the
employer DOM. Only selected contact values enter the isolated script world. Fill
is bound to the originally inspected tab/document and exact URL. Messages are
accepted only from the extension's own popup or its supported-site frame
content script, with host permission rechecked for each action. Content scripts
never receive tokens or whole profile responses. Programmatic page clicks cannot
invoke the hint's actions. Arbitrary web messages and remote executable code are
not supported. Requests and stored questions/answers
are bounded; no endpoint proxies arbitrary URLs. The existing per-process rate
limiter is not a substitute for distributed edge limits at rollout.

Chrome references: [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab),
[identity](https://developer.chrome.com/docs/extensions/reference/api/identity),
[storage](https://developer.chrome.com/docs/extensions/reference/api/storage),
[scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting).

Detection uses a throttled MutationObserver with unchanged-render suppression,
pauses when hidden, and only compares URLs on the SPA fallback interval (no DOM
polling). The hint is dismissible per page. Revoking site access removes existing
hints; expired connections prompt reconnection. Filling is revalidated after the
contact API response so a delayed response cannot fill another job's form.
Every worker start also reconciles missing content-script registration against
existing permission grants. Unchanged registration is retained; waking the
worker does not briefly unregister an active detector. Custom question capture
preserves fieldset context such as "Reference details: Email".

## Verification

- `node --import tsx --test tests/application-assistant.test.ts tests/application-answer-policy.test.ts`
- `DOTENV_CONFIG_PATH=.env.local NODE_PATH=./node_modules/next/dist/compiled NODE_OPTIONS=--conditions=react-server npx tsx -r dotenv/config tests/integration/application-assistant.ts`
- `npm run extension:test`: intercepted synthetic employer forms in real Chromium;
  no employer traffic, submissions, or user data. Targets: all expected fields
  filled, zero unsafe fields changed, zero Next/Submit clicks, no answer overwrite.
- `npm run extension:test:resume`: resume fixtures for all three adapters,
  exact bytes, existing files, field replacement, ambiguity, format mismatch,
  navigation, rejected widgets, and no Next/Submit or resume-autofill invocation.
- `npm run extension:test:undo`: all three adapters, repeated undo, edits (even
  changed back), replaced/disabled/hidden/readonly/ambiguous controls, navigation,
  expiry, and zero Next/Submit. The browser integration also verifies actual
  Undo/refill controls, worker-start registration recovery, profile copying,
  clipboard failure, retained question drafts and a 320px review layout.
- `npm run extension:test:package`: production and Store ZIP integrity, fixed
  origins, minimal permissions, distinct Store identity, and prohibited flags.
- `EXTENSION_TEST_PROFILE=output/playwright/assistant-frames-profile npm run extension:test:frames`:
  real MV3 cross-origin frame isolation, old-registration upgrade, trusted-click
  enforcement, review privacy, replaced-document races, narrow layout and
  permission removal/re-enable. Approve optional permissions once with
  `EXTENSION_HEADED=1` in this disposable profile. Every HTTP request is mocked.
- `npm run extension:test:expanded`: Workday/iCIMS/generic contact and selected
  history fixtures, existing rows, precision, native selects, edited Undo,
  ambiguous repeaters, reference fields, DOM/navigation races, mobile layout.
- `EXTENSION_TEST_PROFILE=output/playwright/assistant-frames-profile npm run extension:test:history`:
  actual MV3 runtime, selected-entry requests, Workday/iCIMS history/Undo,
  same-origin success navigation, explicit confirmation, replay rejection and
  account-cache clearing. API data is synthetic; real backend invariants are
  covered by `tests/integration/application-assistant.ts`.
- `DOTENV_CONFIG_PATH=.env.local NODE_PATH=./node_modules/next/dist/compiled NODE_OPTIONS=--conditions=react-server npx tsx -r dotenv/config tests/integration/extension-resume.ts`:
  temporary local users/files; ownership, PKCE, one-use race, revision, expiry,
  revocation, bounded reads and cascade cleanup.
- `node scripts/test-application-extension-connection.mjs`: real unpacked Chrome
  identity/consent flow against localhost only. Requires the local preview build,
  allowlisted unpacked extension ID, local admin test login, and a complete
  Playwright Chromium install. Revokes its connection and signs out afterward.
- `EXTENSION_HEADED=1 EXTENSION_TEST_PROFILE=output/playwright/assistant-test-profile npm run extension:test:detection`:
  real MV3 worker, dynamic scripts, three synthetic ATS fixtures, dynamic mounts,
  SPA navigation, revocation/re-enable, trusted clicks, no overwrite, safe fields,
  review capture and delayed API response. Approve Chrome's native site-access
  prompt once in this disposable profile; later runs may omit EXTENSION_HEADED.
  A fresh headless profile cannot approve the native prompt. API data is synthetic
  in this fixture test; the test below covers the real backend.
- `DOTENV_CONFIG_PATH=.env.local NODE_PATH=./node_modules/next/dist/compiled NODE_OPTIONS=--conditions=react-server EXTENSION_TEST_PROFILE=output/playwright/assistant-test-profile npx tsx -r dotenv/config tests/integration/application-extension-browser.ts`:
  creates a temporary local account with confirmed contact facts, signs in through
  the real UI, pairs via Chrome identity, fills a synthetic form using the real
  contact API, exercises resume confirmation/cancellation and attachment with
  the real API, checks download/mobile layout, then revokes/signs out/deletes it.
  Add `EXTENSION_EMBEDDED_FIXTURE=1` to run the same authenticated flow in a
  cross-origin Greenhouse iframe, including per-file consent and exact bytes.
- `node scripts/test-application-extension-toolbar.mjs`: interactive native-toolbar
  activeTab smoke test, without ATS host permissions. Open Extensions > ApplyOverflow
  > Fill contact details in the test browser. No real employer traffic.
- `EXTENSION_TEST_PROFILE=output/playwright/assistant-test-profile node scripts/inspect-application-extension-live.mjs <supported URLs...>`:
  live read-only detection/visual checks. Never clicks Fill, Review, or employer controls.

These scripts require a complete Playwright Chromium install. Set
`PLAYWRIGHT_BROWSERS_PATH` if using an isolated browser installation.
Use a fresh dedicated test profile when testing a rebuilt unpacked worker;
Chromium may retain the previous worker in an existing automation profile.
For example, the resume batch was verified with
`EXTENSION_HEADED=1 EXTENSION_TEST_PROFILE=output/playwright/assistant-resume-profile`
on the browser integration command, approving the native site-access prompt
once, then rerunning headlessly. Never point these tests at a personal profile.

Deploy the matching web/backend revision before distributing 0.5: earlier
backends lack history/tracking endpoints and broader URL validation. Installed unpacked
previews require Reload in Chrome and an employer-page refresh.

Before public release: broader real-form compatibility validation (with
consenting test profiles), controlled React/select/repeater fixtures,
Chrome Web Store review, and source-grounded answer-drafting batches.
