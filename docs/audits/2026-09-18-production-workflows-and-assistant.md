# Production Workflows and Assistant Follow-up

Date: September 18, 2026 (America/Toronto). Branch: `dev`, base `13edb0d5`.
Changes remain local and uncommitted. No production deployment, migration,
job-data repair or employer application submission was performed.

## Actual Production Checks

Signed in normally to applyoverflow.com with the existing dedicated audit account
in an isolated headed Chrome, not with the localhost development login. Checked
the public-facing Jobs interface and authenticated application workflows, not
just API responses. Credentials stayed outside the repository and report.

| Workflow | Observed result |
| --- | --- |
| Sign-in and authenticated navigation | Jobs, Picks, Applications, Documents, Profile, Settings and Notifications loaded |
| Search and paging | Title search, next page, combined title/location filters and filter cancellation worked; default filters showed zero active |
| Invalid salary filter | Applying a reversed range did not navigate; cancel discarded the draft |
| AI search | "Data analyst jobs in Toronto" became title/location/job-function filters with visible results |
| Empty search | A unique nonexistent title produced an empty state; Clear filters returned to the board |
| Saved search | Created, reloaded, restored and deleted the audit search |
| Job selection | Desktop first-selection/detail and narrow-screen selection/scroll worked; smooth scrolling requires waiting for completion |
| Wishlist and comparison | Saved two jobs, confirmed persistence, compared them, then removed both; comparison withheld salary it could not confirm |
| Manual tracking | Created a clearly synthetic application, validated missing title, changed status to Interview, reloaded and checked the timeline |
| Reminder | Created without notification time, reloaded, edited and deleted with confirmation; no notification was scheduled |
| Incomplete application | Short pasted description was rejected with its draft retained; Analyze fit explained the missing profile data |
| Incomplete profile | Picks displayed the setup requirement instead of claiming successful empty recommendations |
| Narrow layouts | Visually checked job detail, application list and comparison at 390px; no page-level horizontal overflow in these samples |
| Sign-out | Confirmed sign-out and checked protected comparison redirect |

All created production application records, bookmarks, saved searches and reminders
were removed. No employer received a form submission or uploaded file. These are
representative checks, not an exhaustive assertion about every account or ATS.

### Sample Timing

Single-user samples, not load tests, p95s or service-level guarantees. Existing
prefetch/caches were allowed, reflecting normal navigation.

| Action | Observed | Working target |
| --- | ---: | ---: |
| Prefetched next page | about 0.19 s | under 1 s |
| Add Toronto to title filter | about 1.67 s | under 2 s |
| AI search to filtered results | about 1.67 s | under 3 s |
| No-match search | about 1.07 s | under 2 s |
| Authenticated route to heading | about 0.27-0.59 s | under 1 s |

Do not report the raw canonical lifecycle count as the public pool. No new pool
count query was added; the audit used the board's existing displayed metrics.

## Confirmed Fixes

1. **Salary endpoints:** Sun Life's Senior Software Quality Engineer (Mainframe)
   (`cmu6m1j6p8leplmrv7e9hjlvq`) displayed CAD 90,000-90,000/year while the source
   description says `90,000/90 000 - 140,000/140 000`. The parser now collapses
   numerically identical bilingual representations and parses the actual range,
   not the first two numbers in the surrounding paragraph.
2. **Salary period:** Bevi's Senior NPI Quality Engineer
   (`cmu6vq2qf000abrrvilswyz70`) displayed USD 116,025-143,325/month. The description
   has that pay range separately from monthly phone/commuting stipends. Period
   evidence is now limited to the amount or an adjacent pay clause; HTML block
   boundaries are retained and both annualized endpoints must be plausible.
   Regression tests retain genuine hourly/daily/weekly/monthly pay. Original
   snippet text remains available as extraction evidence.
3. **Extension startup:** Browser integration reproduced permissions surviving
   while registered detection scripts were absent. The worker now reconciles on
   every start and retains unchanged registrations. The rerun restored the hint
   without toggling permissions.
4. **Question context:** Custom reference-email fields were correctly skipped by
   contact fill but captured simply as "Email". Capture now retains the fieldset
   context; existing field values are still never uploaded.

The salary parser change does not itself repair already persisted production
rows. Deploy, then run a separately reviewed bounded re-extraction/repair using
retained source evidence and verify feed-index synchronization. Do not convert
all suspicious monthly amounts to annual solely by magnitude.

## Next Assistant Batch Implemented

- **Undo contact fill:** visible when relevant, same document/URL, original
  control and unchanged value only. Trusted user edits remain protected even
  when changed back. Ten-minute bounded in-page memory; no new disk storage,
  API request, database table or permission. Does not remove attachments or
  retract information already autosaved by an employer.
- **Profile reference:** expandable web workspace with Contact, Work and
  Education tabs, per-field copy controls and manual-copy failure feedback.
  Year-only dates remain years; missing values are omitted; repeated roles are
  distinct. Profile facts are not sent to the extension. Switching reference
  views does not discard unsaved question answers. Available from every owned
  application, including manually created ones.

## Verification

- 962 unit tests passed, including production salary examples and reference
  projection/precision/privacy bounds.
- TypeScript and focused ESLint passed; an isolated optimized Next.js production
  build passed without interrupting the existing development server.
- Local database integration passed ownership, connection/PKCE, replay,
  revisions, scoped answers and profile-reference isolation.
- Contact-fill and resume suites passed across synthetic Greenhouse, Lever and
  Ashby forms; no Next/Submit clicks and no silent overwrite.
- Undo fixtures passed on all three adapters, including edit/replacement,
  ambiguity, visibility, expiry, repeat invocation and navigation cases.
- Real MV3 Chrome integration against the built local backend passed normal
  sign-in, web consent, restored detection, contact fill, Undo/refill, web question
  capture, exact year copying, clipboard failure, retained drafts, 320px layout,
  resume cancel/choice/attachment and disconnect/revocation. Temporary users,
  resume bytes and connections were cleaned up.
- Downloadable production-origin preview ZIP is about 100 KiB; packaging is
  local only, not a Web Store publication or production rollout.

Screenshots/logs are under `output/playwright/production-audit-20260918-*`,
`assistant-reference-*`, and `production-follow-up-*` (ignored artifacts).

## Remaining Boundaries

- Production has not received the onboarding/extension preview, so its new-user,
  connection and resume-sharing workflow was tested on a built local backend,
  not misrepresented as live production coverage.
- Work/education repeaters, custom selects, embedded/cross-origin forms, Workday,
  AI narrative generation, real employer uploads/submissions and Chrome Web Store
  installation remain outside this verified slice.
- Did not exercise password reset/email delivery, account deletion, billing,
  notifications at a scheduled delivery time, or every document generator using
  real personal data. Do not claim the whole app is bug-free.
- Some company-logo requests returned 404. A separate source/domain audit should
  address those without substituting unverified company identities.
- Full private-beta coverage still requires the broader fixture and consenting
  tester matrix in the design document; three adapters are not universal coverage.
