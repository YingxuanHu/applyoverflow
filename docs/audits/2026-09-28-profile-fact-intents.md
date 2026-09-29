# Profile fact intents: 0.11.5

## Scope

Shared extension-side fixes for applicant location, alternative professional
links, custom control ownership, and false user-edit detection. No backend or
profile schema changes are included. This is not universal form support.

- Resolve fact intents independently of ATS names and field IDs. Compose
  geographic components and allowed professional-link alternatives instead of
  adding whole-label exceptions for individual employers.
- Project an intent into text, native selections, datalists, or associated custom
  dropdowns. Require a committed choice, not merely matching search text.
- Permit bounded single-control ownership when a widget omits ARIA references;
  do not bypass invalid explicit references or borrow unrelated options.
- Support plain-text editable textboxes and semantically labelled search inputs.
- Compare committed values before protecting a user edit. Focus and navigation
  are not edits; real changes and deliberate clears remain protected by Autofill
  and Undo, including native and custom choice controls.
- Distinguish non-submitting default buttons outside forms from actual submit
  buttons. Explicit submit/form attributes remain blocked.

## Verification

- 44 new network-isolated browser scenarios pass, including exact reported
  labels, unrelated domains, widget variants, source/option ambiguity, ownership,
  actual trusted edits and submit prevention.
- Production ZIP runtime passes those 44 scenarios and 34 discovery scenarios.
- Full shared extension suite passes, including its 200-case context suite,
  custom choices, history, contact scope, compound controls, education and
  malformed employer validation tests.
- Core autofill and semantic extension suites pass.
- 1,227 unit tests pass. Typecheck passes. Lint has zero errors and the two
  existing unused-variable warnings in ai-access.ts and auth-password-reset.ts.
- Production package: 172,822 bytes. Production, store and store-test package
  checks pass. Extension ID, origin and permissions are unchanged.

## Live browser checks

Used the existing signed-in account and previously authorized profile/resume on
two fresh employer tabs. Inspected the actual employer form after Autofill, not
just the extension's progress count. No applications were submitted. Only the
two temporary test tabs were closed afterward; existing user tabs were retained.

### Achievers / Lever

https://jobs.lever.co/achievers/8a27486d-aa52-4a24-9222-bca5c6e9824c/apply

- Clicked into blank Current location and tabbed away before Autofill.
- Observed saved city/province/country in that field, contact details, LinkedIn,
  Other as the job source, the uploaded resume and explicitly saved voluntary
  choices on the employer form.
- Reported 8 filled and 10 left empty. Current company was later populated by
  the employer's resume parser; this is not counted as an extension success.
- Remaining gaps include unresolved employment-country context, hybrid schedule
  wording, an unsuccessful programming-language answer generation and screening
  questions without sufficiently supported answers. Background-check and
  future-contact consent were not accepted automatically.

### Sentry / Ashby

https://jobs.ashbyhq.com/sentry/68757804-a892-40ed-8ea7-f2d13500f29c/application

- Observed a committed custom location selection, both LinkedIn and GitHub,
  contact details, uploaded resume, saved voluntary choices and generated
  profile-backed prose in the employer's Why Sentry textarea.
- Final installed build reported 9 filled and 6 left empty.
- Remaining: missing pronouns; insufficient evidence for a specific architectural
  decision story; privacy acknowledgement; no exact match for the saved race
  choice; hybrid weekday preference; sponsorship wording using "the location
  where this job is posted". The last item is a backend meaning-matching gap,
  not proof that the profile lacks sponsorship information.
- Default-button ownership is fixed and fixture-tested, but it does not fix
  those backend question-matching gaps by itself.

## Delivery state

Installed and reloaded version 0.11.5 in the user's existing unpacked Chrome
extension. Chrome visibly confirmed the version and reload. The previous 0.11.4
folder was backed up, and all 14 generated files were copied and verified.

At the initial verification, no production deployment had been performed.
The subsequent release is recorded below. These live results do not certify other employers, authenticated ATS
flows, closed shadow roots, inaccessible frames, or arbitrary rich editors.

## Production Release: September 29

- Committed and pushed release `40ce530ba5ed7727506864973e2afabdc5b11c57`.
  [GitHub Verify](https://github.com/YingxuanHu/applyoverflow/actions/runs/36574291150)
  passed all jobs before activation.
- Confirmed that web source, dependency lockfile, schema, Dockerfile and Compose
  configuration were unchanged from the running `9b4cb08` web revision. The
  package.json difference only adds the new test command.
- Built an immutable, download-only image layer on the exact running base image
  `sha256:2fa029d6d0d209fd1d66e5607e64581eb5c8c6d86f0a838997bb60fee8fc5553`.
  No full-image import or dependency rebuild was needed. Checked over 4 GiB
  available on root and the actual Docker/containerd stores before building.
  The only copied file is `/app/public/downloads/applyoverflow-assistant.zip`;
  BUILD_SHA and revision labels identify this artifact release and its web base.
- Preserved the old image as `applyoverflow-rollback:before-0.11.5-web`.
  The release Dockerfile, ZIP and guarded activation/rollback script are retained
  under the attached volume's `autoapplication/releases/40ce530ba5ed7727506864973e2afabdc5b11c57`.
- Candidate PDF generation, parser and sandbox checks passed. Recreated only
  the app with `--no-deps --no-build`, waiting for healthy status. No database
  migration, image pruning, remote source synchronization or worker restart.
- Public `/api/health` returned ready at the release revision. The public ZIP
  manifest reports 0.11.5 and matches the tested package byte-for-byte:
  SHA-256 `1fae7d1e22d2f02f31d6515a884c3cd665f174e885a5bc91a72d1324f37db6e0`.
- PostgreSQL, Caddy and all three production workers retained their container
  identities. Root retained about 5 GiB free and the attached volume about 82 GiB.
  This small artifact release does not resolve the broader Docker storage issue.

## Full Web Rebuild: September 29

On explicit request, rebuilt the full linux/amd64 web image from
`ffacbcff1764d8644cc25bb7ead241c3e7e729f1`, rather than reusing the prior web
bundle. [Verify](https://github.com/YingxuanHu/applyoverflow/actions/runs/36575345204)
passed. The image is 943,329,985 bytes. Local compilation, TypeScript and PDF
parser checks passed. Local runtime smoke tests passed using temporary-memory
mounts after Docker storage pressure prevented normal temporary-file writes.

With the user's approval, exported the unused before-0.11.0 web and worker
rollback images to the attached volume's
`autoapplication/image-archives/rollback-before-0.11.0-20260929.tar.gz`.
Verified gzip integrity, both manifest tags, all referenced layers and SHA-256
before removing only those two local image copies. Image inspection metadata
and the checksum sidecar are retained beside the archive. Running and immediate
rollback images were not removed.

The import guard required 6,181,627,266 bytes; 10,138,161,152 bytes were available
on the root-backed image stores. Streamed the image over SSH without staging a
tarball on root. Candidate PDF generation, sandbox and parser checks passed on
the server. Preserved the previous app image as
`applyoverflow-rollback:before-full-rebuild-20260929-web`, then replaced only the
app container with health-wait and automatic rollback on startup failure.

Public health returned ready at `ffacbcff1764d8644cc25bb7ead241c3e7e729f1`.
The jobs route returned HTTP 200 after normal redirects, and all 14 public ZIP
files matched the tested 0.11.5 package. No sampled app startup errors. Database,
Caddy and worker container identities were unchanged. Root retained about
9.2 GiB free; the attached volume about 81 GiB.

Separately committed and pushed the previously pending main-workspace changes
as `c128ed0` on `codex/pending-product-updates`. That branch passed type checking,
1,010 unit tests and lint (two pre-existing warnings). It contains separate UI,
job-reporting schema and document-retention work and is not part of this rebuilt
production release. Its browser and database integration tests were not rerun
as part of this deployment.
