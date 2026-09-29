# Shared Application Discovery

Status: local changes for the unreleased 0.11.4 candidate. No production or
personal Chrome installation was changed by this task.

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

No personal profile or resume was transmitted to a new employer. No live
employer end-to-end fill was performed for this change. Remaining limitations
include inaccessible cross-origin frames, closed/split shadow roots, ambiguous
controls, and employer-specific editors or option catalogs.
