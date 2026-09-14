import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateRequirements,
  parseRequirements,
  requirementsSchema,
} from "../src/lib/top-picks/requirements";
import {
  capabilityEvidence,
  extractCapabilities,
} from "../src/lib/jobs/capabilities";

const base = {
  location: "Toronto, ON, Canada",
  workMode: "REMOTE",
  employmentType: "FULL_TIME",
  salaryMin: 100_000,
  salaryCurrency: "CAD",
};
test("hard rules reject known conflicts regardless of unknown policy", () => {
  const rules = requirementsSchema.parse({
    country: "CA",
    workModes: ["REMOTE"],
    minimumSalary: 90_000,
  });
  assert.equal(evaluateRequirements(rules, base).passed, true);
  for (const job of [
    { ...base, workMode: "ONSITE" },
    { ...base, salaryMin: 70_000 },
    { ...base, description: "Candidates must reside in the United States." },
  ])
    assert.equal(evaluateRequirements(rules, job).passed, false);
});
test("unknown salary and country never silently satisfy strict requirements", () => {
  const rules = requirementsSchema.parse({
    country: "CA",
    minimumSalary: 80_000,
    unknownPolicy: "exclude",
  });
  assert.equal(
    evaluateRequirements(rules, { location: "Remote" }).passed,
    false,
  );
  const relaxed = evaluateRequirements(
    { ...rules, unknownPolicy: "include" },
    { location: "Remote" },
  );
  assert.equal(relaxed.passed, true);
  assert.deepEqual(relaxed.unknown, [
    "Country eligibility",
    "Minimum advertised salary",
  ]);
  assert.equal(
    evaluateRequirements(rules, { ...base, salaryCurrency: null }).passed,
    false,
  );
});
test("country rules require residency evidence, not incidental US mentions", () => {
  const rules = requirementsSchema.parse({ country: "CA" });
  for (const description of [
    "You must be able to help us deliver.",
    "You must be available during US hours.",
    "You must reside in the United States or Canada.",
  ]) {
    assert.equal(
      evaluateRequirements(rules, { ...base, description }).passed,
      true,
      description,
    );
  }
  assert.equal(
    evaluateRequirements(rules, {
      ...base,
      description: "You must be based in the US.",
    }).passed,
    false,
  );
  assert.equal(
    evaluateRequirements(rules, {
      ...base,
      location: "Remote, United States",
      description: "You must reside in the United States or Canada.",
    }).passed,
    true,
  );
});
test("sponsorship needs explicit evidence and negatives win", () => {
  const rules = requirementsSchema.parse({
    sponsorshipRequired: true,
    unknownPolicy: "exclude",
  });
  assert.equal(
    evaluateRequirements(rules, {
      ...base,
      description: "Visa sponsorship is available.",
    }).passed,
    true,
  );
  assert.equal(
    evaluateRequirements(rules, {
      ...base,
      description: "We do not provide visa sponsorship.",
    }).passed,
    false,
  );
  assert.equal(
    evaluateRequirements(rules, {
      ...base,
      description:
        "We not only provide visa sponsorship but also relocation support.",
    }).passed,
    true,
  );
  assert.equal(evaluateRequirements(rules, base).passed, false);
});
test("requirements validation rejects invented flags and invalid salaries", () => {
  assert.equal(
    requirementsSchema.safeParse({ minimumSalary: -1 }).success,
    false,
  );
  assert.equal(
    requirementsSchema.safeParse({ ownerId: "someone_else" }).success,
    false,
  );
  assert.deepEqual(parseRequirements("broken"), requirementsSchema.parse({}));
});
test("capabilities distinguish occupations without inventing technologies", () => {
  assert.deepEqual(
    extractCapabilities("Financial reporting, reconciliation and IFRS"),
    ["financial reporting", "reconciliation", "ifrs"],
  );
  assert.deepEqual(
    extractCapabilities("Talent acquisition and employee relations"),
    ["recruiting", "employee relations"],
  );
  assert.deepEqual(extractCapabilities("Legal research and contract review"), [
    "contract review",
    "legal research",
  ]);
  assert.deepEqual(extractCapabilities("JavaScript and React"), [
    "javascript",
    "react",
  ]);
  assert.deepEqual(
    extractCapabilities("A cloud platform and a product database"),
    [],
  );
});
test("source evidence separates required, preferred and negated capabilities", () => {
  const facts = capabilityEvidence(
    "## Requirements\n- Financial reporting and IFRS experience.\n- Python is not required.\n## Preferred qualifications\n- SQL is a plus.\n## Responsibilities\n- Manage payroll.",
  );
  assert.ok(
    facts.some(
      (fact) => fact.skill === "ifrs" && fact.category === "requirements",
    ),
  );
  assert.ok(
    facts.some((fact) => fact.skill === "sql" && fact.category === "preferred"),
  );
  assert.ok(!facts.some((fact) => fact.skill === "python"));
});
