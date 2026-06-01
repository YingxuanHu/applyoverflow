import type { Prisma } from "@/generated/prisma/client";
import type { NormalizedIndustry } from "@/lib/job-metadata";

export const COMPANY_INDUSTRY_FILTER_CONFIDENCE_THRESHOLD = 0.9;

export type CompanyIndustryResolutionSource =
  | "company_profile"
  | "company_sector_metadata"
  | "company_domain_alias"
  | "company_name_alias"
  | "ambiguous_company_metadata"
  | "unknown_company_industry";

export type CompanyIndustryResolution = {
  normalizedIndustry: NormalizedIndustry;
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
  confidence: 0.2,
  source: "unknown_company_industry",
  signals: ["unknown_company_industry"],
};

const ATS_OR_SOURCE_VALUES = new Set([
  "ashby",
  "ashbyhq",
  "ats",
  "bamboohr",
  "company site",
  "company-site",
  "direct careers page",
  "greenhouse",
  "icims",
  "jobvite",
  "lever",
  "oraclecloud",
  "recruitee",
  "rippling",
  "smartrecruiters",
  "successfactors",
  "taleo",
  "teamtailor",
  "workable",
  "workday",
]);

const COMPANY_NAME_ALIASES: Record<string, NormalizedIndustry> = {
  ACCENTURE: "CONSULTING_PROFESSIONAL_SERVICES",
  ADOBE: "TECHNOLOGY",
  AIRBNB: "HOSPITALITY_FOOD_SERVICES",
  ALLSTATE: "FINANCIAL_SERVICES",
  AMAZON: "RETAIL_CONSUMER_GOODS",
  AMD: "TECHNOLOGY",
  "AMERICAN EXPRESS": "FINANCIAL_SERVICES",
  APPLE: "TECHNOLOGY",
  ATLASSIAN: "TECHNOLOGY",
  "BANK OF AMERICA": "FINANCIAL_SERVICES",
  BELL: "TELECOMMUNICATIONS",
  "BELL CANADA": "TELECOMMUNICATIONS",
  BMO: "FINANCIAL_SERVICES",
  BOEING: "AEROSPACE_DEFENSE",
  "BUCK MASON": "RETAIL_CONSUMER_GOODS",
  BUCKMASON: "RETAIL_CONSUMER_GOODS",
  CIBC: "FINANCIAL_SERVICES",
  CISCO: "TECHNOLOGY",
  COSTCO: "RETAIL_CONSUMER_GOODS",
  CROWDSTRIKE: "TECHNOLOGY",
  DATABRICKS: "TECHNOLOGY",
  DELOITTE: "CONSULTING_PROFESSIONAL_SERVICES",
  DOORDASH: "RETAIL_CONSUMER_GOODS",
  EY: "CONSULTING_PROFESSIONAL_SERVICES",
  FISERV: "FINANCIAL_SERVICES",
  GOOGLE: "TECHNOLOGY",
  HPE: "TECHNOLOGY",
  "HEWLETT PACKARD ENTERPRISE": "TECHNOLOGY",
  IBM: "TECHNOLOGY",
  INSTACART: "RETAIL_CONSUMER_GOODS",
  INTEL: "TECHNOLOGY",
  JPMORGAN: "FINANCIAL_SERVICES",
  "JPMORGAN CHASE": "FINANCIAL_SERVICES",
  KPMG: "CONSULTING_PROFESSIONAL_SERVICES",
  LIFESTANCE: "HEALTHCARE_LIFE_SCIENCES",
  LINKEDIN: "TECHNOLOGY",
  LYFT: "TECHNOLOGY",
  MASTERCARD: "FINANCIAL_SERVICES",
  MCKINSEY: "CONSULTING_PROFESSIONAL_SERVICES",
  META: "TECHNOLOGY",
  MICROSOFT: "TECHNOLOGY",
  NETFLIX: "MEDIA_ENTERTAINMENT",
  NVIDIA: "TECHNOLOGY",
  OKTA: "TECHNOLOGY",
  ORACLE: "TECHNOLOGY",
  PALANTIR: "TECHNOLOGY",
  PWC: "CONSULTING_PROFESSIONAL_SERVICES",
  RBC: "FINANCIAL_SERVICES",
  RIPPLING: "TECHNOLOGY",
  ROGERS: "TELECOMMUNICATIONS",
  SALESFORCE: "TECHNOLOGY",
  SAP: "TECHNOLOGY",
  SCOTIABANK: "FINANCIAL_SERVICES",
  SHOPIFY: "TECHNOLOGY",
  SNOWFLAKE: "TECHNOLOGY",
  STRIPE: "FINANCIAL_SERVICES",
  TARGET: "RETAIL_CONSUMER_GOODS",
  TD: "FINANCIAL_SERVICES",
  "TD BANK": "FINANCIAL_SERVICES",
  TELUS: "TELECOMMUNICATIONS",
  TESLA: "MANUFACTURING_AUTOMOTIVE",
  UBER: "TECHNOLOGY",
  VISA: "FINANCIAL_SERVICES",
  WALMART: "RETAIL_CONSUMER_GOODS",
};

const DOMAIN_ALIASES: Record<string, NormalizedIndustry> = {
  "accenture.com": "CONSULTING_PROFESSIONAL_SERVICES",
  "adobe.com": "TECHNOLOGY",
  "airbnb.com": "HOSPITALITY_FOOD_SERVICES",
  "allstate.com": "FINANCIAL_SERVICES",
  "amazon.jobs": "RETAIL_CONSUMER_GOODS",
  "amazon.com": "RETAIL_CONSUMER_GOODS",
  "amd.com": "TECHNOLOGY",
  "americanexpress.com": "FINANCIAL_SERVICES",
  "apple.com": "TECHNOLOGY",
  "atlassian.com": "TECHNOLOGY",
  "bankofamerica.com": "FINANCIAL_SERVICES",
  "bell.ca": "TELECOMMUNICATIONS",
  "bmo.com": "FINANCIAL_SERVICES",
  "boeing.com": "AEROSPACE_DEFENSE",
  "buckmason.com": "RETAIL_CONSUMER_GOODS",
  "cibc.com": "FINANCIAL_SERVICES",
  "cisco.com": "TECHNOLOGY",
  "costco.com": "RETAIL_CONSUMER_GOODS",
  "crowdstrike.com": "TECHNOLOGY",
  "databricks.com": "TECHNOLOGY",
  "deloitte.com": "CONSULTING_PROFESSIONAL_SERVICES",
  "doordash.com": "RETAIL_CONSUMER_GOODS",
  "ey.com": "CONSULTING_PROFESSIONAL_SERVICES",
  "fiserv.com": "FINANCIAL_SERVICES",
  "google.com": "TECHNOLOGY",
  "hpe.com": "TECHNOLOGY",
  "ibm.com": "TECHNOLOGY",
  "instacart.com": "RETAIL_CONSUMER_GOODS",
  "intel.com": "TECHNOLOGY",
  "jpmorganchase.com": "FINANCIAL_SERVICES",
  "kpmg.com": "CONSULTING_PROFESSIONAL_SERVICES",
  "lifestance.com": "HEALTHCARE_LIFE_SCIENCES",
  "linkedin.com": "TECHNOLOGY",
  "lyft.com": "TECHNOLOGY",
  "mastercard.com": "FINANCIAL_SERVICES",
  "mckinsey.com": "CONSULTING_PROFESSIONAL_SERVICES",
  "meta.com": "TECHNOLOGY",
  "microsoft.com": "TECHNOLOGY",
  "netflix.com": "MEDIA_ENTERTAINMENT",
  "nvidia.com": "TECHNOLOGY",
  "okta.com": "TECHNOLOGY",
  "oracle.com": "TECHNOLOGY",
  "palantir.com": "TECHNOLOGY",
  "pwc.com": "CONSULTING_PROFESSIONAL_SERVICES",
  "rbc.com": "FINANCIAL_SERVICES",
  "rippling.com": "TECHNOLOGY",
  "rogers.com": "TELECOMMUNICATIONS",
  "salesforce.com": "TECHNOLOGY",
  "sap.com": "TECHNOLOGY",
  "scotiabank.com": "FINANCIAL_SERVICES",
  "shopify.com": "TECHNOLOGY",
  "snowflake.com": "TECHNOLOGY",
  "stripe.com": "FINANCIAL_SERVICES",
  "target.com": "RETAIL_CONSUMER_GOODS",
  "td.com": "FINANCIAL_SERVICES",
  "telus.com": "TELECOMMUNICATIONS",
  "tesla.com": "MANUFACTURING_AUTOMOTIVE",
  "uber.com": "TECHNOLOGY",
  "visa.com": "FINANCIAL_SERVICES",
  "walmart.com": "RETAIL_CONSUMER_GOODS",
};

const SECTOR_KEYWORDS: Array<{
  industry: NormalizedIndustry;
  patterns: RegExp[];
}> = [
  {
    industry: "FINANCIAL_SERVICES",
    patterns: [
      /\b(fintech|banking|bank|finance|financial services|payments?|credit|lending|wealth management|asset management|capital markets|foreign exchange)\b/i,
    ],
  },
  {
    industry: "FINANCIAL_SERVICES",
    patterns: [/\b(insurance|insurtech|underwriting|claims)\b/i],
  },
  {
    industry: "HEALTHCARE_LIFE_SCIENCES",
    patterns: [
      /\b(healthcare|health care|healthtech|pharma|pharmaceutical|biotech|life sciences|medical devices?|clinical|therapeutics|genomics)\b/i,
    ],
  },
  {
    industry: "CONSULTING_PROFESSIONAL_SERVICES",
    patterns: [/\b(consulting|professional services|advisory|agency services)\b/i],
  },
  {
    industry: "EDUCATION",
    patterns: [/\b(education|edtech|university|college|school|learning)\b/i],
  },
  {
    industry: "RETAIL_CONSUMER_GOODS",
    patterns: [
      /\b(retail|ecommerce|e-commerce|commerce|consumer goods|marketplace|grocery|fashion|apparel|restaurant tech|food delivery|delivery)\b/i,
    ],
  },
  {
    industry: "MANUFACTURING_AUTOMOTIVE",
    patterns: [/\b(manufacturing|industrial|factory|materials|automation|electronics)\b/i],
  },
  {
    industry: "ENERGY_UTILITIES_NATURAL_RESOURCES",
    patterns: [/\b(energy|utilities|utility|renewables?|solar|oil|gas|climate tech)\b/i],
  },
  {
    industry: "GOVERNMENT_PUBLIC_SECTOR",
    patterns: [/\b(government|public sector|public service|municipal|federal|state agency)\b/i],
  },
  {
    industry: "LEGAL_SERVICES",
    patterns: [/\b(legal|law firm|legal services|litigation)\b/i],
  },
  {
    industry: "MEDIA_ENTERTAINMENT",
    patterns: [/\b(media|entertainment|streaming|publishing|news|studio|creator economy|content)\b/i],
  },
  {
    industry: "TELECOMMUNICATIONS",
    patterns: [/\b(telecom|telecommunications|wireless|5g|network carrier)\b/i],
  },
  {
    industry: "TRANSPORTATION_LOGISTICS",
    patterns: [/\b(transportation|logistics|freight|shipping|airlines?|rail|fleet|supply chain)\b/i],
  },
  {
    industry: "REAL_ESTATE_CONSTRUCTION",
    patterns: [/\b(real estate|property|construction|proptech|builder|infrastructure)\b/i],
  },
  {
    industry: "HOSPITALITY_FOOD_SERVICES",
    patterns: [/\b(hospitality|hotel|travel|tourism|restaurant|food services)\b/i],
  },
  {
    industry: "NONPROFIT_SOCIAL_IMPACT",
    patterns: [/\b(nonprofit|non-profit|ngo|charity|foundation|social impact|philanthropy)\b/i],
  },
  {
    industry: "ENERGY_UTILITIES_NATURAL_RESOURCES",
    patterns: [/\b(agriculture|farming|forestry|mining|natural resources|agtech)\b/i],
  },
  {
    industry: "AEROSPACE_DEFENSE",
    patterns: [/\b(aerospace|defense|defence|aviation|space)\b/i],
  },
  {
    industry: "MANUFACTURING_AUTOMOTIVE",
    patterns: [/\b(automotive|automobile|vehicle|electric vehicles?|ev charging|mobility)\b/i],
  },
  {
    industry: "TECHNOLOGY",
    patterns: [
      /\b(technology|tech|software|saas|cloud|ai|artificial intelligence|data|database|devtools?|cybersecurity|security|networking|semiconductors?|hardware|hr tech|martech|adtech|productivity|enterprise software|vertical saas)\b/i,
    ],
  },
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

function normalizeDomain(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = value.includes("://") ? new URL(value) : new URL(`https://${value}`);
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return value.replace(/^www\./i, "").toLowerCase().trim() || null;
  }
}

function asRecord(value: Prisma.JsonValue | Record<string, unknown> | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
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

function resolveSectorIndustry(value: string) {
  const normalizedValue = normalizeText(value).toLowerCase();
  if (!normalizedValue || ATS_OR_SOURCE_VALUES.has(normalizedValue)) return null;

  const direct = normalizeIndustryValue(value);
  if (direct) return direct;

  for (const entry of SECTOR_KEYWORDS) {
    if (entry.patterns.some((pattern) => pattern.test(normalizedValue))) {
      return entry.industry;
    }
  }

  return null;
}

function chooseIndustryFromSectorHints(values: string[]) {
  const counts = new Map<NormalizedIndustry, number>();
  const signals: string[] = [];

  for (const value of values) {
    const industry = resolveSectorIndustry(value);
    if (!industry) continue;
    counts.set(industry, (counts.get(industry) ?? 0) + 1);
    signals.push(`company_sector:${value}`);
  }

  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
    return {
      normalizedIndustry: "UNKNOWN" as const,
      confidence: 0.2,
      source: "ambiguous_company_metadata" as const,
      signals: ["ambiguous_company_sector_metadata", ...signals],
    };
  }

  return {
    normalizedIndustry: ranked[0][0],
    confidence: ranked[0][1] >= 2 ? 0.96 : 0.92,
    source: "company_sector_metadata" as const,
    signals,
  };
}

export function resolveCompanyIndustry(input: CompanyIndustryInput): CompanyIndustryResolution {
  const metadata = asRecord(input.metadataJson);
  const explicitMetadataIndustry = normalizeIndustryValue(
    readString(metadata?.normalizedCompanyIndustry) ??
      readString(metadata?.companyIndustry) ??
      readString(metadata?.industry)
  );
  if (explicitMetadataIndustry) {
    return {
      normalizedIndustry: explicitMetadataIndustry,
      confidence: 0.98,
      source: "company_profile",
      signals: ["company_profile_industry"],
    };
  }

  const sectorHints = [
    ...readStringArray(metadata?.sectors),
    ...readStringArray(metadata?.industries),
    ...readStringArray(metadata?.industryTags),
  ];
  const sectorMatch = chooseIndustryFromSectorHints(sectorHints);
  if (sectorMatch) return sectorMatch;

  const domain = normalizeDomain(input.domain);
  if (domain) {
    const domainAlias = DOMAIN_ALIASES[domain];
    if (domainAlias) {
      return {
        normalizedIndustry: domainAlias,
        confidence: 0.98,
        source: "company_domain_alias",
        signals: [`company_domain:${domain}`],
      };
    }
  }

  const companyKey = normalizeKey(input.companyName);
  const companyAlias =
    COMPANY_NAME_ALIASES[companyKey] ??
    COMPANY_NAME_ALIASES[companyKey.replace(/\s+/g, "")];
  if (companyAlias) {
    return {
      normalizedIndustry: companyAlias,
      confidence: 0.98,
      source: "company_name_alias",
      signals: ["company_name_alias"],
    };
  }

  return UNKNOWN_COMPANY_INDUSTRY;
}

export function resolveCompanyIndustryFromName(companyName: string | null | undefined) {
  return resolveCompanyIndustry({ companyName });
}

export function isFilterSafeCompanyIndustry(resolution: CompanyIndustryResolution) {
  return (
    resolution.normalizedIndustry !== "UNKNOWN" &&
    resolution.confidence >= COMPANY_INDUSTRY_FILTER_CONFIDENCE_THRESHOLD
  );
}
