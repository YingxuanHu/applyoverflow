# Search and location picker release

## Release

- Implementation on main: `7086b9b62d7bf69e9bb57d15b34c9559c48d4deb`.
- Isolated production revision: `983698526368fedfd19fc816b30b4b61d2a3f4af`.
- Release tag: `production-location-picker-2026-10-22`.
- Production base: `b044ca33f04d48393cea82b77a430025874ed1bf`.
- Deployed the web app and ingestion/source/maintenance workers. No schema migration was needed.
- Unrelated extension and onboarding changes were excluded. Installed extensions do not need an update for this release.
- Public `/api/health` returned `ready` with the production revision above.

## Behavior

- Keyword search and location selection are separate controls. Location is no longer an alternate keyword-search mode or a duplicate editor inside Filters.
- The Locations picker supports country, province/state, city suggestions, custom places, separate removable selections, and explicit Apply/Cancel. There is a maximum of ten locations.
- Multiple locations are alternatives, while components of one qualified location are combined. Toronto plus Seattle matches either city; Vancouver, WA is not Vancouver, BC.
- Selections remain drafts until Apply. Applying locations preserves the current keyword draft and other filters. Cancel discards changes.
- Search and location submissions use client navigation without reloading the document. Existing loading feedback remains; this is not a guarantee of instant backend queries.
- Canada includes Canadian city jobs and explicitly eligible remote jobs. Explicit global/North America remote labels qualify for both countries. An unqualified `Remote` label is not evidence of Canadian eligibility.
- Accented/common location spellings share search terms. Explicit state/province qualifiers take precedence over ambiguous city-name guesses during ingestion.

## Verification

- 1,107 unit tests passed in the working tree.
- TypeScript, scoped ESLint, and `git diff --check` passed.
- 61 database integration checks passed across canonical, feed-index, and SQL query paths and result totals.
- Authenticated Playwright tests passed on Jobs and Picks using a disposable local user and jobs. Fixtures were cleaned up afterward.
- Browser coverage included multi-location OR matching, country/remote inclusion and exclusion, qualified cities, keyword/location combinations, preserving filters, draft Apply/Cancel, duplicate removal, clearing legacy location filters, selection limits, validation, Back/Forward/reload, and preventing full-document reloads.
- Screenshots were inspected at 1440, 390, and 320 pixels. No page errors were observed in the local browser run.
- Production build checks passed, including 16 guarded HTTP checks and packaged PDF/LaTeX smoke checks.
- Signed-in normal Chrome verified the production controls. Toronto and Seattle returned 242 matches, then adding `engineer` returned 208, with the user's existing experience and job-function filters preserved. These are observations at test time, not stable job-count assertions.
- The original Canada filter and other search settings were restored after testing. No applications were submitted or profile data changed.

Local rerun commands (the empty private URL override prevents `.env.local` from selecting a remote database):

```bash
node --import tsx --test --test-reporter=dot tests/*.test.ts
npm run typecheck
env DATABASE_URL_DO_PRIVATE= DOTENV_CONFIG_PATH=.env.local node --import tsx -r dotenv/config tests/integration/location-filters.ts
env DATABASE_URL_DO_PRIVATE= DOTENV_CONFIG_PATH=.env.local node --import tsx -r dotenv/config tests/e2e/location-filters.mjs
```

The browser suite expects the local development server. Screenshots and operational logs are under ignored `output/` and are not part of the release.

## Production data repair

The new inference behavior prevents future ambiguous-city errors, but existing records required separate review.

- Dry-run inspected 810,080 LIVE/AGING records with assigned countries and found 396 explicit-qualifier mismatches.
- Seven records with ambiguous or multi-location strings were excluded from the repair.
- 389 reviewed records were attempted with compare-and-set checks on ID, location, previous region, and live status. Canonical and search-index region updates were transactional.
- The first attempt hit the database's five-second interactive transaction timeout. The retry used a longer transaction deadline and checked already-correct rows before writing.
- 388 records were verified with matching corrected country values in both tables. The remaining record expired concurrently and was not modified.
- The Vancouver, Washington ZoomInfo listing `cmvgnzc8s1dyye0norz05cdvd` was verified as US, and the actual Canada search predicate returned zero matches for that record.
- In-memory feed query results can retain pre-repair rows for up to their existing five-minute TTL. Do not mistake a previously loaded result for a fresh predicate evaluation.
- Saved jobs and application history were not removed or modified.

Audit logs: `output/location-region-dry-run.log` and `output/location-region-repair.log`. The generic `--repair-explicit` output is a candidate list, not approval for blind updates; review comma-separated multi-location strings before applying a repair.

## Remaining limitations

- GitHub Actions run [39895579956](https://github.com/YingxuanHu/applyoverflow/actions/runs/39895579956) failed in the existing extension workspace fixture with `Unexpected API: onboarding-event`. Earlier main runs had the same failure. This is not a green full-CI claim; the failing extension/onboarding changes were not included in this isolated release.
- Large cold production searches can still be slow under concurrent ingestion/index maintenance. This release removes document reloads and fixes search/filter semantics; it does not establish a new query-latency SLA.
- Geographic matching still depends on source metadata. Unknown remote eligibility and ambiguous multi-country locations are not silently treated as every country.

## Rollback

The previous production revision is recorded above. Pre-release images were retained as `applyoverflow-rollback:before-location-picker-20261022-web` and `applyoverflow-rollback:before-location-picker-20261022-worker`. The reviewed geography corrections are independent of the UI deployment and should not be blindly reversed.
