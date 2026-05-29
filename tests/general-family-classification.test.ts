/**
 * Tests for the per-family GENERAL classifier.
 *
 * The product is expanding from TECH/FINANCE only to all white-collar
 * (Industry: GENERAL) coverage. This means our new Jooble per-family shards
 * (marketing-na, sales-na, hr-na, legal-na, ops-admin-na, supply-chain-na,
 * consulting-na, communications-na, customer-success-na, biz-dev-na) need
 * to produce jobs that the normalizer classifies into the right roleFamily
 * with industry=GENERAL.
 *
 * If any of these regress (e.g. a future title pattern unintentionally
 * captures a marketing/sales role into TECH), the supply we worked hard to
 * grow will silently drop out of the GENERAL pool. This test pins the
 * routing.
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
  const cases: Array<{ title: string; industry: string; family: string }> = [
    // Marketing
    { title: "Marketing Manager", industry: "GENERAL", family: "Marketing" },
    { title: "Brand Manager", industry: "GENERAL", family: "Marketing" },
    { title: "Growth Marketing Lead", industry: "GENERAL", family: "Marketing" },
    { title: "Demand Generation Specialist", industry: "GENERAL", family: "Marketing" },
    { title: "Content Strategist", industry: "GENERAL", family: "Marketing" },
    // Sales
    { title: "Account Executive", industry: "GENERAL", family: "Sales" },
    { title: "Sales Development Representative", industry: "GENERAL", family: "Sales" },
    { title: "Inside Sales Manager", industry: "GENERAL", family: "Sales" },
    { title: "Enterprise Sales Director", industry: "GENERAL", family: "Sales" },
    // HR
    { title: "HR Business Partner", industry: "GENERAL", family: "HR / People" },
    { title: "People Operations Manager", industry: "GENERAL", family: "HR / People" },
    { title: "Talent Acquisition Lead", industry: "GENERAL", family: "HR / People" },
    { title: "Compensation Analyst", industry: "GENERAL", family: "HR / People" },
    // Legal
    { title: "Corporate Counsel", industry: "GENERAL", family: "Legal" },
    { title: "Paralegal", industry: "GENERAL", family: "Legal" },
    { title: "Contracts Manager", industry: "GENERAL", family: "Legal" },
    // Consulting
    { title: "Management Consultant", industry: "GENERAL", family: "Consulting" },
    { title: "Strategy Consultant", industry: "GENERAL", family: "Consulting" },
    { title: "Engagement Manager", industry: "GENERAL", family: "Consulting" },
    // Supply Chain
    { title: "Supply Chain Analyst", industry: "GENERAL", family: "Supply Chain" },
    { title: "Procurement Manager", industry: "GENERAL", family: "Supply Chain" },
    { title: "Logistics Analyst", industry: "GENERAL", family: "Supply Chain" },
    // Communications
    { title: "Communications Manager", industry: "GENERAL", family: "Communications" },
    { title: "Investor Relations Director", industry: "GENERAL", family: "Communications" },
    // Business Development
    { title: "Business Development Manager", industry: "GENERAL", family: "Business Development" },
    { title: "Strategic Partnerships Lead", industry: "GENERAL", family: "Business Development" },
    // HR shorthand + payroll (newly added)
    { title: "Senior HRBP", industry: "GENERAL", family: "HR / People" },
    { title: "Payroll Manager", industry: "GENERAL", family: "HR / People" },
    { title: "Payroll Specialist", industry: "GENERAL", family: "HR / People" },
    // Sales variants (newly added)
    { title: "Sales Advisor", industry: "GENERAL", family: "Sales" },
    { title: "Membership Sales Advisor", industry: "GENERAL", family: "Sales" },
    { title: "Account Manager", industry: "GENERAL", family: "Sales" },
    // Insurance (new family)
    { title: "Senior Underwriter", industry: "GENERAL", family: "Insurance" },
    { title: "Claims Adjuster", industry: "GENERAL", family: "Insurance" },
    { title: "Insurance Broker", industry: "GENERAL", family: "Insurance" },
    { title: "General Liability Claim Rep", industry: "GENERAL", family: "Insurance" },
    // Healthcare Admin (new family). "Practice Manager" alone is too
    // ambiguous (medical vs consulting) and "Medical Office Manager"
    // collides with the broader Administrative pattern's "office manager"
    // — using more specific titles that only one family can match.
    { title: "Hospital Administrator", industry: "GENERAL", family: "Healthcare Admin" },
    { title: "Medical Biller", industry: "GENERAL", family: "Healthcare Admin" },
    { title: "Medical Coding Specialist", industry: "GENERAL", family: "Healthcare Admin" },
    { title: "Revenue Cycle Analyst", industry: "GENERAL", family: "Healthcare Admin" },
    // Real Estate (new family)
    { title: "Real Estate Analyst", industry: "GENERAL", family: "Real Estate" },
    { title: "Leasing Manager", industry: "GENERAL", family: "Real Estate" },
    { title: "Property Manager", industry: "GENERAL", family: "Real Estate" },
    // Hospitality Mgmt (new family)
    { title: "Hotel Manager", industry: "GENERAL", family: "Hospitality Management" },
    { title: "Events Manager", industry: "GENERAL", family: "Hospitality Management" },
    // Government (new family)
    { title: "Policy Analyst", industry: "GENERAL", family: "Government" },
    { title: "Program Officer", industry: "GENERAL", family: "Government" },
    { title: "Legislative Analyst", industry: "GENERAL", family: "Government" },
    // Editorial (new family)
    { title: "Managing Editor", industry: "GENERAL", family: "Editorial" },
    { title: "Senior Copy Editor", industry: "GENERAL", family: "Editorial" },
    { title: "Video Producer", industry: "GENERAL", family: "Editorial" },
    // Education Admin (new family)
    { title: "University Registrar", industry: "GENERAL", family: "Education Admin" },
    { title: "Admissions Counselor", industry: "GENERAL", family: "Education Admin" },
    { title: "Academic Advisor", industry: "GENERAL", family: "Education Admin" },
    // FINANCE/Accounting expansion
    { title: "Tax Preparer", industry: "FINANCE", family: "Accounting" },
    { title: "Bookkeeping Manager", industry: "FINANCE", family: "Accounting" },
    // TECH/Engineering (non-software) — newly added family for the
    // 12-priority "Engineering" expansion.
    { title: "Mechanical Engineer", industry: "TECH", family: "Engineering" },
    { title: "Civil Engineer", industry: "TECH", family: "Engineering" },
    { title: "Electrical Engineer", industry: "TECH", family: "Engineering" },
    { title: "Chemical Engineer", industry: "TECH", family: "Engineering" },
    { title: "Biomedical Engineer", industry: "TECH", family: "Engineering" },
    { title: "Aerospace Engineer", industry: "TECH", family: "Engineering" },
    { title: "Manufacturing Engineer", industry: "TECH", family: "Engineering" },
    { title: "Industrial Engineer", industry: "TECH", family: "Engineering" },
    { title: "Environmental Engineer", industry: "TECH", family: "Engineering" },
    // HR deep
    { title: "Technical Recruiter", industry: "GENERAL", family: "HR / People" },
    // Accounting deep
    { title: "Forensic Accountant", industry: "FINANCE", family: "Accounting" },
    { title: "AP Specialist", industry: "FINANCE", family: "Accounting" },
  ];

  for (const { title, industry, family } of cases) {
    it(`routes "${title}" → ${industry} / ${family}`, () => {
      const profile = inferRoleProfile(title);
      strictEqual(
        profile?.industry,
        industry,
        `expected industry=${industry} for "${title}", got ${profile?.industry ?? "null"}`
      );
      strictEqual(
        profile?.roleFamily,
        family,
        `expected roleFamily=${family} for "${title}", got ${profile?.roleFamily ?? "null"}`
      );
    });
  }

  it("still routes a clear TECH title to TECH", () => {
    const profile = inferRoleProfile("Senior Software Engineer");
    strictEqual(profile?.industry, "TECH");
  });

  it("still routes a clear FINANCE title to FINANCE", () => {
    const profile = inferRoleProfile("Financial Analyst");
    strictEqual(profile?.industry, "FINANCE");
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
  // / trades that don't fit the auto-apply UX.
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
