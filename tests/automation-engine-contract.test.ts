import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("auto-apply API passes the authenticated profile into the engine", () => {
  const routeSource = readFileSync(
    new URL("../src/app/api/jobs/[id]/auto-apply/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(routeSource, /requireCurrentProfileId/);
  assert.match(routeSource, /userId\s*=\s*await\s+requireCurrentProfileId\(\)/);
  assert.match(routeSource, /runAutoApply\(\{[\s\S]*userId,/);
});

test("automation candidate queries are scoped to the selected user profile", () => {
  const engineSource = readFileSync(
    new URL("../src/lib/automation/engine.ts", import.meta.url),
    "utf8"
  );

  assert.match(engineSource, /loadProfile\(userId\)/);
  assert.match(engineSource, /getSingleCandidate\(jobId,\s*userId\)/);
  assert.match(engineSource, /getEligibleCandidates\(maxPerRun,\s*userId\)/);
  assert.match(engineSource, /recordAutomationResult\(candidate,\s*result,\s*runMode,\s*userId\)/);
  assert.match(engineSource, /AUTO_APPLY_USER_PROFILE_ID/);
  assert.match(engineSource, /ALLOW_DEMO_USER_FALLBACK/);
  assert.match(engineSource, /recordResult\?: boolean/);
  assert.match(engineSource, /mode="fill_and_submit" explicitly after a user has reviewed the fields/);
  assert.match(engineSource, /return "fill_only"/);
  assert.doesNotMatch(engineSource, /return\s+trimmedUserId\s+\|\|\s+DEMO_USER_ID/);
  assert.doesNotMatch(engineSource, /where:\s*\{\s*id:\s*DEMO_USER_ID\s*\}/);
  assert.doesNotMatch(engineSource, /userId:\s*DEMO_USER_ID/);
});

test("current-user helpers do not silently fall back to the demo profile", () => {
  const currentUserSource = readFileSync(
    new URL("../src/lib/current-user.ts", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(currentUserSource, /fallbackToDemo/);
  assert.doesNotMatch(currentUserSource, /DEMO_USER_ID/);
  assert.match(currentUserSource, /requireCurrentUserIds/);
});
