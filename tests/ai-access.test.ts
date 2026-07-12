import assert from "node:assert/strict";
import test from "node:test";

import { isAiFeatureAllowed } from "../src/lib/ai-access";

test("AI access has no account eligibility gate", () => {
  assert.equal(isAiFeatureAllowed("user@example.com"), true);
  assert.equal(isAiFeatureAllowed("another-user@example.com"), true);
  assert.equal(isAiFeatureAllowed(null), true);
  assert.equal(isAiFeatureAllowed("   "), true);
});
