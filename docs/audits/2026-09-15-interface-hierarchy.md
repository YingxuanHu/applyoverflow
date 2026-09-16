# Interface hierarchy

## Approach

Keep frequent decisions visible. Put secondary actions in a consistently placed, labelled menu. Expand diagnostics on demand, without hiding errors or active filters. Use restrained headings, stable control sizes, and the existing blue selection accent across the app.

## Implemented

- Jobs and Picks use compact workspace tabs and unframed search bands instead of large nested summary panels. Matching totals are secondary, non-blocking metadata; unresolved counts no longer display a prominent spinner. Failed counts retain a retry control.
- Board totals, freshness, active connectors, and daily activity remain available under Board activity. Public pool totals still come from the existing filtered summary cache.
- Shared pagination puts labelled icon-only Previous/Next controls on the left, followed immediately by a Page input and submit arrow. Query preservation, prefetching, keyboard submission, validation, and disabled boundary states remain intact.
- The short loading indicator is portaled to the viewport, delayed 250 ms to avoid flashes, and positioned below the mobile header. Route skeletons follow the list/detail layout. Reduced-motion preferences are respected.
- Application rows keep the clickable title and status selector visible. Reminders, job details, original posting, editing, tags, and confirmed deletion share one persistent actions menu, available by touch and keyboard rather than hover.
- Shared dropdowns size to content and are constrained by viewport width. Mobile global minimum-width resets previously caused icon-triggered menus to collapse to the trigger width.

## Whole-app direction

The shared pagination, dropdown, and spinner changes apply beyond the job board. Further changes should follow the same hierarchy rather than removing capabilities:

1. Documents: keep the active resume and primary preview/download visible; put rename, duplicate, and version operations in an adjacent menu. Keep document identity and active-version status explicit.
2. Application detail: keep status and the next dated action prominent; use expandable history and preparation sections for supporting information.
3. Settings and operational screens: group advanced controls and diagnostics in labelled disclosure sections. Do not collapse validation failures or required setup steps.
4. Notifications: lead with the item needing a decision and its direct action, with timestamps and source metadata secondary.

These further screen-specific changes are proposals, not claimed implementation. This patch changes the common controls and the Jobs, Picks, and Applications surfaces without changing ranking, permissions, or production data.

## Validation

Unit rendering tests cover accessible pagination order, query preservation, unique form IDs, page bounds/errors, compact count states, workspace navigation, and menu width constraints. Browser checks cover delayed counts, retry, late-response isolation, page correction, desktop/mobile layout, reminder presets, tag/edit dialogs, and menu reachability. Screenshots are under `output/playwright/clean-*`.

Final results: 929 unit tests passed; TypeScript and scoped ESLint passed. The PostgreSQL-backed deferred-count browser regression passed, including Enter and arrow-button page jumps with filters preserved. Loading centering was measured at 390/1440 px; application menu text and bounds were checked at 320/390/1440 px. Temporary database fixtures were removed by the test's cleanup.

The local workspace had competing Next development processes sharing build output. Verification moved to an isolated preview checkout; no production services were changed.
