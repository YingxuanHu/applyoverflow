import type { NormalizedIndustry, NormalizedRoleCategory } from "@/lib/job-metadata";

export type JobFunctionCategory = NormalizedRoleCategory;

export type JobFunctionGroup =
  | "SOFTWARE_ENGINEERING"
  | "DATA_ANALYTICS_AI"
  | "PRODUCT_DESIGN"
  | "IT_SECURITY_DEVOPS"
  | "SALES_CUSTOMER_SUPPORT"
  | "MARKETING_CONTENT"
  | "FINANCE_ACCOUNTING"
  | "CONSULTING_STRATEGY"
  | "LEGAL_COMPLIANCE"
  | "OPERATIONS_LOGISTICS"
  | "WAREHOUSE_DELIVERY_DRIVING"
  | "HR_RECRUITING"
  | "HEALTHCARE_CLINICAL"
  | "EDUCATION_RESEARCH"
  | "ENGINEERING_MANUFACTURING"
  | "RETAIL_HOSPITALITY_SERVICE"
  | "SKILLED_TRADES_FACILITIES"
  | "ADMINISTRATIVE_OFFICE"
  | "OTHER_UNKNOWN";

export type JobFunctionStatus =
  | "verified"
  | "confident"
  | "usable_review"
  | "ambiguous"
  | "quarantine"
  | "unknown";

export type JobFunctionCandidateSource =
  | "normalized_title"
  | "raw_title"
  | "description_responsibilities"
  | "description_requirements"
  | "description_skills"
  | "source_category"
  | "legacy_role_family"
  | "company_industry_tiebreaker"
  | "url"
  | "fallback";

export type JobFunctionCandidate = {
  category: JobFunctionCategory;
  group: JobFunctionGroup;
  confidence: number;
  source: JobFunctionCandidateSource;
  evidence: string[];
  reasons: string[];
  penalties: string[];
  warnings: string[];
};

export type JobFunctionExtractionResult = {
  category: JobFunctionCategory;
  group: JobFunctionGroup;
  confidence: number;
  status: JobFunctionStatus;
  source: string;
  candidates: JobFunctionCandidate[];
  evidence: string[];
  warnings: string[];
  rejectedCandidates: JobFunctionCandidate[];
};

type ExtractJobFunctionInput = {
  normalizedTitle: string;
  rawTitle?: string | null;
  description?: string | null;
  company?: string | null;
  roleFamily?: string | null;
  sourceMetadata?: unknown;
  companyIndustries?: NormalizedIndustry[] | null;
  applyUrl?: string | null;
  sourceUrl?: string | null;
};

type PatternRule = {
  category: JobFunctionCategory;
  confidence: number;
  title?: RegExp[];
  description?: RegExp[];
  reasons: string[];
};

const CATEGORY_TO_GROUP: Record<JobFunctionCategory, JobFunctionGroup> = {
  SOFTWARE_ENGINEERING: "SOFTWARE_ENGINEERING",
  DATA_ANALYTICS: "DATA_ANALYTICS_AI",
  AI_MACHINE_LEARNING: "DATA_ANALYTICS_AI",
  PRODUCT_MANAGEMENT: "PRODUCT_DESIGN",
  DESIGN_UX: "PRODUCT_DESIGN",
  IT_SYSTEMS_DEVOPS: "IT_SECURITY_DEVOPS",
  CYBERSECURITY: "IT_SECURITY_DEVOPS",
  FINANCE_ACCOUNTING: "FINANCE_ACCOUNTING",
  INVESTMENT_BANKING: "FINANCE_ACCOUNTING",
  CONSULTING: "CONSULTING_STRATEGY",
  SALES: "SALES_CUSTOMER_SUPPORT",
  MARKETING: "MARKETING_CONTENT",
  OPERATIONS: "OPERATIONS_LOGISTICS",
  CUSTOMER_SUCCESS_SUPPORT: "SALES_CUSTOMER_SUPPORT",
  HUMAN_RESOURCES_RECRUITING: "HR_RECRUITING",
  LEGAL_COMPLIANCE: "LEGAL_COMPLIANCE",
  HEALTHCARE_CLINICAL: "HEALTHCARE_CLINICAL",
  RESEARCH_SCIENCE: "EDUCATION_RESEARCH",
  EDUCATION_TEACHING: "EDUCATION_RESEARCH",
  ENGINEERING_HARDWARE: "ENGINEERING_MANUFACTURING",
  RETAIL_SERVICE: "RETAIL_HOSPITALITY_SERVICE",
  SKILLED_TRADES_FACILITIES: "SKILLED_TRADES_FACILITIES",
  MEDIA_CONTENT_COMMUNICATIONS: "MARKETING_CONTENT",
  MANUFACTURING_TRADES: "ENGINEERING_MANUFACTURING",
  SUPPLY_CHAIN_LOGISTICS: "OPERATIONS_LOGISTICS",
  PROJECT_PROGRAM_MANAGEMENT: "OPERATIONS_LOGISTICS",
  ADMINISTRATIVE: "ADMINISTRATIVE_OFFICE",
  BUSINESS_DEVELOPMENT: "SALES_CUSTOMER_SUPPORT",
  WAREHOUSE_DELIVERY_DRIVING: "WAREHOUSE_DELIVERY_DRIVING",
  OTHER_UNKNOWN: "OTHER_UNKNOWN",
};

const STRONG_TITLE_RULES: PatternRule[] = [
  {
    category: "AI_MACHINE_LEARNING",
    confidence: 0.93,
    title: [
      /\bmachine learning engineer\b/i,
      /\bml engineer\b/i,
      /\bai engineer\b/i,
      /\b(?:applied|research)\s+scientist\b.*\b(?:machine learning|ml|ai|llm|language model|computer vision|nlp|deep learning)\b/i,
      /\b(?:machine learning|ml|ai|llm|language model|computer vision|nlp|deep learning)\b.*\b(?:scientist|researcher|engineer)\b/i,
      /\b(?:computer vision|nlp|llm|deep learning|mlops)\s+(?:engineer|scientist|researcher)\b/i,
      /\bai researcher\b/i,
    ],
    reasons: ["strong_ai_ml_role_title"],
  },
  {
    category: "WAREHOUSE_DELIVERY_DRIVING",
    confidence: 0.92,
    title: [
      /\bwarehouse\s+(?:worker|associate|operator|specialist|team member|clerk)\b/i,
      /\b(?:picker|packer|pick\s+packer|forklift operator|material handler|shipping and receiving|fulfillment associate|inventory associate)\b/i,
      /\b(?:delivery driver|courier|truck driver|owner operator|cargo van driver|driver helper|mover|route driver)\b/i,
      /\b(?:dispatcher|fleet dispatcher)\b/i,
    ],
    reasons: ["warehouse_delivery_driving_title"],
  },
  {
    category: "SOFTWARE_ENGINEERING",
    confidence: 0.91,
    title: [
      /\bsoftware\s+(?:engineer|developer|architect|programmer|development manager|engineering manager)\b/i,
      /\b(?:backend|back-end|frontend|front-end|full[-\s]?stack|web|mobile|ios|android|game)\s+(?:engineer|developer|programmer|architect)\b/i,
      /\b(?:application|app)\s+(?:developer|engineer|programmer)\b/i,
      /\bdeveloper\s+(?:intern|internship)\b/i,
      /\b(?:embedded|firmware)\s+(?:software\s+)?(?:engineer|developer)\b/i,
      /\b(?:sdet|software development engineer in test|qa automation engineer|test automation engineer)\b/i,
      /\b(?:développeur|développeuse|ingénieur logiciel|ingénieure logiciel)\b/i,
    ],
    reasons: ["strong_software_engineering_title"],
  },
  {
    category: "DATA_ANALYTICS",
    confidence: 0.9,
    title: [
      /\bdata\s+(?:analyst|engineer|scientist|architect|modeler|modeller|analytics engineer|visualization specialist)\b/i,
      /\b(?:business intelligence|bi)\s+(?:analyst|developer|engineer|specialist)\b/i,
      /\b(?:reporting|analytics?)\s+(?:analyst|engineer|manager|specialist|consultant)\b/i,
      /\bquantitative analyst\b/i,
    ],
    reasons: ["strong_data_analytics_title"],
  },
  {
    category: "PRODUCT_MANAGEMENT",
    confidence: 0.9,
    title: [
      /\b(?:associate\s+|senior\s+|sr\.?\s+|staff\s+|principal\s+|group\s+)?product\s+(?:manager|owner|lead)\b/i,
      /\btechnical product manager\b/i,
      /\bhead of product\b/i,
    ],
    reasons: ["strong_product_management_title"],
  },
  {
    category: "DESIGN_UX",
    confidence: 0.9,
    title: [
      /\b(?:ux|ui|product|visual|graphic|brand|interaction)\s+designer\b/i,
      /\bdesigner,?\s+(?:ux|ui|product|visual|graphic|brand|interaction)\b/i,
      /\bux researcher\b/i,
      /\bdesign researcher\b/i,
    ],
    reasons: ["strong_design_ux_title"],
  },
  {
    category: "CYBERSECURITY",
    confidence: 0.9,
    title: [
      /\b(?:cybersecurity|cyber security|information security|appsec|secops)\s+(?:engineer|analyst|architect|consultant|specialist|manager)\b/i,
      /\b(?:security engineer|security analyst|soc analyst|penetration tester|incident response|iam engineer|security architect)\b/i,
    ],
    reasons: ["strong_cybersecurity_title"],
  },
  {
    category: "IT_SYSTEMS_DEVOPS",
    confidence: 0.88,
    title: [
      /\b(?:devops|dev ops|site reliability|sre|cloud|platform|infrastructure|network|systems?)\s+(?:engineer|administrator|architect|specialist|analyst)\b/i,
      /\b(?:it support|help desk|desktop support|database administrator|dba|systems administrator|network administrator)\b/i,
      /\bdata center technician\b/i,
      /\bsolutions architect\b/i,
    ],
    reasons: ["strong_it_systems_devops_title"],
  },
  {
    category: "FINANCE_ACCOUNTING",
    confidence: 0.88,
    title: [
      /\b(?:fp&a|financial planning(?:\s+and|\s*&)\s+analysis)\b/i,
      /\b(?:financial|finance|revenue)\s+(?:analyst|associate|manager|director|controller|business partner|specialist)\b/i,
      /\b(?:accountant|accounting\s+(?:analyst|associate|manager|specialist|coordinator|clerk|director)|accounts?\s+(?:payable|receivable)|ap\/ar|bookkeeper)\b/i,
      /^(?:senior\s+|sr\.?\s+|assistant\s+)?controller\b/i,
      /\b(?:financial|finance|corporate|accounting|plant)\s+controller\b/i,
      /\b(?:tax|treasury|payroll|billing)\s+(?:analyst|associate|specialist|manager|director|accountant|administrator|coordinator|clerk|consultant)\b/i,
      /\b(?:auditor|audit\s+(?:analyst|associate|specialist|manager|director|consultant))\b/i,
    ],
    reasons: ["strong_finance_accounting_title"],
  },
  {
    category: "INVESTMENT_BANKING",
    confidence: 0.88,
    title: [
      /\b(?:investment banking|private equity|asset management|wealth management|portfolio|trader|trading|mortgage|loan officer|credit analyst)\b/i,
      /\b(?:wealth advisor|financial advisor|portfolio analyst|risk analyst)\b/i,
    ],
    reasons: ["strong_banking_investment_title"],
  },
  {
    category: "LEGAL_COMPLIANCE",
    confidence: 0.88,
    title: [
      /\b(?:lawyer|attorney|legal counsel|general counsel|counsel|paralegal|legal assistant)\b/i,
      /\b(?:compliance|regulatory affairs|privacy counsel|risk compliance|contract specialist|contracts manager)\s+(?:analyst|officer|manager|specialist|counsel|associate|director)?\b/i,
    ],
    reasons: ["strong_legal_compliance_title"],
  },
  {
    category: "HEALTHCARE_CLINICAL",
    confidence: 0.89,
    title: [
      /\b(?:registered nurse|nurse practitioner|licensed practical nurse|lpn|rpn|rn\b|physician|doctor|surgeon|pharmacist|dentist|therapist|audiologist)\b/i,
      /\b(?:medical assistant|clinical coordinator|clinical research coordinator|caregiver|personal support worker|psw|resident physician)\b/i,
    ],
    reasons: ["strong_healthcare_clinical_title"],
  },
  {
    category: "EDUCATION_TEACHING",
    confidence: 0.87,
    title: [
      /\b(?:teacher|tutor|instructor|professor|lecturer|academic advisor|curriculum developer|instructional designer)\b/i,
      /\b(?:education|student affairs|admissions|registrar)\s+(?:administrator|coordinator|advisor|specialist|manager)\b/i,
    ],
    reasons: ["strong_education_teaching_title"],
  },
  {
    category: "RESEARCH_SCIENCE",
    confidence: 0.86,
    title: [
      /\b(?:research scientist|scientist|lab technician|laboratory technician|chemist|biologist|research associate|postdoctoral fellow|principal investigator)\b/i,
    ],
    reasons: ["strong_research_science_title"],
  },
  {
    category: "ENGINEERING_HARDWARE",
    confidence: 0.86,
    title: [
      /\b(?:mechanical|electrical|civil|structural|aerospace|industrial|chemical|biomedical|environmental|manufacturing|process|quality|plant|automation|controls)\s+engineer\b/i,
      /\b(?:production supervisor|cnc machinist|manufacturing technician)\b/i,
    ],
    reasons: ["strong_engineering_manufacturing_title"],
  },
  {
    category: "SALES",
    confidence: 0.86,
    title: [
      /\b(?:account executive|sales representative|sales manager|sales engineer|business development representative|bdr\b|sdr\b|partnerships manager|account manager)\b/i,
      /\b(?:sales|business development|revenue)\s+(?:associate|representative|manager|director|specialist|lead)\b/i,
    ],
    reasons: ["strong_sales_title"],
  },
  {
    category: "CUSTOMER_SUCCESS_SUPPORT",
    confidence: 0.84,
    title: [
      /\b(?:customer success|client success|customer support|customer service|member support|technical support|support engineer|support specialist|call center)\b/i,
      /\b(?:implementation consultant|solutions consultant)\b/i,
    ],
    reasons: ["strong_customer_support_title"],
  },
  {
    category: "MARKETING",
    confidence: 0.84,
    title: [
      /\b(?:product marketing|marketing|growth|brand|demand generation|developer advocate|developer relations|devrel|technical community)(?:\s+(?:manager|specialist|lead|associate|director))?\b/i,
      /\b(?:product marketing|developer advocate|developer relations|devrel|technical community)\b/i,
      /\bmarket research analyst\b/i,
      /\b(?:market insights|market research)\s+(?:analyst|manager|specialist|associate)\b/i,
      /\bresearch analyst\b.*\bmarket insights\b/i,
    ],
    reasons: ["strong_marketing_growth_title"],
  },
  {
    category: "MEDIA_CONTENT_COMMUNICATIONS",
    confidence: 0.84,
    title: [
      /\b(?:writer|editor|copywriter|content strategist|communications specialist|communications manager|pr specialist|journalist|content creator|translator|technical writer|social media specialist)\b/i,
    ],
    reasons: ["strong_media_content_title"],
  },
  {
    category: "HUMAN_RESOURCES_RECRUITING",
    confidence: 0.86,
    title: [
      /\b(?:recruiter|technical recruiter|talent acquisition|hr generalist|people operations|compensation analyst|benefits specialist|hr business partner|learning and development)\b/i,
    ],
    reasons: ["strong_hr_recruiting_title"],
  },
  {
    category: "CONSULTING",
    confidence: 0.82,
    title: [
      /\b(?:strategy consultant|management consultant|business consultant|advisory consultant|engagement manager|strategy associate|risk advisory)\b/i,
    ],
    reasons: ["consulting_strategy_title"],
  },
  {
    category: "OPERATIONS",
    confidence: 0.84,
    title: [
      /\b(?:operations|business operations|chief of staff|process improvement)\s+(?:associate|analyst|manager|director|specialist|lead)?\b/i,
      /\b(?:project manager|program manager|scrum master|delivery manager|production manager)\b/i,
      /\b(?:sourcing|procurement|buyer|vendor manager|materials? sourcing|supplier performance)\s*(?:contractor|associate|specialist|analyst|manager|lead|coordinator)?\b/i,
    ],
    reasons: ["operations_supply_chain_title"],
  },
  {
    category: "SUPPLY_CHAIN_LOGISTICS",
    confidence: 0.83,
    title: [
      /\b(?:supply chain|logistics|inventory|demand planner|shipping|receiving)\s+(?:coordinator|analyst|manager|specialist|associate|planner)?\b/i,
      /\blogistics coordinator\b/i,
    ],
    reasons: ["supply_chain_logistics_title"],
  },
  {
    category: "RETAIL_SERVICE",
    confidence: 0.83,
    title: [
      /\b(?:retail associate|store associate|store manager|cashier|merchandiser|server|barista|cook|restaurant manager|hotel front desk|guest services|bank teller)\b/i,
    ],
    reasons: ["retail_hospitality_service_title"],
  },
  {
    category: "SKILLED_TRADES_FACILITIES",
    confidence: 0.84,
    title: [
      /\b(?:electrician|plumber|hvac technician|mechanic|maintenance technician|facilities technician|security guard|custodian|janitor|cleaner|carpenter|welder|installer|assembler|machine operator|production operator|quality inspector)\b/i,
    ],
    reasons: ["skilled_trades_facilities_title"],
  },
  {
    category: "ADMINISTRATIVE",
    confidence: 0.84,
    title: [
      /\b(?:administrative assistant|office assistant|receptionist|executive assistant|data entry clerk|clerk|scheduler|office coordinator|office manager)\b/i,
    ],
    reasons: ["administrative_office_title"],
  },
];

const DESCRIPTION_RULES: PatternRule[] = [
  {
    category: "AI_MACHINE_LEARNING",
    confidence: 0.78,
    description: [
      /\b(?:build|train|deploy|serve|evaluate|fine[-\s]?tune|optimi[sz]e)\s+(?:machine learning|ml|ai|deep learning|llm|language model|computer vision|nlp)\s+models?\b/i,
      /\b(?:model serving|model inference|feature engineering|mlops|embeddings|recommendation systems?|ranking models?|pytorch|tensorflow|scikit[-\s]?learn)\b/i,
    ],
    reasons: ["ai_ml_builder_description"],
  },
  {
    category: "SOFTWARE_ENGINEERING",
    confidence: 0.76,
    description: [
      /\b(?:build|building|develop|developing|implement|maintain|ship)\s+(?:software|applications?|web applications?|apis?|backend services?|frontend components?|mobile apps?|web apps?)\b/i,
      /\b(?:write|review|debug)\s+(?:production\s+)?code\b/i,
      /\b(?:react|next\.?js|node\.?js|typescript|java|python|kotlin|swift|c\+\+|postgresql|api design|system design)\b/i,
    ],
    reasons: ["software_engineering_description"],
  },
  {
    category: "DATA_ANALYTICS",
    confidence: 0.74,
    description: [
      /\b(?:analy[sz]e|visuali[sz]e|report on|build dashboards?|query)\s+(?:data|metrics|business performance)\b/i,
      /\b(?:sql|tableau|power bi|looker|data pipelines?|data warehouse|etl|business intelligence)\b/i,
    ],
    reasons: ["data_analytics_description"],
  },
  {
    category: "WAREHOUSE_DELIVERY_DRIVING",
    confidence: 0.74,
    description: [
      /\b(?:pick|pack|ship|receive|load|unload)\s+(?:orders?|packages?|pallets?|freight|inventory|goods|materials?|shipments?)\b/i,
      /\b(?:operate forklift|forklift operation|warehouse inventory|fulfillment center|distribution center|shipping and receiving)\b/i,
      /\b(?:delivery route|route driver|commercial driver|truck driver|courier delivery|last[-\s]?mile delivery)\b/i,
    ],
    reasons: ["warehouse_delivery_description"],
  },
  {
    category: "HEALTHCARE_CLINICAL",
    confidence: 0.74,
    description: [/\b(?:patient care|clinical care|diagnos|treat patients|medical records|care plan)\b/i],
    reasons: ["healthcare_clinical_description"],
  },
  {
    category: "LEGAL_COMPLIANCE",
    confidence: 0.72,
    description: [/\b(?:legal advice|contracts?|regulatory|compliance program|privacy law|litigation|counsel)\b/i],
    reasons: ["legal_compliance_description"],
  },
  {
    category: "FINANCE_ACCOUNTING",
    confidence: 0.72,
    description: [/\b(?:financial reporting|month[-\s]?end close|accounts payable|accounts receivable|general ledger|tax filings?|audit support|fp&a)\b/i],
    reasons: ["finance_accounting_description"],
  },
  {
    category: "OPERATIONS",
    confidence: 0.7,
    description: [/\b(?:vendor management|procurement|sourcing|process improvement|cross-functional operations|program delivery)\b/i],
    reasons: ["operations_description"],
  },
];

const LEGACY_ROLE_FAMILY_MAP: Record<string, JobFunctionCategory> = {
  SWE: "SOFTWARE_ENGINEERING",
  "DATA SCIENCE": "DATA_ANALYTICS",
  "DATA ENGINEERING": "DATA_ANALYTICS",
  "DATA ANALYST": "DATA_ANALYTICS",
  "PRODUCT ANALYST": "DATA_ANALYTICS",
  "PRODUCT MANAGEMENT": "PRODUCT_MANAGEMENT",
  DESIGN: "DESIGN_UX",
  SECURITY: "CYBERSECURITY",
  "IT OPERATIONS": "IT_SYSTEMS_DEVOPS",
  "SOLUTIONS ARCHITECTURE": "IT_SYSTEMS_DEVOPS",
  "FINANCIAL ANALYST": "FINANCE_ACCOUNTING",
  "FP&A": "FINANCE_ACCOUNTING",
  ACCOUNTING: "FINANCE_ACCOUNTING",
  "QUANTITATIVE FINANCE": "INVESTMENT_BANKING",
  "INVESTMENT BANKING": "INVESTMENT_BANKING",
  BANKING: "INVESTMENT_BANKING",
  CREDIT: "INVESTMENT_BANKING",
  "WEALTH MANAGEMENT": "INVESTMENT_BANKING",
  RISK: "LEGAL_COMPLIANCE",
  COMPLIANCE: "LEGAL_COMPLIANCE",
  MARKETING: "MARKETING",
  "HR / PEOPLE": "HUMAN_RESOURCES_RECRUITING",
  SALES: "SALES",
  "BUSINESS DEVELOPMENT": "SALES",
  CONSULTING: "CONSULTING",
  LEGAL: "LEGAL_COMPLIANCE",
  "SUPPLY CHAIN": "OPERATIONS",
  COMMUNICATIONS: "MEDIA_CONTENT_COMMUNICATIONS",
  ADMINISTRATIVE: "ADMINISTRATIVE",
  OPERATIONS: "OPERATIONS",
  "HEALTHCARE ADMIN": "HEALTHCARE_CLINICAL",
  "EDUCATION ADMIN": "EDUCATION_TEACHING",
  MANUFACTURING: "SKILLED_TRADES_FACILITIES",
  TRADES: "SKILLED_TRADES_FACILITIES",
};

const INDUSTRY_TIEBREAKER_GROUPS: Partial<Record<NormalizedIndustry, JobFunctionGroup[]>> = {
  FINANCIAL_SERVICES: ["FINANCE_ACCOUNTING"],
  HEALTHCARE_LIFE_SCIENCES: ["HEALTHCARE_CLINICAL", "EDUCATION_RESEARCH"],
  EDUCATION: ["EDUCATION_RESEARCH"],
  LEGAL_SERVICES: ["LEGAL_COMPLIANCE"],
  TRANSPORTATION_LOGISTICS: ["OPERATIONS_LOGISTICS", "WAREHOUSE_DELIVERY_DRIVING"],
  MANUFACTURING_AUTOMOTIVE: ["ENGINEERING_MANUFACTURING", "SKILLED_TRADES_FACILITIES"],
  RETAIL_CONSUMER_GOODS: ["RETAIL_HOSPITALITY_SERVICE", "OPERATIONS_LOGISTICS"],
  MEDIA_ENTERTAINMENT: ["MARKETING_CONTENT"],
};

const GENERIC_TITLE_PATTERN =
  /\b(?:associate|analyst|specialist|coordinator|consultant|manager|lead|advisor|assistant)\b/i;

const AI_CONTEXT_ONLY_PATTERN =
  /\b(?:ai training|training ai|ai[-\s]?powered|use ai|using ai|ai tools?|artificial intelligence tools?|help train ai|data annotation|data labeling|labeling data)\b/i;

const AI_BUILDER_PATTERN =
  /\b(?:machine learning engineer|ml engineer|ai engineer|research scientist.*(?:ml|ai|machine learning|llm)|(?:build|train|deploy|serve|evaluate|fine[-\s]?tune|optimi[sz]e)\s+(?:machine learning|ml|ai|deep learning|llm|language model|computer vision|nlp)\s+models?|model serving|model inference|feature engineering|mlops|embeddings|pytorch|tensorflow|scikit[-\s]?learn|recommendation systems?|ranking models?)\b/i;

const SOFTWARE_FALSE_POSITIVE_TITLE =
  /\b(?:developer advocate|developer relations|devrel|business development|sales development|market development|partnership development|fundraising development|organizational development|learning and development|content developer|curriculum developer|course developer|training developer|instructional developer|real estate developer|land developer|property developer|technical writer)\b/i;

const DATA_FALSE_POSITIVE_TITLE =
  /\b(?:data entry|data center technician|data annotation|data annotator|data labeling|data labeler|data protection officer|database administrator)\b/i;

const PRODUCT_FALSE_POSITIVE_TITLE =
  /\b(?:product designer|product marketing|product support|product analyst|product engineer|production manager|program manager|project manager)\b/i;

const SECURITY_FALSE_POSITIVE_TITLE =
  /\b(?:security guard|loss prevention|safety officer)\b/i;

const ENGINEERING_FALSE_POSITIVE_TITLE =
  /\b(?:sales engineer|solutions engineer|solution engineer|prompt engineer)\b/i;

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value: string | null | undefined) {
  return normalizeText(value).toUpperCase().replace(/[\/_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function trimEvidence(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 140);
}

function collectEvidence(text: string, patterns: RegExp[], limit = 4) {
  const evidence: string[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[0]) evidence.push(trimEvidence(match[0]));
    if (evidence.length >= limit) break;
  }
  return evidence;
}

function candidate(
  category: JobFunctionCategory,
  confidence: number,
  source: JobFunctionCandidateSource,
  evidence: string[],
  reasons: string[],
  warnings: string[] = [],
  penalties: string[] = []
): JobFunctionCandidate {
  return {
    category,
    group: CATEGORY_TO_GROUP[category],
    confidence: clamp(confidence),
    source,
    evidence: evidence.slice(0, 6),
    reasons,
    penalties,
    warnings,
  };
}

function clamp(value: number) {
  return Math.max(0, Math.min(0.99, Number(value.toFixed(3))));
}

function getDescriptionSections(description: string) {
  const normalized = normalizeText(description);
  const responsibilities = extractSection(normalized, [
    "responsibilities",
    "what you will do",
    "what you'll do",
    "about the role",
    "role overview",
    "day to day",
  ]);
  const requirements = extractSection(normalized, [
    "requirements",
    "qualifications",
    "what you bring",
    "skills",
    "experience",
  ]);
  return {
    full: stripBoilerplate(normalized),
    responsibilities: responsibilities || stripBoilerplate(normalized).slice(0, 2200),
    requirements,
  };
}

function extractSection(text: string, headings: string[]) {
  for (const heading of headings) {
    const index = text.indexOf(heading);
    if (index < 0) continue;
    return text.slice(index, index + 2200);
  }
  return "";
}

function stripBoilerplate(text: string) {
  const cutPatterns = [
    "equal opportunity",
    "eeo statement",
    "benefits",
    "cookie",
    "privacy notice",
    "about us",
  ];
  let cutAt = text.length;
  for (const pattern of cutPatterns) {
    const index = text.indexOf(pattern);
    if (index > 400 && index < cutAt) cutAt = index;
  }
  return text.slice(0, cutAt);
}

function addPatternCandidates(
  candidates: JobFunctionCandidate[],
  rules: PatternRule[],
  source: JobFunctionCandidateSource,
  text: string,
  matcher: "title" | "description",
  confidenceAdjustment = 0
) {
  for (const rule of rules) {
    const patterns = matcher === "title" ? rule.title : rule.description;
    if (!patterns) continue;
    const evidence = collectEvidence(text, patterns);
    if (evidence.length === 0) continue;
    candidates.push(
      candidate(
        rule.category,
        rule.confidence + confidenceAdjustment,
        source,
        evidence,
        rule.reasons
      )
    );
  }
}

function sourceMetadataText(sourceMetadata: unknown) {
  if (!sourceMetadata || typeof sourceMetadata !== "object") return "";
  const values: string[] = [];
  const record = sourceMetadata as Record<string, unknown>;
  for (const key of ["department", "team", "category", "jobCategory", "function", "family"]) {
    const value = record[key];
    if (typeof value === "string") values.push(value);
  }
  return values.join(" ");
}

function addSourceCategoryCandidates(candidates: JobFunctionCandidate[], sourceMetadata: unknown) {
  const text = normalizeText(sourceMetadataText(sourceMetadata));
  if (!text) return;
  addPatternCandidates(candidates, STRONG_TITLE_RULES, "source_category", text, "title", -0.28);
}

function addLegacyRoleFamilyCandidate(candidates: JobFunctionCandidate[], roleFamily?: string | null) {
  const key = normalizeKey(roleFamily);
  if (!key) return;
  if (key === "AI TRAINING") {
    candidates.push(
      candidate("OTHER_UNKNOWN", 0.2, "legacy_role_family", [roleFamily ?? ""], [
        "legacy_ai_training_role_family_ignored",
      ], ["AI training is task context, not job function"])
    );
    return;
  }
  const mapped = LEGACY_ROLE_FAMILY_MAP[key];
  if (!mapped) return;
  candidates.push(
    candidate(mapped, 0.55, "legacy_role_family", [roleFamily ?? ""], [
      "legacy_role_family_candidate_only",
    ], ["Legacy roleFamily is a weak hint and cannot override title evidence"])
  );
}

function addCompanyIndustryTiebreakers(
  candidates: JobFunctionCandidate[],
  companyIndustries?: NormalizedIndustry[] | null
) {
  if (!companyIndustries?.length) return;
  const existingGroups = new Set(candidates.filter((c) => c.confidence >= 0.55).map((c) => c.group));
  for (const industry of companyIndustries) {
    for (const group of INDUSTRY_TIEBREAKER_GROUPS[industry] ?? []) {
      if (!existingGroups.has(group)) continue;
      const matching = candidates.find((entry) => entry.group === group && entry.category !== "OTHER_UNKNOWN");
      if (!matching) continue;
      candidates.push(
        candidate(
          matching.category,
          0.32,
          "company_industry_tiebreaker",
          [industry],
          ["company_industry_supports_existing_job_function_candidate"],
          ["Company industry is only a tie-breaker and cannot assign job function alone"]
        )
      );
    }
  }
}

function addUrlCandidates(candidates: JobFunctionCandidate[], urls: Array<string | null | undefined>) {
  const text = normalizeText(urls.filter(Boolean).join(" "));
  if (!text) return;
  addPatternCandidates(candidates, STRONG_TITLE_RULES, "url", text, "title", -0.42);
}

function rejectUnsafeCandidates(input: {
  candidates: JobFunctionCandidate[];
  title: string;
  description: string;
}) {
  const accepted: JobFunctionCandidate[] = [];
  const rejected: JobFunctionCandidate[] = [];
  const { title, description } = input;
  const combined = `${title} ${description}`;

  for (const entry of input.candidates) {
    const warnings = [...entry.warnings];
    const penalties = [...entry.penalties];
    let reject = false;

    if (entry.category === "AI_MACHINE_LEARNING") {
      const builderEvidence = AI_BUILDER_PATTERN.test(combined);
      if (!builderEvidence || (AI_CONTEXT_ONLY_PATTERN.test(combined) && !AI_BUILDER_PATTERN.test(title))) {
        reject = true;
        warnings.push("AI/ML rejected because evidence is AI usage/training context, not ML-building work");
        penalties.push("ai_context_without_ml_builder_evidence");
      }
    }

    if (entry.category === "SOFTWARE_ENGINEERING" && SOFTWARE_FALSE_POSITIVE_TITLE.test(title)) {
      const codingEvidence = /\b(?:write|build|develop|ship|review|debug)\s+(?:production\s+)?code\b/i.test(
        description
      );
      if (!codingEvidence) {
        reject = true;
        warnings.push("Software engineering rejected for adjacent developer/technical content role");
        penalties.push("software_adjacent_false_positive_title");
      }
    }

    if (entry.category === "DATA_ANALYTICS" && DATA_FALSE_POSITIVE_TITLE.test(title)) {
      reject = true;
      warnings.push("Data analytics rejected for data-entry/data-center/data-labeling false positive");
      penalties.push("data_keyword_false_positive_title");
    }

    if (entry.category === "PRODUCT_MANAGEMENT" && PRODUCT_FALSE_POSITIVE_TITLE.test(title)) {
      reject = true;
      warnings.push("Product management rejected for product-adjacent non-PM title");
      penalties.push("product_keyword_false_positive_title");
    }

    if (entry.category === "CYBERSECURITY" && SECURITY_FALSE_POSITIVE_TITLE.test(title)) {
      reject = true;
      warnings.push("Cybersecurity rejected for physical security or safety title");
      penalties.push("physical_security_false_positive_title");
    }

    if (entry.category === "ENGINEERING_HARDWARE" && ENGINEERING_FALSE_POSITIVE_TITLE.test(title)) {
      reject = true;
      warnings.push("Engineering/manufacturing rejected for sales/solutions/prompt engineer ambiguity");
      penalties.push("engineering_keyword_false_positive_title");
    }

    if (reject) {
      rejected.push({ ...entry, warnings, penalties, confidence: clamp(entry.confidence - 0.45) });
    } else {
      accepted.push(entry);
    }
  }

  return { accepted, rejected };
}

function aggregateCandidates(candidates: JobFunctionCandidate[]) {
  const byCategory = new Map<JobFunctionCategory, JobFunctionCandidate[]>();
  for (const entry of candidates) {
    if (entry.category === "OTHER_UNKNOWN") continue;
    const existing = byCategory.get(entry.category) ?? [];
    existing.push(entry);
    byCategory.set(entry.category, existing);
  }

  const aggregated: JobFunctionCandidate[] = [];
  for (const entries of byCategory.values()) {
    const sorted = [...entries].sort((a, b) => b.confidence - a.confidence);
    const primary = sorted[0];
    const nonIndustryEvidenceCount = entries.filter((entry) => entry.source !== "company_industry_tiebreaker").length;
    const sameCategoryBonus = Math.min(0.1, Math.max(0, nonIndustryEvidenceCount - 1) * 0.035);
    const industryBonus = entries.some((entry) => entry.source === "company_industry_tiebreaker") ? 0.025 : 0;
    aggregated.push({
      ...primary,
      confidence: clamp(primary.confidence + sameCategoryBonus + industryBonus),
      evidence: unique(entries.flatMap((entry) => entry.evidence)).slice(0, 8),
      reasons: unique(entries.flatMap((entry) => entry.reasons)).slice(0, 8),
      warnings: unique(entries.flatMap((entry) => entry.warnings)).slice(0, 8),
      penalties: unique(entries.flatMap((entry) => entry.penalties)).slice(0, 8),
    });
  }

  return aggregated.sort((a, b) => b.confidence - a.confidence);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function statusForConfidence(confidence: number): JobFunctionStatus {
  if (confidence >= 0.85) return "verified";
  if (confidence >= 0.75) return "confident";
  if (confidence >= 0.6) return "usable_review";
  if (confidence >= 0.45) return "ambiguous";
  return "unknown";
}

function resolveWinner(input: {
  aggregated: JobFunctionCandidate[];
  rejected: JobFunctionCandidate[];
  title: string;
}) {
  const warnings: string[] = [];
  if (input.rejected.length > 0) {
    warnings.push(...input.rejected.flatMap((entry) => entry.warnings));
  }

  const [top, second] = input.aggregated;
  if (!top) {
    return {
      category: "OTHER_UNKNOWN" as JobFunctionCategory,
      group: "OTHER_UNKNOWN" as JobFunctionGroup,
      confidence: 0.2,
      status: "unknown" as JobFunctionStatus,
      source: "fallback",
      evidence: [],
      warnings: unique(warnings.concat("No reliable job-function evidence found")),
    };
  }

  let confidence = top.confidence;
  if (second && second.group !== top.group && top.confidence - second.confidence < 0.08) {
    confidence = clamp(confidence - 0.12);
    warnings.push(`Ambiguous job function: ${top.category} close to ${second.category}`);
  }

  if (GENERIC_TITLE_PATTERN.test(input.title) && top.source !== "normalized_title" && confidence > 0.72) {
    confidence = 0.72;
    warnings.push("Generic title requires stronger evidence before becoming a strict filter match");
  }

  if (confidence < 0.45) {
    return {
      category: "OTHER_UNKNOWN" as JobFunctionCategory,
      group: "OTHER_UNKNOWN" as JobFunctionGroup,
      confidence,
      status: "unknown" as JobFunctionStatus,
      source: top.source,
      evidence: top.evidence,
      warnings: unique(warnings.concat("Top job-function candidate below confidence threshold")),
    };
  }

  return {
    category: top.category,
    group: top.group,
    confidence,
    status: statusForConfidence(confidence),
    source: top.source,
    evidence: top.evidence,
    warnings: unique(warnings),
  };
}

export function getJobFunctionGroup(category: JobFunctionCategory): JobFunctionGroup {
  return CATEGORY_TO_GROUP[category] ?? "OTHER_UNKNOWN";
}

export function extractJobFunction(input: ExtractJobFunctionInput): JobFunctionExtractionResult {
  const normalizedTitle = normalizeText(input.normalizedTitle);
  const rawTitle = normalizeText(input.rawTitle);
  const sections = getDescriptionSections(input.description ?? "");
  const candidates: JobFunctionCandidate[] = [];

  addPatternCandidates(candidates, STRONG_TITLE_RULES, "normalized_title", normalizedTitle, "title");

  if (rawTitle && rawTitle !== normalizedTitle) {
    addPatternCandidates(candidates, STRONG_TITLE_RULES, "raw_title", rawTitle, "title", -0.1);
  }

  addPatternCandidates(
    candidates,
    DESCRIPTION_RULES,
    "description_responsibilities",
    sections.responsibilities,
    "description",
    sections.responsibilities ? 0 : -0.1
  );
  addPatternCandidates(
    candidates,
    DESCRIPTION_RULES,
    "description_requirements",
    sections.requirements,
    "description",
    -0.08
  );
  addSourceCategoryCandidates(candidates, input.sourceMetadata);
  addLegacyRoleFamilyCandidate(candidates, input.roleFamily);
  addUrlCandidates(candidates, [input.applyUrl, input.sourceUrl]);
  addCompanyIndustryTiebreakers(candidates, input.companyIndustries);

  const { accepted, rejected } = rejectUnsafeCandidates({
    candidates,
    title: normalizedTitle,
    description: sections.full,
  });
  const aggregated = aggregateCandidates(accepted);
  const winner = resolveWinner({
    aggregated,
    rejected,
    title: normalizedTitle,
  });
  const allWarnings = unique([
    ...winner.warnings,
    ...candidates.flatMap((entry) => entry.warnings),
    ...rejected.flatMap((entry) => entry.warnings),
  ]);

  return {
    category: winner.category,
    group: winner.group,
    confidence: winner.confidence,
    status: winner.status,
    source: winner.source,
    candidates: aggregated.slice(0, 8),
    evidence: winner.evidence.slice(0, 8),
    warnings: allWarnings.slice(0, 12),
    rejectedCandidates: rejected.slice(0, 8),
  };
}
