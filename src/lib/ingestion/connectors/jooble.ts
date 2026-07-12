/**
 * Jooble public job search API connector.
 *
 * Official docs:
 *   POST https://jooble.org/api/{apiKey}
 *
 * The API is query-driven rather than a full market dump, so this connector
 * fans out across configurable keyword/location searches and checkpoints across
 * that frontier over multiple runs.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EmploymentType, WorkMode } from "@/generated/prisma/client";
import {
  readCsvEnv,
  readPositiveIntEnv,
} from "@/lib/ingestion/source-family-config";
import {
  sleepWithAbort,
  throwIfAborted,
} from "@/lib/ingestion/runtime-control";
import type {
  SourceConnector,
  SourceConnectorFetchOptions,
  SourceConnectorFetchResult,
  SourceConnectorJob,
} from "@/lib/ingestion/types";

const JOOBLE_API_BASE = "https://jooble.org/api";
const JOOBLE_DEFAULT_RATE_DELAY_MS = 750;
const JOOBLE_DEFAULT_RESULTS_PER_PAGE = 75;
const JOOBLE_DEFAULT_MAX_PAGES = 4;
// Raised from 6 → 10. Previous setting was sized for the flat 180s budget;
// the adaptive runtime budget now grants high-yield shards up to 540s, so we
// can comfortably process more keyword × location pairs per run before the
// soft budget kicks in. The internal AbortController still cuts off mid-page
// if budget is hit, so over-allocating searches is safe.
const JOOBLE_DEFAULT_SEARCHES_PER_RUN = 10;
const JOOBLE_PLACEHOLDER_COMPANIES = new Set(["jooble", "jooble.org"]);

const DEFAULT_JOOBLE_KEYWORDS = [
  "software engineer",
  "data engineer",
  "data scientist",
  "product manager",
  "business analyst",
  "financial analyst",
  "accountant",
  "cybersecurity",
  "devops",
  "operations manager",
];

const DEFAULT_JOOBLE_LOCATIONS = [
  "Remote",
  "United States",
  "Canada",
];

const JOOBLE_TECH_KEYWORDS = [
  "software engineer",
  "software developer",
  "frontend engineer",
  "backend engineer",
  "full stack engineer",
  "data engineer",
  "data scientist",
  "machine learning engineer",
  "ai engineer",
  "devops engineer",
  "cloud engineer",
  "security engineer",
  "cybersecurity analyst",
  "product manager",
  "technical program manager",
  "business analyst",
  "qa engineer",
];

const JOOBLE_FINANCE_KEYWORDS = [
  "financial analyst",
  "finance manager",
  "investment analyst",
  "quantitative analyst",
  "risk analyst",
  "accountant",
  "controller",
  "auditor",
  "tax analyst",
  "treasury analyst",
  "fp&a analyst",
  "business analyst finance",
];

const JOOBLE_OPERATIONS_KEYWORDS = [
  "operations manager",
  "project manager",
  "program manager",
  "customer success manager",
  "implementation consultant",
  "solutions consultant",
  "sales engineer",
  "revenue operations",
  "marketing analyst",
];

// ── White-collar keyword clusters ────────────────────────────────────────────
//
// Sharded by role family so each Jooble profile can paginate fully under the
// adaptive runtime budget. The previous "whitecollar-na" lump cycled 93
// keyword×location combos through a single profile, which meant any one
// family only re-ran every ~16 cadence ticks — too slow to keep up with
// posting velocity. With per-family shards, each family cycles in 2-3 ticks.
//
// Exclusion patterns in normalize.ts still catch blue-collar / clinical /
// retail / trades titles that leak in, so we can be expansive here.

const JOOBLE_MARKETING_KEYWORDS = [
  "marketing manager",
  "marketing director",
  "marketing coordinator",
  "marketing specialist",
  "brand manager",
  "product marketing",
  "growth marketing",
  "performance marketing",
  "content marketing",
  "content strategist",
  "digital marketing",
  "demand generation",
  "marketing analyst",
  "marketing operations",
  "seo manager",
  "email marketing",
  "lifecycle marketing",
  "field marketing",
  "copywriter",
];

const JOOBLE_SALES_KEYWORDS = [
  "account executive",
  "sales manager",
  "sales director",
  "sales representative",
  "inside sales",
  "outside sales",
  "sales development representative",
  "sdr",
  "bdr",
  "business development representative",
  "enterprise sales",
  "regional sales manager",
  "sales analyst",
  "sales operations",
  "sales enablement",
  "channel sales",
  "partner sales",
  "revenue operations",
  "sales engineer",
];

const JOOBLE_HR_KEYWORDS = [
  "hr business partner",
  "hr generalist",
  "hr manager",
  "hr director",
  "talent acquisition",
  "talent partner",
  "people operations",
  "people partner",
  "head of people",
  "compensation analyst",
  "benefits manager",
  "hris analyst",
  "hr analyst",
  "hr coordinator",
  "learning and development",
  "training manager",
  "organizational development",
  "employee relations",
  "recruiter",
];

const JOOBLE_LEGAL_KEYWORDS = [
  "corporate counsel",
  "general counsel",
  "associate counsel",
  "paralegal",
  "legal analyst",
  "legal operations",
  "legal manager",
  "contracts manager",
  "contract manager",
  "compliance analyst",
  "compliance manager",
  "ip counsel",
  "regulatory affairs",
  "legal director",
];

const JOOBLE_OPS_ADMIN_KEYWORDS = [
  "operations manager",
  "operations analyst",
  "operations director",
  "business operations",
  "strategy and operations",
  "project manager",
  "program manager",
  "chief of staff",
  "executive assistant",
  "office manager",
  "administrative coordinator",
  "operations coordinator",
];

const JOOBLE_SUPPLY_CHAIN_KEYWORDS = [
  "supply chain analyst",
  "supply chain manager",
  "procurement manager",
  "procurement analyst",
  "logistics analyst",
  "logistics manager",
  "sourcing manager",
  "sourcing analyst",
  "demand planner",
  "supply planner",
  "inventory manager",
  "materials manager",
  "vendor manager",
];

const JOOBLE_CONSULTING_KEYWORDS = [
  "management consultant",
  "strategy consultant",
  "senior consultant",
  "principal consultant",
  "engagement manager",
  "practice lead",
  "business strategy",
  "associate consultant",
  "business consultant",
];

const JOOBLE_COMMUNICATIONS_KEYWORDS = [
  "communications manager",
  "communications director",
  "corporate communications",
  "internal communications",
  "public relations",
  "pr manager",
  "media relations",
  "investor relations",
  "content manager",
  "editor",
  "publicist",
  "spokesperson",
];

const JOOBLE_CUSTOMER_SUCCESS_KEYWORDS = [
  "customer success",
  "customer success manager",
  "customer success engineer",
  "implementation consultant",
  "implementation specialist",
  "onboarding specialist",
  "technical account manager",
  "customer experience",
  "client success",
  "account manager",
];

const JOOBLE_BIZ_DEV_KEYWORDS = [
  "business development",
  "business development manager",
  "partnerships manager",
  "partnerships director",
  "strategic partnerships",
  "alliances manager",
  "partner manager",
  "channel manager",
  "bd manager",
];

// ── New GENERAL families (previously uncovered) ─────────────────────────────
// Each addresses a white-collar/knowledge-worker segment that fits the
// office/knowledge-worker feed but was invisible to our keyword-based discovery before.
// Clinical / blue-collar / trades terms are intentionally absent — they'd
// be caught by EXCLUDED_TITLE_PATTERNS downstream anyway.

const JOOBLE_GOVERNMENT_KEYWORDS = [
  "policy analyst",
  "policy advisor",
  "program officer",
  "program analyst",
  "public administrator",
  "government affairs",
  "public sector consultant",
  "regulatory analyst",
  "intelligence analyst",
  "legislative analyst",
  "research analyst government",
  "federal contractor analyst",
  "municipal analyst",
];

const JOOBLE_EDUCATION_ADMIN_KEYWORDS = [
  "registrar",
  "admissions counselor",
  "admissions director",
  "student affairs",
  "academic advisor",
  "career counselor",
  "financial aid administrator",
  "academic program manager",
  "associate dean operations",
  "associate dean administration",
  "institutional research analyst",
  "education program manager",
  "edtech program manager",
];

const JOOBLE_HEALTHCARE_ADMIN_KEYWORDS = [
  "healthcare operations manager",
  "healthcare program manager",
  "hospital administrator",
  "practice manager",
  "clinic operations manager",
  "health policy analyst",
  "health systems analyst",
  "medical office manager",
  "patient experience manager",
  "revenue cycle analyst",
  "medical billing manager",
  "credentialing manager",
  "health insurance analyst",
];

const JOOBLE_NONPROFIT_KEYWORDS = [
  "nonprofit program manager",
  "development director",
  "grant writer",
  "grants manager",
  "fundraising manager",
  "donor relations",
  "foundation program officer",
  "executive director nonprofit",
  "advocacy manager",
  "philanthropy manager",
];

const JOOBLE_REAL_ESTATE_KEYWORDS = [
  "real estate analyst",
  "real estate associate",
  "asset manager real estate",
  "leasing manager",
  "property manager",
  "real estate portfolio analyst",
  "real estate development manager",
  "acquisitions analyst",
  "investment analyst real estate",
  "commercial real estate analyst",
];

const JOOBLE_INSURANCE_KEYWORDS = [
  "underwriter",
  "underwriting analyst",
  "claims analyst",
  "claims adjuster",
  "insurance broker",
  "actuarial analyst",
  "risk analyst insurance",
  "insurance product manager",
  "policy analyst insurance",
  "reinsurance analyst",
];

const JOOBLE_HOSPITALITY_MGMT_KEYWORDS = [
  "hotel manager",
  "hotel operations manager",
  "revenue manager hotel",
  "guest experience manager",
  "events manager",
  "event operations manager",
  "catering operations manager",
  "hospitality program manager",
  "travel operations manager",
];

const JOOBLE_EDITORIAL_PUBLISHING_KEYWORDS = [
  "editor",
  "senior editor",
  "managing editor",
  "editor in chief",
  "content director",
  "publisher",
  "editorial manager",
  "editorial assistant",
  "staff writer",
  "copy editor",
  "production editor",
];

const JOOBLE_RESEARCH_POLICY_KEYWORDS = [
  "research analyst",
  "research associate non-clinical",
  "policy researcher",
  "think tank analyst",
  "market research analyst",
  "qualitative researcher",
  "quantitative researcher policy",
  "social science researcher",
  "ux researcher",
];

const JOOBLE_PROJECT_CONSTRUCTION_PM_KEYWORDS = [
  "construction project manager",
  "construction program manager",
  "real estate project manager",
  "facilities project manager",
  "capital projects manager",
  "infrastructure project manager",
];

const JOOBLE_CONTENT_CREATOR_KEYWORDS = [
  "content creator",
  "social media manager",
  "social media strategist",
  "video producer",
  "podcast producer",
  "creative producer",
  "content producer",
  "brand storyteller",
];

// ── Engineering (non-software) — the 12-priority "Engineering" category ─────
// Software / data / cloud / security engineering is already covered by
// JOOBLE_TECH_KEYWORDS. This set covers the hardware / civil / mechanical /
// chemical / aerospace / biomedical / environmental / industrial engineering
// disciplines that the existing tech shards miss.
const JOOBLE_ENGINEERING_NONSWE_KEYWORDS = [
  // Mechanical / hardware
  "mechanical engineer",
  "mechanical design engineer",
  "hardware engineer",
  "mechatronics engineer",
  // Civil / structural / construction
  "civil engineer",
  "structural engineer",
  "transportation engineer",
  "geotechnical engineer",
  // Electrical / electronics
  "electrical engineer",
  "electronics engineer",
  "power systems engineer",
  "controls engineer",
  // Chemical / process
  "chemical engineer",
  "process engineer",
  "process safety engineer",
  // Aerospace / defense
  "aerospace engineer",
  "avionics engineer",
  "propulsion engineer",
  // Biomedical / pharma
  "biomedical engineer",
  "validation engineer",
  "manufacturing engineer pharma",
  // Industrial / manufacturing
  "industrial engineer",
  "manufacturing engineer",
  "quality engineer",
  "reliability engineer (non-software)",
  // Environmental / energy
  "environmental engineer",
  "energy engineer",
  "renewable energy engineer",
  "sustainability engineer",
  // Materials / metallurgy
  "materials engineer",
  "metallurgical engineer",
];

// ── Law / Legal — deeper than just corporate counsel ─────────────────────────
const JOOBLE_LAW_DEEP_KEYWORDS = [
  "associate attorney",
  "senior associate attorney",
  "litigation associate",
  "transactional attorney",
  "corporate attorney",
  "intellectual property attorney",
  "patent attorney",
  "patent agent",
  "immigration attorney",
  "real estate attorney",
  "employment attorney",
  "tax attorney",
  "trademark attorney",
  "compliance counsel",
  "regulatory counsel",
  "privacy counsel",
  "data protection officer",
  "ethics and compliance",
  "litigation paralegal",
  "ip paralegal",
  "contract administrator",
];

// ── Accounting — deeper than tax/audit/AP/AR ─────────────────────────────────
const JOOBLE_ACCOUNTING_DEEP_KEYWORDS = [
  "staff accountant",
  "senior accountant",
  "general ledger accountant",
  "corporate accountant",
  "cost accountant",
  "forensic accountant",
  "audit associate",
  "audit senior",
  "external audit",
  "internal audit",
  "tax associate",
  "tax senior",
  "tax preparer",
  "ap specialist",
  "ar specialist",
  "billing specialist",
  "collections specialist",
  "revenue accountant",
  "controller",
  "assistant controller",
];

// ── HR — deeper specialties ──────────────────────────────────────────────────
const JOOBLE_HR_DEEP_KEYWORDS = [
  "technical recruiter",
  "corporate recruiter",
  "executive recruiter",
  "diversity recruiter",
  "campus recruiter",
  "university recruiter",
  "talent sourcer",
  "recruiting coordinator",
  "people analyst",
  "people partner",
  "rewards analyst",
  "total rewards manager",
  "benefits specialist",
  "401k administrator",
  "employee experience manager",
  "diversity equity inclusion",
  "dei manager",
  "leadership development",
];

// ── Marketing — deeper specialties ───────────────────────────────────────────
const JOOBLE_MARKETING_DEEP_KEYWORDS = [
  "seo specialist",
  "seo manager",
  "sem manager",
  "paid media manager",
  "paid search specialist",
  "marketing automation",
  "crm marketing manager",
  "email marketing manager",
  "affiliate marketing",
  "influencer marketing",
  "brand marketing manager",
  "category manager",
  "shopper marketing",
  "trade marketing",
  "marketing data analyst",
  "marketing intelligence",
  "creative director marketing",
  "art director marketing",
];

// ── Sales — deeper specialties / industries ──────────────────────────────────
const JOOBLE_SALES_DEEP_KEYWORDS = [
  "saas sales",
  "enterprise account executive",
  "mid market account executive",
  "smb account executive",
  "named account executive",
  "strategic account manager",
  "national account manager",
  "key account manager",
  "global account manager",
  "vp sales",
  "head of sales",
  "sales engineer enterprise",
  "pre-sales consultant",
  "post-sales engineer",
  "renewal manager",
  "retention manager",
];

// ── Healthcare admin — deeper specialties ────────────────────────────────────
const JOOBLE_HEALTHCARE_ADMIN_DEEP_KEYWORDS = [
  "health informatics analyst",
  "ehr analyst",
  "epic analyst",
  "cerner analyst",
  "healthcare data analyst",
  "managed care analyst",
  "provider relations",
  "payer relations",
  "utilization management",
  "case management coordinator (administrative)",
  "discharge planner administrative",
  "patient access manager",
  "medical staff coordinator",
  "compliance officer healthcare",
];

// ── Consulting — deeper specialties ──────────────────────────────────────────
const JOOBLE_CONSULTING_DEEP_KEYWORDS = [
  "associate consultant",
  "consulting associate",
  "summer associate consulting",
  "strategy associate",
  "transformation consultant",
  "operations consultant",
  "supply chain consultant",
  "human capital consultant",
  "technology consultant",
  "implementation consultant",
  "salesforce consultant",
  "sap consultant",
  "oracle consultant",
  "data and analytics consultant",
  "risk consultant",
  "cybersecurity consultant",
  "tax consultant",
  "audit consultant",
];

// ── Business operations — deeper specialties ─────────────────────────────────
const JOOBLE_BIZOPS_DEEP_KEYWORDS = [
  "biz ops analyst",
  "business operations analyst",
  "business operations manager",
  "strategic finance analyst",
  "fp&a analyst",
  "growth analyst",
  "growth operations",
  "rev ops analyst",
  "revenue operations analyst",
  "go to market operations",
  "marketing operations analyst",
  "sales operations analyst",
  "customer operations analyst",
  "operations strategy associate",
  "chief of staff associate",
];

// Aggregate used by the lump-style "whitecollar-na" profile (kept for
// backwards compat with existing deployments / env-driven overrides).
const JOOBLE_WHITECOLLAR_KEYWORDS = [
  ...JOOBLE_MARKETING_KEYWORDS,
  ...JOOBLE_SALES_KEYWORDS,
  ...JOOBLE_HR_KEYWORDS,
  ...JOOBLE_LEGAL_KEYWORDS,
  ...JOOBLE_OPS_ADMIN_KEYWORDS,
  ...JOOBLE_SUPPLY_CHAIN_KEYWORDS,
  ...JOOBLE_CONSULTING_KEYWORDS,
  ...JOOBLE_COMMUNICATIONS_KEYWORDS,
  ...JOOBLE_CUSTOMER_SUCCESS_KEYWORDS,
  ...JOOBLE_BIZ_DEV_KEYWORDS,
];

const JOOBLE_US_TECH_HUBS = [
  "New York, NY",
  "San Francisco, CA",
  "San Jose, CA",
  "Seattle, WA",
  "Austin, TX",
  "Boston, MA",
  "Chicago, IL",
  "Los Angeles, CA",
  "Denver, CO",
  "Atlanta, GA",
  "Dallas, TX",
  "Washington, DC",
  "Raleigh, NC",
  "Pittsburgh, PA",
  "Minneapolis, MN",
  "Philadelphia, PA",
];

const JOOBLE_CANADA_TECH_HUBS = [
  "Toronto, ON",
  "Vancouver, BC",
  "Montreal, QC",
  "Ottawa, ON",
  "Waterloo, ON",
  "Calgary, AB",
  "Edmonton, AB",
];

type JoobleJob = {
  id?: number | string;
  title?: string;
  location?: string;
  snippet?: string;
  salary?: string;
  source?: string;
  type?: string;
  link?: string;
  company?: string;
  updated?: string;
};

type JoobleResponse = {
  totalCount?: number;
  jobs?: JoobleJob[];
};

type JoobleCheckpoint = {
  searchIndex: number;
  page: number;
};

type JoobleSearchSpec = {
  keyword: string;
  location: string | null;
};

type JoobleConnectorOptions = {
  profile?: string;
  keywords?: string[];
  locations?: Array<string | null>;
};

type JoobleProfileDefaults = {
  keywords: string[];
  locations: Array<string | null>;
};

const JOOBLE_PROFILE_DEFAULTS: Record<string, JoobleProfileDefaults> = {
  feed: {
    keywords: DEFAULT_JOOBLE_KEYWORDS,
    locations: DEFAULT_JOOBLE_LOCATIONS,
  },
  "all-na": {
    keywords: [""],
    locations: ["United States", "Canada", "Remote"],
  },
  "tech-na": {
    keywords: JOOBLE_TECH_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "finance-na": {
    keywords: JOOBLE_FINANCE_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "operations-na": {
    keywords: JOOBLE_OPERATIONS_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "tech-cities-us": {
    keywords: JOOBLE_TECH_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },
  "tech-cities-ca": {
    keywords: JOOBLE_TECH_KEYWORDS,
    locations: JOOBLE_CANADA_TECH_HUBS,
  },
  "finance-cities-us": {
    keywords: JOOBLE_FINANCE_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },
  "early-career-na": {
    keywords: [
      "new grad software engineer",
      "entry level software engineer",
      "junior software developer",
      "junior data analyst",
      "data analyst",
      "business analyst",
      "financial analyst",
      "junior accountant",
      "software engineer intern",
      "data science intern",
    ],
    locations: ["United States", "Canada", "Remote"],
  },
  "remote-broad-na": {
    keywords: [
      ...JOOBLE_TECH_KEYWORDS,
      ...JOOBLE_FINANCE_KEYWORDS,
      ...JOOBLE_OPERATIONS_KEYWORDS,
    ],
    locations: ["Remote", "Remote United States", "Remote Canada", "Remote North America"],
  },
  // Broader white-collar profile: marketing, HR, legal, comms, sales, supply
  // chain, consulting, admin. Pulls in office/knowledge-worker roles outside
  // pure tech & finance to expand pool coverage. Kept as a lump for backwards
  // compatibility — new deployments should prefer the per-family shards
  // below since each can paginate fully under the adaptive runtime budget.
  "whitecollar-na": {
    keywords: JOOBLE_WHITECOLLAR_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "whitecollar-cities-us": {
    keywords: JOOBLE_WHITECOLLAR_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },
  "whitecollar-cities-ca": {
    keywords: JOOBLE_WHITECOLLAR_KEYWORDS,
    locations: JOOBLE_CANADA_TECH_HUBS,
  },

  // ── Per-family GENERAL shards ──────────────────────────────────────────────
  // Each family gets its own profile so it can cycle through all keyword
  // × location combos in a small number of cadence ticks. With the adaptive
  // budget (yield-aware), high-yield families auto-expand their per-run
  // time while empty/exhausted families auto-shrink.

  // Marketing
  "marketing-na": {
    keywords: JOOBLE_MARKETING_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "marketing-cities-us": {
    keywords: JOOBLE_MARKETING_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },
  "marketing-cities-ca": {
    keywords: JOOBLE_MARKETING_KEYWORDS,
    locations: JOOBLE_CANADA_TECH_HUBS,
  },

  // Sales & Revenue
  "sales-na": {
    keywords: JOOBLE_SALES_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "sales-cities-us": {
    keywords: JOOBLE_SALES_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },
  "sales-cities-ca": {
    keywords: JOOBLE_SALES_KEYWORDS,
    locations: JOOBLE_CANADA_TECH_HUBS,
  },

  // HR & People
  "hr-na": {
    keywords: JOOBLE_HR_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "hr-cities-us": {
    keywords: JOOBLE_HR_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },
  "hr-cities-ca": {
    keywords: JOOBLE_HR_KEYWORDS,
    locations: JOOBLE_CANADA_TECH_HUBS,
  },

  // Legal
  "legal-na": {
    keywords: JOOBLE_LEGAL_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "legal-cities-us": {
    keywords: JOOBLE_LEGAL_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Operations / Project / Program / Admin
  "ops-admin-na": {
    keywords: JOOBLE_OPS_ADMIN_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "ops-admin-cities-us": {
    keywords: JOOBLE_OPS_ADMIN_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },
  "ops-admin-cities-ca": {
    keywords: JOOBLE_OPS_ADMIN_KEYWORDS,
    locations: JOOBLE_CANADA_TECH_HUBS,
  },

  // Supply Chain & Procurement
  "supply-chain-na": {
    keywords: JOOBLE_SUPPLY_CHAIN_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "supply-chain-cities-us": {
    keywords: JOOBLE_SUPPLY_CHAIN_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Consulting / Strategy
  "consulting-na": {
    keywords: JOOBLE_CONSULTING_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "consulting-cities-us": {
    keywords: JOOBLE_CONSULTING_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Communications & PR
  "communications-na": {
    keywords: JOOBLE_COMMUNICATIONS_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "communications-cities-us": {
    keywords: JOOBLE_COMMUNICATIONS_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Customer Success
  "customer-success-na": {
    keywords: JOOBLE_CUSTOMER_SUCCESS_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "customer-success-cities-us": {
    keywords: JOOBLE_CUSTOMER_SUCCESS_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Business Development & Partnerships
  "biz-dev-na": {
    keywords: JOOBLE_BIZ_DEV_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "biz-dev-cities-us": {
    keywords: JOOBLE_BIZ_DEV_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // ── New GENERAL families ──────────────────────────────────────────────────

  // Government / public sector (US + CA)
  "government-na": {
    keywords: JOOBLE_GOVERNMENT_KEYWORDS,
    locations: ["United States", "Canada", "Remote", "Washington, DC", "Ottawa, ON"],
  },
  "government-cities-us": {
    keywords: JOOBLE_GOVERNMENT_KEYWORDS,
    locations: ["Washington, DC", "Bethesda, MD", "Arlington, VA", "Alexandria, VA", "Sacramento, CA", "Albany, NY"],
  },

  // Education administration (non-classroom)
  "education-admin-na": {
    keywords: JOOBLE_EDUCATION_ADMIN_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "education-admin-cities-us": {
    keywords: JOOBLE_EDUCATION_ADMIN_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Healthcare administration (non-clinical)
  "healthcare-admin-na": {
    keywords: JOOBLE_HEALTHCARE_ADMIN_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "healthcare-admin-cities-us": {
    keywords: JOOBLE_HEALTHCARE_ADMIN_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Nonprofit & philanthropy
  "nonprofit-na": {
    keywords: JOOBLE_NONPROFIT_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "nonprofit-cities-us": {
    keywords: JOOBLE_NONPROFIT_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Real estate
  "real-estate-na": {
    keywords: JOOBLE_REAL_ESTATE_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "real-estate-cities-us": {
    keywords: JOOBLE_REAL_ESTATE_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Insurance
  "insurance-na": {
    keywords: JOOBLE_INSURANCE_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "insurance-cities-us": {
    keywords: JOOBLE_INSURANCE_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Hospitality management (non-frontline)
  "hospitality-mgmt-na": {
    keywords: JOOBLE_HOSPITALITY_MGMT_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "hospitality-mgmt-cities-us": {
    keywords: JOOBLE_HOSPITALITY_MGMT_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Editorial & publishing
  "editorial-na": {
    keywords: JOOBLE_EDITORIAL_PUBLISHING_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "editorial-cities-us": {
    keywords: JOOBLE_EDITORIAL_PUBLISHING_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Research & policy
  "research-policy-na": {
    keywords: JOOBLE_RESEARCH_POLICY_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "research-policy-cities-us": {
    keywords: JOOBLE_RESEARCH_POLICY_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Construction / real-estate / infrastructure PM (not blue-collar trades)
  "construction-pm-na": {
    keywords: JOOBLE_PROJECT_CONSTRUCTION_PM_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },

  // Content creators / producers
  "content-creator-na": {
    keywords: JOOBLE_CONTENT_CREATOR_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "content-creator-cities-us": {
    keywords: JOOBLE_CONTENT_CREATOR_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // ── Deep / specialty shards for the 12 priority categories ────────────────
  // These run in addition to the broader family shards above. Each focuses on
  // narrower keyword variants that the broad shards miss (e.g. SaaS-flavored
  // sales titles, audit-specific accounting roles, non-software engineering).

  // Engineering (non-software) — the 12-priority "Engineering" category
  // beyond the existing tech-* shards which cover SWE-flavored engineering.
  "engineering-na": {
    keywords: JOOBLE_ENGINEERING_NONSWE_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "engineering-cities-us": {
    keywords: JOOBLE_ENGINEERING_NONSWE_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },
  "engineering-cities-ca": {
    keywords: JOOBLE_ENGINEERING_NONSWE_KEYWORDS,
    locations: JOOBLE_CANADA_TECH_HUBS,
  },

  // Law / Legal — deeper specialty terms
  "law-deep-na": {
    keywords: JOOBLE_LAW_DEEP_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "law-deep-cities-us": {
    keywords: JOOBLE_LAW_DEEP_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Accounting — deeper specialty terms (general ledger, audit, billing, etc.)
  "accounting-deep-na": {
    keywords: JOOBLE_ACCOUNTING_DEEP_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "accounting-deep-cities-us": {
    keywords: JOOBLE_ACCOUNTING_DEEP_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // HR — deeper specialty terms (recruiting, total rewards, DEI, L&D)
  "hr-deep-na": {
    keywords: JOOBLE_HR_DEEP_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "hr-deep-cities-us": {
    keywords: JOOBLE_HR_DEEP_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Marketing — deeper specialty terms (SEO, paid media, automation, brand)
  "marketing-deep-na": {
    keywords: JOOBLE_MARKETING_DEEP_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "marketing-deep-cities-us": {
    keywords: JOOBLE_MARKETING_DEEP_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Sales — deeper specialty terms (SaaS, enterprise, AE tiers)
  "sales-deep-na": {
    keywords: JOOBLE_SALES_DEEP_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "sales-deep-cities-us": {
    keywords: JOOBLE_SALES_DEEP_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Healthcare admin — deeper (informatics, Epic/Cerner analysts, utilization)
  "healthcare-admin-deep-na": {
    keywords: JOOBLE_HEALTHCARE_ADMIN_DEEP_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "healthcare-admin-deep-cities-us": {
    keywords: JOOBLE_HEALTHCARE_ADMIN_DEEP_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Consulting — deeper (associates, implementation consultants, vertical)
  "consulting-deep-na": {
    keywords: JOOBLE_CONSULTING_DEEP_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "consulting-deep-cities-us": {
    keywords: JOOBLE_CONSULTING_DEEP_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // Business operations — deeper (BizOps, RevOps, GTM ops, growth analysts)
  "bizops-deep-na": {
    keywords: JOOBLE_BIZOPS_DEEP_KEYWORDS,
    locations: ["United States", "Canada", "Remote"],
  },
  "bizops-deep-cities-us": {
    keywords: JOOBLE_BIZOPS_DEEP_KEYWORDS,
    locations: JOOBLE_US_TECH_HUBS,
  },

  // ── Rotation profiles — replace exhausted shards with fresh seed combos ──
  // `admin-coordination-cities-us`, `tech-intern-coop-cities-us`,
  // `security-cities-us-2`, `fintech-emerging-cities-us` and similar have
  // all produced 0 net-new for 12 consecutive runs — they've mined their
  // keyword/city space. These rotation profiles pair different keyword
  // shapes with mid-tier US cities the original shards skipped (Phoenix,
  // Charlotte, Tampa, Salt Lake City, etc.) so we re-hit fresh inventory.

  // Admin / coordination rotation — small-mid market cities
  "admin-rotation-na": {
    keywords: [
      "office coordinator",
      "operations coordinator",
      "department coordinator",
      "project coordinator",
      "executive coordinator",
      "scheduling coordinator",
      "operations administrator",
      "executive assistant",
      "team administrator",
      "facilities coordinator",
      "logistics coordinator",
    ],
    locations: [
      "Phoenix, AZ",
      "Charlotte, NC",
      "Tampa, FL",
      "Orlando, FL",
      "Salt Lake City, UT",
      "Nashville, TN",
      "Indianapolis, IN",
      "Columbus, OH",
      "Kansas City, MO",
      "San Antonio, TX",
      "Halifax, NS",
      "Hamilton, ON",
    ],
  },

  // Intern / co-op / new grad rotation — university towns
  "early-career-rotation-na": {
    keywords: [
      "new grad analyst",
      "graduate engineer",
      "rotational program",
      "leadership rotational",
      "entry level associate",
      "junior associate",
      "associate analyst",
      "associate consultant",
      "co-op engineering",
      "summer internship",
      "winter internship",
      "fall internship",
      "campus hire",
    ],
    locations: [
      "Boston, MA",
      "Ann Arbor, MI",
      "Cambridge, MA",
      "Champaign, IL",
      "Berkeley, CA",
      "Stanford, CA",
      "Pittsburgh, PA",
      "College Station, TX",
      "West Lafayette, IN",
      "Madison, WI",
      "Ithaca, NY",
      "Kitchener, ON",
      "Kingston, ON",
      "London, ON",
    ],
  },

  // Security rotation — beyond the cybersecurity-only first shard
  "security-rotation-na": {
    keywords: [
      "security operations analyst",
      "soc analyst",
      "incident response analyst",
      "threat intelligence analyst",
      "vulnerability analyst",
      "application security engineer",
      "cloud security engineer",
      "identity and access management",
      "iam analyst",
      "security architect",
      "grc analyst",
      "security compliance analyst",
      "penetration tester",
      "red team",
      "blue team",
      "security awareness manager",
    ],
    locations: [
      "Washington, DC",
      "Arlington, VA",
      "Bethesda, MD",
      "Atlanta, GA",
      "Reston, VA",
      "Tysons, VA",
      "Annapolis Junction, MD",
      "Huntsville, AL",
      "Colorado Springs, CO",
      "San Antonio, TX",
    ],
  },

  // Fintech rotation — beyond payments + crypto into wealth/insurtech/regtech
  "fintech-rotation-na": {
    keywords: [
      "wealthtech analyst",
      "robo-advisor",
      "insurtech analyst",
      "regtech analyst",
      "lending operations",
      "credit risk analyst",
      "fraud analyst fintech",
      "payments product manager",
      "card operations analyst",
      "embedded finance",
      "open banking",
      "blockchain analyst non-engineering",
      "defi operations",
      "crypto operations",
    ],
    locations: [
      "Charlotte, NC",
      "Tampa, FL",
      "Salt Lake City, UT",
      "Jersey City, NJ",
      "Atlanta, GA",
      "Wilmington, DE",
      "Toronto, ON",
      "Montreal, QC",
    ],
  },

  // Tech rotation — mid-tier hubs beyond the SF/Seattle/NYC dominant set
  "tech-rotation-na": {
    keywords: JOOBLE_TECH_KEYWORDS,
    locations: [
      "Pittsburgh, PA",
      "Salt Lake City, UT",
      "Nashville, TN",
      "Indianapolis, IN",
      "Phoenix, AZ",
      "Columbus, OH",
      "Charlotte, NC",
      "Tampa, FL",
      "Madison, WI",
      "Detroit, MI",
      "Cincinnati, OH",
      "Saint Louis, MO",
      "Hamilton, ON",
      "Halifax, NS",
      "Winnipeg, MB",
      "Regina, SK",
      "Saskatoon, SK",
    ],
  },

  // Finance rotation — non-NYC US hubs
  "finance-rotation-na": {
    keywords: JOOBLE_FINANCE_KEYWORDS,
    locations: [
      "Charlotte, NC",
      "Tampa, FL",
      "Jacksonville, FL",
      "Saint Louis, MO",
      "Minneapolis, MN",
      "Salt Lake City, UT",
      "Phoenix, AZ",
      "Atlanta, GA",
      "Dallas, TX",
      "Houston, TX",
      "Wilmington, DE",
      "Cleveland, OH",
      "Pittsburgh, PA",
      "Birmingham, AL",
    ],
  },
};

export function createJoobleConnector(
  options: JoobleConnectorOptions = {}
): SourceConnector {
  const apiKey = process.env.JOOBLE_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new Error(
      "Jooble connector requires JOOBLE_API_KEY."
    );
  }

  const profile = normalizeProfileName(options.profile ?? "feed");
  const fetchCache = new Map<string, Promise<SourceConnectorFetchResult>>();

  return {
    key: `jooble:${profile}`,
    sourceName: "Jooble",
    sourceTier: "TIER_3",
    freshnessMode: "FULL_SNAPSHOT",
    async fetchJobs(
      fetchOptions: SourceConnectorFetchOptions
    ): Promise<SourceConnectorFetchResult> {
      const cacheKey = JSON.stringify({
        limit: fetchOptions.limit ?? "all",
        checkpoint: fetchOptions.checkpoint ?? null,
      });
      const existing = fetchCache.get(cacheKey);
      if (existing) {
        return existing;
      }

      const request = fetchJoobleJobs({
        apiKey,
        profile,
        keywords: options.keywords,
        locations: options.locations,
        now: fetchOptions.now,
        limit: fetchOptions.limit,
        signal: fetchOptions.signal,
        log: fetchOptions.log,
        checkpoint: parseCheckpoint(fetchOptions.checkpoint),
        onCheckpoint: fetchOptions.onCheckpoint,
      });
      request.catch(() => fetchCache.delete(cacheKey));
      fetchCache.set(cacheKey, request);
      return request;
    },
  };
}

async function fetchJoobleJobs(input: {
  apiKey: string;
  profile: string;
  keywords?: string[];
  locations?: Array<string | null>;
  now: Date;
  limit?: number;
  signal?: AbortSignal;
  log?: (message: string) => void;
  checkpoint?: JoobleCheckpoint | null;
  onCheckpoint?: (checkpoint: Prisma.InputJsonValue | null) => Promise<void> | void;
}): Promise<SourceConnectorFetchResult> {
  const searches = buildSearchSpecs({
    profile: input.profile,
    keywords: input.keywords,
    locations: input.locations,
  });
  const resultsPerPage = readPositiveIntEnv(
    "JOOBLE_RESULTS_PER_PAGE",
    JOOBLE_DEFAULT_RESULTS_PER_PAGE
  );
  const maxPages = readPositiveIntEnv(
    "JOOBLE_MAX_PAGES",
    JOOBLE_DEFAULT_MAX_PAGES
  );
  const searchesPerRun = readPositiveIntEnv(
    "JOOBLE_SEARCHES_PER_RUN",
    JOOBLE_DEFAULT_SEARCHES_PER_RUN
  );
  const rateDelayMs = readPositiveIntEnv(
    "JOOBLE_RATE_DELAY_MS",
    JOOBLE_DEFAULT_RATE_DELAY_MS
  );
  const seenIds = new Set<string>();
  const jobs: SourceConnectorJob[] = [];
  const searchSummaries: Array<Record<string, Prisma.InputJsonValue | null>> = [];
  const log = input.log ?? console.log;
  let nextCheckpoint: JoobleCheckpoint | null = input.checkpoint ?? {
    searchIndex: 0,
    page: 1,
  };
  let searchesProcessed = 0;
  let filteredForQualityCount = 0;

  for (
    let searchIndex = input.checkpoint?.searchIndex ?? 0;
    searchIndex < searches.length;
    searchIndex += 1
  ) {
    if (searchesPerRun > 0 && searchesProcessed >= searchesPerRun) {
      break;
    }

    const search = searches[searchIndex]!;
    const startPage =
      searchIndex === (input.checkpoint?.searchIndex ?? 0)
        ? input.checkpoint?.page ?? 1
        : 1;
    let pagesFetchedForSearch = 0;
    let fetchedForSearch = 0;
    let filteredForQualityForSearch = 0;

    for (
      let page = startPage;
      page <= maxPages && pagesFetchedForSearch < maxPages;
      page += 1
    ) {
      throwIfAborted(input.signal);
      if (typeof input.limit === "number" && jobs.length >= input.limit) {
        break;
      }

      const payload = await fetchJoobleSearchPage({
        apiKey: input.apiKey,
        keyword: search.keyword,
        location: search.location,
        page,
        resultsPerPage,
        signal: input.signal,
      });
      const entries = payload.jobs ?? [];

      if (entries.length === 0) {
        nextCheckpoint = {
          searchIndex: searchIndex + 1,
          page: 1,
        };
        await input.onCheckpoint?.(nextCheckpoint as Prisma.InputJsonValue);
        break;
      }

      for (const entry of entries) {
        if (!isAcceptableJoobleEntry(entry)) {
          filteredForQualityCount += 1;
          filteredForQualityForSearch += 1;
          continue;
        }

        const sourceId = buildSourceId(entry);
        if (!sourceId || seenIds.has(sourceId)) {
          continue;
        }
        seenIds.add(sourceId);
        jobs.push(mapJoobleJob(entry, input.now, search));
        fetchedForSearch += 1;
      }

      pagesFetchedForSearch += 1;
      nextCheckpoint = {
        searchIndex,
        page: page + 1,
      };
      await input.onCheckpoint?.(nextCheckpoint as Prisma.InputJsonValue);

      if (entries.length < resultsPerPage) {
        nextCheckpoint = {
          searchIndex: searchIndex + 1,
          page: 1,
        };
        await input.onCheckpoint?.(nextCheckpoint as Prisma.InputJsonValue);
        break;
      }

      await sleepWithAbort(rateDelayMs, input.signal);
    }

    searchSummaries.push({
      keyword: search.keyword,
      location: search.location,
      fetchedCount: fetchedForSearch,
      pagesFetched: pagesFetchedForSearch,
      filteredForQualityCount: filteredForQualityForSearch,
    });
    searchesProcessed += 1;

    if (pagesFetchedForSearch === 0) {
      log(
        `[jooble] search "${search.keyword}" @ "${search.location ?? "any"}" yielded no jobs`
      );
    }

    if (typeof input.limit === "number" && jobs.length >= input.limit) {
      break;
    }
  }

  const finalJobs =
    typeof input.limit === "number" ? jobs.slice(0, input.limit) : jobs;

  return {
    jobs: finalJobs,
    checkpoint: nextCheckpoint as Prisma.InputJsonValue | null,
    exhausted:
      nextCheckpoint == null ||
      nextCheckpoint.searchIndex >= searches.length,
    metadata: {
      apiBaseUrl: JOOBLE_API_BASE,
      profile: input.profile,
      fetchedAt: input.now.toISOString(),
      searchCount: searches.length,
      searchesProcessed,
      searchesPerRun,
      resultsPerPage,
      maxPages,
      rateDelayMs,
      filteredForQualityCount,
      searchSummaries,
      attribution: {
        required: false,
        note: "Provider-specific attribution should still be preserved where Jooble terms require it.",
      },
    } as Prisma.InputJsonValue,
  };
}

function isAcceptableJoobleEntry(job: JoobleJob) {
  const title = job.title?.trim();
  const company = job.company?.trim();
  if (!title || !company) return false;

  const normalizedCompany = company.toLowerCase().replace(/^www\./, "");
  return !JOOBLE_PLACEHOLDER_COMPANIES.has(normalizedCompany);
}

async function fetchJoobleSearchPage(input: {
  apiKey: string;
  keyword: string;
  location: string | null;
  page: number;
  resultsPerPage: number;
  signal?: AbortSignal;
}) {
  const response = await fetch(`${JOOBLE_API_BASE}/${input.apiKey}`, {
    method: "POST",
    signal: input.signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; applyoverflow-jooble/1.0)",
    },
    body: JSON.stringify({
      keywords: input.keyword,
      location: input.location ?? undefined,
      page: String(input.page),
      ResultOnPage: String(input.resultsPerPage),
      SearchMode: "0",
      companysearch: "false",
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Jooble API fetch failed: ${response.status} ${response.statusText}`
    );
  }

  return (await response.json()) as JoobleResponse;
}

function parseCheckpoint(value: Prisma.InputJsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const checkpoint = value as Prisma.InputJsonObject;
  const rawSearchIndex = checkpoint.searchIndex;
  const rawPage = checkpoint.page;
  const searchIndex =
    typeof rawSearchIndex === "number" ? Math.max(0, Math.round(rawSearchIndex)) : 0;
  const page = typeof rawPage === "number" ? Math.max(1, Math.round(rawPage)) : 1;

  return {
    searchIndex,
    page,
  } satisfies JoobleCheckpoint;
}

function buildSearchSpecs(input: {
  profile: string;
  keywords?: string[];
  locations?: Array<string | null>;
}) {
  const profileDefaults =
    JOOBLE_PROFILE_DEFAULTS[input.profile] ?? JOOBLE_PROFILE_DEFAULTS.feed;
  const envPrefix = input.profile.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const rawKeywords =
    input.keywords ??
    readCsvEnv(
      input.profile === "feed"
        ? "JOOBLE_KEYWORDS"
        : `JOOBLE_${envPrefix}_KEYWORDS`,
      profileDefaults.keywords
    );
  const rawLocations =
    input.locations ??
    readCsvEnv(
      input.profile === "feed"
        ? "JOOBLE_LOCATIONS"
        : `JOOBLE_${envPrefix}_LOCATIONS`,
      profileDefaults.locations.filter(
        (location): location is string => typeof location === "string"
      )
    );
  const keywords =
    rawKeywords.length === 1 && rawKeywords[0] === "ALL"
      ? [""]
      : rawKeywords;
  const locations =
    rawLocations.length === 1 && rawLocations[0] === "ALL"
      ? [null]
      : rawLocations
          .map((location) =>
            typeof location === "string" ? location.trim() : null
          )
          .filter((location): location is string => Boolean(location));

  const specs: JoobleSearchSpec[] = [];

  for (const location of locations.length > 0 ? locations : [null]) {
    for (const keyword of keywords.length > 0 ? keywords : [""]) {
      specs.push({
        keyword: keyword.trim(),
        location: location && location.trim().length > 0 ? location.trim() : null,
      });
    }
  }

  return specs.filter((spec) => spec.keyword.length > 0 || spec.location != null);
}

function normalizeProfileName(profile: string) {
  const normalized = profile.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return normalized || "feed";
}

function buildSourceId(job: JoobleJob) {
  if (job.id != null) {
    return `jooble:${String(job.id).trim()}`;
  }

  const link = job.link?.trim();
  if (link && link.length > 0) {
    return `jooble:${link}`;
  }

  const fallbackParts = [
    job.title?.trim().toLowerCase() ?? "",
    job.company?.trim().toLowerCase() ?? "",
    job.location?.trim().toLowerCase() ?? "",
    job.updated?.trim() ?? "",
  ].filter(Boolean);
  return fallbackParts.length > 0
    ? `jooble:${fallbackParts.join("|")}`
    : null;
}

function mapJoobleJob(
  job: JoobleJob,
  now: Date,
  search: JoobleSearchSpec
): SourceConnectorJob {
  const salary = parseSalaryRange(job.salary);
  const link = job.link?.trim() ?? "";
  const location = normalizeLocation(job.location, search.location);
  const description = (job.snippet ?? "").trim();
  const workMode = inferWorkMode(job, location);

  return {
    sourceId:
      buildSourceId(job) ??
      `jooble:${search.keyword.trim().toLowerCase() || "any"}|${
        search.location?.trim().toLowerCase() || "anywhere"
      }`,
    sourceUrl: link || null,
    title: (job.title ?? "").trim() || "Untitled Position",
    company: (job.company ?? "").trim() || "Unknown Company",
    location,
    description,
    applyUrl: link,
    postedAt: parseDate(job.updated) ?? now,
    deadline: null,
    employmentType: inferEmploymentType(job.type),
    workMode,
    salaryMin: salary.min,
    salaryMax: salary.max,
    salaryCurrency: salary.currency,
    metadata: {
      source: "jooble",
      providerSource: job.source ?? null,
      providerType: job.type ?? null,
      searchKeyword: search.keyword,
      searchLocation: search.location,
      rawLocation: job.location ?? null,
      rawSalary: job.salary ?? null,
    } as Prisma.InputJsonValue,
  };
}

function normalizeLocation(
  rawLocation: string | undefined,
  fallbackLocation: string | null
) {
  const raw = rawLocation?.trim();
  if (raw && raw.length > 0) {
    if (/remote|work from home|anywhere/i.test(raw)) {
      if (/canada/i.test(raw)) return "Remote (Canada)";
      if (/united states|usa|u\.s\./i.test(raw)) return "Remote (US Only)";
      if (/north america/i.test(raw)) return "Remote (North America)";
      return "Remote";
    }

    return raw;
  }

  if (fallbackLocation) {
    if (/remote/i.test(fallbackLocation)) return "Remote";
    return fallbackLocation;
  }

  return "Unknown";
}

function inferWorkMode(job: JoobleJob, location: string): WorkMode | null {
  const joined = [job.title, job.snippet, job.location, location]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\bremote|work from home|anywhere\b/.test(joined)) return "REMOTE" as WorkMode;
  if (/\bhybrid\b/.test(joined)) return "HYBRID" as WorkMode;
  if (/\bon[- ]?site\b/.test(joined)) return "ONSITE" as WorkMode;
  return null;
}

function inferEmploymentType(rawType: string | undefined): EmploymentType | null {
  const value = rawType?.trim().toLowerCase();
  if (!value) return null;
  if (value.includes("contract") || value.includes("freelance")) return "CONTRACT";
  if (value.includes("part")) return "PART_TIME";
  if (value.includes("intern")) return "INTERNSHIP";
  if (value.includes("temp")) return "CONTRACT";
  if (value.includes("full")) return "FULL_TIME";
  return null;
}

function parseSalaryRange(rawValue: string | undefined) {
  if (!rawValue || !rawValue.trim()) {
    return {
      min: null,
      max: null,
      currency: null,
    };
  }

  const currency =
    /\bCAD\b|C\$/i.test(rawValue)
      ? "CAD"
      : /\bEUR\b|€/i.test(rawValue)
        ? "EUR"
        : "USD";
  const values = [...rawValue.matchAll(/\$?C?\$?€?\s*(\d+(?:\.\d+)?)\s*([kK])?/g)]
    .map((match) => {
      const base = Number(match[1]);
      if (!Number.isFinite(base)) return null;
      return match[2] ? base * 1_000 : base;
    })
    .filter((value): value is number => typeof value === "number" && value > 0);

  if (values.length === 0) {
    return {
      min: null,
      max: null,
      currency: null,
    };
  }

  return {
    min: values[0] ?? null,
    max: values[1] ?? values[0] ?? null,
    currency,
  };
}

function parseDate(value: string | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
