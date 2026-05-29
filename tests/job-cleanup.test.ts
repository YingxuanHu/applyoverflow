import assert from "node:assert/strict";
import test from "node:test";

import {
  hasUnresolvedGenericCompanyName,
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
});
