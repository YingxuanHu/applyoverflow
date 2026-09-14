# Production Workflow Audit

Date: 2026-09-14. This is the pre-release audit record. Its patches were subsequently deployed in `61ec780`; see the [production release follow-up](2026-09-14-production-release.md) for current verification and remaining issues.

Follow-up: [Search latency](2026-09-14-search-latency.md) implements deferred exact counts, faster geographic row lookup, and selective pagination correctness. The diagnosis below records the earlier audit baseline; see the follow-up for the current implementation and remaining limits.

## Scope and Safety

Inspected the authenticated production site with the dedicated, ordinary-permission test account: Jobs, Picks, Applications, an application workspace, Documents, Notifications, Profile, Settings, and sign-in redirects. Checked desktop and mobile layouts and selected search/detail interactions. This is a sampled workflow audit, not a claim that every feature or browser combination is bug-free.

Created one explicitly labeled, fictional production application to exercise tracking and validation. Deleted it through the application's normal delete confirmation and verified it was gone. No real applications were submitted, no messages were sent, no production services were restarted, and no production schema or deployment files were changed. Query diagnostics on production were read-only, with individual execution bounds. Local integration fixtures clean up their own IDs only.

## Measurements

These are individual observations, not statistically established p95 values. Browser navigation timings include waiting for network idle; development compilation timings must not be compared with production budgets.

| Workflow | Working target | Production observation |
| --- | --- | --- |
| Warm navigation to ordinary app pages | At most 2 seconds | Picks, Applications, Notifications, Documents, Profile, Settings: 921-1,143 ms |
| Jobs reload | At most 2 seconds | 1,218 ms; document TTFB 121 ms |
| Uncached job detail selection | At most 500 ms | 213-245 ms; reselecting cached detail: 32 ms |
| Title search for engineer | At most 2 seconds | About 21 seconds, fails target |
| Company search for OpenAI | At most 2 seconds | 1,592 ms |
| Location search for Toronto | At most 2 seconds | 6,841 ms, fails target |
| Mobile content | No clipping at 320/390 px | Documents description extended beyond its header; fixed locally |
| SSR hydration | No recoverable hydration errors | Settings and application timestamps triggered React error 418 across time zones; fixed locally |
| Failed form submission | Keep entered values and show error beside form | Reminder and pasted-description editors closed before server validation; fixed locally |

Jobs' initial document transferred 62,483 encoded bytes (579,587 decoded). Existing desktop scroll containment was already present; no speculative scroll rewrite was made. New-profile Picks correctly required profile setup.

## Implemented Fixes

1. **Keep application drafts until an actual save succeeds.** Six editors awaited the `useActionState` dispatcher, which returns void, instead of waiting for the server action. Move success-only close/reset into the async action reducer. Preserve controlled reminder, header, and pasted-description drafts on validation failure; expose inline errors and lock conflicting controls while pending. A failed description fetch opens the paste fallback without making Cancel ineffective.
2. **Prevent a pre-hydration sign-in submission.** The native POST could submit to the page route before the client handler was ready. Keep submit disabled until hydration, retain POST as the fallback method, and provide a no-JavaScript explanation. No authentication bypass or weaker credentials were introduced.
3. **Honor the requested destination after sign-in.** An already-authenticated visit to sign-in used to discard the callback and go to Jobs. Server and client now use the same internal-path validator; external, malformed, and self-looping callbacks fall back to Jobs. The installed Better Auth client already navigates when `callbackURL` is supplied. Remove the competing application navigation and let that plugin own the handoff. Its verification callback now retains the intended destination; unverified accounts still get the verification feedback flow.
4. **Render timestamps consistently across time zones.** A shared component initially renders deterministic UTC on server and client, then switches to the browser's zone. Apply it to security sessions, application updates, timeline entries, and reminders. Date-only deadlines remain calendar dates instead of shifting to the previous day in western time zones.
5. **Retain repaired descriptions when revisiting a job.** A nonempty but incomplete feed preview could replace full text already in the cache. Prefer fetched text when the feed description needs repair, while preserving a newer healthy authoritative description and distinguishing an empty response from an unloaded one.
6. **Fix the mobile Documents header.** Constrain the flex item and allow the description to wrap. Verified header bounds at 320, 390, and 768 px.
7. **Restore the optimized search-count eligibility check.** The shared URL parser emits `hideApplied: false` and `includeUnknownSalary: false`; these no-op defaults incorrectly disabled the narrow SQL path. Only those two false flags are exempted. True flags and all extra constraints still force the general path.
8. **Use the existing partial rank index for broad title/company searches.** Extend the default feed's parameterized SQL lookup to supported broad scoped searches. Keep literal LIVE predicates, identical public visibility and per-viewer PASS exclusions, the full deterministic ranking order, and normal pagination. Selective searches, additional filters, and explicit sorts retain their existing paths. Both the row and count query use one scoped-text SQL builder.

## Search Diagnosis and Limits

Independent uncached `getJobs` calls still took roughly 17 seconds with either count implementation. A second call in the same process returned in 2 ms because of the response cache; that is not evidence of a query improvement.

Per-query tracing identified both a slow ranked lookup (8.5 seconds in one trace) and a slow exact count (13.5 seconds). A read-only paired comparison against production data returned the same 51 IDs in the same order: the proposed raw ranked lookup took **167 ms**, versus **9,624 ms** for Prisma's ranked lookup. This measures the row-query component only, without deployment or a claimed end-to-end improvement.

The count plan uses the title trigram index, then a large number of canonical primary-key lookups to validate current public visibility. It is not simply a missing text index. The page still waits for the exact count, so first-hit broad search remains a material performance risk even after the row fix. Location search needs its own measured query-plan work. Do not trade these checks away or replace the public headline with raw LIVE counts.

Next performance phase: compare a compact, transactionally maintained public-visibility projection against asynchronously loading exact filtered counts. Measure cold and warm requests with realistic concurrent users, preserve freshness/PASS behavior, and quantify index/storage/write-amplification costs before selecting an approach. No new production indexes, image files, or materialized datasets were added in this patch.

## Verification

- Unit suite: 889 tests passed, including URL-parser/count compatibility, redirect validation, timezone-stable SSR, and description-cache regressions.
- TypeScript: `npx tsc --noEmit` passed.
- Jobs browser regression passed in an isolated production-mode build: no-JavaScript sign-in safety, a single authenticated document navigation to the intended callback, timezone hydration, responsive Documents header, payload size, saved-state updates, detail selection, filter validation/cancellation, history, AI response races, and Picks navigation.
- Application workspace browser regression passed independently: invalid reminder create/edit retains draft, successful reminder persists, short pasted description retains draft, delayed successful description save remains pending then persists after reload.
- Broad ranked-search integration passed with 8,055 local fixtures: both pages of title/company/combined searches matched Prisma totals and ordering, including public visibility and per-viewer PASS exclusions. All fixture records were removed afterward.
- Full multi-account UX suite passed against both the development server and the isolated production-mode build. Covers populated/empty/loading Picks, strict requirements, feedback/Undo, saved-search lifecycle, cross-account authorization, source evidence, application preflight, reminders, document-description recovery, tracking views, status updates, and mobile layouts. The pending-refresh test now holds only its own fixture queued so the dev inline worker cannot finish before the duplicate-request assertion.
- Isolated optimized build passed (`next build --webpack`, compile 28 seconds, TypeScript 12.5 seconds). It used a temporary source snapshot, a loopback database, a new ephemeral auth secret, and port 3017; it did not overwrite the user's dev build or deploy anything.
- Scoped ESLint and `git diff --check` passed.

Production-mode local fixture timings: Applications load 991 ms, view switch 28 ms, status update 186 ms. These are small-fixture measurements, not production-load claims. The application logo response was 15,086 bytes with browser caching. The temporary production-mode server and build directory were removed after verification; the existing localhost server remains available.

Commands:

```sh
npm run test:unit
npx tsc --noEmit
TEST_APP_URL=http://127.0.0.1:3001 node tests/e2e/jobs.mjs
DOTENV_CONFIG_PATH=.env.local TEST_APP_URL=http://127.0.0.1:3001 node --import tsx -r dotenv/config tests/e2e/ux-workflows.ts
DATABASE_URL_DO_PRIVATE= DATABASE_PROCESS_ROLE=web DOTENV_CONFIG_PATH=.env.local node --import tsx -r dotenv/config tests/integration/ranked-search.ts
```

The broad-search test uses more than 8,000 local-only rows to exceed the selective-search threshold, compares both pages of title/company/combined searches against Prisma, checks visibility exclusions and two viewer contexts, and removes all fixture records afterward. It refuses production and remote database overrides.

Visual artifacts: `output/playwright/documents-mobile-fixed.png`, `output/playwright/application-workspace-draft-recovery.png`, and the `production-mobile-*` screenshots show the inspected layouts. Production-only observations must be rechecked after the eventual deployment. A local production-mode build was tested; no live deployment was performed during this audit.

## Remaining Coverage

Real outbound submissions, sending email, OAuth account linking, payment flows, destructive account/security actions, OS microphone permissions, and every external job provider were not exercised. The dedicated audit account has no production admin permissions. Existing uncommitted logo/search/application changes were preserved; their local success must not be described as already live.
