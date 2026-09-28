# Autofill 0.10.0 validation

## Behavior

- Autofill fills saved facts and opted-in resume data first, then inserts supported
  professional answers directly on the employer form.
- Popup and on-page assistant show value-free field progress, not a duplicate
  questionnaire. Users review and edit answers on the employer form.
- The service worker owns generation; requests run two at a time and DOM writes
  are serialized, pinned to the original document, and rechecked for user edits.
- Unknown facts, unsupported controls, sensitive decisions and certifications
  remain unfilled. Exact live options and professional evidence are required for
  generated choice answers. No Next, consent or Submit actions are automated.
- Generated answers are transient, not saved as profile facts. Overall generation
  time and individual model requests are bounded.

## Verified before release

- 1,019 unit tests pass, including concurrent-edit preservation, exact-choice
  matching and exclusion of sensitive or AI-restricted questions.
- Package integrity, existing adapter autofill, readiness and progress rendering
  tests pass. The progress view has no answer controls or answer values and fits
  a 320px viewport. Show field focuses the actual employer control.
- Typecheck passes. Lint has no errors; two pre-existing unused-variable warnings
  remain outside this change.
- Database-backed semantic answer tests pass with a disposable synthetic profile.
- Native MV3, authenticated local API and live model test passes: contacts and a
  professional answer are inserted even after the on-page assistant is dismissed.
  Editing is done on the employer form; existing answers are preserved.
- Live Mission Lane Greenhouse form passes with synthetic profile data and
  employer traffic blocked before filling: actual dropdown values and a non-generic
  professional overview are inserted. A Canadian province does not become a US
  state; undocumented management experience is not asserted. No upload or submission.
- Restarting the disposable browser retains the connection. Disconnect revokes
  the token and clears the local connection.

## Limits

Earlier 0.9.0 live checks cover eight public forms and separate personal-account
checks on Greenhouse and HiBob; those are not new 0.10.0 certification. Arbitrary
widgets, incomplete profile histories and employer-specific choices may still
require manual input. Fixture coverage is not universal platform compatibility.
Store publication is separate from this downloadable preview.
