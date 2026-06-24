import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildNaturalLanguageJobsHref,
  parseNaturalLanguageJobSearch,
} from "../src/lib/jobs/natural-language-search";

function paramsFor(text: string) {
  return parseNaturalLanguageJobSearch(text).params;
}

describe("parseNaturalLanguageJobSearch", () => {
  it("maps a realistic analyst request into strict filters and soft preferences", () => {
    const result = parseNaturalLanguageJobSearch(
      "I'm looking for entry-level data analyst roles in Toronto or remote, preferably in finance or healthcare, and I don't want senior roles."
    );

    assert.equal(result.params.jobFunction, "DATA_ANALYTICS");
    assert.equal(result.params.careerStage, "ENTRY_JUNIOR");
    assert.equal(result.params.locationSearch, "Toronto");
    assert.equal(result.params.workMode, "REMOTE");
    assert.equal(result.params.titleSearch, "data analyst");
    assert.equal(result.params.industry, undefined);
    assert.deepEqual(result.softPreferences.map((entry) => entry.value), [
      "FINANCIAL_SERVICES",
      "HEALTHCARE_LIFE_SCIENCES",
    ]);
    assert.ok(result.exclusions.some((entry) => entry.value === "SENIOR_LEAD_STAFF"));
  });

  it("supports OR values inside one strict filter section", () => {
    const params = paramsFor(
      "Find software engineering or AI machine learning internships in Vancouver or Calgary, remote or hybrid, posted this week."
    );

    assert.equal(params.jobFunction, "SOFTWARE_ENGINEERING,AI_MACHINE_LEARNING");
    assert.equal(params.careerStage, "STUDENT_INTERN");
    assert.equal(params.employmentType, "INTERNSHIP_COOP");
    assert.equal(params.locationSearch, "Vancouver,Calgary");
    assert.equal(params.workMode, "REMOTE,HYBRID");
    assert.equal(params.posted, "7d");
  });

  it("keeps company industry separate from job function", () => {
    const result = parseNaturalLanguageJobSearch(
      "I want software engineer jobs at banks or financial services companies in New York."
    );

    assert.equal(result.params.jobFunction, "SOFTWARE_ENGINEERING");
    assert.equal(result.params.industry, "FINANCIAL_SERVICES");
    assert.equal(result.params.locationSearch, "New York");
    assert.notEqual(result.params.jobFunction, "FINANCE_ACCOUNTING");
  });

  it("does not turn negated role phrases into target filters", () => {
    const result = parseNaturalLanguageJobSearch(
      "Software engineer jobs at banks in Toronto, not finance analyst roles."
    );

    assert.equal(result.params.jobFunction, "SOFTWARE_ENGINEERING");
    assert.equal(result.params.industry, "FINANCIAL_SERVICES");
    assert.equal(result.params.locationSearch, "Toronto");
    assert.equal(result.params.titleSearch, undefined);
    assert.ok(result.exclusions.some((entry) => entry.value === "FINANCE_ACCOUNTING"));
  });

  it("does not treat general flexibility as a work-mode filter", () => {
    const result = parseNaturalLanguageJobSearch(
      "I want something with Python and SQL, ideally healthcare, but I am flexible."
    );

    assert.equal(result.params.workMode, undefined);
    assert.equal(result.params.industry, undefined);
    assert.ok(result.softPreferences.some((entry) => entry.value === "HEALTHCARE_LIFE_SCIENCES"));
  });

  it("parses salary ranges and currency without inventing missing bounds", () => {
    assert.deepEqual(
      pickSalary(paramsFor("Remote product manager roles in Canada paying CAD 90k to 150k")),
      { salaryCurrency: "CAD", salaryMax: "150000", salaryMin: "90000" }
    );
    assert.deepEqual(
      pickSalary(paramsFor("Marketing roles above $80,000")),
      { salaryCurrency: undefined, salaryMax: undefined, salaryMin: "80000" }
    );
  });

  it("does not apply ambiguous soft preferences as hard filters", () => {
    const result = parseNaturalLanguageJobSearch(
      "Something around analytics, ideally healthcare, maybe remote, no manager jobs."
    );

    assert.equal(result.params.industry, undefined);
    assert.ok(result.softPreferences.some((entry) => entry.value === "HEALTHCARE_LIFE_SCIENCES"));
    assert.ok(result.exclusions.some((entry) => entry.value === "MANAGER_DIRECTOR_EXECUTIVE"));
    assert.ok(result.warnings.length > 0);
  });

  it("builds a stable jobs href and omits empty params", () => {
    assert.equal(
      buildNaturalLanguageJobsHref(
        parseNaturalLanguageJobSearch("new grad finance analyst jobs in Toronto newest")
      ),
      "/jobs?searchScope=title&titleSearch=finance+analyst&jobFunction=FINANCE_ACCOUNTING&careerStage=ENTRY_JUNIOR&locationSearch=Toronto&sortBy=newest"
    );
  });
});

function pickSalary(params: Record<string, string | undefined>) {
  return {
    salaryCurrency: params.salaryCurrency,
    salaryMax: params.salaryMax,
    salaryMin: params.salaryMin,
  };
}
