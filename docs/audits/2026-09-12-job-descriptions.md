# Job Description Accuracy and Readability

## Findings and Changes

- **Missing provider content:** Lever ingestion discarded `lists`, which contain named responsibilities, qualifications, and benefits. It also repeated opening text already included in `description`. The connector now retains those lists, closing text, and compensation text without repeating the opening. The provider contract is documented in the [official Lever Postings API](https://github.com/lever/postings-api).
- **Lost source structure:** Ashby preferred flattened plain text even when HTML was available, and HTML-only descriptions were reduced to team metadata. It now prefers the complete HTML field. A shared `htmlparser2` converter preserves headings, standalone bold headings, paragraph boundaries, bullet content, ordered step numbers, and table cell text while producing inert text, not executable HTML.
- **Destructive formatting:** Cleanup could remove pay/intro text before the first recognized heading, cut at an ordinary mention of similar jobs or a privacy notice, drop quoted text and countries, remove repeated paragraphs, corrupt `.NET` and decimals, and erase inline "About the job" content. These paths are corrected. Paragraphs following lists stay paragraphs. Required and preferred sections remain separate.
- **Unsafe repair selection:** The worker previously tried only the apply URL and marked an unsuccessful fetch as successful. It now checks fresh identity-matched raw source snapshots, restores omitted provider fields, then tries up to three mapped source URLs. Structured data must match the vacancy identity, including its URL when supplied. Ambiguous vacancies and generic site descriptions are rejected; DOM fallback requires a matching title and a description container. Oversized HTTP bodies are rejected rather than partially saved. Existing SSRF and response-time limits remain in place.
- **Reader experience:** A shared component powers the Jobs/Picks detail panel and full job/apply pages. It provides source-derived excerpts under "At a glance", section links with keyboard focus and reduced-motion support, readable paragraphs/lists, and the complete description below. Excerpts use whole source blocks rather than generated claims. Missing or weak descriptions are labeled as unavailable/potentially incomplete instead of pretending to be complete.

## Validation

| Check | Expected | Observed |
| --- | --- | --- |
| Provider content | Every named Lever list and closing/pay field retained | Passing connector regression |
| Complete detail | No truncation of distinct requirements or final paragraphs | Passing tests, including all 350 items in a long posting |
| Source identity | Never choose another role, employer, or explicit vacancy URL | Passing mocked-source and guarded-fetch tests |
| Formatting cost | Warm presentation p95 below 50 ms locally for a large posting | 5.5 ms p95 across 100 samples, 38,070-byte input; not a production latency guarantee |
| Desktop panels | Equal heights; no horizontal overflow | 832 px each in the end-to-end test |
| Mobile detail | No document overflow at 390 px; final content retained | Passing browser checks |
| Section navigation | Correct target and keyboard focus | Passing split-view/full-page browser checks |
| Failed detail request | Retry action, no false empty-description message | Injected HTTP 503, then successful retry and restored content |
| General regressions | Unit tests, types, build, targeted lint | 783 unit tests passed; production build/type checking passed; targeted lint clean |

The existing end-to-end jobs suite also passed sign-in, minimal feed payload, save/remove cache consistency, default selection, lazy description loading, desktop geometry, mobile back-navigation, resume landmarks, and Picks navigation. The local account's Picks page correctly displayed its incomplete-profile gate; a populated personalized ranking was not browser-tested. Populated Picks use the same tested master-detail/description components. Full-project lint has two pre-existing unused-argument warnings in `ai-access.ts` and `auth-password-reset.ts`, with no errors.

Browser artifacts are under `output/playwright/description-*`; unit/build logs are `description-unit-tests.log` and `description-build.log`. Testing used local fictional jobs, not real user applications. No applications were submitted and no production records or services were changed.

## Rollout and Limits

1. Deploy the web and maintenance-worker build together, including the existing `DESCRIPTION_REPAIR` queue migration in the pending changes.
2. Normal source polls will ingest the corrected Lever/Ashby descriptions. Opening a missing/weak description (including the first selected job) queues bounded repair. Legacy Lever descriptions are also queued even when their introduction passes the ordinary quality-length check.
3. The existing PM2 description-repair schedule drains five tasks per pass. Review repaired/unavailable/skipped counts and queue age before increasing throughput or scheduling a larger backfill. This change does not run a production backfill or promise instant repair of every old record.
4. Repair uses compare-and-swap on the canonical update timestamp and transactionally updates the description, fingerprint, quality fields, and description-dependent feed search fields. It records source URL, snapshot/fetch method, and observation time on the task. It does not change job lifecycle/visibility, saved jobs, submissions, or packages. Failed fetches retain the previous text and retry up to the existing task attempt limit.

Protected sources, pages without sufficient identity evidence, malformed source content, and details absent from the provider cannot be reconstructed reliably. We preserve available source text and link to the original posting instead of inventing missing qualifications. Nested lists and complex tables are reduced to readable text rather than pixel-perfect source layouts. HTML links/emphasis are not rendered as arbitrary source markup.

Production `/jobs` could not be reached from this environment (eight-second connection timeout). Live provider smoke attempts did not yield a usable sample, so provider correctness was verified against the documented contract and deterministic source fixtures, not claimed as a live crawl. `npm audit` reports existing Prisma/deepmerge-ts and PM2 advisories; the newly added HTML parser is not implicated. Those unrelated dependency upgrades were not included in this description patch.
