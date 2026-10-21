# Jobs navigation release

## Scope

- Auto Apply is a Jobs view alongside Jobs and Picks for you, in the shared header and desktop/mobile navigation.
- Applications is the tracker. Submitted still links to its applied-job view.
- `/applications/auto-apply` remains the transport URL trusted by installed extensions. No extension update is required.
- Matching, review, consent, submission, and queue behavior are unchanged.

## Release

- Main implementation: `ee1d53aea4ca4e5b77e6f6f812cb961c9d969f61`.
- Production revision: `c6e03fa192f3df15c6992985cccb83029f5ef64c`.
- Tag: `production-jobs-navigation-2026-10-21`.
- Based on the previous production revision `07bf22913875b9b3f6fa3a4f41f4614580ed04ff`, with only the navigation commit cherry-picked. Pending onboarding and extension work was excluded.
- Only the web service restarted; ingestion workers remained running.
- Rollback image: `applyoverflow-rollback:before-jobs-navigation-20261021-web`.

## Verification

- 1,101 unit tests passed; TypeScript and scoped ESLint passed.
- Authenticated local UI/API benchmark passed 19 checkpoints with zero browser errors. Screenshots checked at desktop and phone sizes, including 320px; no horizontal overflow.
- Covered Jobs/tracker navigation, active states, persisted queue changes, unsaved-answer guards, consent cancellation, readiness expiry, unknown-submission retry protection, and connection/session recovery.
- UI tests used a synthetic local account and simulated extension transport. No real employer application was submitted.
- Isolated production build and type checking passed. Candidate HTTP guard and PDF runtime smoke tests passed. No pending database migrations.
- Public `/api/health` returned `ready` with the exact production revision above; the web container was healthy.
- Final signed-in production browser inspection could not complete because Chrome control timed out. Local UI verification is not represented as a production browser walkthrough.

## Existing CI issue

[Verify run 39679795224](https://github.com/YingxuanHu/applyoverflow/actions/runs/39679795224) fails in the existing extension workspace fixture with `Unexpected API: onboarding-event`. This predates the navigation change and comes from onboarding work excluded from this isolated release. Full main-branch CI is not green.
