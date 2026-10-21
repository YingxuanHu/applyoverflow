# Unified location search release

## Scope

- Removed the duplicate Location editor from Filters on Jobs and Picks for you.
- Search type > Location is the single editor. Submitting a place adds an OR alternative; existing chips remove individual places.
- Title, company, location, and AI drafts are independent. Unsubmitted text in one mode cannot become a constraint in another.
- Other filter submissions preserve committed locations. Legacy location URLs, reloads, back/forward navigation, and clearing the last location remain supported.
- Invalid additions show an error instead of silently dropping entries beyond the ten-place or total-length limit.
- On narrow screens, the search mode and text input stack to preserve usable typing space.
- Country/remote eligibility query semantics are unchanged and were regression-tested.

## Release

- Main implementation: `631464faf0af611d73bc7248de0be6a2a92e7687`.
- Production revision: `b044ca33f04d48393cea82b77a430025874ed1bf`.
- Tag: `production-location-search-2026-10-21`.
- Isolated release based on the previous production revision `c6e03fa192f3df15c6992985cccb83029f5ef64c`, with only the location-search commit cherry-picked. Pending onboarding and extension changes were excluded.
- Only the web container restarted. Ingestion workers remained running; no extension update is needed.
- Rollback image: `applyoverflow-rollback:before-location-search-20261021-web`.

## Verification

- All 1,102 unit tests, TypeScript, scoped ESLint, and diff whitespace checks passed. The 23 affected tests were rerun after the final responsive-layout adjustment and passed.
- All 41 database integration checks passed across canonical jobs, search index, raw SQL, and feed totals. Covered Canada including Canadian cities and eligible remote jobs, cross-border/explicit North America remote eligibility, exclusion of US-only/unknown remote geography, qualified cities, OR alternatives, and unsafe query text.
- Authenticated local browser tests passed on Jobs and Picks: independent drafts, multiple additions, deduplication, filter preservation, chip removal, reload/history, invalid additions, and legacy clearing. No browser page errors.
- Screenshots inspected at 1440px and 320px; overflow assertions also passed at 390px. Tests used synthetic local account/database data, not the user's production account.
- Isolated production build/type checking, 16 candidate HTTP guard tests, PDF parsing/generation smoke tests, and container health checks passed. No pending database migrations.
- Public `/api/health` returned `ready` with the exact production revision above. Unauthenticated Jobs and Picks requests retained their expected login redirects. A signed-in production browser walkthrough was not performed.

## Operational Notes

- The first build was killed by host memory exhaustion before replacing the live web container. The existing 2 GB swap was full.
- A mode-0600 4 GB swap file at `/mnt/HC_Volume_105915443/release-build.swap` was created and activated on the attached volume. The retry succeeded without stopping the live app or ingestion workers. This swap remains active for the current boot; `/etc/fstab` was not changed. It uses attached-volume space, not root-disk space.
- [Verify run 39681911923](https://github.com/YingxuanHu/applyoverflow/actions/runs/39681911923) still fails in the pre-existing extension workspace fixture with `Unexpected API: onboarding-event`. That onboarding work is excluded from this isolated production release. Full main-branch CI is not green.
