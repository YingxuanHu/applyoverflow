# Autofill 0.10.3: complete history records

## Behavior

- Month-only history dates use the first day for starts and the actual final day
  of the month for ends when the employer requires a day. Exact dates win,
  current entries have no end date, and year-only dates remain unresolved.
  Stored profile date precision is unchanged. The progress summary discloses
  when month boundaries were used.
- Explicit majors/programs survive resume extraction, sanitization and merging.
  Shared profile normalization recovers missing majors from clear degree wording;
  ambiguous qualifications and unrelated minors are not treated as majors.
  Existing user-entered fields of study are preserved.
- HiBob history editors are completed, validated, saved and followed by the next
  profile entry. A compatible partial editor can resume after an extension reload.
  Conflicting values, missing required facts, failed Save, navigation and edits
  prevent automatic saving. Apply/Submit/Continue are never clicked.
- Progress reports include the number of history records saved, not just writes.

## Verification

- Unit tests cover explicit program extraction, compound-degree ambiguity,
  legacy dates, structured precision and preserved user edits.
- Resume import integration verifies a major reaches the shared profile and
  existing user-entered majors survive subsequent imports.
- Browser fixtures save three work records and two education records in one pass;
  cover partial-row recovery, leap years, month/date formats, current roles,
  repeat fills after reload, missing facts, conflicting edits and failed saves.
- Actual public HiBob Angular form tested with outbound employer traffic blocked:
  authenticated local API projects a synthetic profile with legacy month ranges
  and missing explicit major fields. All five records save, no editor remains,
  and repeated Autofill creates no duplicates. No application is submitted.
- Existing expanded, contact/autofill, package, typecheck and lint checks pass.

HiBob's custom resume upload remains manual. This release does not certify all
custom editors or authenticated Workday/iCIMS flows. Missing facts are reported,
not invented to satisfy a required field.
