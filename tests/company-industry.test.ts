import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPANY_INDUSTRY_FILTER_CONFIDENCE_THRESHOLD,
  isFilterSafeCompanyIndustry,
  resolveCompanyIndustry,
} from "../src/lib/company-industry";

test("resolves company industry from explicit company profile metadata", () => {
  const result = resolveCompanyIndustry({
    companyName: "Example Bank",
    metadataJson: {
      companyIndustry: "Financial Services",
    },
  });

  assert.equal(result.normalizedIndustry, "FINANCIAL_SERVICES");
  assert.equal(result.source, "company_profile");
  assert.ok(result.confidence >= COMPANY_INDUSTRY_FILTER_CONFIDENCE_THRESHOLD);
  assert.equal(isFilterSafeCompanyIndustry(result), true);
});

test("resolves company industry from company sector metadata", () => {
  const result = resolveCompanyIndustry({
    companyName: "Databricks",
    metadataJson: {
      sectors: ["data", "ai", "cloud"],
    },
  });

  assert.equal(result.normalizedIndustry, "TECHNOLOGY");
  assert.equal(result.source, "company_sector_metadata");
  assert.ok(result.confidence >= COMPANY_INDUSTRY_FILTER_CONFIDENCE_THRESHOLD);
});

test("ignores ATS vendor strings as company industry", () => {
  const result = resolveCompanyIndustry({
    companyName: "LifeStance",
    metadataJson: {
      industry: "lever",
    },
  });

  assert.equal(result.normalizedIndustry, "HEALTHCARE_LIFE_SCIENCES");
  assert.equal(result.source, "company_name_alias");
  assert.ok(result.confidence >= COMPANY_INDUSTRY_FILTER_CONFIDENCE_THRESHOLD);
});

test("maps legacy and merged industry labels to the current taxonomy", () => {
  assert.equal(
    resolveCompanyIndustry({
      companyName: "Allstate",
      metadataJson: { companyIndustry: "Insurance" },
    }).normalizedIndustry,
    "FINANCIAL_SERVICES"
  );
  assert.equal(
    resolveCompanyIndustry({
      companyName: "Tesla",
      metadataJson: { companyIndustry: "Automotive" },
    }).normalizedIndustry,
    "MANUFACTURING_AUTOMOTIVE"
  );
  assert.equal(
    resolveCompanyIndustry({
      companyName: "Example Energy",
      metadataJson: { companyIndustry: "Energy, Utilities & Natural Resources" },
    }).normalizedIndustry,
    "ENERGY_UTILITIES_NATURAL_RESOURCES"
  );
  assert.equal(
    resolveCompanyIndustry({
      companyName: "Example Law",
      metadataJson: { companyIndustry: "Legal Services" },
    }).normalizedIndustry,
    "LEGAL_SERVICES"
  );
});

test("does not guess on ambiguous multi-industry sector metadata", () => {
  const result = resolveCompanyIndustry({
    companyName: "Example Hybrid Company",
    metadataJson: {
      sectors: ["software", "banking"],
    },
  });

  assert.equal(result.normalizedIndustry, "UNKNOWN");
  assert.equal(result.source, "ambiguous_company_metadata");
  assert.equal(isFilterSafeCompanyIndustry(result), false);
});
