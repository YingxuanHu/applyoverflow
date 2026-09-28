# Production extension verification

## Method

Version 0.11.0, deployed revision `30179ad7e1344e83fd515288f5b2ab01688c2594`.
The public download was extracted and compared byte-for-byte with the tested
production build, then copied with checksum comparison into the user's existing
unpacked Chrome folder. Chrome's extension details confirmed 0.11.0 after Reload.
The existing production connection and supported-site permissions persisted.

These tests used the packaged extension in the user's normal Chrome, the saved
production profile and opted-in default resume. The user explicitly authorized
the named employer destinations and file uploads. No source injection or
synthetic profile was used. The checks read actual employer field values,
selected options, uploaded-file labels and saved history rows through Chrome's
accessibility tree; selected results were also inspected visually. No application
was submitted, legal attestation accepted, or Save and Continue clicked.

Counts below are the extension's progress counters, checked against the visible
fields. They are not a claim that every field or every tenant on a platform works.
Employer resume parsers can also populate fields; those writes are not attributed
to the extension. No contact values, resume content or credentials are recorded here.

## Initial Live Results: 0.11.0

| Form | Observed result | Gaps found |
| --- | --- | --- |
| [Braze / Greenhouse](https://job-boards.greenhouse.io/braze/jobs/8222294) | 7 filled, 3 existing, 8 empty; default resume attached; first education school/degree and second school visibly selected | Second degree unfilled. Job country unresolved for eligibility/commute; source and consent preferences unset. |
| [Achievers / Lever](https://jobs.lever.co/achievers/8a27486d-aa52-4a24-9222-bca5c6e9824c/apply) | 4 filled, 1 existing, 13 empty; name/email/phone/LinkedIn and successful resume attachment verified | Current location missed. Programming-language answer rejected by evidence validation. Exact leadership-years/coaching facts unsupported. |
| [Sentry / Ashby](https://jobs.ashbyhq.com/sentry/68757804-a892-40ed-8ea7-f2d13500f29c/application) | 5 filled, 4 empty; contact links and default resume verified | Location and Yes/No toggle groups absent from progress. Motivation answer failed validation; architectural example remained blank. |
| [From Day One / Workable](https://apply.workable.com/fromdayone/j/98A02EA1E9/apply/) | 4 contact fields filled; preselected phone country and pre-existing location preserved | Closed Add education/experience sections and custom resume upload not completed. Headline, summary and cover letter remained blank. |
| [Synpulse / HiBob](https://synpulse.careers.hibob.com/jobs/fdf3f02f-4c3b-472d-bf53-305dc0296650/apply) | 13 filled, 5 existing, 7 empty; 14 history fields, 2 education records saved; three grounded professional narratives actually inserted on the form | First work record blocked by required-field validation despite visible populated core fields. Eligibility dropdown selection and custom resume widget incomplete. |
| [BioAge / Rippling](https://ats.rippling.com/bioage-labs/jobs/d522f490-bd87-43a0-9383-b81c4bc91c44/apply) | Toolbar access worked; contact, location and one resume file remained after employer parsing. Closing popup did not cancel the run | Employer parser also populated company/phone data; not counted as extension-only writes. Unset pronouns/SMS consent and cover letter stayed blank. |
| [Mission Lane / Greenhouse](https://job-boards.greenhouse.io/missionlane/jobs/8848599002) | 10 filled, 18 empty; contact/preferred name, phone country, city, professional link, resume and saved sponsorship verified | Overview answer validation failed; one demographic option unmatched. Employer relationships, visa details, source and SMS preferences unset. No invented US state or leadership history. |
| [Recursion / Greenhouse](https://job-boards.greenhouse.io/recursionpharmaceuticals/jobs/8214932) | 11 filled, 9 empty; contact/link/resume, Canada-only work authorization and matching saved selections verified | Unmatched veteran option; ambiguous multi-country sponsorship. Clinical leadership not invented; unset personal facts and legal consent untouched. |
| [TD / authenticated Workday](https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers/job/Toronto-Ontario/Finance-Analyst_R_1510129/apply/applyManually) | 0 filled, 2 existing, 12 empty on My Information | Contact fields incorrectly classified as work/history fields. Stayed on this step; no Save and Continue. |

## Deployment Incident

The first image import exhausted root space and the PDF runtime gate failed with
ENOSPC before the app switch. PostgreSQL subsequently entered recovery after
disk-full writes. Older unused rollback images were exported to the attached
volume, gzip/tar and SHA-256 checked, then their root-disk copies removed. Current
and immediate rollback images were retained. No database files were deleted.
PostgreSQL completed WAL recovery/checkpoint and accepted connections again at
20:03:21 UTC. The retry passed runtime checks, reported no pending migrations,
and started the new healthy app. Other workers and Caddy were not restarted.

A second verified image archive increased root free space to approximately
14 GB; the attached volume retained approximately 82 GB. A follow-up deployment
guard checks root and actual Docker/containerd store headroom before import.

## Boundaries

Authenticated iCIMS and Workday history remain unverified. CAPTCHA-gated flows,
closed shadow roots, unsupported upload widgets and arbitrary tenant controls
are not covered by these results. Missing profile facts must not become guessed
consent, eligibility, employer relationships or professional qualifications.

Corrective patch verification will be appended after the patched production
package is deployed and tested through the same Chrome workflow.

During testing the user highlighted Recursion's remaining source, sponsorship and
qualification fields. Their earlier explicit source preference (Other,
ApplyOverflow) was saved through the production Profile UI. Another extension
Autofill click selected Other and filled its dependent text field with ApplyOverflow;
the visible count increased from 11 to 13 filled without replacing existing values.
The application country and specific clinical-experience fact were requested
instead of guessing jurisdiction or interpreting absent experience as No.
