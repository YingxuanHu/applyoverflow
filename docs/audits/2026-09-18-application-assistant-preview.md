# Application Assistant Preview Verification

This records the initial 0.1 batch. See [0.2 detection verification](2026-09-18-extension-detection.md)
for the later multi-site, native-toolbar, real contact-fill and download checks.

## Scope

Local, additive follow-up to the onboarding foundation. No production deployment,
remote database writes, Chrome Web Store publication, commits, or merges.

- Allowlisted Chrome pairing with explicit web consent, fresh sign-in, S256 PKCE,
  single-use authorization code, hashed expiring token, and session-bound revocation.
- Narrow versioned bearer API for contact fields, question capture, and disconnect.
- Minimal MV3 popup and Greenhouse contact adapter; no application submission.
- Captured questions reuse the existing tracker, preserve application stage, and
  attach an unambiguous exact canonical posting when available.
- Web review with explicit saves, copying, employer-scoped remembered suggestions,
  and Settings controls to forget answers or disconnect extensions.
- Explicit given/family-name fields; never infer these by splitting full names.

## Results

| Check | Expected | Observed |
| --- | --- | --- |
| Full unit suite | No regressions | 945 tests passed |
| TypeScript / changed-file ESLint / diff whitespace | Clean | Passed |
| Database integration | Owner isolation and no implicit submission | Passed |
| PKCE and code replay race | Wrong verifier rejected; only one exchange succeeds | Passed |
| Session revocation | Subsequent extension requests rejected | Passed |
| Real unpacked Chrome connection | Web consent, exchange, disconnect | Passed against localhost |
| Synthetic Greenhouse form | All four expected empty fields filled | 4/4, about 150-210ms locally |
| Unsafe/control fields | No changes or submission/navigation clicks | Zero |
| Repeat fill | Preserve existing content | Passed |
| Ambiguous/controlled inputs | Skip duplicates; report rejected values | Passed |
| Unsupported host/multiple forms/changed URL | Fail closed | Passed |
| Capture | No existing form answers or contact values uploaded | Passed |
| Review persistence | Save, employer-scoped suggestion, forget | Passed in browser |
| Mobile layout | No horizontal overflow at 390px | Passed |

The database integration also exercises repeat/concurrent capture, stale review
revisions, forbidden sensitive-answer storage, same-employer versus cross-employer
suggestions, canonical posting linkage, and preservation of an APPLIED stage.
Synthetic users/records and this audit's temporary browser sessions were removed.

Browser artifacts live under ignored `output/playwright/`: `assistant-consent.png`,
`assistant-popup-connected.png`, `assistant-review-desktop.png`,
`assistant-review-mobile.png`, and `assistant-form-fixture.png`.

The local development server had a transient database connection timeout and
cold-build navigation timeout during repeated checks. Reruns passed. These are
not production performance benchmarks. The connection test allows 90 seconds
for a cold development navigation; ordinary adapter checks do not rely on that.

## Remaining Gates

This is a developer preview. Form tests use intercepted synthetic pages, not
submissions to real employers. The connection test runs the actual extension
page/worker and Chrome identity flow, but is not a physical toolbar/activeTab
gesture test. That and representative live-form compatibility remain release
gates. No universal Greenhouse compatibility is claimed.

Next batches: structured work/education history and provenance; deliberate resume
selection/attachment without duplicating stored files; richer controlled-input
adapters; source-grounded answer drafting with explicit approval; further ATS
coverage. Public distribution also needs privacy disclosures, a stable store ID,
security/permission review, and staged rollout. Setup and limits are documented
in [the extension README](../../extensions/chrome/README.md).
