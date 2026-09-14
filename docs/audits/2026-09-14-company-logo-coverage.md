# Company Logo Coverage Audit

## Scope and Release State

Signed into applyoverflow.com using a dedicated, standard-permission audit account created with the existing password hashing and credential-account mechanism. No admin role, authentication bypass, or public default password was added. Credentials are kept in a mode-0600 local file, outside the repository. Notifications are disabled for the account.

The deployed Jobs UI contains no employer image elements, and `/api/company-logo?domain=stripe.com` returns 404. The logo implementation is local and has not been deployed. This is a deployment gap, separate from the coverage problems below.

The audit used the first two authenticated Jobs API pages: 100 jobs representing 42 employers, with company-record metadata read from production. No production jobs, company records, source mappings, or files were changed. Local browser fixtures copy public job content; their timestamps and source-quality fields are adjusted only to put them first in the test feed. These are not evidence of production search/ranking quality.

## Findings and Changes

- The initial domain-only loader downloaded images for 81/100 sampled jobs, but some represented unrelated organizations. Download success is not identity accuracy.
- Corrected audited name/source pairs for wrong or missing domains. Both the employer name and the exact source hostname/path must match. No generated name-to-domain guesses, fuzzy employer matching, or ATS-slug inference.
- Blocked shared recruiting/aggregator hosts from acting as employer brands. First-party careers domains conflicting with the company record suppress the logo rather than silently endorsing the wrong identity.
- Strip ordinary careers subdomains when the parent domain is the employer site; preserve the independently checked Intact careers mark through an explicit identity entry.
- Added a second fixed favicon provider when the primary fails. Raster signatures, 32 KiB streaming bounds, timeout, redirect rejection, request coalescing, negative caching and generic-image rejection still apply.
- Reduced the shared list and application logo slot from 36px to 28px, with a 36px detail mark. Fixed geometry, lazy loading, object containment, and a white image background preserve alignment and contrast in light/dark themes. Browser-cached images are checked during hydration.
- Removed the image's hydration-dependent opacity gate. A decoded logo must be visible in the server-rendered page even while JavaScript is loading; cached failures still fall back to initials. Added server-rendering regression tests for this behavior.

## Measured Coverage

| Measurement | Result |
| --- | --- |
| Sample | 100 jobs / 42 employer records |
| Initial downloadable images | 81/100; includes wrong identities |
| Revised downloadable images | 98/100 |
| Distinct revised images | 40, all decoded in the browser contact sheet |
| Total distinct image payload | 128,502 bytes (125.5 KiB) |
| Unresolved identity cases | 2 |

The contact sheet was inspected visually, including employer-specific marks for DiDi, OpenAI, Plaid, Radiant, Peregrine, NFP, Schneider Electric, Loblaw, Motive, Intact, Florida Panthers, Aon, Reliant, Goodwin and Rocket Lab. This is a dated sample, not a guarantee for every company in the pool or future third-party availability.

Unresolved cases:

- **Amphenol:** the linked careers record points to `careers.agcocorp.com`. An Amphenol logo would misrepresent that posting. Correcting the underlying employer/source association needs a separate ingestion repair.
- **Aviri Sukses Bersaudara:** its recorded domain is the Glints aggregator, not a verified employer website. Do not substitute Glints branding.

The sample also contains out-of-product-scope roles/locations. These are separate ingestion/filter-quality findings, not reasons to invent branding or change production records during a logo audit.

## Storage and Performance Budget

- No persistent image files, database blobs, or Next image-optimizer cache on the VPS. No image per job: keys are employer domains.
- 32 KiB maximum per upstream response; 128 memory entries retain at most 4 MiB of image bytes per Node process, plus bounded transient download buffers and metadata.
- At most 64 concurrent cache misses; duplicate domains share requests. One primary fetch and at most one fallback, each with a four-second timeout.
- Browser and successful in-memory cache: 24 hours. Negative memory cache: one hour. Failed browser response: five minutes.
- Only fixed DuckDuckGo and Google favicon endpoints are fetched. No visitor cookies, authorization, referrer, or IP headers are forwarded; the upstream sees the server request and employer domain, not which user/job requested it.
- Native image rendering and `cache: "no-store"` upstream fetches avoid an accumulating server image cache. Optional browser caching consumes the user's browser cache, not Hetzner storage.

## Identity Evidence

Each correction in `src/lib/company-logo-identities.ts` requires an exact normalized employer name and a compatible source URL. Sources checked September 14, 2026:

| Employer / Record Name | Identity Evidence |
| --- | --- |
| DiDi | [Official careers](https://careers.didiglobal.com/teams); Greenhouse `didi` |
| Rocket Lab | [Official careers](https://rocketlabcorp.com/careers/); Greenhouse `rocketlab` |
| Radiant Industries | [Official careers](https://radiantnuclear.com/careers); Ashby `radiant-industries` / Greenhouse `radiantindustries` |
| Motive / Gomotive | [Official careers](https://gomotive.com/company/careers/jobs/); Greenhouse `gomotive` |
| Peregrine Technologies | [Official careers](https://peregrine.io/careers); Greenhouse `peregrinetechnologies` |
| NFP Corp | [NFP](https://www.nfp.com/); NFP-branded roles on Aon's careers domain |
| Loblaw | [Official careers](https://www.loblaw.ca/en/careers); Workday `loblaw_careers` |
| Incident / Incident IQ | [Official careers](https://www.incidentiq.com/careers); Greenhouse `incidentiq`, not incident.com |
| Huuuge | [Employer site](https://huuugegames.com/); Recruitee `huuugegames` |
| Pinnacle Live | [Official careers](https://www.pinnaclelive.com/careers); Jobvite `pinnaclelive` |
| Customer.io | [Official careers](https://customer.io/careers); Greenhouse `customerio` |
| Mission Lane | [Official careers](https://www.missionlane.com/careers); Greenhouse `missionlane` |
| Momo Medical | [Official careers](https://www.momomedical.com/careers); Recruitee `momomedical` |
| Maxor / VytlOne | [Maxor redirects to VytlOne](https://www.maxor.com/); VytlOne careers links `careers-maxor.icims.com` |
| Goodwin | [Aviation company](https://www.teamgoodwin.com/), not the similarly named law firm; [matching Greenhouse posting](https://job-boards.greenhouse.io/goodwin/jobs/5235068007) |
| Reliant | [Reliant Health Partners](https://www.relianthp.com/); [matching Greenhouse posting](https://job-boards.greenhouse.io/reliant/jobs/5413116008), not the energy company |
| Pave / Trove Information Technologies | [Corporate identity](https://www.pave.com/company/legal/privacy-policy); Greenhouse `paveakatroveinformationtechnologies` |
| Intact Financial | [Branded employer careers site](https://careers.intactfc.com/) |
| 1-800-Got-Junk? | [Employer site](https://www.1800gotjunk.com/us_en); Greenhouse `1800gotjunk` |
| Florida Panthers | `floridapanthers.com` redirects to the [official team site](https://www.nhl.com/panthers/); inspected team crest, not a generic NHL favicon; Greenhouse `thefloridapanthers` |

## Browser Artifacts

- `output/playwright/production-logos-before.png`: authenticated production UI without logos.
- `output/playwright/company-logo-contact-sheet.png`: every distinct sampled employer and the returned mark.
- `output/playwright/company-logos-jobs-desktop.png`: actual local Jobs UI with production-content fixtures.
- `output/playwright/company-logos-jobs-mobile.png`: compact 28px logo slots at 390px viewport width.

At 1440px, all 50 first-page logos decoded and displayed. Of the 45 production-content fixtures reaching the second local page, 44 displayed logos and one was the deliberately suppressed Amphenol mismatch. Five other source-sample fixtures were excluded by the current local feed; local dummy jobs filled those slots, so they are not counted as missing production logos. The separate 100-row domain audit and 40-employer contact sheet include all sampled employers, regardless of local feed eligibility. Both desktop and 390px mobile had no horizontal overflow or page errors; selecting a job updated the detail pane and Next changed pages.

Verification: 880 unit tests, TypeScript, targeted ESLint and whitespace checks pass. The application workflow suite passed before the final opacity-gate removal, including loaded/cached/failing logos, status persistence, reminders and mobile geometry. The final component passes dedicated server-rendering tests and the manual desktop/mobile visual checks. Three full browser-suite repeats did not complete: one timed out navigating to Applications and two failed to finish fresh fixture sign-in. One sign-in failure rendered a blank development page; after the dev-server process changed and recovered, another remained on Sign in without displaying a form error. The local development server also intermittently emitted an invalid-token error during recompilation; a clean reload of the Jobs page had no errors. These repeats are not recorded as passes or attributed to a confirmed authentication-code defect. Re-run and investigate the full suite against a production-mode local build before release. Development timings are not production latency benchmarks.

The audit checks decoded pixels, image geometry, failed-image behavior, and cached-image hydration. No build, deployment, commit, or production source-data repair is implied by these artifacts. Temporary local job/company fixtures are removed after inspection.
