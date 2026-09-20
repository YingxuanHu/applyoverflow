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
- iCIMS: Cadmus permits reaching the Basic Information account form with the
  dedicated audit email. Full authenticated history testing remains unverified.
- Chrome Store: publisher dashboard requires sign-in. The owner must complete
  publisher registration/agreement/payment and approve the final Store identity.
- Previously withheld salary repairs remain withheld where source evidence expired.
