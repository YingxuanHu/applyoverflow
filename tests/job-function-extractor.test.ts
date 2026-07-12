import assert from "node:assert/strict";
import test from "node:test";

import { extractJobFunction } from "../src/lib/ingestion/extraction/job-function-extractor";
import { classifyJobMetadata } from "../src/lib/job-metadata";

function classify(title: string, description = "", roleFamily = "Unknown") {
  return extractJobFunction({
    normalizedTitle: title,
    rawTitle: title,
    description,
    roleFamily,
    company: "Example",
  });
}

test("warehouse and manual logistics roles are not classified as AI/ML", () => {
  const warehouse = classify(
    "Warehouse Worker",
    "OpenAI builds useful artificial intelligence systems. This role picks, packs, ships, receives, and manages warehouse inventory."
  );

  assert.equal(warehouse.category, "WAREHOUSE_DELIVERY_DRIVING");
  assert.notEqual(warehouse.category, "AI_MACHINE_LEARNING");
  assert.ok(warehouse.confidence >= 0.75);
});

test("generic drive and deliver wording does not create warehouse/delivery labels", () => {
  const engineeringManager = classify(
    "Engineering Manager, CDN",
    "Lead engineering teams, drive roadmap execution, and deliver reliable infrastructure for customers.",
    "SWE"
  );
  assert.equal(engineeringManager.category, "SOFTWARE_ENGINEERING");
  assert.notEqual(engineeringManager.category, "WAREHOUSE_DELIVERY_DRIVING");

  const auditManager = classify(
    "Internal Audit SOX Associate Manager",
    "Drive internal audit planning, deliver SOX controls testing, and partner with finance teams.",
    "Audit"
  );
  assert.notEqual(auditManager.category, "WAREHOUSE_DELIVERY_DRIVING");

  const deliveryDriver = classify(
    "Delivery Driver",
    "Complete route delivery, load packages, and operate a company vehicle."
  );
  assert.equal(deliveryDriver.category, "WAREHOUSE_DELIVERY_DRIVING");
});

test("AI training context does not override the professional function", () => {
  const audiologist = classify(
    "Licensed Audiologist - AI Training",
    "Review audiology cases and apply clinical judgment to improve AI training data."
  );
  assert.equal(audiologist.category, "HEALTHCARE_CLINICAL");
  assert.notEqual(audiologist.category, "AI_MACHINE_LEARNING");

  const attorney = classify(
    "Attorney - AI Training",
    "Review legal prompts and provide domain expertise for AI training."
  );
  assert.equal(attorney.category, "LEGAL_COMPLIANCE");
  assert.notEqual(attorney.category, "AI_MACHINE_LEARNING");

  const dataEntry = classify(
    "Data Entry Clerk for AI Training",
    "Enter and review structured data used by an AI training team."
  );
  assert.equal(dataEntry.category, "ADMINISTRATIVE");
  assert.notEqual(dataEntry.category, "AI_MACHINE_LEARNING");
  assert.notEqual(dataEntry.category, "DATA_ANALYTICS");
});

test("AI/ML requires actual model-building, research, or deployment evidence", () => {
  const mlEngineer = classify(
    "Machine Learning Engineer",
    "Build, train, deploy, and evaluate machine learning models using PyTorch."
  );
  assert.equal(mlEngineer.category, "AI_MACHINE_LEARNING");
  assert.ok(mlEngineer.confidence >= 0.85);

  const mlops = classify(
    "MLOps Engineer",
    "Deploy ML models, operate model serving, and monitor inference pipelines."
  );
  assert.equal(mlops.category, "AI_MACHINE_LEARNING");
});

test("software engineering is separated from developer-adjacent roles", () => {
  assert.equal(
    classify("Software Engineer", "Build backend services and write production code.").category,
    "SOFTWARE_ENGINEERING"
  );

  const advocate = classify(
    "Developer Advocate",
    "Create technical community content, write tutorials, and run developer programs."
  );
  assert.equal(advocate.category, "MARKETING");
  assert.notEqual(advocate.category, "SOFTWARE_ENGINEERING");

  assert.equal(
    classify("Business Development Representative", "Own outbound pipeline and sales outreach.").category,
    "SALES"
  );
});

test("data analytics avoids data-entry, data-center, and annotation false positives", () => {
  assert.equal(
    classify("Data Analyst", "Analyze data in SQL and build dashboards in Tableau.").category,
    "DATA_ANALYTICS"
  );
  assert.equal(
    classify("Data Entry Clerk", "Enter records and maintain office files.").category,
    "ADMINISTRATIVE"
  );
  assert.equal(
    classify("Data Center Technician", "Maintain racks, hardware, networks, and infrastructure.").category,
    "IT_SYSTEMS_DEVOPS"
  );
});

test("product, design, marketing, and production titles do not collapse into product management", () => {
  assert.equal(classify("Product Manager", "Own roadmap and prioritization.").category, "PRODUCT_MANAGEMENT");
  assert.equal(classify("Product Designer", "Design user interfaces and UX flows.").category, "DESIGN_UX");
  assert.equal(
    classify("Product Marketing Manager", "Lead positioning and go-to-market launches.").category,
    "MARKETING"
  );
  assert.equal(
    classify("Production Manager", "Manage plant operations and production schedules.").category,
    "OPERATIONS"
  );
});

test("security, finance, healthcare, education, engineering, sales, HR, admin, and trades examples classify cleanly", () => {
  assert.equal(classify("Security Engineer", "Own incident response and IAM systems.").category, "CYBERSECURITY");
  assert.equal(classify("Security Guard", "Patrol facilities and monitor physical access.").category, "SKILLED_TRADES_FACILITIES");
  assert.equal(classify("Account Executive", "Sell enterprise software to customers.").category, "SALES");
  assert.equal(classify("Accountant", "Own general ledger and month-end close.").category, "FINANCE_ACCOUNTING");
  assert.equal(classify("Financial Analyst", "Build forecasts and FP&A reports.").category, "FINANCE_ACCOUNTING");
  assert.equal(classify("Investment Banking Analyst", "Support M&A and capital markets deals.").category, "INVESTMENT_BANKING");
  assert.equal(classify("Legal Counsel", "Advise on contracts and regulatory matters.").category, "LEGAL_COMPLIANCE");
  assert.equal(classify("Registered Nurse", "Provide patient care in a clinical setting.").category, "HEALTHCARE_CLINICAL");
  assert.equal(classify("Teacher", "Teach students and prepare lesson plans.").category, "EDUCATION_TEACHING");
  assert.equal(classify("UX Researcher", "Conduct user research for digital products.").category, "DESIGN_UX");
  assert.equal(classify("Mechanical Engineer", "Design mechanical systems.").category, "ENGINEERING_HARDWARE");
  assert.equal(classify("Sales Engineer", "Lead pre-sales demos and customer discovery.").category, "SALES");
  assert.equal(classify("Technical Recruiter", "Recruit engineering candidates.").category, "HUMAN_RESOURCES_RECRUITING");
  assert.equal(classify("Executive Assistant", "Manage calendars and office administration.").category, "ADMINISTRATIVE");
  assert.equal(classify("Technical Writer", "Write product documentation and developer guides.").category, "MEDIA_CONTENT_COMMUNICATIONS");
  assert.equal(classify("Electrician", "Install and repair electrical systems.").category, "SKILLED_TRADES_FACILITIES");
  assert.equal(classify("Maintenance Technician", "Maintain facilities and repair equipment.").category, "SKILLED_TRADES_FACILITIES");
});

test("company industry is only a weak tie-breaker and never overrides title evidence", () => {
  const softwareAtBank = classifyJobMetadata({
    title: "Software Engineer",
    company: "RBC",
    description: "Build banking platform APIs and write production code.",
    roleFamily: "SWE",
    companyIndustries: ["FINANCIAL_SERVICES"],
    legacyIndustry: null,
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "HYBRID",
  });

  assert.equal(softwareAtBank.normalizedRoleCategory, "SOFTWARE_ENGINEERING");
  assert.notEqual(softwareAtBank.normalizedRoleCategory, "FINANCE_ACCOUNTING");

  const warehouseAtAiCompany = classifyJobMetadata({
    title: "Warehouse Associate",
    company: "AI Example",
    description: "Pick, pack, ship, receive, and manage inventory in a warehouse.",
    roleFamily: "AI Training",
    companyIndustries: ["TECHNOLOGY"],
    legacyIndustry: null,
    inferredEmploymentType: "FULL_TIME",
    sourceEmploymentType: null,
    workMode: "ONSITE",
  });

  assert.equal(warehouseAtAiCompany.normalizedRoleCategory, "WAREHOUSE_DELIVERY_DRIVING");
  assert.notEqual(warehouseAtAiCompany.normalizedRoleCategory, "AI_MACHINE_LEARNING");
  assert.ok(warehouseAtAiCompany.normalizedRoleCategoryWarnings.some((warning) => /AI training/i.test(warning)));
});
