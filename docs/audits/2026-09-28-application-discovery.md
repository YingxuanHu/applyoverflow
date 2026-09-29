# Shared Application Discovery

Status: 0.11.4 deployed at revision
`9b4cb08ef94183f73d775040d8bbd26505a1850b` on September 29 UTC.
Chrome's extension-details page confirms 0.11.4 in the existing unpacked folder.

## Findings

The extension already had generic HTTPS toolbar support, but application
selection depended on an email field and, for form-less pages, an upload control.
Known-provider selectors could prevent the generic path from running. Clear
questions rendered as nearby spans/divs were not recovered. The indicator did
not observe late label/ARIA attributes or text-only mutations.

## Changes

- Evidence-based form selection with negative context checks. Applicant identity
  plus contact information, independent job-specific questions, or recognizable
  education/work records can establish a locally labelled application step.
- Shared fallback for known-provider markup drift and custom non-form containers.
  Select the full local application region without merging separate applications
  or escaping a third-party contact section.
- Single-control structural labels, while preserving explicit label precedence,
  conflict rejection and reference/history ownership.
- Label/text hydration triggers bounded indicator rescans. No permissions or
  profile-transmission behavior was broadened.

## Verification

- New discovery suite: 34 network-isolated scenarios, actual field-value readback,
  no Submit/Continue clicks; source and serialized package runtime tested.
- Existing context suite: 200 cases, including open shadow roots, forbidden forms
  and field-owner isolation.
- Autofill, semantic, shared-control and legacy extension suites passed.
- 1,227 unit tests, TypeScript checking and ESLint passed.
- Production, store and store-test ZIP validation passed. The compressed
  production candidate is approximately 166 KiB, with no new dependencies.
- Full MV3 detection/permission harness was attempted but timed out waiting for
  the optional-origin permission request in headless Chrome. Its permission UI
  lifecycle is not claimed as verified by this run. A separate indicator test
  verifies late ARIA/text mutation behavior with mocked permission availability.

The isolated regression tests transmitted no personal profile or resume.
Remaining limitations
include inaccessible cross-origin frames, closed/split shadow roots, ambiguous
controls, and employer-specific editors or option catalogs.

## Production Release

- [GitHub Verify](https://github.com/YingxuanHu/applyoverflow/actions/runs/36507654800)
  passed. The exact Primer URL has a regression test covering the shared
  extension/backend resolver and its employer-boundary checks.
- Built and imported only the web image. Compared Prisma, the dependency
  lockfile, Dockerfile, Compose config and guarded-transport implementation
  against the running `fbc5122` revision; none changed. No migration was needed.
  The remote source checkout and worker images were not changed.
- Reused the release script's headroom guard with the actual web-image size:
  943,326,708 bytes; required 6,181,620,712 bytes; available 6,881,492,992 bytes.
  Verified both Docker and containerd storage paths. No image pruning occurred.
- Candidate PDF generation and sandbox checks passed. Retained the old web image
  as `applyoverflow-rollback:before-0.11.4-web`; recreated only the app.
  Public health returned ready with the new revision. PostgreSQL, workers and
  Caddy stayed running. Root retained about 5 GiB free; the volume about 82 GiB.
- Downloaded the public ZIP and compared all 14 extracted files with the tested
  package and installed folder. Every file matched. ZIP-level hashes differ
  because of archive metadata; no runtime-file discrepancy was found.
- Reloaded Chrome without changing the extension ID, login or permissions.
  The live Primer page now shows the on-page assistant and enabled Autofill
  control, instead of failing before form inspection.

## Live Primer Test

The user explicitly approved sending their saved profile and default resume to
this Primer application. Tested the installed extension through its on-page
Autofill button, using the deployed backend, without script injection or manual
field entry. Chrome's accessibility tree confirmed name and email values, two
saved voluntary selections, and the attached resume filename. The assistant
reported **4 filled, 8 left empty**, with the resume tracked separately.
A second Autofill run completed with the same visible field values and one
resume attachment; no existing answer was replaced or attachment duplicated.

Remaining fields: expected salary, combined notice-period/start-availability
question, future base country and its conditional Other detail, country-relative
working-rights status, sponsorship visa details, race option matching, and the
full-working-rights Yes/No buttons. The salary message requested a profile value;
other reasons included unsupported question semantics and a nonmatching option.
These are recorded as remaining gaps, not all dismissed as missing profile data.
No country, immigration status or personal fact was invented. The job lists
multiple non-North-American hiring locations, so Canadian residence alone must
not become authorization for the offered job countries.

No application was submitted, no legal attestation accepted, and no profile
values were changed for this test. This confirms the original URL rejection is
fixed, not complete coverage of every question on this form or every Ashby tenant.
