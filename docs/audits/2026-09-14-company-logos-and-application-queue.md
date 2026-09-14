# Company Logos and Application Work Queue

## Decisions

- Add small, fixed-size company marks to the shared Jobs/Picks list and detail pane, and to feed-linked applications. Use the existing Company.domain relationship plus audited name/source identity corrections; never guess a domain from a company name or use an ATS posting host as the employer's brand.
- Use initials for missing, invalid, blocked, oversized, or unavailable icons. Manually entered applications without a known company domain also use initials. Changing a tracked company's name does not retain another company's logo.
- Put the application list and next actions first. Keep the existing flow chart and reminder manager available on demand, rather than introducing another competing pipeline board.

## Storage and Privacy

The same-origin `/api/company-logo` endpoint retrieves a favicon from fixed DuckDuckGo and fallback Google favicon endpoints. It does not contact arbitrary employer URLs or forward visitor credentials, referrers, or IP headers to those providers. This is a best-effort external dependency, not guaranteed brand coverage. See [the production-sample coverage audit](2026-09-14-company-logo-coverage.md) for audited employer corrections, visual coverage, and release status.

| Resource | Bound |
| --- | --- |
| Persistent logo files / database blobs | None |
| Per-image response | 32 KiB, enforced while streaming |
| Memory cache | 128 entries, at most 4 MiB of retained image bytes per process |
| Concurrent cache misses | 64; repeated domains share one request |
| Upstream timeout | 4 seconds per provider; at most two attempts |
| Browser / positive memory cache | 24 hours |
| Negative memory cache | 1 hour |

Native lazy-loaded images bypass the Next image optimizer, and upstream fetches use `no-store`. Only PNG, JPEG, or ICO signatures are served; SVG/HTML and redirects are rejected. Missing images keep the same geometry. Browser-cached images are checked at hydration as well as on load.

## Application Changes

- Views for all current results, in-progress applications, the next seven days, follow-up candidates, wishlist, and closed applications. Counts narrow the current search/filter/flow selection, not the entire account unconditionally.
- Follow-up candidates: applied/screen/interview applications without an update in seven days and without a future reminder, plus passed wishlist deadlines. These are suggestions, never automatic outreach. Offers and closed applications are excluded from quiet-period nudges.
- Inline status selection reuses the existing authorized transaction and timeline event. A scheduled reminder can be added without leaving the list, with tomorrow/next-week shortcuts and a local-time input.
- The next reminder and urgent deadline are visible on the row. Date-only deadlines retain their calendar date; overdue classification uses the user's time zone.
- Invalid reminder dates retain the draft and show an inline error. Add-application now opens in a dialog and closes only after a successful save.
- Preserve the existing reminders, editing, tags, deletion confirmation, search, sort, and flow chart. Empty filtered states offer a way back to all applications.
- Remove unused notes from the dashboard payload, scope navigation memory to the signed-in user, fix clipped search labels, and give row editors unique field IDs.

## Verification

Focused tests cover domain rejection, raster-only responses, streaming limits, request coalescing, cache expiration/eviction, concurrent bounds, failures, seven-day boundaries, closed statuses, reminder suppression, and date-only deadlines across time zones.

Browser checks use isolated, automatically cleaned local fixtures. They cover inline status and its persisted timeline event; reminder validation, draft retention, scheduling and reload; application creation; view counts and empty states; logo delivery, cached hydration and forced-failure fallback; and desktop/mobile geometry. The existing production-mode UX suite also passes its Picks, saved-search, feedback, authorization, description, and refresh-queue checks.

Observed local production-mode fixture results (not a production SLA): page settled in 1,016 ms, view switch 38 ms, status update 187 ms. The sampled icon was 15,086 bytes. Targets: view switches under 200 ms, warm status updates under 2 seconds, and no persistent image storage. The development server's compilation overhead is excluded from these targets.

No deployment, migration, commit, or production job/source-data mutation is part of this change. A separately authorized standard production test account supports the visual audit. Existing uncommitted search/filter changes remain intact.
