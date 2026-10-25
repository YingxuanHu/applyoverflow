import assert from "node:assert/strict";
import { test } from "node:test";
import { announcementPath, autofillAnnouncementEmail, AUTOFILL_ANNOUNCEMENT } from "../src/lib/announcements/content";
import { productUnsubscribeToken, readProductUnsubscribeToken } from "../src/lib/announcements/unsubscribe";

test("announcement links are allowlisted", () => {
  assert.equal(announcementPath(AUTOFILL_ANNOUNCEMENT.path), "/extension/guide");
  for (const value of [null, undefined, "//evil.example", "javascript:alert(1)", "/extension/guide?redirect=evil", "/settings"]) assert.equal(announcementPath(value), null);
});

test("email is useful without images, honest about consent, and uses the Store release", () => {
  const mail = autofillAnnouncementEmail("https://applyoverflow.com", 'https://applyoverflow.com/email/product-updates?token=a&b="x"');
  for (const phrase of ["1. Review your profile", "2. Install", "3. Connect", "4. Choose", "5. Fill", "Autofill never submits", "opted into", "Unsubscribe"]) assert.ok(mail.text.includes(phrase), phrase);
  assert.ok(mail.text.includes("mhkkioknljkgnhgnhcamilkgbadjnmil"));
  assert.ok(mail.html.includes("alt=\"Example:"));
  assert.ok(mail.html.includes("&amp;b=&quot;x&quot;"));
  assert.ok(!mail.html.includes("/downloads/"));
  assert.throws(() => autofillAnnouncementEmail("http://evil.example", "x"));
});

test("unsubscribe tokens are signed, purpose-bound and reject malformed input", () => {
  const before = process.env.BETTER_AUTH_SECRET;
  process.env.BETTER_AUTH_SECRET = "isolated-announcement-unit-test-secret";
  try {
    const token = productUnsubscribeToken("user-123");
    assert.equal(readProductUnsubscribeToken(token), "user-123");
    assert.equal(readProductUnsubscribeToken(token.replace(/^./, token[0] === "a" ? "b" : "a")), null);
    for (const invalid of ["", "a.b", "x".repeat(5000), "../x", "eyJ1c2VySWQiOiIxIn0"]) assert.equal(readProductUnsubscribeToken(invalid), null);
    process.env.BETTER_AUTH_SECRET = "other-isolated-announcement-test-secret";
    assert.equal(readProductUnsubscribeToken(token), null);
    delete process.env.BETTER_AUTH_SECRET;
    assert.throws(() => productUnsubscribeToken("user"));
  } finally {
    if (before === undefined) delete process.env.BETTER_AUTH_SECRET; else process.env.BETTER_AUTH_SECRET = before;
  }
});
