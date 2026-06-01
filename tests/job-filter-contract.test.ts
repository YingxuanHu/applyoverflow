import assert from "node:assert/strict";
import test from "node:test";

import {
  assertJobFilterContract,
  getJobFilterContractViolations,
} from "../src/lib/job-filter-contract";

const financeFilter = { roleCategory: "FINANCE_ACCOUNTING" };

function job(overrides: Partial<Parameters<typeof getJobFilterContractViolations>[1][number]>) {
  return {
    id: overrides.id ?? "job_1",
    title: overrides.title ?? "FP&A Analyst",
    company: overrides.company ?? "Example",
    roleFamily: overrides.roleFamily ?? "FP&A",
    normalizedRoleCategory: overrides.normalizedRoleCategory ?? "FINANCE_ACCOUNTING",
    normalizedRoleCategoryConfidence: overrides.normalizedRoleCategoryConfidence ?? 0.9,
    normalizedIndustry: overrides.normalizedIndustry ?? "TECHNOLOGY",
    normalizedIndustryConfidence: overrides.normalizedIndustryConfidence ?? 0.8,
    normalizedCareerStage: overrides.normalizedCareerStage ?? "MID_LEVEL",
    normalizedCareerStageConfidence: overrides.normalizedCareerStageConfidence ?? 0.82,
    classificationStatus: overrides.classificationStatus ?? "PARTIAL",
  };
}

test("Finance / Accounting role filter only accepts Finance / Accounting role metadata", () => {
  const rows = [
    job({ title: "FP&A Analyst - Revenue" }),
    job({
      id: "bad_swe",
      title: "Senior Software Engineering Lead - TSQL and 837 Medical Claims",
      roleFamily: "SWE",
      normalizedRoleCategory: "SOFTWARE_ENGINEERING",
      normalizedIndustry: "FINANCIAL_SERVICES",
    }),
    job({
      id: "bad_data",
      title: "Data Engineer, Risk Platform",
      roleFamily: "Data Engineering",
      normalizedRoleCategory: "DATA_ANALYTICS",
      normalizedIndustry: "FINANCIAL_SERVICES",
    }),
    job({
      id: "bad_consulting",
      title: "Senior Consultant - Risk Advisory Technology",
      roleFamily: "Risk",
      normalizedRoleCategory: "CONSULTING",
      normalizedIndustry: "CONSULTING_PROFESSIONAL_SERVICES",
    }),
  ];

  const violations = getJobFilterContractViolations(financeFilter, rows);

  assert.deepEqual(
    violations.map((violation) => violation.id),
    ["bad_swe", "bad_data", "bad_consulting"]
  );
});

test("role filters reject low-confidence and unknown role metadata", () => {
  const rows = [
    job({
      id: "low_confidence",
      normalizedRoleCategory: "FINANCE_ACCOUNTING",
      normalizedRoleCategoryConfidence: 0.62,
    }),
    job({
      id: "unknown",
      normalizedRoleCategory: "OTHER_UNKNOWN",
      normalizedRoleCategoryConfidence: 0.2,
      classificationStatus: "UNKNOWN",
    }),
  ];

  const violations = getJobFilterContractViolations(financeFilter, rows);

  assert.deepEqual(
    violations.map((violation) => violation.reason),
    ["role_category_low_confidence", "role_category_mismatch"]
  );
});

test("search-like titles do not override active structured role filters", () => {
  assert.throws(() =>
    assertJobFilterContract(
      {
        roleCategory: "FINANCE_ACCOUNTING",
      },
      [
        job({
          id: "payments_backend",
          title: "Backend Developer, Payments",
          roleFamily: "SWE",
          normalizedRoleCategory: "SOFTWARE_ENGINEERING",
          normalizedIndustry: "FINANCIAL_SERVICES",
        }),
      ],
      "test"
    )
  );
});

test("multiple selected role categories use OR within role category", () => {
  const rows = [
    job({ id: "finance", normalizedRoleCategory: "FINANCE_ACCOUNTING" }),
    job({ id: "software", normalizedRoleCategory: "SOFTWARE_ENGINEERING" }),
    job({ id: "data", normalizedRoleCategory: "DATA_ANALYTICS" }),
  ];

  const violations = getJobFilterContractViolations(
    { roleCategory: "FINANCE_ACCOUNTING,SOFTWARE_ENGINEERING" },
    rows
  );

  assert.deepEqual(
    violations.map((violation) => violation.id),
    ["data"]
  );
});

test("industry and role are independent in the role filter contract", () => {
  const rows = [
    job({
      id: "software_at_bank",
      title: "Software Engineer",
      roleFamily: "SWE",
      normalizedRoleCategory: "SOFTWARE_ENGINEERING",
      normalizedIndustry: "FINANCIAL_SERVICES",
    }),
    job({
      id: "finance_at_tech",
      title: "FP&A Analyst",
      roleFamily: "FP&A",
      normalizedRoleCategory: "FINANCE_ACCOUNTING",
      normalizedIndustry: "TECHNOLOGY",
    }),
  ];

  const violations = getJobFilterContractViolations(financeFilter, rows);

  assert.deepEqual(
    violations.map((violation) => violation.id),
    ["software_at_bank"]
  );
});

test("intern experience filter only accepts intern/co-op/student metadata", () => {
  const violations = getJobFilterContractViolations(
    { careerStage: "INTERNSHIP_COOP_STUDENT" },
    [
      job({
        id: "intern",
        title: "Software Engineer Intern",
        normalizedCareerStage: "INTERNSHIP_COOP_STUDENT",
        normalizedCareerStageConfidence: 0.94,
      }),
      job({
        id: "senior",
        title: "Senior Software Engineer",
        normalizedCareerStage: "SENIOR",
        normalizedCareerStageConfidence: 0.84,
      }),
      job({
        id: "low_confidence",
        title: "Student Programs Coordinator",
        normalizedCareerStage: "INTERNSHIP_COOP_STUDENT",
        normalizedCareerStageConfidence: 0.5,
      }),
    ]
  );

  assert.deepEqual(
    violations.map((violation) => violation.id),
    ["senior", "low_confidence"]
  );
});
