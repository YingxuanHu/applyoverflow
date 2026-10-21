import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildFeedVisibilityRepair } from "../src/lib/ingestion/feed-visibility-repair";

test("visibility repair is parameterized and guards both canonical and projection versions", () => {
  const now = new Date("2026-10-21T00:00:00Z");
  const query = buildFeedVisibilityRepair([{ id: "test-job", canonicalUpdatedAt: now, indexUpdatedAt: now }]);
  assert.match(query.sql, /UPDATE "JobFeedIndex"/);
  assert.match(query.sql, /jc\."updatedAt" = candidate\."canonicalUpdatedAt"/);
  assert.match(query.sql, /jfi\."updatedAt" = candidate\."indexUpdatedAt"/);
  assert.match(query.sql, /jfi\.status = 'LIVE'/);
  assert.doesNotMatch(query.sql, /DELETE|UPDATE "JobCanonical"|test-job/);
  assert.equal(JSON.parse(query.values[0] as string)[0].id, "test-job");
});

test("repair CLI is dry-run by default and shares the ingestion publication policy", () => {
  const script = readFileSync(new URL("../scripts/repair-job-feed-visibility.ts", import.meta.url), "utf8");
  assert.match(script, /const dryRun = !process\.argv\.includes\("--apply"\)/);
  assert.match(script, /excluded\.length && !dryRun/);
  assert.match(script, /shouldExcludeFromFeedIndex\(\{/);
  assert.match(script, /--fast-sql is retired/);
});
