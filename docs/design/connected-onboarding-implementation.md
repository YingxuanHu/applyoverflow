# Connected Onboarding Implementation

Implemented locally on October 15, 2026, from `connected-onboarding-plan.md`.
Candidate extension: **0.16.0**. Last verified public Store package: **0.15.1**.
This implementation does not publish the candidate or deploy the website.

## Behavior

- First installation opens `/extension/setup` once. Updates and worker startup do not reopen it.
- Setup, sign-in and profile preparation take place in an ordinary website tab. Only final PKCE consent uses Chrome's short identity flow.
- Setup checks the actual browser connection against the current website account using a short-lived, single-use server challenge. A ping or historical connection record is not proof.
- Contact details can be confirmed immediately. Other sections are independently reviewed. Unreviewed import data remains in the existing onboarding draft; optional job interests no longer delay confirmed facts.
- Drafts autosave after a short pause. Saves serialize against acknowledged revisions. Closing with unacknowledged edits warns the user.
- Concurrent profile changes offer a saved-versus-draft comparison by section. A stale tab cannot overwrite a newer draft. Session expiry preserves the editor and opens reauthentication in a separate tab; account changes reject stale saves.
- Existing saved profiles stay usable without another import or mandatory wizard. Missing history, resumes, optional personal answers and goals do not block contact autofill or browsing jobs.
- Resume presence, attachment eligibility and sharing permission have distinct labels. No new sharing permission is inferred from an upload or connection.
- An explicitly captured employer tab is only focused after account verification. Setup does not reload, navigate, fill, upload or submit there. The user invokes Autofill separately.
- Desktop Chrome, detection unavailable, no responding extension, outdated protocol, disconnected, different-account and verified states have separate actions. Older nonresponding clients retain toolbar/update guidance, without claiming installation absence.
- Store installation is the default. Unpacked installation is confined to developer/testing guidance. The popup labels its actual channel and offers optional site access dismissibly after useful autofill.

## Implementation Map

| Area | Main files |
| --- | --- |
| Scoped confirmation, versioned draft | `src/lib/profile-setup.ts`, `src/app/onboarding/actions.ts` |
| Autosave and conflict review | `src/components/profile/profile-setup.tsx`, `setup-conflict-review.tsx` |
| Browser coordinator | `src/app/extension/setup/page.tsx`, `src/components/applications/extension-setup.tsx` |
| Account proof | `src/app/api/extension/setup/route.ts`, `src/lib/queries/extension-setup.ts` |
| Isolated extension handoff | `extensions/chrome/setup-bridge.mjs`, `background.mjs` |
| Auth recovery | Auth components, password-reset handlers, narrow onboarding POST handling in `src/proxy.ts` |
| Independent capability display | `src/lib/extension-setup.ts`, popup, extension settings |
| Optional measurement | `src/lib/onboarding-events.ts`, `src/lib/queries/onboarding-events.ts`, event routes |

The setup bridge accepts only four operations from the exact first-party setup path in a top-frame document. Nonces are document-bound. Return contexts are browser-local, expiring, one-use, and bound to the invoking tab and account. Existing workspace messages and employer submission guards remain separate.

## Data and Measurement

Apply migration `20261015190000_connected_onboarding_metrics` through the normal migration pipeline before enabling measurement. The existing `Verification` model stores expiring setup challenges; no second profile/onboarding database is introduced.

`ONBOARDING_METRICS_ENABLED=1` opts into measurement. It is disabled by default. Review privacy disclosures before enabling it. Allowed fields are event name, random journey/run identifiers, entry point, and bounded filled/remaining counts. No email, resume text, filename, answers, question labels, credentials or employer URLs are accepted.

Autofill attempts are counted before form inspection, including failed/unsupported scans. Distinct run IDs preserve repeat attempts while deduplicating event delivery. Success requires a previously empty field reported as retained/verified by the existing executor; connecting is not a successful autofill. Resume assignment is not counted as proof of uploaded attachment acceptance. First success is deduplicated per account within the retained dataset.

Raw records older than 30 days are removed on subsequent event writes. This is write-time cleanup, not a strict scheduled deletion deadline. Authentication completion means a recognized authenticated session in that journey, not necessarily a new sign-in. Existing job engagement signals remain separate from extension activation. This release supplies bounded events, not a conversion dashboard or measured conversion claims.

## Verification

All integration/browser tests use disposable local accounts and synthetic profiles. No employer application was submitted or personal Chrome profile modified.

| Layer | Result / evidence |
| --- | --- |
| Full unit suite | 1,079 tests passed, including existing autofill and authentication regressions |
| Real database | Challenge single-use concurrency, session/account binding, mismatch, expiry, revocation, saved-profile capability, optional metrics deduplication |
| Resume import integration | Draft isolation, stale revision protection, concurrent cleanup, no implicit canonical confirmation |
| Website onboarding E2E | Contact-only confirmation with invalid unreviewed history, later history review, deferred goals, persistence and profile edits |
| Recovery E2E | Preserved auth callbacks, unsupported mobile browser, acknowledged autosave, stale tabs, section reconciliation, expired sessions, account-switch rejection |
| Real packaged MV3 extension | Chrome identity cancellation/retry, PKCE exchange, same-account proof, return to unchanged original document, explicit verified contact fill, preserved manual edits, no submission, revocation |
| UI | Screenshots at 320/390/768/1440 CSS pixels, no horizontal overflow; actual Chrome 200% zoom; keyboard-triggered connection |

The real-extension run used a routed synthetic application with one test-only pregranted host in an isolated browser profile. The shipping package still requires optional employer-site permissions. This proves the connection/handoff/executor integration, **not live-employer coverage or the production Store update path**.

Useful local commands (with a disposable local database and the local web server running):

```sh
npm run test:unit
node --test scripts/test-extension-setup-bridge.mjs
env DATABASE_URL_DO_PRIVATE= DOTENV_CONFIG_PATH=.env.local node --conditions=react-server -r dotenv/config --import tsx tests/integration/connected-onboarding.ts
env DATABASE_URL_DO_PRIVATE= DOTENV_CONFIG_PATH=.env.local node --conditions=react-server -r dotenv/config --import tsx tests/integration/profile-setup-import.ts
env DATABASE_URL_DO_PRIVATE= DOTENV_CONFIG_PATH=.env.local node -r dotenv/config --import tsx tests/e2e/profile-onboarding.ts
env DATABASE_URL_DO_PRIVATE= DOTENV_CONFIG_PATH=.env.local node -r dotenv/config --import tsx tests/e2e/connected-onboarding-recovery.ts
node scripts/build-application-extension.mjs --local=http://127.0.0.1:3004
```

Run the packaged extension integration with `EXTENSION_SETUP_ONLY=1`, `EXTENSION_TEST_PROFILE=output/playwright/connected-onboarding-test`, and `APPLICATION_EXTENSION_IDS` set to the actual generated local package ID. Use `tests/integration/application-extension-browser.ts`; never substitute a personal Chrome profile. Screenshots are under `output/playwright/` and are not committed. GitHub Verify runs the pure bridge/database checks plus both website browser suites against its local production server.

## Release Gate

1. Deploy the additive database migration and compatible backend/website together through the normal reviewed release process. Keep metrics off unless explicitly enabled after privacy review.
2. Confirm production allows the public Store ID. Verify old Store 0.15.1's existing consent flow and truthful coordinator fallback before shipping the new package.
3. Upload 0.16.0 only through the publisher review process. Update Store screenshots to replace preview ZIP guidance. This work has not submitted or published it.
4. Verify the installed Store version and production website revision with a dedicated test account: authentication/verification delivery, connection, account mismatch, original-tab return, and first useful fill.
5. With consent, run direct, embedded, multi-step and unsupported live-application cases. Record verified results and limitations; never treat fixture results as universal website support.

The prior design's per-record diff tools, cross-device continuation, practice-form experiments, and broader funnel reporting remain follow-up work, not prerequisites silently added to the user's setup.
