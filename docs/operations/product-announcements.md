# Autofill Getting-Started Announcement

## Audience and Consent

- In-app: active accounts, once per campaign, including accounts without email consent.
- Email: active accounts with a verified address and `productUpdatesEnabled = true`.
- `emailNotificationsEnabled` only controls deadline reminders. It never qualifies an account for product updates.
- Product updates default to off for both existing and new accounts. Users opt in under Settings > Notifications > Email product updates.
- No tracking pixels or link redirects. The guide images are static shared assets, not per-recipient URLs.
- Account deletion cascades delivery records. Dismissing a notification does not erase the deduplication record.

## Review and Release

1. Review `/extension/guide` at desktop and mobile widths and the email preview. The public Chrome Web Store release was verified as 0.15.1 on October 25, 2026. It uses the toolbar connection flow, not the newer setup bridge.
2. Confirm the text and recipient rules with the owner before sending. Preview with `npm run announce:autofill -- --preview-only`. Generated HTML/plain text are in `output/announcements/`; the preview's unsubscribe link intentionally contains no real token.
3. Apply `20261025120000_product_announcements` and deploy the matching app/assets before publishing a notification or sending emails. The migration is additive and does not opt anyone in.
4. Check the public guide, all four screenshot URLs, Store link, authenticated notification preferences and signed unsubscribe endpoint on the deployed version.
5. In the deployment's trusted environment, run a dry run for each channel:

```sh
npm run announce:autofill -- --channel=in-app
npm run announce:autofill -- --channel=email
```

Dry runs query counts and write local previews only. They do not create delivery records, notifications or emails. No recipient addresses are printed. By default the links use `https://applyoverflow.com`; `APP_BASE_URL` may override this only for localhost previews.

6. After approval, publish bounded batches:

```sh
npm run announce:autofill -- --channel=in-app --send --max=100 --confirm=autofill-getting-started-2026-10
npm run announce:autofill -- --channel=email --send --max=100 --confirm=autofill-getting-started-2026-10
```

Repeat the same campaign command until the unprocessed count is zero. Email batches send sequentially with a one-second pause. The hard per-run limit is 1,000. Email requires configured SMTP and the same strong `BETTER_AUTH_SECRET` used by the app for signed unsubscribe links. Do not change the campaign key simply to resend the same message.

## Delivery and Recovery

- `ACCEPTED` means the SMTP server accepted the message; it does **not** prove inbox delivery. Inspect provider bounce/delivery logs separately.
- `SENDING` reserves a recipient before the network call. Concurrent runners cannot claim it twice.
- A crash leaves `SENDING`; an exception marks `UNKNOWN`. Neither is retried automatically. Sending stops on an uncertain result. Check provider logs before any operator repair. Prefer a missed message over a duplicate when acceptance is unknown.
- `NOT_SENT` means no send was claimed, or the transport was unavailable before sending. Eligibility is checked again immediately before sending.
- Never log the full mail body, recipient list or unsubscribe tokens in operational reports. Report counts, campaign key and status totals only.
- The unsubscribe page's GET has no mutation, protecting against email link scanners. Confirmation and RFC 8058 one-click unsubscribe use POST. They turn off product updates only, not reminders or account/security emails. Old unsubscribe links remain usable until the signing secret rotates.
- SMTP signing/DKIM and provider delivery reputation are infrastructure concerns; this feature does not claim to verify them.

## Verification and Screenshots

Unit tests: `node --import tsx --test tests/product-announcements.test.ts`.

Browser/integration test: migrate a **dedicated local** database whose name includes `announcement_test`, start Next with that database and a test-only `BETTER_AUTH_SECRET`, then run `npm run test:announcements` with matching `DATABASE_URL`, `BETTER_AUTH_SECRET` and `TEST_APP_URL`. SMTP is mocked in the test; no external recipient or employer is contacted. CI runs it against its isolated test database.

Coverage includes explicit opt-in persistence, default-off migration behavior, audience exclusions, concurrent deduplication, dismissed notices, uncertain SMTP outcomes, scanner-safe and one-click unsubscribe, clickable notifications, public guide access, image loading and mobile overflow.

`UPDATE_GUIDE_SCREENSHOTS=1` regenerates the guide assets from a synthetic local profile and the published extension's HTML/CSS at commit `96d0322`. Popup screenshots use deterministic demo connection/progress states, not a live employer result. They are documentation illustrations of the real UI, not evidence of a live application test. No personal account data is used. Normal test runs only read the committed assets. Keep the reviewed screenshots when updating tests; refresh them deliberately for a new Store UI release.
