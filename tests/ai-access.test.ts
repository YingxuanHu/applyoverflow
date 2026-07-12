import assert from "node:assert/strict";
import test from "node:test";

import { isAiFeatureAllowed } from "../src/lib/ai-access";

test("every authenticated account can use AI features", () => {
  assert.equal(isAiFeatureAllowed("user@example.com"), true);
  assert.equal(isAiFeatureAllowed("another-user@example.com"), true);
});

test("missing email is denied", () => {
  assert.equal(isAiFeatureAllowed(null), false);
  assert.equal(isAiFeatureAllowed("   "), false);
});
