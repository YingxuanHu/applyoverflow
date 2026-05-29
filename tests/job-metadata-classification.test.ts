import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyJobMetadata,
  normalizeCareerStageFilterValue,
  normalizeEmploymentTypeFilterValue,
  normalizeIndustryFilterValue,
  normalizeRoleCategoryFilterValue,
} from "../src/lib/job-metadata";

test("senior software engineer is not classified as internship", () => {
  const metadata = classifyJobMetadata({
    title: "Senior Software Engineer",
    company: "Amazon",
    description: "Lead product engineering projects and mentor junior engineers.",
    roleFamily: "SWE",
    legacyIndustry: "TECH",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "HYBRID",
  });

  assert.equal(metadata.normalizedCareerStage, "SENIOR");
  assert.equal(metadata.normalizedEmploymentType, "FULL_TIME");
  assert.notEqual(metadata.normalizedCareerStage, "INTERNSHIP_COOP_STUDENT");
});

test("internship/co-op requires strong internship evidence", () => {
  const seniorWithInternMention = classifyJobMetadata({
    title: "Senior Software Engineer",
    company: "Example",
    description: "Mentor interns and work with internal engineering teams.",
    roleFamily: "SWE",
    legacyIndustry: "TECH",
    inferredEmploymentType: "UNKNOWN",
    sourceEmploymentType: null,
    workMode: "REMOTE",
  });

  assert.equal(seniorWithInternMention.normalizedCareerStage, "SENIOR");
  assert.notEqual(seniorWithInternMention.normalizedEmploymentType, "INTERNSHIP");

  const intern = classifyJobMetadata({
    title: "Software Engineer Intern",
    company: "Example",
    description: "Join our engineering internship program for the summer.",
    roleFamily: "SWE",
    legacyIndustry: "TECH",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "REMOTE",
  });

  assert.equal(intern.normalizedCareerStage, "INTERNSHIP_COOP_STUDENT");
  assert.equal(intern.normalizedEmploymentType, "INTERNSHIP");
});

test("explicit intern evidence overrides senior wording only when the posting is actually an internship", () => {
  const metadata = classifyJobMetadata({
    title: "Senior Software Engineer Intern Tools",
    company: "Example",
    description: "This internship program builds internal developer tooling.",
    roleFamily: "SWE",
    legacyIndustry: "TECH",
    inferredEmploymentType: "UNKNOWN",
    sourceEmploymentType: null,
    workMode: "REMOTE",
  });

  assert.equal(metadata.normalizedCareerStage, "INTERNSHIP_COOP_STUDENT");
  assert.equal(metadata.normalizedEmploymentType, "INTERNSHIP");
});

test("new grad is entry-level, not internship", () => {
  const metadata = classifyJobMetadata({
    title: "New Grad Software Engineer",
    company: "Example",
    description: "Campus hire role for recent graduates.",
    roleFamily: "SWE",
    legacyIndustry: "TECH",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "ONSITE",
  });

  assert.equal(metadata.normalizedCareerStage, "ENTRY_LEVEL_NEW_GRAD");
  assert.equal(metadata.normalizedEmploymentType, "FULL_TIME");
});

test("student-facing senior roles are not treated as student internships", () => {
  const metadata = classifyJobMetadata({
    title: "Program Manager, Student Outreach",
    company: "Example University",
    description: "Lead outreach programs for students and employer partners.",
    roleFamily: "Operations",
    legacyIndustry: "GENERAL",
    inferredEmploymentType: "INTERNSHIP",
    sourceEmploymentType: null,
    workMode: "HYBRID",
  });

  assert.equal(metadata.normalizedCareerStage, "MANAGER");
  assert.notEqual(metadata.normalizedEmploymentType, "INTERNSHIP");
});

test("co-op company names do not make manager roles co-op internships", () => {
  const metadata = classifyJobMetadata({
    title: "Senior Manager, People & Culture - Westview Co-op",
    company: "Westview Co-op",
    description: "Lead people operations and culture programs across the organization.",
    roleFamily: "HR / People",
    legacyIndustry: "GENERAL",
    inferredEmploymentType: "INTERNSHIP",
    sourceEmploymentType: null,
    workMode: "ONSITE",
  });

  assert.equal(metadata.normalizedCareerStage, "MANAGER");
  assert.notEqual(metadata.normalizedEmploymentType, "CO_OP");
  assert.notEqual(metadata.normalizedEmploymentType, "INTERNSHIP");
});

test("staff roles for internship programs are not classified as internships", () => {
  const metadata = classifyJobMetadata({
    title: "Lead Instructor, Internship Programs",
    company: "Example Education",
    description: "Teach students and manage internship program curriculum.",
    roleFamily: "Education Admin",
    legacyIndustry: "GENERAL",
    inferredEmploymentType: "UNKNOWN",
    sourceEmploymentType: null,
    workMode: "REMOTE",
  });

  assert.equal(metadata.normalizedCareerStage, "STAFF_PRINCIPAL");
  assert.notEqual(metadata.normalizedEmploymentType, "INTERNSHIP");
});

test("explicit co-op intern roles remain co-op/student roles", () => {
  const metadata = classifyJobMetadata({
    title: "Staff Accountant - Audit Public/Private - Co-op/Intern Fall 2026",
    company: "Deloitte",
    description: "Fall co-op placement for accounting students.",
    roleFamily: "Accounting",
    legacyIndustry: "FINANCE",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "HYBRID",
  });

  assert.equal(metadata.normalizedCareerStage, "INTERNSHIP_COOP_STUDENT");
  assert.equal(metadata.normalizedEmploymentType, "CO_OP");
});

test("industry and role category are independent labels", () => {
  const metadata = classifyJobMetadata({
    title: "Software Engineer",
    company: "JPMorgan Chase",
    description: "Build trading and banking platforms for financial services.",
    roleFamily: "SWE",
    legacyIndustry: "TECH",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "HYBRID",
  });

  assert.equal(metadata.normalizedRoleCategory, "SOFTWARE_ENGINEERING");
  assert.equal(metadata.normalizedIndustry, "FINANCE_BANKING");
});

test("metadata filter normalization maps legacy values to the new taxonomy", () => {
  assert.equal(
    normalizeCareerStageFilterValue("INTERNSHIP,SENIOR_LEVEL,New Grad"),
    "INTERNSHIP_COOP_STUDENT,SENIOR,ENTRY_LEVEL_NEW_GRAD"
  );
  assert.equal(
    normalizeEmploymentTypeFilterValue("full time,co-op,contract"),
    "FULL_TIME,CO_OP,CONTRACT"
  );
  assert.equal(normalizeIndustryFilterValue("TECH,Finance & Banking"), "TECHNOLOGY,FINANCE_BANKING");
  assert.equal(normalizeRoleCategoryFilterValue("SWE,Data Analytics"), "SOFTWARE_ENGINEERING,DATA_ANALYTICS");
});
