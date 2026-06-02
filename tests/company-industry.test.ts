import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPANY_INDUSTRY_FILTER_CONFIDENCE_THRESHOLD,
  isFilterSafeCompanyIndustry,
  resolveCompanyIndustry,
} from "../src/lib/company-industry";

test("resolves company industry only from verified registry metadata", () => {
  const result = resolveCompanyIndustry({
    companyName: "Example Bank",
    metadataJson: {
      verifiedIndustryCodes: ["FINANCIAL_SERVICES"],
      primaryIndustryCode: "FINANCIAL_SERVICES",
    },
  });

  assert.equal(result.normalizedIndustry, "FINANCIAL_SERVICES");
  assert.deepEqual(result.normalizedIndustries, ["FINANCIAL_SERVICES"]);
  assert.equal(result.source, "company_verified_csv");
  assert.ok(result.confidence >= COMPANY_INDUSTRY_FILTER_CONFIDENCE_THRESHOLD);
  assert.equal(isFilterSafeCompanyIndustry(result), true);
});

test("supports multiple verified company industry labels", () => {
  const result = resolveCompanyIndustry({
    companyName: "Example Streaming AI",
    metadataJson: {
      verified_industry_codes_semicolon_separated:
        "MEDIA_ENTERTAINMENT;TECHNOLOGY",
      primary_industry_code: "MEDIA_ENTERTAINMENT",
    },
  });

  assert.equal(result.normalizedIndustry, "MEDIA_ENTERTAINMENT");
  assert.deepEqual(result.normalizedIndustries, [
    "MEDIA_ENTERTAINMENT",
    "TECHNOLOGY",
  ]);
  assert.equal(result.source, "company_verified_csv");
  assert.equal(isFilterSafeCompanyIndustry(result), true);
});

test("maps legacy labels only when they come from verified registry fields", () => {
  assert.equal(
    resolveCompanyIndustry({
      companyName: "Allstate",
      metadataJson: {
        verifiedIndustryCodes: "Insurance",
        primaryIndustryCode: "Insurance",
      },
    }).normalizedIndustry,
    "FINANCIAL_SERVICES"
  );
  assert.equal(
    resolveCompanyIndustry({
      companyName: "Tesla",
      metadataJson: {
        verifiedIndustryCodes: "Automotive",
        primaryIndustryCode: "Automotive",
      },
    }).normalizedIndustry,
    "MANUFACTURING_AUTOMOTIVE"
  );
  assert.equal(
    resolveCompanyIndustry({
      companyName: "Example Energy",
      metadataJson: {
        verifiedIndustryCodes: "Energy, Utilities & Natural Resources",
        primaryIndustryCode: "Energy, Utilities & Natural Resources",
      },
    }).normalizedIndustry,
    "ENERGY_UTILITIES_NATURAL_RESOURCES"
  );
  assert.equal(
    resolveCompanyIndustry({
      companyName: "Example Law",
      metadataJson: {
        verifiedIndustryCodes: "Legal Services",
        primaryIndustryCode: "Legal Services",
      },
    }).normalizedIndustry,
    "LEGAL_SERVICES"
  );
});

test("does not infer company industry from source metadata, sectors, domain, or name", () => {
  const sourceMetadata = resolveCompanyIndustry({
    companyName: "Example Bank",
    domain: "jpmorganchase.com",
    metadataJson: {
      companyIndustry: "Financial Services",
      industry: "banking",
      sectors: ["data", "ai", "cloud"],
      industries: ["technology"],
    },
  });

  assert.equal(sourceMetadata.normalizedIndustry, "UNKNOWN");
  assert.deepEqual(sourceMetadata.normalizedIndustries, []);
  assert.equal(sourceMetadata.source, "unknown_company_industry");
  assert.equal(isFilterSafeCompanyIndustry(sourceMetadata), false);

  const nameAlias = resolveCompanyIndustry({
    companyName: "LifeStance",
  });

  assert.equal(nameAlias.normalizedIndustry, "UNKNOWN");
  assert.deepEqual(nameAlias.normalizedIndustries, []);
  assert.equal(nameAlias.source, "unknown_company_industry");
});
