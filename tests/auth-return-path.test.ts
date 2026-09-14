import assert from "node:assert/strict";
import test from "node:test";
import { getSafeSignInCallback } from "../src/lib/auth-return-path";

test("sign-in preserves internal destinations, search state and selected jobs", () => {
  for (const path of ["/applications", "/jobs?titleSearch=Engineer#job-test", "/settings#security"])
    assert.equal(getSafeSignInCallback(path), path);
});

test("sign-in rejects external, malformed and looping return destinations", () => {
  for (const value of [undefined, null, [], "/sign-in", "/sign-in/?callbackUrl=/sign-in", "https://evil.test", "//evil.test", "/\\evil.test", "/\n/evil.test", "/\t/evil.test", "javascript:alert(1)", "/settings/../sign-in"])
    assert.equal(getSafeSignInCallback(value), "/jobs", String(value));
});
