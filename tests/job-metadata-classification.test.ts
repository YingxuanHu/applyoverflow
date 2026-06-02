import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyJobMetadata,
  INDUSTRY_FILTER_CONFIDENCE_THRESHOLD,
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

test("early career or program pages are not internship without role-level evidence", () => {
  const metadata = classifyJobMetadata({
    title: "Site Reliability Engineer (SRE) AI Infrastructure (Early Career)",
    company: "Example",
    description: "University recruiting and internship program information may appear elsewhere on the page.",
    roleFamily: "SWE",
    legacyIndustry: "TECH",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "REMOTE",
  });

  assert.notEqual(metadata.normalizedCareerStage, "INTERNSHIP_COOP_STUDENT");
  assert.notEqual(metadata.normalizedEmploymentType, "INTERNSHIP");
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
  assert.equal(metadata.normalizedIndustry, "FINANCIAL_SERVICES");
  assert.ok(metadata.confidence.roleCategory >= 0.75);
  assert.ok(metadata.confidence.industry >= INDUSTRY_FILTER_CONFIDENCE_THRESHOLD);
  assert.equal(metadata.classificationStatus, "PARTIAL");
});

test("industry is the company industry, not the job function or description topic", () => {
  const retailSourcing = classifyJobMetadata({
    title: "Associate Raw Material Sourcing CONTRACTOR (PT/FT)",
    company: "Buckmason",
    description:
      "Work with mills and vendors on seasonal fabric development, sourcing processes, fabric quality, cost, lead times, MOQs, and procurement.",
    roleFamily: "General Professional",
    legacyIndustry: "GENERAL",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "HYBRID",
  });

  assert.equal(retailSourcing.normalizedRoleCategory, "OPERATIONS");
  assert.equal(retailSourcing.normalizedIndustry, "RETAIL_CONSUMER_GOODS");
  assert.notEqual(retailSourcing.normalizedRoleCategory, "AI_MACHINE_LEARNING");
  assert.notEqual(retailSourcing.normalizedIndustry, "EDUCATION");

  const softwareAtUnknownCompany = classifyJobMetadata({
    title: "Software Engineer",
    company: "Example",
    description: "Build backend services for a customer platform.",
    roleFamily: "SWE",
    legacyIndustry: "TECH",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "REMOTE",
  });

  assert.equal(softwareAtUnknownCompany.normalizedRoleCategory, "SOFTWARE_ENGINEERING");
  assert.equal(softwareAtUnknownCompany.normalizedIndustry, "UNKNOWN");
});

test("generic AI wording in the description does not make a non-AI title AI/ML", () => {
  const metadata = classifyJobMetadata({
    title: "Sourcing Contractor",
    company: "Buck Mason",
    description:
      "This employer may use artificial intelligence tools to support the hiring process. The role manages vendors and material sourcing.",
    roleFamily: "General Professional",
    legacyIndustry: "GENERAL",
    inferredEmploymentType: "CONTRACT",
    sourceEmploymentType: null,
    workMode: "ONSITE",
  });

  assert.equal(metadata.normalizedRoleCategory, "OPERATIONS");
  assert.notEqual(metadata.normalizedRoleCategory, "AI_MACHINE_LEARNING");
});

test("finance role classification does not absorb software or technology jobs", () => {
  const badFinanceExamples = [
    {
      title: "Senior Software Engineering Lead - TSQL and 837 Medical Claims",
      company: "Taleo",
      description: "Build and operate enterprise software for healthcare claims platforms.",
      roleFamily: "SWE",
      expected: "SOFTWARE_ENGINEERING",
    },
    {
      title: "Software Development Engineer II, Internet Edge Services - Outbound Traffic Controller",
      company: "Amazon",
      description: "We're seeking a talented Software Development Engineer to join our dynamic team.",
      roleFamily: "SWE",
      expected: "SOFTWARE_ENGINEERING",
    },
    {
      title: "Backend Developer, Payments",
      company: "Example Bank",
      description: "Build APIs and backend services for payment systems.",
      roleFamily: "SWE",
      expected: "SOFTWARE_ENGINEERING",
    },
    {
      title: "Data Engineer, Risk Platform",
      company: "Example Finance",
      description: "Build data pipelines for risk analytics and reporting.",
      roleFamily: "Data Engineering",
      expected: "DATA_ANALYTICS",
    },
    {
      title: "Senior Staff Engineer - Payroll Platform",
      company: "Example",
      description: "Lead platform engineering for payroll systems.",
      roleFamily: "SWE",
      expected: "SOFTWARE_ENGINEERING",
    },
    {
      title: "Director, Software Engineering - Tax Exempt",
      company: "Example",
      description: "Lead software engineering teams for tax exempt products.",
      roleFamily: "SWE",
      expected: "SOFTWARE_ENGINEERING",
    },
  ];

  for (const example of badFinanceExamples) {
    const metadata = classifyJobMetadata({
      title: example.title,
      company: example.company,
      description: example.description,
      roleFamily: example.roleFamily,
      legacyIndustry: "FINANCE",
      inferredEmploymentType: "FULL_TIME",
      sourceEmploymentType: null,
      workMode: "HYBRID",
    });

    assert.equal(metadata.normalizedRoleCategory, example.expected, example.title);
    assert.notEqual(metadata.normalizedRoleCategory, "FINANCE_ACCOUNTING", example.title);
  }

  const riskAdvisoryTechnology = classifyJobMetadata({
    title: "Senior Consultant-Risk Advisory Technology",
    company: "Crosscountry Consulting",
    description: "Serve as a trusted partner to clients on risk advisory technology programs.",
    roleFamily: "Risk",
    legacyIndustry: "FINANCE",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "REMOTE",
  });

  assert.notEqual(riskAdvisoryTechnology.normalizedRoleCategory, "FINANCE_ACCOUNTING");
});

test("finance accounting stays strict to finance and accounting roles", () => {
  const financeExamples = [
    "FP&A Analyst - Revenue",
    "Mobility Tax Analyst",
    "Payroll Specialist",
    "Accounts Payable Clerk",
    "Treasury Analyst",
    "Controller",
    "Senior Auditor",
  ];

  for (const title of financeExamples) {
    const metadata = classifyJobMetadata({
      title,
      company: "Example",
      description: "Finance and accounting team role.",
      roleFamily: "Accounting",
      legacyIndustry: "FINANCE",
      inferredEmploymentType: "FULL_TIME",
      sourceEmploymentType: null,
      workMode: "HYBRID",
    });

    assert.equal(metadata.normalizedRoleCategory, "FINANCE_ACCOUNTING", title);
    assert.ok(metadata.confidence.roleCategory >= 0.75, title);
  }
});

test("software engineering filter evidence is title-specific and avoids adjacent roles", () => {
  const engineer = classifyJobMetadata({
    title: "Senior Software Engineer",
    company: "Example",
    description: "Build backend services and production software.",
    roleFamily: "SWE",
    legacyIndustry: "TECH",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "REMOTE",
  });
  assert.equal(engineer.normalizedRoleCategory, "SOFTWARE_ENGINEERING");

  const developerAdvocate = classifyJobMetadata({
    title: "Developer Advocate",
    company: "Example",
    description: "Create technical community content and run developer programs.",
    roleFamily: "Unknown",
    legacyIndustry: "TECH",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "REMOTE",
  });
  assert.equal(developerAdvocate.normalizedRoleCategory, "MARKETING");
  assert.notEqual(developerAdvocate.normalizedRoleCategory, "SOFTWARE_ENGINEERING");

  const productManager = classifyJobMetadata({
    title: "Product Manager",
    company: "Example",
    description: "Own roadmap, prioritization, and customer discovery.",
    roleFamily: "Product Management",
    legacyIndustry: "TECH",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "HYBRID",
  });
  assert.equal(productManager.normalizedRoleCategory, "PRODUCT_MANAGEMENT");
});

test("uncertain jobs stay searchable without becoming confident filter matches", () => {
  const metadata = classifyJobMetadata({
    title: "Associate",
    company: "Example",
    description: "Support cross-functional business initiatives.",
    roleFamily: "Unknown",
    legacyIndustry: "GENERAL",
    inferredEmploymentType: "UNKNOWN",
    sourceEmploymentType: null,
    workMode: "UNKNOWN",
  });

  assert.equal(metadata.normalizedRoleCategory, "OTHER_UNKNOWN");
  assert.equal(metadata.confidence.roleCategory < 0.75, true);
  assert.equal(metadata.classificationStatus, "PARTIAL");
});

test("new global role categories classify non-software jobs separately", () => {
  const mechanical = classifyJobMetadata({
    title: "Mechanical Engineer",
    company: "Example Manufacturing",
    description: "Design mechanical systems for industrial equipment.",
    roleFamily: "Engineering",
    legacyIndustry: "GENERAL",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "ONSITE",
  });
  assert.equal(mechanical.normalizedRoleCategory, "ENGINEERING_HARDWARE");

  const nurse = classifyJobMetadata({
    title: "Registered Nurse",
    company: "Example Hospital",
    description: "Provide clinical care to patients.",
    roleFamily: "Unknown",
    legacyIndustry: "GENERAL",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "ONSITE",
  });
  assert.equal(nurse.normalizedRoleCategory, "HEALTHCARE_CLINICAL");

  const teacher = classifyJobMetadata({
    title: "High School Teacher",
    company: "Example School",
    description: "Teach students and prepare curriculum.",
    roleFamily: "Unknown",
    legacyIndustry: "GENERAL",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "ONSITE",
  });
  assert.equal(teacher.normalizedRoleCategory, "EDUCATION_TEACHING");
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
  assert.equal(normalizeIndustryFilterValue("TECH,Finance & Banking"), "TECHNOLOGY,FINANCIAL_SERVICES");
  assert.equal(
    normalizeRoleCategoryFilterValue("SWE,Software Engineering,Data Analytics"),
    "SOFTWARE_ENGINEERING,DATA_ANALYTICS"
  );
  assert.equal(
    normalizeRoleCategoryFilterValue("Business Development,Supply Chain Logistics,Manufacturing Trades"),
    "SALES,OPERATIONS,SKILLED_TRADES_FACILITIES"
  );
  assert.equal(
    normalizeRoleCategoryFilterValue("Healthcare Administration,Education Administration"),
    "HEALTHCARE_CLINICAL,EDUCATION_TEACHING"
  );
});

test("new job function taxonomy separates retail service and media communications", () => {
  const retail = classifyJobMetadata({
    title: "Retail Associate",
    company: "Example Store",
    description: "Help customers and maintain store operations.",
    roleFamily: "Unknown",
    legacyIndustry: "GENERAL",
    inferredEmploymentType: "PART_TIME",
    sourceEmploymentType: null,
    workMode: "ONSITE",
  });
  assert.equal(retail.normalizedRoleCategory, "RETAIL_SERVICE");

  const communications = classifyJobMetadata({
    title: "Communications Manager",
    company: "Example Media",
    description: "Lead editorial communications and public relations.",
    roleFamily: "Communications",
    legacyIndustry: "GENERAL",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "HYBRID",
  });
  assert.equal(communications.normalizedRoleCategory, "MEDIA_CONTENT_COMMUNICATIONS");
});

test("generic legacy role families do not block stronger title evidence", () => {
  const machineOperator = classifyJobMetadata({
    title: "Machine Operator - Third Shift",
    company: "Lincoln Electric",
    description: "Operate production equipment and support plant operations.",
    roleFamily: "General Professional",
    legacyIndustry: "GENERAL",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "ONSITE",
  });
  assert.equal(machineOperator.normalizedRoleCategory, "SKILLED_TRADES_FACILITIES");

  const developerIntern = classifyJobMetadata({
    title: "Developer Internship",
    company: "Example",
    description: "Internship role building web applications with engineers.",
    roleFamily: "Internship",
    legacyIndustry: "TECH",
    inferredEmploymentType: "INTERNSHIP",
    sourceEmploymentType: null,
    workMode: "HYBRID",
  });
  assert.equal(developerIntern.normalizedRoleCategory, "SOFTWARE_ENGINEERING");
  assert.equal(developerIntern.normalizedCareerStage, "INTERNSHIP_COOP_STUDENT");

  const supportAgent = classifyJobMetadata({
    title: "Customer Service Agent",
    company: "Example",
    description: "Support customers and resolve service requests.",
    roleFamily: "General Professional",
    legacyIndustry: "GENERAL",
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "REMOTE",
  });
  assert.equal(supportAgent.normalizedRoleCategory, "CUSTOMER_SUCCESS_SUPPORT");
});
