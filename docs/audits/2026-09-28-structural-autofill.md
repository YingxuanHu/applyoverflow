# Structural autofill compatibility, 0.11.2

## Reproduction

Inspected the public Zip/Ashby application at
`https://jobs.ashbyhq.com/zip/b5242472-5679-4084-af77-238b6335b792/application`.
The same application was open in the user's normal Chrome window.

- Education History and its rows are ordinary `div` containers, not the semantic
  sections/fieldsets or provider selectors previously recognized by history.mjs.
- The School combobox has no ID or explicit accessible label association. Its
  local unbound label can already be recovered by the shared label detector.
- School search results have separate name, country and domain text. Comparing
  the whole option text against the saved institution cannot succeed.
- The Add Education button has no explicit type, but has no form owner. It is
  not a native submit control. No employer selector is needed to establish this.
- The SMS native radios share a name and a local prompt, but have no fieldset or
  radiogroup. They were reported as two separate unanswered questions even after
  a selection existed.
- Ideal start date is a custom choice, not a free-text date. Its actual options
  are "As soon as possible" and January through September 2027. Arbitrarily
  writing today's date would not constitute a valid selection.

## Changes

- Discover locally labelled history containers and structurally bounded records
  without requiring ATS-specific CSS. Keep sibling major/date fields with their
  school/employer identity. Scope record Add controls to that history owner.
- Treat discovered history fields as record fields, not missing scalar profile
  facts or questions for AI generation.
- Match rich school options by their primary name when the other text is
  recognizable geographical metadata plus a domain. Preserve campus distinctions
  and reject duplicate candidates. Wait for async results and verify selection.
- Group native choices using name, lowest common ownership and a local prompt.
  Validate every option label again before writing.
- Support explicit non-submit Yes/No buttons with verifiable pressed states.
  Submit-capable buttons, legal attestations and unsupported controls stay manual.
- Replace the blanket "Missing information" fallback with an honest unmatched
  answer message. This does not pretend unmatched server-side wording is fixed.

## Verification

- `npm run test:unit`: 1,219 passing tests.
- `npm run extension:test:shared`: passing, including 200 context cases and
  history, native/custom choices, wrong-campus, overwrite and submit safeguards.
- New structural-history suite: 9 passing tests with multiple provider shapes,
  delayed rich options, two education records, independent major fields,
  sibling work dates, international metadata, duplicate rejection and retries.
- The new scenarios also run against the generated isolated-world runtime.
- Package tests: preview/Store/Store-test packaging and unchanged permissions.
- Progress display test and targeted ESLint: passing.

Live rerun of the previously approved Achievers/Lever application used the
installed 0.11.2 extension and production profile. It preserved eight completed
fields and left ten questions unfilled. Existing qualification narratives did
not have sufficient evidence for additional answers. Authorization wording,
gender wording and compound ethnicity labels still need planner improvements;
this rerun is not a successful resolution of those mappings.

No applications were submitted. The new Zip profile/resume Autofill run awaits
specific user permission; DOM inspection and regression fixtures are not a live
Autofill pass. The production web/API deployment and public ZIP remain 0.11.1;
the local unpacked Chrome extension is the 0.11.2 test build.

## Remaining Work

Live Zip verification, shared answer-intent coverage for the wording failures
above, preferred-start choice semantics, and the unmatched conditional source
detail question remain pending. Unknown hosts still require site access through
the toolbar; no automatic all-sites permission was added. Authentication-gated
and unsupported widgets are not universally verified. No algorithm can promise
permanent compatibility with every changing third-party form; changes must have
observable write verification and regression coverage before claiming support.
