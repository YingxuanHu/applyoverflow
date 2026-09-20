# Assistant completion and ingestion stability

## Verified

- Production package 0.5.0 on real headed Chrome, with an ordinary temporary
  audit account: fresh sign-in, onboarding, extension identity consent, selected
  history export, stale profile revision rejection, actual MV3 history fill and
  Undo, separate resume consent and PDF attachment, then revocation.
- The attachment target was an intercepted synthetic Greenhouse form. No real
  employer application was submitted. This is not authenticated Workday/iCIMS
  history certification.
- 992 unit tests, TypeScript, scoped lint, database-backed shared host pacing,
  queue cooldown/lease handling and ingestion-to-feed integration passed.

## Changes

- Shared provider cooldowns defer pending Workable tasks to the persisted
  deadline. All poll claim lanes respect the clock, including retention and
  oldest-first claims. Preflight checks avoid creating failed ingestion runs;
  a racing 429 releases the task lease without a source-health/attempt penalty.
- Validation preflight and shared rate-limit errors likewise avoid invalidating
  healthy sources. The original Retry-After is not shortened or bypassed.
- Busy workers stop admitting polls at an 800 MiB RSS soft threshold, drain
  active batches, and exit at cycle boundaries for supervision to restart them.
  Their existing 1024 MiB hard guards remain. V8 old-space is bounded at 512 MiB.
- Completed connector fetches promptly release deadline timers and listeners.
- Supervisor restarts no longer force all scheduled connectors immediately.
- Historical Job Bank CSVs are excluded from recurring schedules unless explicitly
  enabled. Live Job Bank polling remains enabled; no existing jobs were deleted.

## Release constraints

The website and extension are already deployed at 53f8551. The new patch changes
only worker runtime files. The worker-runtime Dockerfile layers the patch over
that verified Linux/amd64 runner without copying dependencies or rebuilding Next.
Use it only when package manifests, Prisma schema/migrations, Dockerfile, build
configuration and assets are unchanged. Use the normal full build otherwise.
The prebuilt release helper now supports worker-only rollouts, preserving image
revision/platform checks, transport tests, migrations and dependency isolation.

Post-release verification must report web and worker revisions separately and
check process exits, not only container restart counts. Memory pressure controls
are containment, not proof that all long-term allocation growth has been solved.

## External acceptance gates

- Workday: attempted dedicated account registration/sign-in through the Colliers
  UI; neither completed. No successful employer session or history test claimed.
- iCIMS: registration reached a CAPTCHA. A later retry reported the email in use,
  but normal sign-in rejected the test credentials. No authenticated history
  certification or successful registration is claimed; no employer application
  was submitted. Do not retry without a verified dedicated account.
- Chrome Store: owner activated the publisher account and uploaded the candidate.
  Draft ID `mhkkioknljkgnhgnhcamilkgbadjnmil` is verified against its public key and
  narrowly enabled in production alongside the preview ID. Store publication
  still requires owner privacy certifications, a verified publisher contact
  email and reviewer access. Icon and real settings screenshot are uploaded.
  Store-ID consent, history selection, stale-revision rejection, resume consent,
  one-time PDF exchange and revoke passed against production; its optional-host
  prompt timed out awaiting owner approval. Do not claim Store-ID embedded-form
  acceptance from the successful preview-ID test.
- Previously withheld salary repairs remain withheld where source evidence expired.

## Deployment Observation

- Worker runtime 1887b2b deployed through the verified prebuilt release helper.
  Its actual Linux candidate passed 23 transport/rate-limit/memory tests; the
  rollout repeated 16 guarded-transport tests. All 63 migrations were applied
  already; no new migration ran. PostgreSQL and Caddy were not restarted.
- Web remains at 53f8551 and healthy. It was subsequently recreated from the same
  image only to load the exact Store extension allowlist.
- At 00:34:53 UTC, `JobFeedSummaryCache.liveJobCount` was 499,542. Workable's 65
  pending polls were all deferred until its unchanged 20:44:00 UTC cooldown;
  none were running. This is the filtered public board metric, not lifecycle LIVE.
- The daemon completed its first cycle and repaired 2,378 feed-index entries,
  then began catch-up. No daemon restart in the initial observation; this short
  window does not establish long-term memory stability.
- Root: 127/150 GiB used, 18 GiB available (88%). Attached volume: 49/148 GiB,
  92 GiB available (35%). Release context lives on the attached volume and the
  worker-only patch reuses the existing runtime layers.
