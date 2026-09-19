# Assistant and Ingestion Release Follow-up

This follow-up supersedes the local-only release status in the earlier 0.5 audit.
Deployment results must be recorded after the rollout, not inferred from tests.

## Changes

- Selected history entries can fill reversible ARIA single-selects with exact
  labels. The control must explicitly own its listbox and expose an enabled
  blank option for Undo. No fuzzy degree equivalence or sensitive-question
  inference. Submit buttons, disabled/ambiguous/multiselect/irreversible controls
  stay manual. User edits and document changes prevent Undo from clearing them.
- Live Colliers Workday inspection reconfirmed seven contact fields. Its custom
  province listbox has a disabled blank option and no explicit control linkage;
  it intentionally stays manual. No personal data was entered or Next clicked.
- Workday now returns at most five listing pages per batch and no longer retains
  fulfilled/rejected fetch promises across calls. SmartRecruiters returns at
  most 100 listings and checkpoints completed detail batches. Both reserve part
  of the runtime for persistence, with idempotent replay after failures.
- Fetch progress is recorded separately from the durable resume checkpoint.
  Failure metadata retains the starting position. The existing loader already
  reads successful runs only; skipped jobs were not demonstrated in production.
  Incomplete/resumed snapshots still cannot close unseen jobs.
- Production Workable requests coordinate pacing and Retry-After cooldowns through
  shared PostgreSQL ResourceBudget rows, using the isolated `ingestion-host:`
  namespace. One request starts per second across workers; 429 hints defer all
  tenants on that host. Short transactions never span the network request.
  `INGEST_SHARED_HOST_LIMITS=0` is the explicit rollback switch; local development
  can opt in with `1`. No new schema is required.
- `INGEST_VERIFIED_STRUCTURED_SOURCE_IDS` is a comma-separated canary allowlist
  that can bypass the generic-site polling pause only for validated structured
  routes checked within seven days. Both scheduling and runtime admission enforce
  it. Existing queue limits, cooldowns and quality rules still apply. Empty by
  default; no blanket company-site activation.

## Verification

- 985 unit tests passed, including large-board continuation, shared throttling,
  selective structured-source admission and actual PM2 process supervision.
- TypeScript and changed-file ESLint passed.
- Local database: ingestion-to-feed replay after fetch/row failures, checkpoint
  completion, shared cooldown expiry/preservation, assistant ownership/PKCE,
  selected history revisions, application idempotence and resume grants passed.
- Browser fixtures: contact, resume, history, reversible custom dropdowns,
  user-edited Undo, rejection cases and no Next/Submit mutations passed.
- Real MV3 packaged tests passed for supported frames and history/tracking with
  fixture APIs. A new isolated profile needed Chrome's native permission approval;
  rerun used the previously approved disposable test profile.
- Production and Store ZIP checks passed, about 109 KiB each, with narrow
  permissions and distinct identity handling.

## Remaining External Gates

- Authenticated Workday/iCIMS later-step history needs dedicated employer test
  accounts. ApplyOverflow sign-in is not employer sign-in. No account or CAPTCHA
  bypass, employer submission, or autosaving fake application was attempted.
- Chrome Web Store submission needs the owner's verified publisher account,
  contact/legal details and assigned extension ID. The ZIP is still a preview.
- Salary records whose authoritative postings have expired remain unchanged.
- Structured canary sources must be sampled for complete, in-scope extraction
  before adding IDs. Production still contains structured routes pointing at
  individual postings or broad corporate sitemaps, so validation alone is not
  evidence of a productive board. Cadmus's verified direct iCIMS seed remains
  the first narrow diverse-employer candidate.
