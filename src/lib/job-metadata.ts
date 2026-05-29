import type { EmploymentType, Industry, WorkMode } from "@/generated/prisma/client";

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
  | "FINANCE_BANKING"
  | "CONSULTING_PROFESSIONAL_SERVICES"
  | "HEALTHCARE_LIFE_SCIENCES"
  | "EDUCATION"
  | "RETAIL_CONSUMER_GOODS"
  | "MANUFACTURING_INDUSTRIAL"
  | "ENERGY_UTILITIES"
  | "GOVERNMENT_PUBLIC_SECTOR"
  | "LEGAL"
  | "MEDIA_ENTERTAINMENT"
  | "TELECOMMUNICATIONS"
  | "TRANSPORTATION_LOGISTICS"
  | "REAL_ESTATE_CONSTRUCTION"
  | "HOSPITALITY_FOOD_SERVICES"
  | "NONPROFIT_SOCIAL_IMPACT"
  | "AGRICULTURE_NATURAL_RESOURCES"
  | "INSURANCE"
  | "AEROSPACE_DEFENSE"
  | "OTHER_UNKNOWN";

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
  | "HEALTHCARE_ADMINISTRATION"
  | "RESEARCH_SCIENCE"
  | "EDUCATION_ADMINISTRATION"
  | "ENGINEERING_HARDWARE"
  | "SUPPLY_CHAIN_LOGISTICS"
  | "PROJECT_PROGRAM_MANAGEMENT"
  | "ADMINISTRATIVE"
  | "BUSINESS_DEVELOPMENT"
  | "OTHER_UNKNOWN";

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

export const NORMALIZED_INDUSTRY_OPTIONS: Array<TaxonomyOption<NormalizedIndustry>> = [
  { label: "Technology", value: "TECHNOLOGY" },
  { label: "Finance & Banking", value: "FINANCE_BANKING" },
  { label: "Consulting & Professional Services", value: "CONSULTING_PROFESSIONAL_SERVICES" },
  { label: "Healthcare & Life Sciences", value: "HEALTHCARE_LIFE_SCIENCES" },
  { label: "Education", value: "EDUCATION" },
  { label: "Retail & Consumer Goods", value: "RETAIL_CONSUMER_GOODS" },
  { label: "Manufacturing & Industrial", value: "MANUFACTURING_INDUSTRIAL" },
  { label: "Energy & Utilities", value: "ENERGY_UTILITIES" },
  { label: "Government & Public Sector", value: "GOVERNMENT_PUBLIC_SECTOR" },
  { label: "Legal", value: "LEGAL" },
  { label: "Media & Entertainment", value: "MEDIA_ENTERTAINMENT" },
  { label: "Telecommunications", value: "TELECOMMUNICATIONS" },
  { label: "Transportation & Logistics", value: "TRANSPORTATION_LOGISTICS" },
  { label: "Real Estate & Construction", value: "REAL_ESTATE_CONSTRUCTION" },
  { label: "Hospitality & Food Services", value: "HOSPITALITY_FOOD_SERVICES" },
  { label: "Nonprofit & Social Impact", value: "NONPROFIT_SOCIAL_IMPACT" },
  { label: "Agriculture & Natural Resources", value: "AGRICULTURE_NATURAL_RESOURCES" },
  { label: "Insurance", value: "INSURANCE" },
  { label: "Aerospace & Defense", value: "AEROSPACE_DEFENSE" },
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
  { label: "Investment / Banking", value: "INVESTMENT_BANKING" },
  { label: "Consulting", value: "CONSULTING" },
  { label: "Sales", value: "SALES" },
  { label: "Marketing", value: "MARKETING" },
  { label: "Operations", value: "OPERATIONS" },
  { label: "Customer Success / Support", value: "CUSTOMER_SUCCESS_SUPPORT" },
  { label: "Human Resources / Recruiting", value: "HUMAN_RESOURCES_RECRUITING" },
  { label: "Legal / Compliance", value: "LEGAL_COMPLIANCE" },
  { label: "Healthcare Administration", value: "HEALTHCARE_ADMINISTRATION" },
  { label: "Research / Science", value: "RESEARCH_SCIENCE" },
  { label: "Education Administration", value: "EDUCATION_ADMINISTRATION" },
  { label: "Engineering / Hardware", value: "ENGINEERING_HARDWARE" },
  { label: "Supply Chain / Logistics", value: "SUPPLY_CHAIN_LOGISTICS" },
  { label: "Project / Program Management", value: "PROJECT_PROGRAM_MANAGEMENT" },
  { label: "Administrative", value: "ADMINISTRATIVE" },
  { label: "Business Development", value: "BUSINESS_DEVELOPMENT" },
];

const EMPLOYMENT_VALUES = new Set(NORMALIZED_EMPLOYMENT_TYPE_OPTIONS.map((option) => option.value).concat("UNKNOWN"));
const CAREER_STAGE_VALUES = new Set(NORMALIZED_CAREER_STAGE_OPTIONS.map((option) => option.value).concat("UNKNOWN"));
const INDUSTRY_VALUES = new Set(NORMALIZED_INDUSTRY_OPTIONS.map((option) => option.value).concat("OTHER_UNKNOWN"));
const ROLE_CATEGORY_VALUES = new Set(NORMALIZED_ROLE_CATEGORY_OPTIONS.map((option) => option.value).concat("OTHER_UNKNOWN"));

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

const INDUSTRY_ALIASES: Record<string, NormalizedIndustry> = {
  TECH: "TECHNOLOGY",
  FINANCE: "FINANCE_BANKING",
  GENERAL: "OTHER_UNKNOWN",
};

const ROLE_FAMILY_ALIASES: Record<string, NormalizedRoleCategory> = {
  SWE: "SOFTWARE_ENGINEERING",
  ENGINEERING: "ENGINEERING_HARDWARE",
  "SOLUTIONS ENGINEERING": "SOFTWARE_ENGINEERING",
  "SOLUTIONS ARCHITECTURE": "IT_SYSTEMS_DEVOPS",
  "PRODUCT MANAGEMENT": "PRODUCT_MANAGEMENT",
  "PROJECT MANAGEMENT": "PROJECT_PROGRAM_MANAGEMENT",
  RESEARCH: "RESEARCH_SCIENCE",
  "DATA SCIENCE": "DATA_ANALYTICS",
  "AI TRAINING": "AI_MACHINE_LEARNING",
  "DATA ENGINEERING": "DATA_ANALYTICS",
  "DATA ANALYST": "DATA_ANALYTICS",
  "PRODUCT ANALYST": "DATA_ANALYTICS",
  "BUSINESS ANALYST": "OPERATIONS",
  SECURITY: "CYBERSECURITY",
  QA: "SOFTWARE_ENGINEERING",
  "IT OPERATIONS": "IT_SYSTEMS_DEVOPS",
  "TECHNICAL WRITING": "PROJECT_PROGRAM_MANAGEMENT",
  DESIGN: "DESIGN_UX",
  "CUSTOMER SUCCESS": "CUSTOMER_SUCCESS_SUPPORT",
  "FINANCIAL ANALYST": "FINANCE_ACCOUNTING",
  "FP&A": "FINANCE_ACCOUNTING",
  ACCOUNTING: "FINANCE_ACCOUNTING",
  "QUANTITATIVE FINANCE": "INVESTMENT_BANKING",
  "INVESTMENT BANKING": "INVESTMENT_BANKING",
  BANKING: "INVESTMENT_BANKING",
  RISK: "FINANCE_ACCOUNTING",
  COMPLIANCE: "LEGAL_COMPLIANCE",
  CREDIT: "INVESTMENT_BANKING",
  "WEALTH MANAGEMENT": "INVESTMENT_BANKING",
  MARKETING: "MARKETING",
  "HR / PEOPLE": "HUMAN_RESOURCES_RECRUITING",
  SALES: "SALES",
  "BUSINESS DEVELOPMENT": "BUSINESS_DEVELOPMENT",
  CONSULTING: "CONSULTING",
  LEGAL: "LEGAL_COMPLIANCE",
  "SUPPLY CHAIN": "SUPPLY_CHAIN_LOGISTICS",
  COMMUNICATIONS: "MARKETING",
  ADMINISTRATIVE: "ADMINISTRATIVE",
  OPERATIONS: "OPERATIONS",
  INSURANCE: "FINANCE_ACCOUNTING",
  "HEALTHCARE ADMIN": "HEALTHCARE_ADMINISTRATION",
  "REAL ESTATE": "OPERATIONS",
  "HOSPITALITY MANAGEMENT": "OPERATIONS",
  GOVERNMENT: "OPERATIONS",
  EDITORIAL: "MARKETING",
  NONPROFIT: "OPERATIONS",
  "EDUCATION ADMIN": "EDUCATION_ADMINISTRATION",
  TECHNICAL: "IT_SYSTEMS_DEVOPS",
  INTERNSHIP: "OTHER_UNKNOWN",
};

const ROLE_CATEGORY_FILTER_ALIASES: Record<string, NormalizedRoleCategory> = {
  SWE: "SOFTWARE_ENGINEERING",
  SOFTWARE: "SOFTWARE_ENGINEERING",
  SOFTWARE_ENGINEER: "SOFTWARE_ENGINEERING",
  SOFTWARE_ENGINEERING: "SOFTWARE_ENGINEERING",
  DATA: "DATA_ANALYTICS",
  DATA_ANALYTICS: "DATA_ANALYTICS",
};

export type JobMetadataInput = {
  title: string;
  company?: string | null;
  description?: string | null;
  location?: string | null;
  roleFamily?: string | null;
  legacyIndustry?: Industry | null;
  sourceEmploymentType?: EmploymentType | null;
  inferredEmploymentType?: EmploymentType | null;
  workMode?: WorkMode | null;
};

export type JobMetadataClassification = {
  normalizedEmploymentType: NormalizedEmploymentType;
  normalizedCareerStage: NormalizedCareerStage;
  normalizedIndustry: NormalizedIndustry;
  normalizedRoleCategory: NormalizedRoleCategory;
  confidence: {
    employmentType: number;
    careerStage: number;
    industry: number;
    roleCategory: number;
    workMode: number;
  };
  signals: string[];
};

type PatternDefinition<T extends string> = {
  value: T;
  title?: RegExp[];
  text?: RegExp[];
  company?: RegExp[];
  roleFamily?: RegExp[];
  confidence: number;
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
  /\b(?:this|the|our)\s+(?:internship|co[-\s]?op|student\s+program)\b/i,
  /\binternship\s+program\b/i,
  /\bco[-\s]?op\s+(?:program|position|role|term)\b/i,
  /\bstudent\s+(?:placement|work\s+term|program)\b/i,
  /\bearly\s+talent\s+(?:program|role|position)\b/i,
  /\buniversity\s+(?:program|recruiting|hire)\b/i,
];

const NEW_GRAD_PATTERNS = [
  /\bnew\s+grad(?:uate)?\b/i,
  /\brecent\s+grad(?:uate)?\b/i,
  /\bgraduate\s+(?:program|role|hire|analyst)\b/i,
  /\bcampus\s+hire\b/i,
  /\buniversity\s+hire\b/i,
  /\bearly\s+career\b/i,
  /\b0\s*[-–—to]+\s*2\s+years?\b/i,
  /\b(?:no|limited)\s+prior\s+experience\b/i,
];

const SENIOR_OR_LEADERSHIP_TITLE_PATTERN =
  /\b(senior|sr\.?|staff|principal|lead|manager|director|vp\b|vice president|chief|head of)\b/i;

const TITLE_COOP_ROLE_PATTERNS = [
  /\bco[-\s]?op\s*\/\s*interns?\b/i,
  /\binterns?\s*\/\s*co[-\s]?op\b/i,
  /\bco[-\s]?op\s+(?:intern|student|placement|term|position|role|program)\b/i,
  /\b(?:intern|student|placement|term|position|role|program)\s+co[-\s]?op\b/i,
];

const ROLE_CATEGORY_PATTERNS: Array<PatternDefinition<NormalizedRoleCategory>> = [
  {
    value: "AI_MACHINE_LEARNING",
    title: [/\b(machine learning|ml engineer|ai engineer|llm|deep learning|computer vision|nlp)\b/i],
    text: [/\b(machine learning|artificial intelligence|deep learning|large language models?)\b/i],
    confidence: 0.92,
    signals: ["ai_ml_keywords"],
  },
  {
    value: "SOFTWARE_ENGINEERING",
    title: [/\b(software|frontend|front-end|backend|back-end|full[-\s]?stack|web|mobile|ios|android|developer|sre)\b/i],
    text: [/\b(typescript|javascript|python|java|react|node\.js|api|microservices|software development)\b/i],
    confidence: 0.9,
    signals: ["software_keywords"],
  },
  {
    value: "DATA_ANALYTICS",
    title: [/\b(data scientist|data analyst|analytics?|business intelligence|bi analyst|data engineer|analytics engineer)\b/i],
    text: [/\b(sql|tableau|power bi|data pipeline|warehouse|analytics)\b/i],
    confidence: 0.9,
    signals: ["data_keywords"],
  },
  {
    value: "PRODUCT_MANAGEMENT",
    title: [/\b(product manager|product owner|technical product|product lead)\b/i],
    confidence: 0.9,
    signals: ["product_keywords"],
  },
  {
    value: "DESIGN_UX",
    title: [/\b(product designer|ux|ui designer|visual designer|design researcher)\b/i],
    confidence: 0.88,
    signals: ["design_keywords"],
  },
  {
    value: "CYBERSECURITY",
    title: [/\b(security engineer|cybersecurity|cyber security|information security|appsec|secops|soc analyst)\b/i],
    confidence: 0.9,
    signals: ["security_keywords"],
  },
  {
    value: "IT_SYSTEMS_DEVOPS",
    title: [/\b(devops|platform engineer|systems engineer|cloud engineer|network engineer|it support|systems administrator|solutions architect)\b/i],
    confidence: 0.86,
    signals: ["it_systems_keywords"],
  },
  {
    value: "INVESTMENT_BANKING",
    title: [/\b(investment banking|private equity|asset management|wealth management|portfolio|trader|trading|quantitative)\b/i],
    confidence: 0.88,
    signals: ["investment_keywords"],
  },
  {
    value: "FINANCE_ACCOUNTING",
    title: [/\b(accountant|accounting|finance|financial analyst|fp&a|controller|bookkeeper|tax|audit|treasury|payroll|underwriter|claims)\b/i],
    confidence: 0.86,
    signals: ["finance_accounting_keywords"],
  },
  {
    value: "CONSULTING",
    title: [/\b(consultant|consulting|engagement manager|strategy associate|advisory)\b/i],
    confidence: 0.86,
    signals: ["consulting_keywords"],
  },
  {
    value: "SALES",
    title: [/\b(account executive|sales|business development representative|sdr|bdr|revenue)\b/i],
    confidence: 0.84,
    signals: ["sales_keywords"],
  },
  {
    value: "MARKETING",
    title: [/\b(marketing|growth|brand|content strategist|communications|copywriter|editorial|social media)\b/i],
    confidence: 0.84,
    signals: ["marketing_keywords"],
  },
  {
    value: "HUMAN_RESOURCES_RECRUITING",
    title: [/\b(recruiter|talent acquisition|human resources|hrbp|people operations|compensation|benefits)\b/i],
    confidence: 0.86,
    signals: ["hr_keywords"],
  },
  {
    value: "LEGAL_COMPLIANCE",
    title: [/\b(counsel|legal|paralegal|compliance|contracts manager|privacy)\b/i],
    confidence: 0.86,
    signals: ["legal_keywords"],
  },
  {
    value: "SUPPLY_CHAIN_LOGISTICS",
    title: [/\b(supply chain|logistics|procurement|buyer|inventory|demand planner|warehouse operations)\b/i],
    confidence: 0.84,
    signals: ["supply_chain_keywords"],
  },
  {
    value: "CUSTOMER_SUCCESS_SUPPORT",
    title: [/\b(customer success|customer support|support specialist|solutions consultant|implementation consultant)\b/i],
    confidence: 0.82,
    signals: ["customer_success_keywords"],
  },
  {
    value: "PROJECT_PROGRAM_MANAGEMENT",
    title: [/\b(project manager|program manager|scrum master|delivery manager|technical writer)\b/i],
    confidence: 0.82,
    signals: ["project_program_keywords"],
  },
  {
    value: "HEALTHCARE_ADMINISTRATION",
    title: [/\b(healthcare administrator|hospital administrator|medical biller|medical coding|revenue cycle|clinical operations)\b/i],
    confidence: 0.84,
    signals: ["healthcare_admin_keywords"],
  },
  {
    value: "EDUCATION_ADMINISTRATION",
    title: [/\b(admissions|registrar|academic advisor|education administrator|student affairs)\b/i],
    confidence: 0.82,
    signals: ["education_admin_keywords"],
  },
  {
    value: "RESEARCH_SCIENCE",
    title: [/\b(research scientist|research analyst|scientist|lab manager|policy analyst)\b/i],
    confidence: 0.82,
    signals: ["research_keywords"],
  },
  {
    value: "ENGINEERING_HARDWARE",
    title: [/\b(mechanical engineer|electrical engineer|hardware engineer|civil engineer|aerospace engineer|industrial engineer|manufacturing engineer)\b/i],
    confidence: 0.82,
    signals: ["hardware_engineering_keywords"],
  },
  {
    value: "ADMINISTRATIVE",
    title: [/\b(administrative assistant|executive assistant|office manager|office coordinator|scheduler|receptionist)\b/i],
    confidence: 0.82,
    signals: ["administrative_keywords"],
  },
  {
    value: "BUSINESS_DEVELOPMENT",
    title: [/\b(business development|partnerships|strategic partnerships)\b/i],
    confidence: 0.82,
    signals: ["business_development_keywords"],
  },
  {
    value: "OPERATIONS",
    title: [/\b(operations|business operations|chief of staff|process improvement|operations analyst)\b/i],
    confidence: 0.8,
    signals: ["operations_keywords"],
  },
];

const INDUSTRY_PATTERNS: Array<PatternDefinition<NormalizedIndustry>> = [
  {
    value: "FINANCE_BANKING",
    company: [/\b(bank|capital|financial|finance|credit|payments|stripe|visa|mastercard|jpmorgan|goldman|morgan stanley|citi|rbc|td|bmo|scotiabank|cibc|capital one)\b/i],
    text: [/\b(bank|banking|financial services|fintech|payments|credit union|capital markets|asset management|wealth management)\b/i],
    roleFamily: [/\b(finance|accounting|banking|investment|credit|wealth|risk)\b/i],
    confidence: 0.86,
    signals: ["finance_industry_keywords"],
  },
  {
    value: "HEALTHCARE_LIFE_SCIENCES",
    company: [/\b(health|hospital|medical|clinic|pharma|biotech|life sciences|therapeutics|genomics)\b/i],
    text: [/\b(healthcare|health care|life sciences|pharmaceutical|biotech|clinical operations|patient experience|medical device)\b/i],
    roleFamily: [/\b(healthcare admin|medical|clinical operations)\b/i],
    confidence: 0.84,
    signals: ["healthcare_industry_keywords"],
  },
  {
    value: "CONSULTING_PROFESSIONAL_SERVICES",
    company: [/\b(consulting|deloitte|accenture|mckinsey|bain|bcg|pwc|kpmg|ey)\b/i],
    text: [/\b(consulting firm|professional services|client advisory|management consulting)\b/i],
    roleFamily: [/\bconsulting\b/i],
    confidence: 0.82,
    signals: ["consulting_industry_keywords"],
  },
  {
    value: "INSURANCE",
    company: [/\b(insurance|assurance|mutual|life|allstate|geico|progressive|manulife|sun life)\b/i],
    text: [/\b(insurance|underwriting|claims|policyholder|actuarial)\b/i],
    roleFamily: [/\binsurance\b/i],
    confidence: 0.82,
    signals: ["insurance_industry_keywords"],
  },
  {
    value: "GOVERNMENT_PUBLIC_SECTOR",
    company: [/\b(government|department|ministry|city of|county|state of|public sector|public service)\b/i],
    text: [/\b(government|public sector|federal|municipal|provincial|state agency)\b/i],
    roleFamily: [/\bgovernment\b/i],
    confidence: 0.82,
    signals: ["government_industry_keywords"],
  },
  {
    value: "EDUCATION",
    company: [/\b(university|college|school district|education|academy)\b/i],
    text: [/\b(higher education|university|college|student affairs|academic administration)\b/i],
    roleFamily: [/\beducation\b/i],
    confidence: 0.8,
    signals: ["education_industry_keywords"],
  },
  {
    value: "LEGAL",
    company: [/\b(law firm|legal|llp|litigation)\b/i],
    text: [/\b(law firm|legal services|litigation|corporate law)\b/i],
    roleFamily: [/\blegal\b/i],
    confidence: 0.8,
    signals: ["legal_industry_keywords"],
  },
  {
    value: "REAL_ESTATE_CONSTRUCTION",
    company: [/\b(real estate|property|construction|builder|development)\b/i],
    text: [/\b(real estate|property management|construction|leasing|facilities)\b/i],
    roleFamily: [/\breal estate\b/i],
    confidence: 0.78,
    signals: ["real_estate_industry_keywords"],
  },
  {
    value: "TRANSPORTATION_LOGISTICS",
    company: [/\b(logistics|transportation|freight|shipping|airlines?|rail|delivery)\b/i],
    text: [/\b(logistics|transportation|freight|supply chain network|fleet)\b/i],
    roleFamily: [/\bsupply chain|logistics\b/i],
    confidence: 0.78,
    signals: ["transportation_industry_keywords"],
  },
  {
    value: "ENERGY_UTILITIES",
    company: [/\b(energy|utility|utilities|power|solar|renewables|oil|gas)\b/i],
    text: [/\b(energy|utilities|power grid|renewable energy|oil and gas)\b/i],
    confidence: 0.78,
    signals: ["energy_industry_keywords"],
  },
  {
    value: "AEROSPACE_DEFENSE",
    company: [/\b(aerospace|defense|defence|lockheed|boeing|northrop|raytheon)\b/i],
    text: [/\b(aerospace|defense|defence|aviation|space systems)\b/i],
    confidence: 0.78,
    signals: ["aerospace_industry_keywords"],
  },
  {
    value: "TELECOMMUNICATIONS",
    company: [/\b(telecom|telecommunications|wireless|verizon|rogers|bell|telus|at&t)\b/i],
    text: [/\b(telecom|telecommunications|wireless network|5g)\b/i],
    confidence: 0.76,
    signals: ["telecom_industry_keywords"],
  },
  {
    value: "MEDIA_ENTERTAINMENT",
    company: [/\b(media|entertainment|streaming|publishing|studio|news)\b/i],
    text: [/\b(media|entertainment|publishing|editorial|streaming|content production)\b/i],
    roleFamily: [/\beditorial|communications\b/i],
    confidence: 0.76,
    signals: ["media_industry_keywords"],
  },
  {
    value: "NONPROFIT_SOCIAL_IMPACT",
    company: [/\b(nonprofit|non-profit|foundation|charity|philanthropy|ngo)\b/i],
    text: [/\b(nonprofit|non-profit|social impact|philanthropy|foundation|charity)\b/i],
    roleFamily: [/\bnonprofit\b/i],
    confidence: 0.76,
    signals: ["nonprofit_industry_keywords"],
  },
  {
    value: "RETAIL_CONSUMER_GOODS",
    company: [/\b(retail|consumer|walmart|target|amazon|shopify|nike|lululemon|costco)\b/i],
    text: [/\b(retail|consumer goods|ecommerce|e-commerce|merchandising|marketplace)\b/i],
    confidence: 0.72,
    signals: ["retail_industry_keywords"],
  },
  {
    value: "MANUFACTURING_INDUSTRIAL",
    company: [/\b(manufacturing|industrial|factory|materials|automation)\b/i],
    text: [/\b(manufacturing|industrial operations|production systems|plant operations)\b/i],
    confidence: 0.7,
    signals: ["manufacturing_industry_keywords"],
  },
  {
    value: "AGRICULTURE_NATURAL_RESOURCES",
    company: [/\b(agriculture|farming|natural resources|forestry|mining)\b/i],
    text: [/\b(agriculture|farming|forestry|mining|natural resources)\b/i],
    confidence: 0.7,
    signals: ["agriculture_industry_keywords"],
  },
  {
    value: "TECHNOLOGY",
    company: [/\b(software|technology|tech|cloud|data|ai|systems|digital|saas|microsoft|google|meta|apple|nvidia|oracle|salesforce)\b/i],
    text: [/\b(software company|technology company|saas|cloud platform|developer platform|artificial intelligence)\b/i],
    roleFamily: [/\b(swe|software|data science|data engineering|security|it operations|technical|product management|design)\b/i],
    confidence: 0.7,
    signals: ["technology_industry_keywords"],
  },
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

function firstPatternMatch<T extends string>(
  patterns: Array<PatternDefinition<T>>,
  input: {
    title: string;
    text: string;
    company: string;
    roleFamily: string;
  }
) {
  for (const pattern of patterns) {
    if (
      matchesAny(input.title, pattern.title) ||
      matchesAny(input.text, pattern.text) ||
      matchesAny(input.company, pattern.company) ||
      matchesAny(input.roleFamily, pattern.roleFamily)
    ) {
      return pattern;
    }
  }

  return null;
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
  value: NormalizedCareerStage;
  confidence: number;
  signals: string[];
} {
  const title = normalizeText(input.title);
  const text = normalizeText(`${input.title} ${input.description ?? ""}`);

  if (hasStrongInternshipEvidence(input)) {
    return {
      value: "INTERNSHIP_COOP_STUDENT",
      confidence: 0.94,
      signals: ["strong_internship_evidence"],
    };
  }
  if (matchesAny(title, NEW_GRAD_PATTERNS) || matchesAny(text, NEW_GRAD_PATTERNS)) {
    return { value: "ENTRY_LEVEL_NEW_GRAD", confidence: 0.84, signals: ["entry_or_new_grad"] };
  }
  if (/\b(chief|c-suite|ceo|cto|cfo|coo|cio|president|vice president|vp\b)\b/i.test(title)) {
    return { value: "EXECUTIVE", confidence: 0.92, signals: ["executive_title"] };
  }
  if (/\b(director|head of)\b/i.test(title)) {
    return { value: "DIRECTOR", confidence: 0.9, signals: ["director_title"] };
  }
  if (/\b(manager|supervisor)\b/i.test(title)) {
    return { value: "MANAGER", confidence: 0.86, signals: ["manager_title"] };
  }
  if (/\b(staff|principal|lead|distinguished|fellow)\b/i.test(title)) {
    return { value: "STAFF_PRINCIPAL", confidence: 0.86, signals: ["staff_principal_lead_title"] };
  }
  if (/\b(senior|sr\.?|senior-level)\b/i.test(title) || /\b[5-9]\+?\s+years\b|\b10\+?\s+years\b/i.test(text)) {
    return { value: "SENIOR", confidence: 0.84, signals: ["senior_title_or_years"] };
  }
  if (/\b(mid[-\s]?level|intermediate)\b/i.test(title) || /\b3\s*[-–—to]+\s*5\s+years?\b/i.test(text)) {
    return { value: "MID_LEVEL", confidence: 0.78, signals: ["mid_level_signal"] };
  }
  if (/\b(junior|jr\.?|associate|associate-level)\b/i.test(title) || /\b1\s*[-–—to]+\s*3\s+years?\b/i.test(text)) {
    return { value: "ASSOCIATE_JUNIOR", confidence: 0.76, signals: ["junior_associate_signal"] };
  }

  return { value: "UNKNOWN", confidence: 0.2, signals: ["unknown_career_stage"] };
}

function classifyRoleCategory(input: JobMetadataInput): {
  value: NormalizedRoleCategory;
  confidence: number;
  signals: string[];
} {
  const roleFamilyKey = normalizeText(input.roleFamily).toUpperCase();
  const roleFamilyAlias = ROLE_FAMILY_ALIASES[roleFamilyKey];
  if (roleFamilyAlias) {
    return { value: roleFamilyAlias, confidence: 0.9, signals: ["legacy_role_family_mapping"] };
  }

  const match = firstPatternMatch(ROLE_CATEGORY_PATTERNS, {
    title: input.title,
    text: `${input.title} ${input.description ?? ""}`,
    company: input.company ?? "",
    roleFamily: input.roleFamily ?? "",
  });

  if (match) {
    return { value: match.value, confidence: match.confidence, signals: match.signals };
  }

  return { value: "OTHER_UNKNOWN", confidence: 0.2, signals: ["unknown_role_category"] };
}

function classifyIndustry(input: JobMetadataInput, roleCategory: NormalizedRoleCategory): {
  value: NormalizedIndustry;
  confidence: number;
  signals: string[];
} {
  const match = firstPatternMatch(INDUSTRY_PATTERNS, {
    title: input.title,
    text: `${input.title} ${input.description ?? ""}`,
    company: input.company ?? "",
    roleFamily: input.roleFamily ?? "",
  });

  if (match) {
    return { value: match.value, confidence: match.confidence, signals: match.signals };
  }

  if (input.legacyIndustry === "TECH") {
    return { value: "TECHNOLOGY", confidence: 0.62, signals: ["legacy_industry_tech"] };
  }
  if (input.legacyIndustry === "FINANCE") {
    return { value: "FINANCE_BANKING", confidence: 0.62, signals: ["legacy_industry_finance"] };
  }
  if (
    roleCategory === "SOFTWARE_ENGINEERING" ||
    roleCategory === "DATA_ANALYTICS" ||
    roleCategory === "AI_MACHINE_LEARNING" ||
    roleCategory === "PRODUCT_MANAGEMENT" ||
    roleCategory === "IT_SYSTEMS_DEVOPS" ||
    roleCategory === "CYBERSECURITY"
  ) {
    return { value: "TECHNOLOGY", confidence: 0.55, signals: ["role_category_technology_default"] };
  }

  return { value: "OTHER_UNKNOWN", confidence: 0.2, signals: ["unknown_industry"] };
}

export function classifyJobMetadata(input: JobMetadataInput): JobMetadataClassification {
  const employment = classifyEmploymentType(input);
  const careerStage = classifyCareerStage(input);
  const roleCategory = classifyRoleCategory(input);
  const industry = classifyIndustry(input, roleCategory.value);
  const workModeConfidence = input.workMode && input.workMode !== "UNKNOWN" ? 0.8 : 0.2;

  return {
    normalizedEmploymentType: employment.value,
    normalizedCareerStage: careerStage.value,
    normalizedIndustry: industry.value,
    normalizedRoleCategory: roleCategory.value,
    confidence: {
      employmentType: employment.confidence,
      careerStage: careerStage.confidence,
      industry: industry.confidence,
      roleCategory: roleCategory.confidence,
      workMode: workModeConfidence,
    },
    signals: [
      ...employment.signals,
      ...careerStage.signals,
      ...roleCategory.signals,
      ...industry.signals,
    ],
  };
}

function normalizeToken(value: string) {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_").replace(/_+&_*|_AND_/g, "_");
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

export function normalizeCareerStageFilterValue(value?: string) {
  return normalizeFilterValues<NormalizedCareerStage>(
    value,
    CAREER_STAGE_VALUES,
    CAREER_STAGE_ALIASES
  );
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

export function coerceNormalizedEmploymentType(value?: string | null): NormalizedEmploymentType {
  return (normalizeEmploymentTypeFilterValue(value ?? undefined)?.split(",")[0] ??
    "UNKNOWN") as NormalizedEmploymentType;
}

export function coerceNormalizedCareerStage(value?: string | null): NormalizedCareerStage {
  return (normalizeCareerStageFilterValue(value ?? undefined)?.split(",")[0] ??
    "UNKNOWN") as NormalizedCareerStage;
}

export function coerceNormalizedIndustry(value?: string | null): NormalizedIndustry {
  return (normalizeIndustryFilterValue(value ?? undefined)?.split(",")[0] ??
    "OTHER_UNKNOWN") as NormalizedIndustry;
}

export function coerceNormalizedRoleCategory(value?: string | null): NormalizedRoleCategory {
  return (normalizeRoleCategoryFilterValue(value ?? undefined)?.split(",")[0] ??
    "OTHER_UNKNOWN") as NormalizedRoleCategory;
}
