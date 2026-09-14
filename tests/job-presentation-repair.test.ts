import assert from "node:assert/strict";
import test from "node:test";
import { planJobPresentationRepair } from "../src/lib/ingestion/presentation-repair";
import type { SourceConnectorJob } from "../src/lib/ingestion/types";

const current = { title: "Software Engineer", location: "Hybrid", region: null, salaryMin: 34840, salaryMax: 45656, salaryCurrency: "USD", salaryPeriod: "hour", salarySource: "description_regex", salaryRawText: "$16.75 - $21.95 per hour" };
const source: SourceConnectorJob = { sourceId: "test", sourceUrl: null, title: current.title, company: "Example", location: "Toronto, ON, CA", description: current.salaryRawText, applyUrl: "https://example.com/jobs/1", postedAt: null, deadline: null, employmentType: null, workMode: "HYBRID", salaryMin: null, salaryMax: null, salaryCurrency: null, metadata: { detail: { workplaceType: "Hybrid", locationName: "Toronto, ON, CA" } } };

test("repair restores evidence-backed presentation without lifecycle or compensation amount writes", () => {
  const result = planJobPresentationRepair(current, source);
  assert.equal(result.patch.location, "Toronto, ON, CA");
  assert.equal(result.patch.region, "CA");
  assert.equal(result.patch.salaryCurrency, "CAD");
  assert.equal(result.hideFromFeed, false);
  assert.ok(Object.keys(result.patch).every((key) => /^(location|region|salaryCurrency|salaryPeriod)/.test(key)));
});
test("repair preserves explicit USD, conflicting amounts, and resolved locations", () => {
  assert.equal(planJobPresentationRepair(current, { ...source, salaryCurrency: "USD" }).patch.salaryCurrency, undefined);
  assert.equal(planJobPresentationRepair({ ...current, salaryRawText: "USD 16.75 - USD 21.95 per hour" }, source).patch.salaryCurrency, undefined);
  assert.equal(planJobPresentationRepair({ ...current, salaryRawText: "US$ 16.75 - US$ 21.95 per hour" }, source).patch.salaryCurrency, undefined);
  assert.equal(planJobPresentationRepair({ ...current, salaryMin: 50000 }, source).patch.salaryCurrency, undefined);
  assert.equal(planJobPresentationRepair({ ...current, location: "London, ON" }, source).patch.location, undefined);
  assert.deepEqual(planJobPresentationRepair(current, null).patch, {});
});
test("repair hides foreign and retail jobs in the read model only", () => {
  const foreign = planJobPresentationRepair(current, { ...source, location: "Sao Paulo", metadata: {} });
  assert.equal(foreign.hideFromFeed, true);
  assert.equal("status" in foreign.patch, false);
  assert.equal(planJobPresentationRepair({ ...current, title: "Bakery InStore Clerk" }, null).hideFromFeed, true);
});
