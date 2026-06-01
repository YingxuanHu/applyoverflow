import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveJobTitleFromUrls,
  hasUnresolvedGenericCompanyName,
  sanitizeCompanyName,
  selectBestJobTitle,
  sanitizeJobTitle,
} from "../src/lib/job-cleanup";

test("does not collapse role titles to location suffixes", () => {
  assert.equal(
    sanitizeJobTitle("Territory Sales Representative - Montreal"),
    "Territory Sales Representative"
  );
  assert.equal(
    sanitizeJobTitle(
      "Adjoint ou adjointe, Expansion des affaires, Investly - Montréal / Investly Business Development Associate - Montreal"
    ),
    "Investly Business Development Associate"
  );
  assert.equal(
    sanitizeJobTitle("Éclairagiste d’expérience - Experienced Lighter - Montreal"),
    "Experienced Lighter"
  );
  assert.equal(
    sanitizeJobTitle("AI Trainer - Graphical Abstract - Physics (Remote - Toronto)"),
    "AI Trainer - Graphical Abstract - Physics"
  );
});

test("keeps meaningful role qualifiers while stripping location suffixes", () => {
  assert.equal(
    sanitizeJobTitle("Indie Game Developer - AI Trainer"),
    "Indie Game Developer - AI Trainer"
  );
  assert.equal(sanitizeJobTitle("AI Tutor - Hungarian"), "AI Tutor - Hungarian");
  assert.equal(
    sanitizeJobTitle("Senior Software Engineer - Remote"),
    "Senior Software Engineer"
  );
});

test("treats generic Workable /j apply URLs as unresolved company names", () => {
  assert.equal(
    hasUnresolvedGenericCompanyName(
      "J",
      "https://apply.workable.com/j/34DBD431A1/apply"
    ),
    true
  );
  assert.equal(
    hasUnresolvedGenericCompanyName(
      "Mondia Group",
      "https://apply.workable.com/j/34DBD431A1/apply"
    ),
    false
  );
});

test("treats generic ATS and public-board host slugs as unresolved company names", () => {
  assert.equal(
    hasUnresolvedGenericCompanyName(
      "Oraclecloud",
      "https://fa-tenant.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/requisitions/job/33871"
    ),
    true
  );
  assert.equal(
    hasUnresolvedGenericCompanyName(
      "GC",
      "https://www.jobbank.gc.ca/jobsearch/jobposting/49523704"
    ),
    true
  );
  assert.equal(
    hasUnresolvedGenericCompanyName(
      "Taleo",
      "https://unitedhealthgroup.taleo.net/careersection/10780/jobdetail.ftl"
    ),
    true
  );
  assert.equal(
    hasUnresolvedGenericCompanyName(
      "Paylocity",
      "https://recruiting.paylocity.com/recruiting/jobs/Details/12345"
    ),
    true
  );
  assert.equal(
    hasUnresolvedGenericCompanyName(
      "Teamtailor",
      "https://synthesized.teamtailor.com/jobs/7634610-account-executive-apac"
    ),
    true
  );
});

test("derives concrete job titles from official job URL slugs", () => {
  assert.equal(
    deriveJobTitleFromUrls([
      "https://careers.vistra.com/job/International-Payroll-Associate/16414-en_US/",
    ]),
    "International Payroll Associate"
  );
  assert.equal(
    deriveJobTitleFromUrls([
      "https://www.amazon.jobs/en/jobs/123456/software-development-engineer",
    ]),
    "Software Development Engineer"
  );
  assert.equal(
    deriveJobTitleFromUrls([
      "https://wattswater.wd5.myworkdayjobs.com/external/job/St-Neots-UK/Regional-IT-Leader---Europe_10016646",
    ]),
    "Regional IT Leader Europe"
  );
  assert.equal(
    deriveJobTitleFromUrls([
      "https://workday.wd5.myworkdayjobs.com/workday/job/Australia-NSW-North-Sydney/Principal-People-Business-Partner---APAC_JR-0107391",
    ]),
    "Principal People Business Partner APAC"
  );
});

test("does not derive UUID chunks as job titles", () => {
  assert.equal(
    deriveJobTitleFromUrls([
      "https://jobs.ashbyhq.com/morpho/6cbdcef7-fa15-4fcd-a40a-d0d6b6de9c53",
    ]),
    null
  );
  assert.equal(
    deriveJobTitleFromUrls([
      "https://jobs.lever.co/autofi/abaf60d3-8e41-4d4e-ab0c-f571f4dcf8c9/apply",
    ]),
    null
  );
  assert.equal(
    deriveJobTitleFromUrls(["https://workhands.com/states/district-of-columbia/openings"]),
    null
  );
  assert.equal(
    deriveJobTitleFromUrls([
      "https://workhands.com/organizations/independent-electrical-contractor-inc/apprenticeships/electrician-82625817-9d76-459b-aa12-99752c10b1b5",
    ]),
    "Electrician"
  );
  assert.equal(
    deriveJobTitleFromUrls([
      "https://workhands.com/organizations/e-l-ironworks/openings/welding-and-fabrication-f5bd41b0-1750-44ad-94ad-28869b885306",
    ]),
    "Welding and Fabrication"
  );
});

test("uses URL title when source title collapsed to company name", () => {
  assert.equal(
    selectBestJobTitle("Vistra", {
      company: "Vistra",
      urls: ["https://careers.vistra.com/job/German-Payroll-Administrator/16321-en_US/"],
    }),
    "German Payroll Administrator"
  );
});

test("derives tenant company from Teamtailor domains", () => {
  assert.equal(
    sanitizeCompanyName("Teamtailor", {
      urls: ["https://synthesized.teamtailor.com/jobs/7634610-account-executive-apac"],
    }),
    "Synthesized"
  );
});
