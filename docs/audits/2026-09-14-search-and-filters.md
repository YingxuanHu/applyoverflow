# Search, Filters, and Job Labels

## Scope

Local implementation and verification of Jobs and Picks for you. Production was sampled read-only; no deployment, bulk relabeling, or production data mutation was performed.

## Findings and Changes

| Finding | Change |
| --- | --- |
| Pages, APIs, saved URLs, and filter chips had separate parsing rules. Repeated checkbox values could be lost. | Shared bounded parser and canonical URL builder; enum/alias normalization, literal keyword escaping, repeatable multi-select values, and pagination reset. |
| `Toronto, ON` could become Toronto OR Ontario, returning other cities. | City qualifiers are combined with AND; separate places use OR. Semicolons explicitly separate places. Jobs, feed index, and Picks share the predicate. |
| Legacy aliases could resurrect a cleared filter; editing location could preserve an old hidden value. | Resolve aliases before edits/removal; one canonical location field; preserve independent committed keywords, sort, and legacy constraints. |
| The filter popover lacked reliable focus handling and draft cancellation. | Shared modal dialog with trapped focus, Escape/Cancel, focus restoration, a scrollable body and fixed actions, committed badge count, and draft selection count. |
| Long option lists were hard to scan; several posted-date windows could be selected together. | Searchable option lists, wrapped labels, explicit no-options state, and one posted-date radio choice. |
| Salary bounds were ambiguous and unknown currencies could be treated as USD. | Explicit annual range, validation before submission, one currency-aware query predicate, and opt-in inclusion of missing salary/currency. Unknown currency is labeled as unknown. |
| Feed and detail salary display could re-extract different values from different payloads. | Serialize persisted salary facts consistently; do not invent new salary facts while rendering. |
| Technical references such as distributed systems, virtual machines, and hybrid cloud could imply a work arrangement. | Description-based work-mode inference now requires work-arrangement evidence; low-confidence work mode is not displayed as a confident label. |
| A sampled source supplied a role fragment as the location (`The Paralegal`). | Reject obvious role/prose fragments during extraction and suppress those legacy labels during serialization, without guessing a city. |
| Picks API did not consistently apply title/company terms or repeated filters. | Shared parsing and keyword/location semantics; fixture coverage verifies both supported API filters and actual matching jobs. |
| The feed contract checker lacked career metadata in its result projection. | Include the fields used by the checker and enable strict assertions in the database regression test. |

## Verification and Budgets

These are local regression checks, not a production-scale load test.

| Check | Expected | Observed |
| --- | --- | --- |
| Unit suite | Zero failures | 864 passed |
| Controlled database queries | Identical matching IDs/counts across canonical and index paths; zero contract violations | 18 query cases and 2 serialization checks passed |
| Local fixture query latency | Cold under 1 second, warm under 200 ms | Sample run: 98 ms cold; five warm calls at approximately 1 ms each |
| Browser-to-local-API smoke latency | Every request succeeds in under 1 second | Five title/location/work-mode/salary requests returned HTTP 200 in 81, 21, 19, 11, and 11 ms including JSON parsing |
| Filter state | No phantom defaults; Cancel discards drafts; aliases cannot restore removed values | Unit and browser checks passed |
| Browser interaction | Keyword/sort retained, location replaced, page reset, one date window, invalid salary blocked, Back/Forward restored, hidden selected options retained | Passed |
| Responsive layout | No horizontal overflow; dialog within viewport; equal desktop feed/detail heights | Checked at 390 x 844, 1024 x 600, 1440 x 720, and 1440 x 1000; desktop panels 832 px each at the last size |
| Saved searches and Picks | Persistence, ownership checks, strict requirements, fresh-empty cache without loops, cold-cache refresh completion | Workflow regression suite passed |
| Existing AI workflow | Late responses cannot override a newer draft/mode/clear; successful result navigates | Browser tests with deterministic responses passed |

Reproduction commands (local database and seeded local admin/jobs required):

```sh
npm run test:unit
npm run typecheck
npm run build -- --webpack
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config tests/e2e/search-filters.ts
TEST_APP_URL=http://127.0.0.1:3002 node tests/e2e/jobs.mjs
DOTENV_CONFIG_PATH=.env.local TEST_APP_URL=http://127.0.0.1:3002 npx tsx -r dotenv/config tests/e2e/ux-workflows.ts
```

Run tests after Prisma generation finishes, not concurrently with the build's `prebuild` generator. Database tests delete only their own fixture IDs in `finally`.

Browser captures: `output/playwright/search-filters-mobile.png`, `output/playwright/search-filters-dialog-desktop.png`, and the existing Jobs/UX workflow captures.

## Remaining Limits and Follow-up

- Existing incorrect source facts are not all repaired by a renderer change. Audit stored location, career, currency, and work-mode confidence against source evidence; use the existing bounded metadata/presentation repair tooling and rebuild affected feed-index rows. Do not bulk guess labels from titles or rescan every description on each search request.
- Geographic matching still uses text plus country metadata, not a complete city/subdivision geocoder. Ambiguous city/state names and records with missing country metadata need structured source-backed normalization. A location is not proof of remote work eligibility.
- Picks intentionally supports fewer hard filters than Jobs. The existing AI guard reports unsupported constraints rather than silently applying only part of the request. A future expansion should reuse the shared predicates and receive parity tests.
- Named saved searches and the existing browser-local saved-filter control remain distinct; consolidating them into one saved-search workflow would simplify the product further.
- No live microphone recording, paid AI model call, Safari/Firefox pass, or production-scale concurrency benchmark was performed. The automated browser checks use Chromium. These checks reduce regression risk but do not establish that every possible workflow is bug-free.
