/**
 * Tests for the per-family GENERAL classifier.
 *
 * The product is expanding from tech/finance only to all white-collar
 * role-family coverage. This means our new Jooble per-family shards
 * (marketing-na, sales-na, hr-na, legal-na, ops-admin-na, supply-chain-na,
 * consulting-na, communications-na, customer-success-na, biz-dev-na) need
 * to produce jobs that the normalizer classifies into the right roleFamily.
 *
 * If any of these regress (e.g. a future title pattern unintentionally
 * captures a marketing/sales role into a technical family), the supply we
 * worked hard to grow will silently drop out of the right pool. This test
 * pins the routing.
 */
import { describe, it } from "node:test";
import { strictEqual } from "node:assert";
import { createRequire } from "node:module";

process.env.DATABASE_URL ??= "postgresql://unit:test@localhost:5432/unit";

const require = createRequire(import.meta.url);
const { EXCLUDED_TITLE_PATTERNS, inferRoleProfile } = require(
  "../src/lib/ingestion/normalize"
) as typeof import("../src/lib/ingestion/normalize");

describe("inferRoleProfile — GENERAL family routing", () => {
  const cases: Array<{ title: string; family: string }> = [
    // Marketing
    { title: "Marketing Manager", family: "Marketing" },
    { title: "Brand Manager", family: "Marketing" },
    { title: "Growth Marketing Lead", family: "Marketing" },
    { title: "Demand Generation Specialist", family: "Marketing" },
    { title: "Content Strategist", family: "Marketing" },
    // Sales
    { title: "Account Executive", family: "Sales" },
    { title: "Sales Development Representative", family: "Sales" },
    { title: "Inside Sales Manager", family: "Sales" },
    { title: "Enterprise Sales Director", family: "Sales" },
    // HR
    { title: "HR Business Partner", family: "HR / People" },
    { title: "People Operations Manager", family: "HR / People" },
    { title: "Talent Acquisition Lead", family: "HR / People" },
    { title: "Compensation Analyst", family: "HR / People" },
    // Legal
    { title: "Corporate Counsel", family: "Legal" },
    { title: "Paralegal", family: "Legal" },
    { title: "Contracts Manager", family: "Legal" },
    // Consulting
    { title: "Management Consultant", family: "Consulting" },
    { title: "Strategy Consultant", family: "Consulting" },
    { title: "Engagement Manager", family: "Consulting" },
    // Supply Chain
    { title: "Supply Chain Analyst", family: "Supply Chain" },
    { title: "Procurement Manager", family: "Supply Chain" },
    { title: "Logistics Analyst", family: "Supply Chain" },
    // Communications
    { title: "Communications Manager", family: "Communications" },
    { title: "Investor Relations Director", family: "Communications" },
    // Business Development
    { title: "Business Development Manager", family: "Business Development" },
    { title: "Strategic Partnerships Lead", family: "Business Development" },
    // HR shorthand + payroll (newly added)
    { title: "Senior HRBP", family: "HR / People" },
    { title: "Payroll Manager", family: "HR / People" },
    { title: "Payroll Specialist", family: "HR / People" },
    // Sales variants (newly added)
    { title: "Sales Advisor", family: "Sales" },
    { title: "Membership Sales Advisor", family: "Sales" },
    { title: "Account Manager", family: "Sales" },
    // Insurance (new family)
    { title: "Senior Underwriter", family: "Insurance" },
    { title: "Claims Adjuster", family: "Insurance" },
    { title: "Insurance Broker", family: "Insurance" },
    { title: "General Liability Claim Rep", family: "Insurance" },
    // Healthcare Admin (new family). "Practice Manager" alone is too
    // ambiguous (medical vs consulting) and "Medical Office Manager"
    // collides with the broader Administrative pattern's "office manager"
    // — using more specific titles that only one family can match.
    { title: "Hospital Administrator", family: "Healthcare Admin" },
    { title: "Medical Biller", family: "Healthcare Admin" },
    { title: "Medical Coding Specialist", family: "Healthcare Admin" },
    { title: "Revenue Cycle Analyst", family: "Healthcare Admin" },
    // Real Estate (new family)
    { title: "Real Estate Analyst", family: "Real Estate" },
    { title: "Leasing Manager", family: "Real Estate" },
    { title: "Property Manager", family: "Real Estate" },
    // Hospitality Mgmt (new family)
    { title: "Hotel Manager", family: "Hospitality Management" },
    { title: "Events Manager", family: "Hospitality Management" },
    // Government (new family)
    { title: "Policy Analyst", family: "Government" },
    { title: "Program Officer", family: "Government" },
    { title: "Legislative Analyst", family: "Government" },
    // Editorial (new family)
    { title: "Managing Editor", family: "Editorial" },
    { title: "Senior Copy Editor", family: "Editorial" },
    { title: "Video Producer", family: "Editorial" },
    // Education Admin (new family)
    { title: "University Registrar", family: "Education Admin" },
    { title: "Admissions Counselor", family: "Education Admin" },
    { title: "Academic Advisor", family: "Education Admin" },
    // FINANCE/Accounting expansion
    { title: "Tax Preparer", family: "Accounting" },
    { title: "Bookkeeping Manager", family: "Accounting" },
    // TECH/Engineering (non-software) — newly added family for the
    // 12-priority "Engineering" expansion.
    { title: "Mechanical Engineer", family: "Engineering" },
    { title: "Civil Engineer", family: "Engineering" },
    { title: "Electrical Engineer", family: "Engineering" },
    { title: "Chemical Engineer", family: "Engineering" },
    { title: "Biomedical Engineer", family: "Engineering" },
    { title: "Aerospace Engineer", family: "Engineering" },
    { title: "Manufacturing Engineer", family: "Engineering" },
    { title: "Industrial Engineer", family: "Engineering" },
    { title: "Environmental Engineer", family: "Engineering" },
    // HR deep
    { title: "Technical Recruiter", family: "HR / People" },
    // Accounting deep
    { title: "Forensic Accountant", family: "Accounting" },
    { title: "AP Specialist", family: "Accounting" },
  ];

  for (const { title, family } of cases) {
    it(`routes "${title}" → ${family}`, () => {
      const profile = inferRoleProfile(title);
      strictEqual(
        profile?.roleFamily,
        family,
        `expected roleFamily=${family} for "${title}", got ${profile?.roleFamily ?? "null"}`
      );
    });
  }

  it("still routes a clear software title to SWE", () => {
    const profile = inferRoleProfile("Senior Software Engineer");
    strictEqual(profile?.roleFamily, "SWE");
  });

  it("still routes a clear finance title to Financial Analyst", () => {
    const profile = inferRoleProfile("Financial Analyst");
    strictEqual(profile?.roleFamily, "Financial Analyst");
  });
});

describe("EXCLUDED_TITLE_PATTERNS — admin-flavored education roles are NOT excluded", () => {
  function isExcluded(title: string): boolean {
    return EXCLUDED_TITLE_PATTERNS.some((pattern) => pattern.test(title));
  }

  // These are legitimate white-collar admin roles we want to ingest. The
  // pre-existing `dean\b` exclusion was over-broad and accidentally killed
  // them. Locked-in tests to prevent regressions.
  const allowed = [
    "Associate Dean of Operations",
    "Assistant Dean of Career Services",
    "Dean of Student Affairs",
    "Associate Dean of Administration",
    "Dean of Admissions",
    "Dean of Enrollment Management",
    "Registrar",
    "Director of Admissions",
    "Financial Aid Administrator",
    "Academic Program Manager",
    "Institutional Research Analyst",
  ];

  for (const title of allowed) {
    it(`allows "${title}"`, () => {
      strictEqual(isExcluded(title), false, `expected not excluded, got excluded`);
    });
  }

  // These should still be excluded — they're clinical / classroom-teaching
  // / trades that don't fit the office/knowledge-worker job board.
  const denied = [
    "Registered Nurse",
    "Nurse Practitioner",
    "Pharmacist",
    "Elementary School Teacher",
    "Adjunct Professor of Biology",
    "Math Lecturer",
    "Provost",
    "Truck Driver",
    "Plumber",
    "Barista",
  ];

  for (const title of denied) {
    it(`still excludes "${title}"`, () => {
      strictEqual(isExcluded(title), true, `expected excluded, got allowed`);
    });
  }
});
