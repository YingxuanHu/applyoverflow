import type { EmploymentType, ExperienceLevel, Industry, WorkMode } from "@/generated/prisma/client";
import {
  COMPANY_INDUSTRY_FILTER_CONFIDENCE_THRESHOLD,
} from "@/lib/company-industry";
import {
  extractExperienceLevel,
  normalizeExperienceLevelGroupToken,
  type ExperienceLevelGroup,
} from "@/lib/experience-level";
import {
  extractJobFunction,
  type JobFunctionCandidate,
  type JobFunctionGroup,
  type JobFunctionStatus,
} from "@/lib/ingestion/extraction/job-function-extractor";

export type NormalizedEmploymentType =
  | "FULL_TIME"
  | "PART_TIME"
  | "CONTRACT"
  | "TEMPORARY"
  | "INTERNSHIP"
  | "CO_OP"
  | "APPRENTICESHIP"
  | "SEASONAL"
  | "VOLUNTEER"
  | "FREELANCE"
  | "UNKNOWN";

export type NormalizedEmploymentTypeGroup =
  | "FULL_TIME"
  | "PART_TIME"
  | "CONTRACT"
  | "INTERNSHIP_COOP"
  | "TEMPORARY_SEASONAL"
  | "FREELANCE"
  | "VOLUNTEER"
  | "OTHER"
  | "UNKNOWN";

export type NormalizedCareerStage =
  | "INTERNSHIP_COOP_STUDENT"
  | "ENTRY_LEVEL_NEW_GRAD"
  | "ASSOCIATE_JUNIOR"
  | "MID_LEVEL"
  | "SENIOR"
  | "STAFF_PRINCIPAL"
  | "MANAGER"
  | "DIRECTOR"
  | "EXECUTIVE"
  | "UNKNOWN";

export type NormalizedIndustry =
  | "TECHNOLOGY"
  | "FINANCIAL_SERVICES"
  | "CONSULTING_PROFESSIONAL_SERVICES"
  | "HEALTHCARE_LIFE_SCIENCES"
  | "EDUCATION"
  | "RETAIL_CONSUMER_GOODS"
  | "MANUFACTURING_AUTOMOTIVE"
  | "ENERGY_UTILITIES_NATURAL_RESOURCES"
  | "GOVERNMENT_PUBLIC_SECTOR"
  | "LEGAL_SERVICES"
  | "MEDIA_ENTERTAINMENT"
  | "TELECOMMUNICATIONS"
  | "TRANSPORTATION_LOGISTICS"
  | "REAL_ESTATE_CONSTRUCTION"
  | "HOSPITALITY_FOOD_SERVICES"
  | "NONPROFIT_SOCIAL_IMPACT"
  | "AEROSPACE_DEFENSE"
  | "OTHER"
  | "UNKNOWN";

export type NormalizedRoleCategory =
  | "SOFTWARE_ENGINEERING"
  | "DATA_ANALYTICS"
  | "AI_MACHINE_LEARNING"
  | "PRODUCT_MANAGEMENT"
  | "DESIGN_UX"
  | "IT_SYSTEMS_DEVOPS"
  | "CYBERSECURITY"
  | "FINANCE_ACCOUNTING"
  | "INVESTMENT_BANKING"
  | "CONSULTING"
  | "SALES"
  | "MARKETING"
  | "OPERATIONS"
  | "CUSTOMER_SUCCESS_SUPPORT"
  | "HUMAN_RESOURCES_RECRUITING"
  | "LEGAL_COMPLIANCE"
  | "HEALTHCARE_CLINICAL"
  | "RESEARCH_SCIENCE"
  | "EDUCATION_TEACHING"
  | "ENGINEERING_HARDWARE"
  | "RETAIL_SERVICE"
  | "SKILLED_TRADES_FACILITIES"
  | "WAREHOUSE_DELIVERY_DRIVING"
  | "MEDIA_CONTENT_COMMUNICATIONS"
  | "MANUFACTURING_TRADES"
  | "SUPPLY_CHAIN_LOGISTICS"
  | "PROJECT_PROGRAM_MANAGEMENT"
  | "ADMINISTRATIVE"
  | "BUSINESS_DEVELOPMENT"
  | "OTHER_UNKNOWN";

export type JobClassificationStatus =
  | "CONFIDENT"
  | "PARTIAL"
  | "UNKNOWN"
  | "NEEDS_REVIEW";

export const ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD = 0.75;
export const CAREER_STAGE_FILTER_CONFIDENCE_THRESHOLD = 0.72;
export const EMPLOYMENT_TYPE_FILTER_CONFIDENCE_THRESHOLD = 0.72;
export const INDUSTRY_FILTER_CONFIDENCE_THRESHOLD = COMPANY_INDUSTRY_FILTER_CONFIDENCE_THRESHOLD;
export const METADATA_FIELD_FILTER_CONFIDENCE_THRESHOLD = 0.6;

type TaxonomyOption<T extends string> = {
  label: string;
  value: T;
};

export const NORMALIZED_EMPLOYMENT_TYPE_OPTIONS: Array<TaxonomyOption<NormalizedEmploymentType>> = [
  { label: "Full-time", value: "FULL_TIME" },
  { label: "Part-time", value: "PART_TIME" },
  { label: "Contract", value: "CONTRACT" },
  { label: "Temporary", value: "TEMPORARY" },
  { label: "Internship", value: "INTERNSHIP" },
  { label: "Co-op", value: "CO_OP" },
  { label: "Apprenticeship", value: "APPRENTICESHIP" },
  { label: "Seasonal", value: "SEASONAL" },
  { label: "Volunteer", value: "VOLUNTEER" },
  { label: "Freelance", value: "FREELANCE" },
];

export const NORMALIZED_EMPLOYMENT_TYPE_GROUP_OPTIONS: Array<
  TaxonomyOption<NormalizedEmploymentTypeGroup>
> = [
  { label: "Full-time", value: "FULL_TIME" },
  { label: "Part-time", value: "PART_TIME" },
  { label: "Contract", value: "CONTRACT" },
  { label: "Internship / Co-op", value: "INTERNSHIP_COOP" },
  { label: "Temporary / Seasonal", value: "TEMPORARY_SEASONAL" },
  { label: "Freelance", value: "FREELANCE" },
  { label: "Volunteer", value: "VOLUNTEER" },
];

export const NORMALIZED_CAREER_STAGE_OPTIONS: Array<TaxonomyOption<NormalizedCareerStage>> = [
  { label: "Internship / Co-op / Student", value: "INTERNSHIP_COOP_STUDENT" },
  { label: "Entry Level / New Grad", value: "ENTRY_LEVEL_NEW_GRAD" },
  { label: "Associate / Junior", value: "ASSOCIATE_JUNIOR" },
  { label: "Mid Level", value: "MID_LEVEL" },
  { label: "Senior", value: "SENIOR" },
  { label: "Staff / Principal", value: "STAFF_PRINCIPAL" },
  { label: "Manager", value: "MANAGER" },
  { label: "Director", value: "DIRECTOR" },
  { label: "Executive", value: "EXECUTIVE" },
];

export const EXPERIENCE_LEVEL_GROUP_OPTIONS: Array<TaxonomyOption<ExperienceLevelGroup>> = [
  { label: "Internship / Co-op / Student", value: "STUDENT_INTERN" },
  { label: "Entry / Junior", value: "ENTRY_JUNIOR" },
  { label: "Mid-level / Experienced", value: "MID_EXPERIENCED" },
  { label: "Senior / Lead / Staff", value: "SENIOR_LEAD_STAFF" },
  { label: "Manager / Director / Executive", value: "MANAGER_DIRECTOR_EXECUTIVE" },
];

export const NORMALIZED_INDUSTRY_OPTIONS: Array<TaxonomyOption<NormalizedIndustry>> = [
  { label: "Technology", value: "TECHNOLOGY" },
  { label: "Financial Services", value: "FINANCIAL_SERVICES" },
  { label: "Consulting & Professional Services", value: "CONSULTING_PROFESSIONAL_SERVICES" },
  { label: "Healthcare & Life Sciences", value: "HEALTHCARE_LIFE_SCIENCES" },
  { label: "Education", value: "EDUCATION" },
  { label: "Retail & Consumer Goods", value: "RETAIL_CONSUMER_GOODS" },
  { label: "Manufacturing & Automotive", value: "MANUFACTURING_AUTOMOTIVE" },
  { label: "Energy, Utilities & Natural Resources", value: "ENERGY_UTILITIES_NATURAL_RESOURCES" },
  { label: "Government & Public Sector", value: "GOVERNMENT_PUBLIC_SECTOR" },
  { label: "Media & Entertainment", value: "MEDIA_ENTERTAINMENT" },
  { label: "Telecommunications", value: "TELECOMMUNICATIONS" },
  { label: "Transportation & Logistics", value: "TRANSPORTATION_LOGISTICS" },
  { label: "Real Estate & Construction", value: "REAL_ESTATE_CONSTRUCTION" },
  { label: "Hospitality & Food Services", value: "HOSPITALITY_FOOD_SERVICES" },
  { label: "Nonprofit & Social Impact", value: "NONPROFIT_SOCIAL_IMPACT" },
  { label: "Aerospace & Defense", value: "AEROSPACE_DEFENSE" },
  { label: "Legal Services", value: "LEGAL_SERVICES" },
  { label: "Other", value: "OTHER" },
];

export const NORMALIZED_ROLE_CATEGORY_OPTIONS: Array<TaxonomyOption<NormalizedRoleCategory>> = [
  { label: "Software Engineering", value: "SOFTWARE_ENGINEERING" },
  { label: "Data & Analytics", value: "DATA_ANALYTICS" },
  { label: "AI / Machine Learning", value: "AI_MACHINE_LEARNING" },
  { label: "Product Management", value: "PRODUCT_MANAGEMENT" },
  { label: "Design / UX", value: "DESIGN_UX" },
  { label: "IT / Systems / DevOps", value: "IT_SYSTEMS_DEVOPS" },
  { label: "Cybersecurity", value: "CYBERSECURITY" },
  { label: "Finance / Accounting", value: "FINANCE_ACCOUNTING" },
  { label: "Investment Banking / Asset Management", value: "INVESTMENT_BANKING" },
  { label: "Consulting", value: "CONSULTING" },
  { label: "Sales / Business Development", value: "SALES" },
  { label: "Marketing / Growth", value: "MARKETING" },
  { label: "Operations / Supply Chain", value: "OPERATIONS" },
  { label: "Customer Success / Support", value: "CUSTOMER_SUCCESS_SUPPORT" },
  { label: "Human Resources / Recruiting", value: "HUMAN_RESOURCES_RECRUITING" },
  { label: "Legal / Compliance", value: "LEGAL_COMPLIANCE" },
  { label: "Healthcare / Clinical", value: "HEALTHCARE_CLINICAL" },
  { label: "Research / Science", value: "RESEARCH_SCIENCE" },
  { label: "Education / Teaching", value: "EDUCATION_TEACHING" },
  { label: "Engineering / Manufacturing", value: "ENGINEERING_HARDWARE" },
  { label: "Administrative / Office", value: "ADMINISTRATIVE" },
  { label: "Retail / Service", value: "RETAIL_SERVICE" },
  { label: "Warehouse / Delivery / Driving", value: "WAREHOUSE_DELIVERY_DRIVING" },
  { label: "Skilled Trades / Facilities", value: "SKILLED_TRADES_FACILITIES" },
  { label: "Media / Content / Communications", value: "MEDIA_CONTENT_COMMUNICATIONS" },
  { label: "Other", value: "OTHER_UNKNOWN" },
];

const EMPLOYMENT_VALUES = new Set(NORMALIZED_EMPLOYMENT_TYPE_OPTIONS.map((option) => option.value).concat("UNKNOWN"));
const EMPLOYMENT_GROUP_VALUES = new Set(
  NORMALIZED_EMPLOYMENT_TYPE_GROUP_OPTIONS.map((option) => option.value).concat(
    "OTHER",
    "UNKNOWN"
  )
);
const CAREER_STAGE_VALUES = new Set(NORMALIZED_CAREER_STAGE_OPTIONS.map((option) => option.value).concat("UNKNOWN"));
const EXPERIENCE_LEVEL_GROUP_VALUES = new Set(
  EXPERIENCE_LEVEL_GROUP_OPTIONS.map((option) => option.value).concat("UNKNOWN")
);
const INDUSTRY_VALUES = new Set(NORMALIZED_INDUSTRY_OPTIONS.map((option) => option.value).concat("UNKNOWN"));
const ROLE_CATEGORY_VALUES = new Set(
  NORMALIZED_ROLE_CATEGORY_OPTIONS.map((option) => option.value).concat(
    "BUSINESS_DEVELOPMENT",
    "MANUFACTURING_TRADES",
    "PROJECT_PROGRAM_MANAGEMENT",
    "SUPPLY_CHAIN_LOGISTICS",
    "WAREHOUSE_DELIVERY_DRIVING",
    "OTHER_UNKNOWN"
  )
);

const CAREER_STAGE_ALIASES: Record<string, NormalizedCareerStage> = {
  INTERNSHIP: "INTERNSHIP_COOP_STUDENT",
  CO_OP: "INTERNSHIP_COOP_STUDENT",
  COOP: "INTERNSHIP_COOP_STUDENT",
  STUDENT: "INTERNSHIP_COOP_STUDENT",
  ENTRY: "ENTRY_LEVEL_NEW_GRAD",
  ENTRY_LEVEL: "ENTRY_LEVEL_NEW_GRAD",
  NEW_GRAD: "ENTRY_LEVEL_NEW_GRAD",
  ASSOCIATE: "ASSOCIATE_JUNIOR",
  JUNIOR: "ASSOCIATE_JUNIOR",
  MID: "MID_LEVEL",
  MID_LEVEL: "MID_LEVEL",
  SENIOR_LEVEL: "SENIOR",
  SENIOR: "SENIOR",
  LEAD: "STAFF_PRINCIPAL",
  STAFF: "STAFF_PRINCIPAL",
  PRINCIPAL: "STAFF_PRINCIPAL",
  MANAGER: "MANAGER",
  DIRECTOR: "DIRECTOR",
  EXECUTIVE: "EXECUTIVE",
};

const EMPLOYMENT_GROUP_ALIASES: Record<string, NormalizedEmploymentTypeGroup> = {
  FULLTIME: "FULL_TIME",
  FULL_TIME: "FULL_TIME",
  PARTTIME: "PART_TIME",
  PART_TIME: "PART_TIME",
  CONTRACTOR: "CONTRACT",
  CONTRACT: "CONTRACT",
  INTERN: "INTERNSHIP_COOP",
  INTERNSHIP: "INTERNSHIP_COOP",
  COOP: "INTERNSHIP_COOP",
  CO_OP: "INTERNSHIP_COOP",
  APPRENTICE: "INTERNSHIP_COOP",
  APPRENTICESHIP: "INTERNSHIP_COOP",
  INTERNSHIP_COOP: "INTERNSHIP_COOP",
  TEMP: "TEMPORARY_SEASONAL",
  TEMPORARY: "TEMPORARY_SEASONAL",
  SEASONAL: "TEMPORARY_SEASONAL",
  TEMPORARY_SEASONAL: "TEMPORARY_SEASONAL",
  FREELANCE: "FREELANCE",
  FREELANCER: "FREELANCE",
  VOLUNTEER: "VOLUNTEER",
  OTHER: "OTHER",
  UNKNOWN: "UNKNOWN",
};

const INDUSTRY_ALIASES: Record<string, NormalizedIndustry> = {
  TECH: "TECHNOLOGY",
  FINANCE: "FINANCIAL_SERVICES",
  FINANCE_BANKING: "FINANCIAL_SERVICES",
  FINANCE_AND_BANKING: "FINANCIAL_SERVICES",
  FINANCIAL_SERVICE: "FINANCIAL_SERVICES",
  FINANCIAL_SERVICES: "FINANCIAL_SERVICES",
  INSURANCE: "FINANCIAL_SERVICES",
  GENERAL: "UNKNOWN",
  OTHER_UNKNOWN: "UNKNOWN",
  UNKNOWN: "UNKNOWN",
  MANUFACTURING: "MANUFACTURING_AUTOMOTIVE",
  MANUFACTURING_INDUSTRIAL: "MANUFACTURING_AUTOMOTIVE",
  AUTOMOTIVE: "MANUFACTURING_AUTOMOTIVE",
  ENERGY: "ENERGY_UTILITIES_NATURAL_RESOURCES",
  ENERGY_UTILITIES: "ENERGY_UTILITIES_NATURAL_RESOURCES",
  AGRICULTURE_NATURAL_RESOURCES: "ENERGY_UTILITIES_NATURAL_RESOURCES",
  NATURAL_RESOURCES: "ENERGY_UTILITIES_NATURAL_RESOURCES",
  LEGAL: "LEGAL_SERVICES",
  LEGAL_SERVICES: "LEGAL_SERVICES",
};

const ROLE_CATEGORY_FILTER_ALIASES: Record<string, NormalizedRoleCategory> = {
  SWE: "SOFTWARE_ENGINEERING",
  SOFTWARE: "SOFTWARE_ENGINEERING",
  SOFTWARE_ENGINEER: "SOFTWARE_ENGINEERING",
  SOFTWARE_ENGINEERING: "SOFTWARE_ENGINEERING",
  DATA: "DATA_ANALYTICS",
  DATA_ANALYTICS: "DATA_ANALYTICS",
  HEALTHCARE_ADMINISTRATION: "HEALTHCARE_CLINICAL",
  HEALTHCARE_CLINICAL: "HEALTHCARE_CLINICAL",
  EDUCATION_ADMINISTRATION: "EDUCATION_TEACHING",
  EDUCATION_TEACHING: "EDUCATION_TEACHING",
  BUSINESS_DEVELOPMENT: "SALES",
  MANUFACTURING_TRADES: "SKILLED_TRADES_FACILITIES",
  SUPPLY_CHAIN_LOGISTICS: "OPERATIONS",
  WAREHOUSE_DELIVERY_DRIVING: "WAREHOUSE_DELIVERY_DRIVING",
  PROJECT_PROGRAM_MANAGEMENT: "OPERATIONS",
  SKILLED_TRADES: "SKILLED_TRADES_FACILITIES",
  SKILLED_TRADES_FACILITIES: "SKILLED_TRADES_FACILITIES",
  RETAIL_SERVICE: "RETAIL_SERVICE",
  MEDIA_CONTENT_COMMUNICATIONS: "MEDIA_CONTENT_COMMUNICATIONS",
};

export type JobMetadataInput = {
  title: string;
  rawTitle?: string | null;
  company?: string | null;
  description?: string | null;
  location?: string | null;
  roleFamily?: string | null;
  companyIndustries?: NormalizedIndustry[] | null;
  legacyIndustry?: Industry | null;
  sourceEmploymentType?: EmploymentType | null;
  inferredEmploymentType?: EmploymentType | null;
  workMode?: WorkMode | null;
  sourceMetadata?: unknown;
  applyUrl?: string | null;
  sourceUrl?: string | null;
};

export type JobMetadataClassification = {
  experienceLevel: ExperienceLevel;
  normalizedEmploymentType: NormalizedEmploymentType;
  normalizedCareerStage: NormalizedCareerStage;
  experienceLevelGroup: ExperienceLevelGroup;
  experienceLevelSource: string;
  experienceLevelEvidence: string[];
  experienceLevelWarnings: string[];
  normalizedIndustry: NormalizedIndustry;
  normalizedIndustries: NormalizedIndustry[];
  normalizedRoleCategory: NormalizedRoleCategory;
  normalizedRoleCategoryGroup: JobFunctionGroup;
  normalizedRoleCategoryStatus: JobFunctionStatus;
  normalizedRoleCategorySource: string;
  normalizedRoleCategoryCandidates: JobFunctionCandidate[];
  normalizedRoleCategoryEvidence: string[];
  normalizedRoleCategoryWarnings: string[];
  normalizedRoleCategoryRejectedCandidates: JobFunctionCandidate[];
  classificationStatus: JobClassificationStatus;
  confidence: {
    employmentType: number;
    careerStage: number;
    industry: number;
    roleCategory: number;
    workMode: number;
  };
  signals: string[];
};

const TITLE_INTERNSHIP_PATTERNS = [
  /\binterns?\b/i,
  /\binternship\b(?!\s+programs?\b)/i,
  /\bco[-\s]?op\s*\/\s*interns?\b/i,
  /\binterns?\s*\/\s*co[-\s]?op\b/i,
  /\bco[-\s]?op\s+(?:intern|student|placement|term|position|role|program)\b/i,
  /\b(?:intern|student|placement|term|position|role|program)\s+co[-\s]?op\b/i,
  /\bstudent\s+(?:intern|program|role|position|placement|work\s+term)\b/i,
  /\bsummer\s+(?:analyst|associate|student|intern)\b/i,
  /\bwork\s+term\b/i,
  /\bplacement\s+student\b/i,
];

const DESCRIPTION_INTERNSHIP_PATTERNS = [
  /\b(?:this|the|our)\s+(?:internship|co[-\s]?op)\s+(?:role|position|opportunity|placement|term)\b/i,
  /\b(?:internship|co[-\s]?op)\s+(?:role|position|opportunity|placement|term)\b/i,
  /\bstudent\s+(?:placement|work\s+term)\b/i,
];

const SENIOR_OR_LEADERSHIP_TITLE_PATTERN =
  /\b(senior|sr\.?|staff|principal|lead|manager|director|vp\b|vice president|chief|head of)\b/i;

const TITLE_COOP_ROLE_PATTERNS = [
  /\bco[-\s]?op\s*\/\s*interns?\b/i,
  /\binterns?\s*\/\s*co[-\s]?op\b/i,
  /\bco[-\s]?op\s+(?:intern|student|placement|term|position|role|program)\b/i,
  /\b(?:intern|student|placement|term|position|role|program)\s+co[-\s]?op\b/i,
];

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAny(value: string, patterns: RegExp[] | undefined) {
  return Boolean(patterns?.some((pattern) => pattern.test(value)));
}

export function hasRoleLevelInternshipTitleEvidence(titleValue: string) {
  return matchesAny(normalizeText(titleValue), TITLE_INTERNSHIP_PATTERNS);
}

export function hasStrongInternshipEvidence(input: {
  title: string;
  description?: string | null;
  sourceEmploymentType?: EmploymentType | null;
}) {
  const title = normalizeText(input.title);
  const description = normalizeText(input.description);
  const titleEvidence = hasRoleLevelInternshipTitleEvidence(title);
  const sourceEvidence = input.sourceEmploymentType === "INTERNSHIP";
  const descriptionEvidence = matchesAny(description, DESCRIPTION_INTERNSHIP_PATTERNS);
  const leadershipTitle = SENIOR_OR_LEADERSHIP_TITLE_PATTERN.test(title);

  return (
    titleEvidence ||
    (sourceEvidence && !leadershipTitle) ||
    (descriptionEvidence && !leadershipTitle)
  );
}

function classifyEmploymentType(input: JobMetadataInput): {
  value: NormalizedEmploymentType;
  confidence: number;
  signals: string[];
} {
  const title = normalizeText(input.title);
  const text = normalizeText(`${input.title} ${input.description ?? ""}`);
  const strongInternship = hasStrongInternshipEvidence(input);
  const titleCoopRole = matchesAny(title, TITLE_COOP_ROLE_PATTERNS);

  if (titleCoopRole) {
    return { value: "CO_OP", confidence: 0.95, signals: ["title_coop"] };
  }
  if (strongInternship) {
    return { value: "INTERNSHIP", confidence: 0.92, signals: ["strong_internship_evidence"] };
  }
  if (/\bapprentice(?:ship)?\b/i.test(text)) {
    return { value: "APPRENTICESHIP", confidence: 0.86, signals: ["apprenticeship_keyword"] };
  }
  if (/\bvolunteer\b/i.test(text)) {
    return { value: "VOLUNTEER", confidence: 0.85, signals: ["volunteer_keyword"] };
  }
  if (/\bfreelance|independent contractor\b/i.test(text)) {
    return { value: "FREELANCE", confidence: 0.84, signals: ["freelance_keyword"] };
  }
  if (/\bseasonal\b/i.test(text)) {
    return { value: "SEASONAL", confidence: 0.84, signals: ["seasonal_keyword"] };
  }
  if (/\btemporary|temp\b|\bfixed[-\s]?term\b/i.test(text)) {
    return { value: "TEMPORARY", confidence: 0.82, signals: ["temporary_keyword"] };
  }
  if (/\bcontract(?:or)?\b|\bcontract-to-hire\b/i.test(text)) {
    return { value: "CONTRACT", confidence: 0.82, signals: ["contract_keyword"] };
  }
  if (/\bpart[-\s]?time\b/i.test(text) || input.sourceEmploymentType === "PART_TIME") {
    return { value: "PART_TIME", confidence: 0.82, signals: ["part_time_keyword_or_source"] };
  }
  if (/\bfull[-\s]?time\b|\bpermanent\b/i.test(text) || input.sourceEmploymentType === "FULL_TIME") {
    return { value: "FULL_TIME", confidence: 0.78, signals: ["full_time_keyword_or_source"] };
  }
  if (
    input.inferredEmploymentType &&
    input.inferredEmploymentType !== "UNKNOWN" &&
    input.inferredEmploymentType !== "INTERNSHIP"
  ) {
    return {
      value: input.inferredEmploymentType,
      confidence: 0.65,
      signals: ["legacy_inferred_employment_type"],
    };
  }

  return { value: "UNKNOWN", confidence: 0.2, signals: ["unknown_employment_type"] };
}

function classifyCareerStage(input: JobMetadataInput): {
  experienceLevel: ExperienceLevel;
  value: NormalizedCareerStage;
  group: ExperienceLevelGroup;
  confidence: number;
  source: string;
  signals: string[];
  warnings: string[];
} {
  const extracted = extractExperienceLevel({
    title: input.title,
    company: input.company,
    description: input.description,
    employmentType: input.sourceEmploymentType ?? null,
    normalizedEmploymentType: input.sourceEmploymentType ?? null,
    roleFamily: input.roleFamily,
    industry: input.legacyIndustry,
    sourceMetadata: input.sourceMetadata,
  });

  return {
    experienceLevel: extracted.experienceLevel,
    value: extracted.normalizedCareerStage as NormalizedCareerStage,
    group: extracted.experienceLevelGroup,
    confidence: extracted.confidence,
    source: extracted.source,
    signals:
      extracted.evidence.length > 0
        ? extracted.evidence.map((entry) => `experience:${entry}`)
        : ["unknown_career_stage"],
    warnings: extracted.warnings,
  };
}

function classifyRoleCategory(input: JobMetadataInput): {
  value: NormalizedRoleCategory;
  confidence: number;
  group: JobFunctionGroup;
  status: JobFunctionStatus;
  source: string;
  candidates: JobFunctionCandidate[];
  evidence: string[];
  warnings: string[];
  rejectedCandidates: JobFunctionCandidate[];
  signals: string[];
} {
  const result = extractJobFunction({
    normalizedTitle: input.title,
    rawTitle: input.rawTitle,
    description: input.description,
    company: input.company,
    roleFamily: input.roleFamily,
    sourceMetadata: input.sourceMetadata,
    companyIndustries: input.companyIndustries,
    applyUrl: input.applyUrl,
    sourceUrl: input.sourceUrl,
  });

  return {
    value: result.category,
    confidence: result.confidence,
    group: result.group,
    status: result.status,
    source: result.source,
    candidates: result.candidates,
    evidence: result.evidence,
    warnings: result.warnings,
    rejectedCandidates: result.rejectedCandidates,
    signals: [
      `job_function:${result.category}`,
      `job_function_group:${result.group}`,
      `job_function_status:${result.status}`,
      ...result.evidence.map((entry) => `job_function_evidence:${entry}`),
      ...result.warnings.map((entry) => `job_function_warning:${entry}`),
    ],
  };
}

function classifyIndustry(input: JobMetadataInput): {
  value: NormalizedIndustry;
  values: NormalizedIndustry[];
  confidence: number;
  signals: string[];
} {
  void input;
  return {
    value: "UNKNOWN",
    values: [],
    confidence: 0.2,
    signals: ["company_industry_requires_verified_registry"],
  };
}

function resolveClassificationStatus(input: {
  normalizedEmploymentType: NormalizedEmploymentType;
  normalizedCareerStage: NormalizedCareerStage;
  normalizedIndustry: NormalizedIndustry;
  normalizedRoleCategory: NormalizedRoleCategory;
  confidence: JobMetadataClassification["confidence"];
}): JobClassificationStatus {
  const hasConfidentRole =
    input.normalizedRoleCategory !== "OTHER_UNKNOWN" &&
    input.confidence.roleCategory >= ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD;
  const hasConfidentCareerStage =
    input.normalizedCareerStage !== "UNKNOWN" &&
    input.confidence.careerStage >= CAREER_STAGE_FILTER_CONFIDENCE_THRESHOLD;
  const hasConfidentEmploymentType =
    input.normalizedEmploymentType !== "UNKNOWN" &&
    input.confidence.employmentType >= EMPLOYMENT_TYPE_FILTER_CONFIDENCE_THRESHOLD;
  const hasConfidentIndustry =
    input.normalizedIndustry !== "UNKNOWN" &&
    input.confidence.industry >= INDUSTRY_FILTER_CONFIDENCE_THRESHOLD;

  if (hasConfidentRole && (hasConfidentCareerStage || hasConfidentEmploymentType)) {
    return "CONFIDENT";
  }

  if (
    hasConfidentRole ||
    hasConfidentCareerStage ||
    hasConfidentEmploymentType ||
    hasConfidentIndustry
  ) {
    return "PARTIAL";
  }

  return "UNKNOWN";
}

export function classifyJobMetadata(input: JobMetadataInput): JobMetadataClassification {
  const employment = classifyEmploymentType(input);
  const careerStage = classifyCareerStage(input);
  const roleCategory = classifyRoleCategory(input);
  const industry = classifyIndustry(input);
  const workModeConfidence = input.workMode && input.workMode !== "UNKNOWN" ? 0.8 : 0.2;
  const confidence = {
    employmentType: employment.confidence,
    careerStage: careerStage.confidence,
    industry: industry.confidence,
    roleCategory: roleCategory.confidence,
    workMode: workModeConfidence,
  };

  return {
    experienceLevel: careerStage.experienceLevel,
    normalizedEmploymentType: employment.value,
    normalizedCareerStage: careerStage.value,
    experienceLevelGroup: careerStage.group,
    experienceLevelSource: careerStage.source,
    experienceLevelEvidence: careerStage.signals,
    experienceLevelWarnings: careerStage.warnings,
    normalizedIndustry: industry.value,
    normalizedIndustries: industry.values,
    normalizedRoleCategory: roleCategory.value,
    normalizedRoleCategoryGroup: roleCategory.group,
    normalizedRoleCategoryStatus: roleCategory.status,
    normalizedRoleCategorySource: roleCategory.source,
    normalizedRoleCategoryCandidates: roleCategory.candidates,
    normalizedRoleCategoryEvidence: roleCategory.evidence,
    normalizedRoleCategoryWarnings: roleCategory.warnings,
    normalizedRoleCategoryRejectedCandidates: roleCategory.rejectedCandidates,
    classificationStatus: resolveClassificationStatus({
      normalizedEmploymentType: employment.value,
      normalizedCareerStage: careerStage.value,
      normalizedIndustry: industry.value,
      normalizedRoleCategory: roleCategory.value,
      confidence,
    }),
    confidence,
    signals: [
      ...employment.signals,
      ...careerStage.signals,
      ...roleCategory.signals,
      ...industry.signals,
    ],
  };
}

function normalizeToken(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\/]+/g, "_")
    .replace(/[\s-]+/g, "_")
    .replace(/_+&_*|_AND_/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function normalizeFilterValues<T extends string>(
  value: string | undefined,
  allowed: Set<T | string>,
  aliases: Record<string, T> = {}
) {
  if (!value) return undefined;
  const seen = new Set<T>();
  const values: T[] = [];

  for (const entry of value.split(",")) {
    const token = normalizeToken(entry);
    if (!token) continue;
    const normalized = aliases[token] ?? (allowed.has(token) ? (token as T) : null);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    values.push(normalized);
  }

  return values.length > 0 ? values.join(",") : undefined;
}

export function normalizeEmploymentTypeFilterValue(value?: string) {
  return normalizeFilterValues<NormalizedEmploymentType>(value, EMPLOYMENT_VALUES);
}

export function normalizeEmploymentTypeGroupFilterValue(value?: string) {
  return normalizeFilterValues<NormalizedEmploymentTypeGroup>(
    value,
    EMPLOYMENT_GROUP_VALUES,
    EMPLOYMENT_GROUP_ALIASES
  );
}

export function normalizeCareerStageFilterValue(value?: string) {
  return normalizeFilterValues<NormalizedCareerStage>(
    value,
    CAREER_STAGE_VALUES,
    CAREER_STAGE_ALIASES
  );
}

export function normalizeExperienceLevelGroupFilterValue(value?: string) {
  if (!value) return undefined;
  const seen = new Set<ExperienceLevelGroup>();
  const values: ExperienceLevelGroup[] = [];

  for (const raw of value.split(",")) {
    const group = normalizeExperienceLevelGroupToken(raw);
    if (!group || !EXPERIENCE_LEVEL_GROUP_VALUES.has(group) || seen.has(group)) continue;
    seen.add(group);
    values.push(group);
  }

  return values.length > 0 ? values.join(",") : undefined;
}

export function normalizeIndustryFilterValue(value?: string) {
  return normalizeFilterValues<NormalizedIndustry>(value, INDUSTRY_VALUES, INDUSTRY_ALIASES);
}

export function normalizeRoleCategoryFilterValue(value?: string) {
  return normalizeFilterValues<NormalizedRoleCategory>(
    value,
    ROLE_CATEGORY_VALUES,
    ROLE_CATEGORY_FILTER_ALIASES
  );
}

export function expandNormalizedRoleCategoryFilterValue(value?: string) {
  const normalized = normalizeRoleCategoryFilterValue(value);
  if (!normalized) return undefined;

  const expansions: Partial<Record<NormalizedRoleCategory, NormalizedRoleCategory[]>> = {
    SALES: ["SALES", "BUSINESS_DEVELOPMENT"],
    OPERATIONS: ["OPERATIONS", "SUPPLY_CHAIN_LOGISTICS", "PROJECT_PROGRAM_MANAGEMENT"],
    SKILLED_TRADES_FACILITIES: ["SKILLED_TRADES_FACILITIES", "MANUFACTURING_TRADES"],
  };
  const seen = new Set<NormalizedRoleCategory>();
  const values: NormalizedRoleCategory[] = [];

  for (const entry of normalized.split(",") as NormalizedRoleCategory[]) {
    for (const expanded of expansions[entry] ?? [entry]) {
      if (seen.has(expanded)) continue;
      seen.add(expanded);
      values.push(expanded);
    }
  }

  return values.length > 0 ? values.join(",") : undefined;
}

const ROLE_CATEGORY_DISPLAY_ALIASES: Partial<Record<NormalizedRoleCategory, string>> = {
  BUSINESS_DEVELOPMENT: "Sales / Business Development",
  SUPPLY_CHAIN_LOGISTICS: "Operations / Supply Chain",
  PROJECT_PROGRAM_MANAGEMENT: "Operations / Supply Chain",
  MANUFACTURING_TRADES: "Skilled Trades / Facilities",
};

export function getNormalizedRoleCategoryLabel(value?: string | null) {
  if (!value || value === "OTHER_UNKNOWN") return null;
  return (
    ROLE_CATEGORY_DISPLAY_ALIASES[value as NormalizedRoleCategory] ??
    NORMALIZED_ROLE_CATEGORY_OPTIONS.find((option) => option.value === value)?.label ??
    null
  );
}

export function coerceNormalizedEmploymentType(value?: string | null): NormalizedEmploymentType {
  return (normalizeEmploymentTypeFilterValue(value ?? undefined)?.split(",")[0] ??
    "UNKNOWN") as NormalizedEmploymentType;
}

export function coerceNormalizedCareerStage(value?: string | null): NormalizedCareerStage {
  return (normalizeCareerStageFilterValue(value ?? undefined)?.split(",")[0] ??
    "UNKNOWN") as NormalizedCareerStage;
}

export function coerceExperienceLevelGroup(value?: string | null): ExperienceLevelGroup {
  return (normalizeExperienceLevelGroupFilterValue(value ?? undefined)?.split(",")[0] ??
    "UNKNOWN") as ExperienceLevelGroup;
}

export function coerceNormalizedIndustry(value?: string | null): NormalizedIndustry {
  return (normalizeIndustryFilterValue(value ?? undefined)?.split(",")[0] ??
    "UNKNOWN") as NormalizedIndustry;
}

export function coerceNormalizedRoleCategory(value?: string | null): NormalizedRoleCategory {
  return (normalizeRoleCategoryFilterValue(value ?? undefined)?.split(",")[0] ??
    "OTHER_UNKNOWN") as NormalizedRoleCategory;
}
