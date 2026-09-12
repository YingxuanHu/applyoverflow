import assert from "node:assert/strict";
import test from "node:test";
import { getSignInErrorFeedback } from "../src/lib/auth-sign-in-error";

test("unverified accounts have a verification recovery path", () => {
  assert.deepEqual(getSignInErrorFeedback({ code: "EMAIL_NOT_VERIFIED", status: 403 }), {
    message: "Email not verified. Check your inbox for the verification link.",
    needsVerification: true,
  });
});

test("invalid credentials stay generic and do not disclose account existence", () => {
  for (const error of [{ code: "INVALID_EMAIL_OR_PASSWORD" }, { status: 401 }]) {
    assert.deepEqual(getSignInErrorFeedback(error), {
      message: "Invalid email or password.", needsVerification: false,
    });
  }
});

test("outages, network failures and throttling do not blame the password", () => {
  for (const [status, expected] of [[503, /temporarily unavailable/], [0, /connection/], [429, /Too many/]] as const) {
    const feedback = getSignInErrorFeedback({ status });
    assert.match(feedback.message, expected);
    assert.equal(feedback.needsVerification, false);
  }
  assert.match(getSignInErrorFeedback({ code: "UNKNOWN" }).message, /try again/);
});
