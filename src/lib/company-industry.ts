import type { Prisma } from "@/generated/prisma/client";
import type { NormalizedIndustry } from "@/lib/job-metadata";

export const COMPANY_INDUSTRY_FILTER_CONFIDENCE_THRESHOLD = 0.9;

export type CompanyIndustryResolutionSource =
  | "company_verified_csv"
  | "unknown_company_industry";

export type CompanyIndustryResolution = {
  normalizedIndustry: NormalizedIndustry;
  normalizedIndustries: NormalizedIndustry[];
  confidence: number;
  source: CompanyIndustryResolutionSource;
  signals: string[];
};

type CompanyIndustryInput = {
  companyName?: string | null;
  domain?: string | null;
  metadataJson?: Prisma.JsonValue | Record<string, unknown> | null;
};

const UNKNOWN_COMPANY_INDUSTRY: CompanyIndustryResolution = {
  normalizedIndustry: "UNKNOWN",
  normalizedIndustries: [],
  confidence: 0.2,
  source: "unknown_company_industry",
  signals: ["unknown_company_industry"],
};

const VERIFIED_INDUSTRY_KEYS = [
  "verifiedIndustryCodes",
  "verifiedIndustries",
  "verified_industry_codes_semicolon_separated",
  "companyIndustryRegistryCodes",
];

const VERIFIED_PRIMARY_INDUSTRY_KEYS = [
  "primaryIndustryCode",
  "primary_industry_code",
  "verifiedPrimaryIndustryCode",
  "companyIndustryRegistryPrimaryCode",
];

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value: string | null | undefined) {
  return normalizeText(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function asRecord(value: Prisma.JsonValue | Record<string, unknown> | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function splitIndustryText(value: string | null | undefined) {
  if (!value) return [];
  return value
    .split(/[;|]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readIndustryValues(value: unknown) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      typeof entry === "string" ? splitIndustryText(entry) : []
    );
  }
  if (typeof value === "string") return splitIndustryText(value);
  return [];
}

function normalizeIndustryValue(value: string | null | undefined): NormalizedIndustry | null {
  if (!value) return null;
  const key = normalizeKey(value);
  const normalizedKey = key.replace(/\s+/g, "_");
  const direct: Record<string, NormalizedIndustry> = {
    TECHNOLOGY: "TECHNOLOGY",
    TECH: "TECHNOLOGY",
    FINANCE: "FINANCIAL_SERVICES",
    FINANCE_BANKING: "FINANCIAL_SERVICES",
    FINANCIAL_SERVICES: "FINANCIAL_SERVICES",
    FINANCE_AND_BANKING: "FINANCIAL_SERVICES",
    INSURANCE: "FINANCIAL_SERVICES",
    HEALTHCARE: "HEALTHCARE_LIFE_SCIENCES",
    HEALTHCARE_AND_LIFE_SCIENCES: "HEALTHCARE_LIFE_SCIENCES",
    HEALTHCARE_LIFE_SCIENCES: "HEALTHCARE_LIFE_SCIENCES",
    CONSULTING: "CONSULTING_PROFESSIONAL_SERVICES",
    CONSULTING_AND_PROFESSIONAL_SERVICES: "CONSULTING_PROFESSIONAL_SERVICES",
    CONSULTING_PROFESSIONAL_SERVICES: "CONSULTING_PROFESSIONAL_SERVICES",
    EDUCATION: "EDUCATION",
    RETAIL: "RETAIL_CONSUMER_GOODS",
    RETAIL_AND_CONSUMER_GOODS: "RETAIL_CONSUMER_GOODS",
    RETAIL_CONSUMER_GOODS: "RETAIL_CONSUMER_GOODS",
    MANUFACTURING: "MANUFACTURING_AUTOMOTIVE",
    MANUFACTURING_INDUSTRIAL: "MANUFACTURING_AUTOMOTIVE",
    MANUFACTURING_AND_INDUSTRIAL: "MANUFACTURING_AUTOMOTIVE",
    AUTOMOTIVE: "MANUFACTURING_AUTOMOTIVE",
    MANUFACTURING_AND_AUTOMOTIVE: "MANUFACTURING_AUTOMOTIVE",
    MANUFACTURING_AUTOMOTIVE: "MANUFACTURING_AUTOMOTIVE",
    ENERGY: "ENERGY_UTILITIES_NATURAL_RESOURCES",
    ENERGY_UTILITIES: "ENERGY_UTILITIES_NATURAL_RESOURCES",
    ENERGY_AND_UTILITIES: "ENERGY_UTILITIES_NATURAL_RESOURCES",
    ENERGY_UTILITIES_AND_NATURAL_RESOURCES: "ENERGY_UTILITIES_NATURAL_RESOURCES",
    ENERGY_UTILITIES_NATURAL_RESOURCES: "ENERGY_UTILITIES_NATURAL_RESOURCES",
    AGRICULTURE_NATURAL_RESOURCES: "ENERGY_UTILITIES_NATURAL_RESOURCES",
    AGRICULTURE_AND_NATURAL_RESOURCES: "ENERGY_UTILITIES_NATURAL_RESOURCES",
    NATURAL_RESOURCES: "ENERGY_UTILITIES_NATURAL_RESOURCES",
    GOVERNMENT: "GOVERNMENT_PUBLIC_SECTOR",
    GOVERNMENT_AND_PUBLIC_SECTOR: "GOVERNMENT_PUBLIC_SECTOR",
    GOVERNMENT_PUBLIC_SECTOR: "GOVERNMENT_PUBLIC_SECTOR",
    LEGAL: "LEGAL_SERVICES",
    LEGAL_SERVICES: "LEGAL_SERVICES",
    MEDIA: "MEDIA_ENTERTAINMENT",
    MEDIA_AND_ENTERTAINMENT: "MEDIA_ENTERTAINMENT",
    MEDIA_ENTERTAINMENT: "MEDIA_ENTERTAINMENT",
    TELECOMMUNICATIONS: "TELECOMMUNICATIONS",
    TELECOM: "TELECOMMUNICATIONS",
    TRANSPORTATION_LOGISTICS: "TRANSPORTATION_LOGISTICS",
    TRANSPORTATION_AND_LOGISTICS: "TRANSPORTATION_LOGISTICS",
    REAL_ESTATE_CONSTRUCTION: "REAL_ESTATE_CONSTRUCTION",
    REAL_ESTATE_AND_CONSTRUCTION: "REAL_ESTATE_CONSTRUCTION",
    HOSPITALITY_FOOD_SERVICES: "HOSPITALITY_FOOD_SERVICES",
    HOSPITALITY_AND_FOOD_SERVICES: "HOSPITALITY_FOOD_SERVICES",
    NONPROFIT_SOCIAL_IMPACT: "NONPROFIT_SOCIAL_IMPACT",
    NONPROFIT_AND_SOCIAL_IMPACT: "NONPROFIT_SOCIAL_IMPACT",
    AEROSPACE_DEFENSE: "AEROSPACE_DEFENSE",
    AEROSPACE_AND_DEFENSE: "AEROSPACE_DEFENSE",
    OTHER: "OTHER",
    OTHER_UNKNOWN: "UNKNOWN",
    UNKNOWN: "UNKNOWN",
  };

  return direct[normalizedKey] ?? null;
}

export function uniqueKnownIndustries(values: Array<string | null | undefined>) {
  const seen = new Set<NormalizedIndustry>();
  const industries: NormalizedIndustry[] = [];

  for (const value of values) {
    const industry = normalizeIndustryValue(value);
    if (!industry || industry === "UNKNOWN") continue;
    if (seen.has(industry)) continue;
    seen.add(industry);
    industries.push(industry);
  }

  return industries;
}

export function buildCompanyIndustryResolution(input: {
  industries: NormalizedIndustry[];
  primaryIndustry?: NormalizedIndustry | null;
  confidence: number;
  source: CompanyIndustryResolutionSource;
  signals: string[];
}): CompanyIndustryResolution {
  const normalizedIndustries = uniqueKnownIndustries(input.industries);
  const primary =
    input.primaryIndustry && input.primaryIndustry !== "UNKNOWN"
      ? input.primaryIndustry
      : normalizedIndustries[0] ?? "UNKNOWN";

  return {
    normalizedIndustry: primary,
    normalizedIndustries,
    confidence: normalizedIndustries.length > 0 ? input.confidence : 0.2,
    source: normalizedIndustries.length > 0 ? input.source : "unknown_company_industry",
    signals:
      normalizedIndustries.length > 0
        ? input.signals
        : ["unknown_company_industry", ...input.signals],
  };
}

function readVerifiedIndustries(metadata: Record<string, unknown> | null) {
  if (!metadata) return { industries: [] as NormalizedIndustry[], primaryIndustry: null };

  const industries = uniqueKnownIndustries(
    VERIFIED_INDUSTRY_KEYS.flatMap((key) => readIndustryValues(metadata[key]))
  );
  const primaryIndustry =
    normalizeIndustryValue(
      VERIFIED_PRIMARY_INDUSTRY_KEYS.map((key) => readString(metadata[key])).find(Boolean) ??
        null
    ) ??
    industries[0] ??
    null;

  return { industries, primaryIndustry };
}

export function resolveCompanyIndustry(input: CompanyIndustryInput): CompanyIndustryResolution {
  const metadata = asRecord(input.metadataJson);
  const verified = readVerifiedIndustries(metadata);

  if (verified.industries.length > 0 || verified.primaryIndustry) {
    return buildCompanyIndustryResolution({
      industries:
        verified.industries.length > 0
          ? verified.industries
          : verified.primaryIndustry
            ? [verified.primaryIndustry]
            : [],
      primaryIndustry: verified.primaryIndustry,
      confidence: 0.99,
      source: "company_verified_csv",
      signals: ["verified_company_industry_registry"],
    });
  }

  return UNKNOWN_COMPANY_INDUSTRY;
}

export function isFilterSafeCompanyIndustry(resolution: CompanyIndustryResolution) {
  return (
    resolution.normalizedIndustries.length > 0 &&
    resolution.confidence >= COMPANY_INDUSTRY_FILTER_CONFIDENCE_THRESHOLD &&
    resolution.source === "company_verified_csv"
  );
}
