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
  assert.match(engineSource, /return\s+trimmedUserId\s+\|\|\s+DEMO_USER_ID/);
  assert.doesNotMatch(engineSource, /where:\s*\{\s*id:\s*DEMO_USER_ID\s*\}/);
  assert.doesNotMatch(engineSource, /userId:\s*DEMO_USER_ID/);
});
