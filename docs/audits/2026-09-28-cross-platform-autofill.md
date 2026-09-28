# Cross-platform autofill validation

Branch: `codex/cross-platform-autofill`, based on `66c429a`.

## Scope

The core path detects application forms and resolves fields from labels, ARIA
relationships, autocomplete hints and local group context. Provider adapters are
additional signals, not a requirement for an employer-owned form to work. It does
not widen Chrome site permissions. Unapproved origins still require a toolbar
click; on-page detection requires an approved origin.

The existing profile/contact record remains the source of truth. Added optional
notice period, travel willingness, separate application/job-alert/newsletter
preferences and location-scoped commute choices. Existing users receive no
default answers. Current company/title come from one explicitly current work
entry, not duplicate editable fields.

Shared control handling covers native fields/selects, checkbox/radio groups,
visible ARIA radios/checkboxes/switches, owned asynchronous comboboxes, datalists
and whole forms inside open shadow roots. Custom choices reach the profile planner
before a saved answer is available, while writes still require an explicit saved
choice and verified checked-state changes.
Readback distinguishes a committed selection from search text. Ambiguous choices,
busy lists, user edits and rejected writes are not reported as successful fills.
Saved country selections reuse explicit work-authorization answers.
Clearing a field during a run is preserved on subsequent passes. Full selection
sets are verified even when only one country is requested.

One click rescans newly mounted dependent fields and retries a cleared write once.
Work/education handling uses structurally scoped record editors and verified
record Save/Add controls. It fills all eligible records, preserves existing data,
and does not click an application Submit or Continue button. Required missing
facts stop a record Save, rather than creating incomplete or invented records.

Professional questions use bounded profile evidence and exact offered choices.
Sensitive facts, consent and legal attestations do not use AI inference. The
assistant remains a progress display; editable answers belong on the employer form.

## Verification

- Full unit suite: 1,171 passed.
- Shared browser suite: generic controls, shadow roots, asynchronous selection
  confirmation, partial history recovery, scoped Save/Add and duplicate guards.
- 138 context/detection cases; 26 choice-confirmation and pronoun cases.
- Existing autofill, semantic, question, Rippling and package suites passed.
- Local PostgreSQL-to-DOM integration verifies saved choices through the real plan
  query, plus missing jurisdiction and unrelated-location guards.
- Real database resume-sharing, revocation and profile-revision tests passed.
- Real profile form save/reload passed on desktop and mobile, including preserving
  rejected drafts and separate communication preferences.
- Native cross-origin frame test passed: trusted click, document isolation,
  no parent/sibling writes, undo, progress-only UI and permission revocation.
- Production build, TypeScript and lint passed; lint retains two unrelated existing warnings.
- Preview/Store packages remain under 160 KiB with unchanged minimal permissions.

Public live forms were opened in an isolated browser with synthetic facts. Writes
to employer endpoints were blocked before inserting data; no resumes were uploaded
and no applications were submitted. The live script checks actual name/email
values and accepted dropdown results, and fails if those expectations are missed.

| Live form | Saved fields filled | Additional history fields | Remaining constraints |
| --- | ---: | ---: | --- |
| Braze 8222294 | 10 | 2 | City-only posting context cannot establish legal jurisdiction or a scoped commute; legal retention consent remains manual. |
| Mission Lane 8848599002 | 20 | 0 | No invented US state for a Canadian resident, unsupported leadership/visa facts, or legal certifications. This shared-control run does not invoke AI. |
| Recursion 8214932 | 17 | 0 | Multi-country posting does not establish one sponsorship jurisdiction; unsupported clinical leadership and legal data consent remain manual. |
| Rippling/BioAge d522f490-bd87-43a0-9383-b81c4bc91c44 | 8 | 0 | Existing phone-country selection preserved; contact fields and explicit saved No on the custom SMS radio confirmed in the actual DOM. No resume upload attempted. |

The final four-form deterministic run completed individual fill/check passes in
2.4-6.9 seconds. This excludes initial page loading and AI drafting and is not a
latency guarantee for other sites or larger forms.

## Release Gates

Version 0.11.0 was subsequently deployed at `30179ad` and installed in the user's
normal Chrome. Production-profile verification and the issues it uncovered are
recorded in [the production audit](2026-09-28-production-autofill-verification.md).
The synthetic results above are not substituted for that live-account evidence.

The native test extension reached the authenticated API and inserted a real AI
answer after its assistant was closed. After fixing unnecessary abstention and
mixed answer/missing-fact output, the complete live Mission Lane run also passed:
real profile-backed dropdowns and an overview answer inserted directly on the form,
without asserting unsupported leadership credentials or a US residential state.
The motivation fixture used a generated answer. The successful live overview used
the conservative verbatim professional-summary fallback after model abstention;
it is not evidence that the model generated a tailored answer for that question.
Browser restart retained the connection; disconnect revoked server access.
This is bounded evidence for those flows, not a claim of perfect model reliability.

No claim of universal platform completion: closed shadow roots, unapproved
cross-origin frames, CAPTCHA, custom widgets without reliable selection semantics,
and unsupported multi-choice widgets remain limitations. Authenticated Workday
and iCIMS pages were not retested with this batch; their automated fixtures are
not a substitute for that release check.
