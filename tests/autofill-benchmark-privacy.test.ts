import assert from "node:assert/strict";
import { test } from "node:test";
import { optionalCookieDeclineLabel } from "../scripts/lib/autofill-benchmark-privacy.mjs";

test("benchmark declines only an unambiguous optional cookie choice", () => {
  assert.equal(optionalCookieDeclineLabel("This website uses cookies", ["Accept all", "Decline all"]), "Decline all");
  assert.equal(optionalCookieDeclineLabel("Manage cookies", ["Reject optional cookies"]), "Reject optional cookies");
  assert.equal(optionalCookieDeclineLabel("Cookie settings", ["Reject all cookies"]), "Reject all cookies");
  assert.equal(optionalCookieDeclineLabel("Cookie settings", ["\n Reject   All \n"]), "Reject All");
  assert.equal(optionalCookieDeclineLabel("Accept the terms", ["Accept", "Decline all"]), null);
  assert.equal(optionalCookieDeclineLabel("Manage cookies", ["Accept all", "Continue"]), null);
  assert.equal(optionalCookieDeclineLabel("Manage cookies", ["Decline all", "Reject all"]), null);
  assert.equal(optionalCookieDeclineLabel("Manage cookies", ["No", "Decline"]), null);
  assert.equal(optionalCookieDeclineLabel("Manage cookies", ["Reject all and accept agreement"]), null);
});
