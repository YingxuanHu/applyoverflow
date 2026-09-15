import assert from "node:assert/strict";
import test from "node:test";
import { buildDecisionFacts, changedDecisionFacts } from "../src/lib/jobs/decision-facts";
import { jobDataReportSchema } from "../src/lib/jobs/data-report";

const input: Parameters<typeof buildDecisionFacts>[0] = {
  status: "LIVE", deadSignalAt: null, applyUrlValidationStatus: "ACTIVE",
  location: "Toronto, ON, Canada", locationStatus: "confident", locationConfidence: 0.95,
  workMode: "HYBRID", workModeStatus: "confident", workModeConfidence: 0.9,
  salaryMin: 104000, salaryMax: 124800, salaryCurrency: "CAD", salaryPeriod: "hour", salaryConfidence: 0.9, salaryStatus: "confident",
  employmentType: "FULL_TIME", employmentTypeStatus: "confident", employmentTypeConfidence: 0.9,
  deadline: new Date("2026-10-01T12:00:00Z"), applicationDeadlineConfidence: 0.9, applicationDeadlineStatus: "confident",
};

test("comparison uses source periods, explicit currency, and confirmed facts", () => {
  const facts = buildDecisionFacts(input);
  assert.equal(facts.location, "Toronto, ON, Canada");
  assert.match(facts.salary!, /CAD.*50.*60\.00\/hour/);
  assert.equal(facts.deadline, "2026-10-01");
  assert.equal(facts.availability, "Open");
});

test("uncertain labels and unavailable postings are not presented as confirmed", () => {
  const facts = buildDecisionFacts({ ...input, locationConfidence: 0.1, workModeStatus: "quarantine", salaryConfidence: null, employmentType: "UNKNOWN", applicationDeadlineStatus: "missing", applyUrlValidationStatus: "BROKEN_APPLY_LINK" });
  for (const field of ["location", "workStyle", "salary", "employment", "deadline"] as const) assert.equal(facts[field], null);
  assert.equal(facts.availability, "Not currently listed");
  assert.equal(buildDecisionFacts({ ...input, status: "EXPIRED" }).availability, "Not currently listed", "expiry is not proof an employer closed the role");
});

test("alert baseline is silent; only meaningful fact changes emit deltas", () => {
  const facts = buildDecisionFacts(input);
  assert.deepEqual(changedDecisionFacts(null, facts), []);
  assert.deepEqual(changedDecisionFacts({ version: 2 }, facts), []);
  assert.deepEqual(changedDecisionFacts(facts, { ...facts }), []);
  const changed = buildDecisionFacts({ ...input, workMode: "ONSITE", salaryConfidence: 0 });
  assert.deepEqual(changedDecisionFacts(facts, changed).map((entry) => entry.field), ["workStyle", "salary"]);
  assert.equal(changedDecisionFacts(facts, changed)[1].after, null);
});

test("reports reject arbitrary categories, injected fields, missing detail and oversized text", () => {
  assert.equal(jobDataReportSchema.safeParse({ category: "SALARY", details: "Wrong currency listed" }).success, true);
  for (const body of [
    { category: "ADMIN", details: "Valid length" },
    { category: "CLOSED", details: "wrong", userId: "victim" },
    { category: "CLOSED", details: " " },
    { category: "CLOSED", details: "x".repeat(501) },
    null,
  ]) assert.equal(jobDataReportSchema.safeParse(body).success, false);
});
