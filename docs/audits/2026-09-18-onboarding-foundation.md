# Onboarding Foundation Verification

Date: 2026-09-18. Local implementation; not deployed.

## Scope

The first batch establishes resumable new-user setup, reviewed resume imports, profile compatibility, explicit job interests for recommendations, and conservative answer-reuse rules. It does not implement the Chrome extension or the application answer-review workspace.

Production `/profile` was inspected read-only to check placement and current behavior. The existing screen mixed residence with preferred job location and described seven populated sections as a completely filled profile. The patch separates those concepts and avoids claiming complete application readiness. No production profile, document, or application was changed.

## Automated Checks

- Full unit suite: 940 tests passed. TypeScript (`--noEmit --incremental false`), scoped ESLint, and `git diff --check` passed.
- New tests cover new-versus-existing enrollment, safe return paths, partial drafts versus completion, bounded schemas, legacy profile readers, address preservation, and explicit role/location intent.
- Answer-reuse tests cover approval, revision changes, exact semantic keys, company isolation, country isolation, and sensitive/narrative review requirements.
- Integration test uses a loopback-only in-memory S3 fixture and a temporary local PostgreSQL account. It exercises real resume extraction and persistence, draft survival, no premature profile updates, stale-revision rejection, concurrent uploads, and orphan-object cleanup.

Run the integration test with:

```sh
DOTENV_CONFIG_PATH=.env.local NODE_PATH=./node_modules/next/dist/compiled NODE_OPTIONS=--conditions=react-server npx tsx -r dotenv/config tests/integration/profile-setup-import.ts
```

The test refuses a non-local database, overrides object storage only within its process, disables AI parsing, and removes its own database fixtures. No new external storage service is needed for this test.

## Browser Checks

Playwright CLI on localhost with synthetic accounts:

- Newly created user follows the original callback through sign-in into onboarding.
- Existing local admin goes directly to Profile without being enrolled.
- Manual entry, step navigation, Finish later, Continue setup, and completion.
- Two tabs: a stale completion cannot overwrite newer setup progress.
- Residence remains Toronto while preferred job location saves separately as Vancouver.
- Actual file chooser and multipart upload through `/api/profile/resumes`, using synthetic text and a temporary loopback S3 fixture; imported employment, education, skills, and phone appear for review.
- Partial contact email can be saved and resumed, but completion requires a valid email.
- Desktop and 390px mobile screenshots inspected for clipping and readable controls.

Artifacts are under ignored `output/playwright/onboarding-*`. HMR caused transient stale-page errors during edits; the restarted upload flow had no browser errors. Font-preload warnings were present. Development compilation timings are not production latency benchmarks.

Both synthetic browser-test accounts and their document metadata were removed after verification. The temporary in-memory storage server was stopped, and the localhost preview was restarted with normal configuration. Local object storage is still unconfigured; uploading a real resume in that preview requires configuring the existing storage integration.

## Remaining Gates

- Real email delivery and Google OAuth callback exercise in staging; local checks cover application routing, not external provider behavior.
- Representative PDF, scanned-image, DOCX, and AI-extraction fixtures. This batch's integration/browser fixture is plain text with local parsing; existing extractor behavior was reused, not replaced.
- Profile field provenance, structured dates/entry IDs, and optional country-specific authorization data.
- Secure extension connection, compact controls, one tested ATS adapter, employer-page write verification, web-based answer review, and remembered-answer management.
- No automatic submission, employer-account creation, or real application tests.
