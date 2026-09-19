# Resume Attachment Preview Verification

Date: 2026-09-18. Local preview 0.3.0; not deployed, committed, or published to the Chrome Web Store by this batch.

## Implemented

- Compact Choose resume action, shown in the on-page assistant only for an eligible empty attachment field.
- Authenticated web choice with no default file, optional download for review, and an explicit Share and attach resume confirmation showing the employer URL.
- PDF/DOCX, 5 MiB maximum. Original storage is reused; no new permanent or temporary resume copy. Reads are bounded in memory, including S3 responses that ignore Range.
- Single-file, single-use approval with state and S256 PKCE; connection, owning session, exact application URL, document ownership and revision are checked. Codes are hashed, approvals expire, and disconnect/account/session deletion cascade.
- Exact original tab/document/form/input binding. Existing files, changed fields, ambiguous IDs, incompatible formats, unsupported widgets and disabled inputs are left alone.
- Ashby's separate resume-autofill widget is deliberately excluded. Resume attachment never clicks Next/Submit or changes the tracker to Applied.
- Native file selection is reported separately from employer upload acceptance; rejected/reset widgets receive an explicit manual-review message and are not silently retried.

## Verification

- 951 unit tests passed, 27 suites; TypeScript and focused ESLint passed.
- Browser adapter fixtures passed on Greenhouse, Lever and Ashby for PDF and DOCX, exact bytes, duplicate IDs, existing file preservation, replacement/navigation races, accept mismatch, disabled controls and reset/rejected widgets. Zero unsafe overwrites or Next/Submit clicks.
- Real Chrome MV3 + real localhost backend: temporary account, sign-in, explicit connection consent, contact fill, cancel resume choice without sending a file, explicit radio selection, per-file approval, byte transfer, native attachment, disconnect and revoked-token rejection. Temporary accounts and fixture files were removed.
- Desktop (1100 px) and mobile (390 px) confirmation screenshots inspected; no horizontal overflow or overlapping controls.
- Local database integration passed owner isolation, wrong PKCE/session/URL denial, race/replay protection, document replacement, missing bytes, size limits, expiry, revocation and cascade cleanup.
- Synthetic S3-compatible endpoint passed success, missing object, range requests and over-limit response rejection. No real object store was contacted in that fixture.
- Live read-only checks detected the resume field on Figma/Greenhouse, Palantir/Lever and Notion/Ashby. No real employer uploads, fills, or submissions were performed.
- Production-origin preview ZIP rebuilt locally: approximately 99 KiB. Local download endpoint exercised by the browser integration test.

Artifacts (ignored): `output/playwright/assistant-resume-desktop.png`, `assistant-resume-mobile.png`, `extension-resume-unit-tests.log`, and `assistant-live-{greenhouse,lever,ashby}.png`.

The first browser run exposed a stale worker in a previously used unpacked-extension test profile. A fresh, isolated profile with native permission approval exercised the new worker successfully. Missing extension responses now show a reload instruction instead of an internal JavaScript error. This is not a claim that an unpacked ZIP auto-updates installed extensions.

## Remaining Gates

Only the additive `20260918220000_extension_resume_transfer` migration was applied locally for this batch. Production migration/configuration/deployment and Web Store publication remain separate work. No production Next build was run during this batch.

This verifies three adapter fixtures and three live detection samples, not universal ATS upload compatibility or employer-side processing. Workday, custom domains, cross-origin embedded forms, structured employment/education repeaters, and source-grounded AI question drafting remain future batches. The broader private-beta fixture and accessibility gates in the design document still apply.

References: [Chrome identity](https://developer.chrome.com/docs/extensions/reference/api/identity), [isolated script execution](https://developer.chrome.com/docs/extensions/reference/api/scripting), [native file lists](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/files), [DataTransfer constructor](https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer/DataTransfer).
