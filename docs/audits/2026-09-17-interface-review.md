# Signed-in interface review

## Scope and release state

Inspected production with the dedicated test account: Jobs, Picks for you,
Applications, Documents, Resume builder, Profile, Settings, Notifications,
Compare saved jobs, and Compare documents. Production was inspected without
editing account data, documents, or applications.

The screenshot in the request shows the older application-row controls.
The starting `main` revision (`4af3f76`) already keeps the title and status
visible, with secondary actions in one menu. That release was not yet visible
on production. This pass extends that hierarchy to the surrounding screens;
it does not deploy the changes.

## Changes

| Area | Problem observed | Implementation |
| --- | --- | --- |
| Applications | Add, Compare, counts, flow, and search competed across several rows | One header add action; secondary comparison; one result count; search, status, and sort grouped together |
| Application search | Mobile controls consumed four rows | Search submit integrated into the field; two rows at 390 px, three at 320 px to keep labels readable; GET navigation uses Next Form |
| Row actions | Inconsistent trigger sizes and unnamed document menus | Shared 36 px action trigger with a contextual accessible name, tooltip, focus treatment, and visible touch target |
| Documents | Builder promotion and repeated library headings pushed files down the page | Builder in the header; flat resume and cover-letter sections; templates in a labelled disclosure with a count |
| Document rows | Long cover-letter names overlapped Download on mobile | Titles wrap within their own column; Download and the actions menu remain visible |
| Resume drafts | Duplicate and Archive competed with Generate PDF and Download | Labelled Duplicate/Archive menu items; common output actions stay visible; pending states and action feedback preserved |
| Profile | Strict matching rules came before profile completeness and preferences | Optional requirements grouped with Job preferences, with an active count visible when collapsed; mobile summary tiles retain their labels |
| Settings | Nested panels and permanently expanded credential forms made scanning difficult | Flat page sections; labelled password/email disclosures; current sign-in and session information remain visible |

The Jobs detail actions, notification empty state, profile content accordions,
and comparison empty states already had a reasonable hierarchy and were left
alone. Application preparation no longer exposes environment-variable setup
instructions to users when AI is unavailable.

## Validation

- TypeScript and scoped ESLint passed; 37 focused tests passed.
- Desktop inspection at 1440 px; responsive screenshots at 390 and 320 px.
- Search submit, nonmatching results, clear/reset, view-flow disclosure,
  row status changes, reminder dialog, keyboard menu opening, Escape, and focus
  restoration checked on localhost.
- Created a temporary resume entry and draft through the UI; Duplicate and
  Archive succeeded. Archived drafts no longer offer Archive.
- Resume/template menus, template upload form reveal/cancel, and cover-letter
  delete confirmation checked with temporary local document metadata.
- Requirement-save failure was simulated locally. Its feedback remained
  visible, and the collapsed section retained its active count.
- Password mismatch feedback checked without sending a password change.
- Add application and application-detail actions checked at 320 px; theme
  switching checked with keyboard input.
- No horizontal page overflow across Applications, Documents, Profile, and
  Settings at 320/390 px. A fresh responsive pass reported no page errors.
- Removed this audit's temporary local applications, document metadata, resume
  drafts, and skill entry after validation; existing local records were kept.

Screenshots are in `output/playwright/interface-*`. Document metadata fixtures
were not real uploaded files, so downloading their bytes was not tested. The
production account has no tracked applications or documents; populated states
were tested locally, not inferred from production's empty screens. Local cold
compiles are not production performance measurements.

## Design rule

Keep common actions visible; expose secondary actions one level deep with
descriptive labels. Preserve active-state summaries and error feedback when
disclosing forms. This follows the requested [progressive disclosure
principle](https://www.nngroup.com/articles/progressive-disclosure/) and
[Carbon toolbar/action hierarchy](https://carbondesignsystem.com/components/data-table/usage/).
