import assert from "node:assert/strict";
import test from "node:test";

import { extractExperienceLevel } from "../src/lib/experience-level";

function extract(title: string, description = "", normalizedEmploymentType?: string) {
  return extractExperienceLevel({
    title,
    description,
    normalizedEmploymentType,
  });
}

test("manager keywords require people-management or stronger manager context", () => {
  assert.notEqual(extract("Product Manager").normalizedCareerStage, "MANAGER");
  assert.notEqual(extract("Project Manager").normalizedCareerStage, "MANAGER");
  assert.notEqual(extract("Account Manager").normalizedCareerStage, "MANAGER");

  assert.equal(
    extract("Engineering Manager, Backend", "Manage a team of engineers with direct reports.").normalizedCareerStage,
    "MANAGER"
  );
  assert.equal(extract("Store Manager").normalizedCareerStage, "MANAGER");

  const seniorPm = extract("Product Manager", "Requires 7+ years of product experience.");
  assert.notEqual(seniorPm.normalizedCareerStage, "MANAGER");
  assert.equal(seniorPm.experienceLevelGroup, "SENIOR_LEAD_STAFF");
});

test("executive false positives are not executive-level", () => {
  assert.notEqual(extract("Account Executive").normalizedCareerStage, "EXECUTIVE");
  assert.notEqual(extract("Executive Assistant").normalizedCareerStage, "EXECUTIVE");
  assert.notEqual(extract("Executive Chef").normalizedCareerStage, "EXECUTIVE");
  assert.equal(extract("VP Engineering").normalizedCareerStage, "EXECUTIVE");
  assert.equal(extract("Chief Technology Officer").normalizedCareerStage, "EXECUTIVE");
  assert.equal(extract("Head of Product").normalizedCareerStage, "EXECUTIVE");
});

test("staff/principal false positives are protected", () => {
  assert.equal(extract("Staff Software Engineer").normalizedCareerStage, "STAFF_PRINCIPAL");
  assert.notEqual(extract("Staff Accountant").normalizedCareerStage, "STAFF_PRINCIPAL");
  assert.notEqual(extract("Staff Nurse").normalizedCareerStage, "STAFF_PRINCIPAL");
  assert.notEqual(extract("Chief of Staff").normalizedCareerStage, "STAFF_PRINCIPAL");
});

test("senior/lead/principal context is conservative", () => {
  assert.equal(extract("Senior Software Engineer").normalizedCareerStage, "SENIOR");
  assert.notEqual(extract("Senior Living Caregiver").normalizedCareerStage, "SENIOR");
  assert.notEqual(extract("Senior Care Assistant").normalizedCareerStage, "SENIOR");
  assert.equal(extract("Lead Software Engineer").normalizedCareerStage, "SENIOR");
  assert.notEqual(extract("Lead Generation Specialist").normalizedCareerStage, "SENIOR");
  assert.equal(extract("Principal Engineer").normalizedCareerStage, "STAFF_PRINCIPAL");
  assert.notEqual(extract("School Principal").normalizedCareerStage, "STAFF_PRINCIPAL");
  assert.notEqual(extract("Principal Investigator").normalizedCareerStage, "STAFF_PRINCIPAL");
});

test("associate and assistant titles respect rank context", () => {
  assert.equal(extract("Associate Software Engineer").normalizedCareerStage, "ASSOCIATE_JUNIOR");
  assert.equal(extract("Associate Director").normalizedCareerStage, "DIRECTOR");
  assert.equal(extract("Associate Professor").normalizedCareerStage, "SENIOR");
  assert.equal(extract("Associate General Counsel").normalizedCareerStage, "SENIOR");
  assert.equal(extract("Sales Associate").normalizedCareerStage, "ENTRY_LEVEL_NEW_GRAD");
  assert.equal(extract("Administrative Assistant").normalizedCareerStage, "ENTRY_LEVEL_NEW_GRAD");
  assert.notEqual(extract("Executive Assistant").normalizedCareerStage, "EXECUTIVE");
  assert.equal(extract("Assistant Manager").normalizedCareerStage, "MANAGER");
  assert.notEqual(extract("Assistant Professor").normalizedCareerStage, "ASSOCIATE_JUNIOR");
});

test("intern/student signals describe target worker, not department or program", () => {
  assert.equal(extract("Software Engineer Intern").normalizedCareerStage, "INTERNSHIP_COOP_STUDENT");
  assert.notEqual(extract("Intern Program Manager").normalizedCareerStage, "INTERNSHIP_COOP_STUDENT");
  assert.notEqual(extract("Student Success Manager").normalizedCareerStage, "INTERNSHIP_COOP_STUDENT");
  assert.equal(extract("Graduate Research Assistant").normalizedCareerStage, "INTERNSHIP_COOP_STUDENT");
  assert.equal(extract("New Grad Software Engineer").normalizedCareerStage, "ENTRY_LEVEL_NEW_GRAD");
});

test("common keyword false positives stay unrelated to experience level", () => {
  assert.equal(extract("Full Stack Engineer").normalizedCareerStage, "UNKNOWN");
  assert.notEqual(extract("Partnership Manager").normalizedCareerStage, "MANAGER");
  assert.notEqual(extract("Contract Manager").normalizedCareerStage, "MANAGER");
});

test("level numbers and roman numerals map conservatively", () => {
  assert.equal(extract("Software Engineer I").experienceLevelGroup, "ENTRY_JUNIOR");
  assert.equal(extract("Software Engineer II").experienceLevelGroup, "ENTRY_JUNIOR");
  assert.equal(extract("Software Engineer III").normalizedCareerStage, "MID_LEVEL");
  assert.equal(extract("Software Engineer IV").normalizedCareerStage, "SENIOR");
  assert.equal(extract("Software Engineer V").experienceLevelGroup, "SENIOR_LEAD_STAFF");
  assert.equal(extract("IC5 Software Engineer").experienceLevelGroup, "SENIOR_LEAD_STAFF");
  assert.equal(extract("L6 Engineer").normalizedCareerStage, "STAFF_PRINCIPAL");
});

test("industry-specific examples are handled safely", () => {
  assert.equal(extract("Legal Intern").normalizedCareerStage, "INTERNSHIP_COOP_STUDENT");
  assert.equal(extract("Summer Associate").normalizedCareerStage, "INTERNSHIP_COOP_STUDENT");
  assert.equal(extract("Associate Attorney").experienceLevelGroup, "ENTRY_JUNIOR");
  assert.equal(extract("Senior Counsel").normalizedCareerStage, "SENIOR");
  assert.equal(extract("General Counsel").normalizedCareerStage, "EXECUTIVE");
  assert.equal(extract("Resident Physician").experienceLevelGroup, "ENTRY_JUNIOR");
  assert.notEqual(extract("Postdoctoral Fellow").normalizedCareerStage, "STAFF_PRINCIPAL");
  assert.notEqual(extract("Staff Nurse").normalizedCareerStage, "STAFF_PRINCIPAL");
  assert.equal(extract("Nurse Manager").normalizedCareerStage, "MANAGER");
  assert.equal(extract("Director of Nursing").normalizedCareerStage, "DIRECTOR");
  assert.equal(extract("Sales Development Representative").experienceLevelGroup, "ENTRY_JUNIOR");
  assert.equal(extract("Senior Account Executive").normalizedCareerStage, "SENIOR");
  assert.notEqual(extract("Enterprise Account Executive").normalizedCareerStage, "EXECUTIVE");
  assert.notEqual(extract("Owner Operator").normalizedCareerStage, "EXECUTIVE");
});

test("filters use grouped labels and confidence remains explicit", () => {
  const result = extract(
    "Product Manager",
    "Requires 7+ years of product experience. No direct reports."
  );
  assert.equal(result.experienceLevelGroup, "SENIOR_LEAD_STAFF");
  assert.ok(result.confidence >= 0.6);
  assert.ok(result.evidence.length > 0);
  assert.equal(result.source, "years_required");
});
