# Autofill 0.10.2 coverage audit

Checked September 28, 2026. This is a tested patch, not a universal-platform
compatibility claim or proof of deployment.

## Reproduced gaps fixed

- HiBob country-relative work eligibility questions now use the single country
  in the job header. The applicant's address is never used as job-country evidence.
  Multi-country or unknown-country headers stay unresolved.
- Short Yes/No dropdowns use already loaded options instead of an unnecessary
  asynchronous search. Virtualized lists search explicitly approved alternatives
  such as Other when ApplyOverflow is the saved source.
- The job-source matcher recognizes "this job opening".
- Full degree names can match their explicit broad qualification level. Exact
  program matches still take precedence; mixed levels are not upgraded.
- The extension reads unambiguous legacy history date ranges without modifying
  stored profile data or inventing months/days. Shared-year month ranges are
  supported; ambiguous numeric dates and academic seasons are not inferred.
- HiBob's previously unreported split salary control is detected. An explicitly
  saved annual USD/CAD amount can fill both controls, with currency checked first.
  Hourly pay, ranges, missing currencies and existing conflicting selections are
  not converted or overwritten. Formatted amount readback is verified.

## Public-form checks

The suite loads public employer forms, then blocks outbound employer traffic
before inserting synthetic profile values. Public Greenhouse education catalogs
are the only allowed post-load network requests. It reads actual DOM values and
checks repeat-fill behavior. No applications or real resumes are sent.

| Employer / platform | Filled fields | Detected fields | History writes |
| --- | ---: | ---: | ---: |
| Mission Lane / Greenhouse | 20 | 27 | 0 |
| Florida Panthers / Greenhouse | 14 | 21 | 5 |
| Synpulse / HiBob | 16 | 20 | 10 |
| Recursion / Greenhouse | 14 | 22 | 0 |
| Canonical / Greenhouse | 12 | 29 | 2 |
| BioAge / Rippling | 4 | 8 | 0 |

These are not completion percentages. History writes can overlap detected fields.
The direct inspector suite does not run AI drafting, so professional questions
remain blank there. Legal confirmations, unsupported controls and facts absent
from the synthetic profile are also included in the detected counts. Rippling's
location lookup is network-blocked in this controlled check, not certified here.
The previously supplied Weinstein posting no longer exposes a supported form.

HiBob's actual source, authorization, sponsorship, salary amount and currency
were asserted independently from the extension's completion state. The history
fixture uses full degree wording and legacy date strings, exercising server-side
normalization through real Greenhouse/HiBob controls.

## Additional checks

- 1,023 unit tests pass; typecheck passes. Lint has zero errors and two existing
  warnings outside this patch.
- Native MV3 -> authenticated local API -> real AI answer -> employer textarea
  passes with a disposable profile. Dismissing the assistant does not stop filling.
- Mission Lane native-extension test reads back actual dropdowns and the AI
  professional overview; unsupported leadership claims and a mismatched US-state
  question remain blank. Existing answers are preserved.
- Browser restart retains the connection; disconnect revokes it server-side.
- Fixture suites cover Greenhouse, Lever, Ashby, Workday, iCIMS, Workable and generic
  HTML; custom and native selects, radio groups, full addresses, history repeaters,
  default resume bytes, unsafe-field exclusion, navigation races and Undo pass.
- HiBob live Angular test saves two complete work entries and one education entry
  from synthetic data without submitting the application or selecting consent.
- Progress-only assistant passes the 320px layout test with no answer editors or
  private answer values. Production/Store/local package integrity tests pass.

## Still unverified or unsupported

The user's Mac was locked during this pass. The new build has not been rechecked
in their personal signed-in Chrome, and production is unchanged by this audit.
That check must follow deployment and extension reload before claiming personal-
account acceptance. The read-only profile audit confirmed legacy date text exists;
it did not change profile values.

Custom HiBob resume upload remains manual. Exact-day history widgets cannot use
month-only dates. Authenticated Workday/iCIMS workflows and arbitrary custom
controls are not certified by fixture tests. Unknown eligibility, relationships,
demographics and personal preferences must not be invented to inflate coverage.
