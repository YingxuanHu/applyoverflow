import type { Prisma, Region, WorkMode } from "@/generated/prisma/client";

// Sentinel for jobs whose geography could not be resolved to a known NA region.
// Stored in the DB as null; the feed layer filters these out by default.
export const UNKNOWN_REGION = null satisfies Region | null;
import type {
  NormalizationResult,
  NormalizedJobInput,
  SourceConnectorJob,
} from "@/lib/ingestion/types";
import {
  CA_PROVINCE_CODES,
  CA_PROVINCE_NAMES,
  US_STATE_CODES,
  US_STATE_NAMES,
  hasStrongNonNorthAmericanGeoEvidence,
  isClearlyNonNorthAmericanLocation,
} from "@/lib/geo-scope";
import { buildCanonicalDedupeFields } from "@/lib/ingestion/dedupe";
import { extractNormalizedJobFacts } from "@/lib/ingestion/extraction/quality-gates";
import { mapNormalizedEmploymentTypeToLegacy } from "@/lib/ingestion/extraction/job-metadata-extractor";
import {
  sanitizeCompanyName,
  sanitizeJobDescriptionText,
} from "@/lib/job-cleanup";
import { assessJobDataQuality } from "@/lib/ingestion/job-data-quality";
import { classifyNonJobPosting } from "@/lib/job-integrity";
import { classifyJobMetadata } from "@/lib/job-metadata";

// US/CA state, province, and country marker sets live in src/lib/geo-scope.ts
// (imported above) so the NA-scope guard can share them without pulling
// server-only ingestion modules into client bundles.

const US_CITY_MARKERS = [
  "albuquerque",
  "ann arbor",
  "anchorage",
  "arlington",
  "atlanta",
  "austin",
  "baltimore",
  "baton rouge",
  "bellevue",
  "bethesda",
  "billings",
  "birmingham",
  "bismarck",
  "boise",
  "boston",
  "boulder",
  "brooklyn",
  "buffalo",
  "cambridge",
  "charleston",
  "charlotte",
  "cheyenne",
  "chicago",
  "cincinnati",
  "cleveland",
  "columbia",
  "columbus",
  "dallas",
  "denver",
  "des moines",
  "detroit",
  "durham",
  "eugene",
  "fargo",
  "hartford",
  "honolulu",
  "houston",
  "huntsville",
  "indianapolis",
  "irvine",
  "jackson",
  "jacksonville",
  "jersey city",
  "juneau",
  "kansas city",
  "las vegas",
  "lexington",
  "lincoln",
  "little rock",
  "los angeles",
  "louisville",
  "madison",
  "manchester",
  "memphis",
  "miami",
  "milwaukee",
  "minneapolis",
  "montgomery",
  "mountain view",
  "nashville",
  "new haven",
  "new jersey",
  "new orleans",
  "new york",
  "new york city",
  "newark",
  "nyc",
  "oakland",
  "oklahoma city",
  "omaha",
  "orlando",
  "overland park",
  "palo alto",
  "philadelphia",
  "phoenix",
  "pittsburgh",
  "portland",
  "providence",
  "raleigh",
  "redmond",
  "reno",
  "richmond",
  "rochester",
  "sacramento",
  "salt lake city",
  "san antonio",
  "san diego",
  "san francisco",
  "san jose",
  "santa clara",
  "santa fe",
  "scottsdale",
  "seattle",
  "sioux falls",
  "south san francisco",
  "st. louis",
  "stamford",
  "tampa",
  "tucson",
  "tulsa",
  "tysons",
  "washington dc",
  "wichita",
  "wilmington",
];

const CA_CITY_MARKERS = [
  "toronto",
  "vancouver",
  "montreal",
  "montréal",
  "calgary",
  "ottawa",
  "waterloo",
  "mississauga",
  "markham",
  "vaughan",
  "richmond hill",
  "quebec city",
  "saskatoon",
  "winnipeg",
  "hamilton",
  "burnaby",
  "surrey",
  "halifax",
  "edmonton",
  "regina",
  "kitchener",
  "london, on",
  "brampton",
  "scarborough",
  "richmond, bc",
  "laval",
  "longueuil",
  "gatineau",
  "sherbrooke",
  "barrie",
  "st. john",
  "thunder bay",
  "kelowna",
  "victoria, bc",
  "fredericton",
  "moncton",
  "charlottetown",
  "north york",
  "etobicoke",
  "kanata",
  "oakville",
  "burlington, on",
  "guelph",
  "saint-laurent",
  "dorval",
  "grande prairie",
  "red deer",
  "lethbridge",
  "nanaimo",
  "kamloops",
  "prince george",
  "saint john",
  "trois-rivières",
  "saguenay",
  "lévis",
  "terrebonne",
  "brossard",
  "repentigny",
  "newmarket",
  "richmond hill",
  "vaughan",
  "ajax",
  "whitby",
  "oshawa",
  "pickering",
  "cambridge, on",
  "kingston, on",
  "sudbury",
  "peterborough, on",
  "brantford",
  "st. catharines",
  "niagara falls, on",
  "chatham, on",
  "sarnia",
  "windsor, on",
  "coquitlam",
  "langley",
  "abbotsford",
  "new westminster",
  "north vancouver",
  "west vancouver",
  "delta, bc",
  "maple ridge",
  "chilliwack",
  "courtenay",
  "comox",
  "whistler",
  "squamish",
  "acheson",
];

const ROLE_PATTERNS: Array<{
  pattern: RegExp;
  roleFamily: string;
}> = [
  // ── Tech roles ──────────────────────────────────────────────────────────────

  // Solutions Engineering: pre-sales / technical integration roles
  {
    pattern: /\b(solutions engineer|sales engineer|solutions consultant|pre-sales engineer|implementation engineer|integration engineer|customer engineer)\b/i,
    roleFamily: "Solutions Engineering",
  },
  // Solutions Architecture: broader architectural / implementation layer
  // Listed before SWE so "solutions architect" doesn't fall into the broad engineer match
  {
    pattern:
      /\b(solutions architect|enterprise architect|technical architect|cloud architect|staff architect|principal architect|resident engineer|infrastructure architect|security architect|network architect|data architect)\b/i,
    roleFamily: "Solutions Architecture",
  },
  // Product Management: PM and TPM (TPM is tightly scoped to avoid "program manager" noise)
  // "product management" (gerund) catches exec titles like "Director, Product Management"
  {
    pattern:
      /\b(product manager|product management|group product manager|senior product manager|staff product manager|principal product manager|product owner|product lead)\b/i,
    roleFamily: "Product Management",
  },
  // Project / Delivery Management: scrum, agile, release, delivery roles
  {
    pattern:
      /\b(project manager|program manager|technical program manager|tpm\b|scrum master|agile coach|release manager|delivery manager|project management|program management|pmo)\b/i,
    roleFamily: "Project Management",
  },
  // Research: AI/ML research scientists and engineers at AI-first companies
  // "researcher" alone kept intentional — at OpenAI/Anthropic it is always a technical role
  {
    pattern: /\b(research scientist|research engineer|researcher|applied research scientist)\b/i,
    roleFamily: "Research",
  },
  // Data Science: ML engineering, applied science, and data science leadership
  // "data science" (standalone) catches exec titles like "Data Science Manager", "Head of Data Science"
  {
    pattern: /\b(machine learning|ml engineer|data scientist|data science|applied scientist|ai engineer|artificial intelligence)\b/i,
    roleFamily: "Data Science",
  },
  {
    pattern: /\b(ai tutor|ai trainer|llm evaluator|model trainer|data annotator|ai data specialist)\b/i,
    roleFamily: "AI Training",
  },
  // Data Engineering: pipeline / platform engineering (distinct from analyst/science)
  {
    pattern: /\b(data engineer|etl engineer|data pipeline engineer|data platform engineer|database engineer|database developer)\b/i,
    roleFamily: "Data Engineering",
  },
  // Data Analyst: analytics and BI
  {
    pattern:
      /\b(data analyst|analytics engineer|business intelligence|bi analyst|data analytics|bi developer|reporting analyst)\b/i,
    roleFamily: "Data Analyst",
  },
  // Product Analyst
  {
    pattern: /\b(product analyst)\b/i,
    roleFamily: "Product Analyst",
  },
  // Business Analyst
  {
    pattern: /\b(business analyst|business systems analyst|systems analyst)\b/i,
    roleFamily: "Business Analyst",
  },
  // Security
  {
    pattern: /\b(security|cybersecurity|cyber security)\b/i,
    roleFamily: "Security",
  },
  // QA / Test
  {
    pattern: /\b(qa|quality assurance|test automation|sdet|quality engineer|test engineer)\b/i,
    roleFamily: "QA",
  },
  // IT / Systems Administration: infrastructure operations, DBA, helpdesk
  {
    pattern:
      /\b(it manager|it director|it specialist|it analyst|it operations|systems administrator|system administrator|sysadmin|database administrator|dba|network administrator|help desk|helpdesk|it support|it technician|network engineer|infrastructure manager|it infrastructure)\b/i,
    roleFamily: "IT Operations",
  },
  // DevOps / cloud / platform / reliability roles. Kept separate from SWE so
  // filters can route them to IT / Systems / DevOps instead of generic
  // Software Engineering.
  {
    pattern:
      /\b(devops|dev ops|site reliability|sre\b|cloud engineer|infrastructure engineer|platform engineer|platform engineering|reliability engineer|build engineer|release engineer|automation engineer)\b/i,
    roleFamily: "IT Operations",
  },
  // (Marketing was historically classified as TECH/Marketing here so the
  // pool had any home for it. With GENERAL/Marketing live below, marketing
  // titles route there instead — see line ~488. The only marketing-coded
  // titles that stay TECH are explicitly engineering-flavored ones, which
  // are caught by the SWE pattern via the `engineer` keyword.)
  // Technical Writing / Developer Relations: technical content and community roles
  {
    pattern:
      /\b(technical writer|developer relations|developer advocate|devrel|developer experience|documentation engineer|technical documentation|technical editor|community engineer)\b/i,
    roleFamily: "Technical Writing",
  },
  // Design: product/UX/brand/web design — must be listed before SWE to prevent
  // "Designer, Web & Brand" from matching the SWE catch-all via "web engineer"
  {
    pattern:
      /\b(designer|design lead|design director|ux design|ui design|product design|brand design|graphic design|visual design|interaction design|design manager|ux researcher)\b/i,
    roleFamily: "Design",
  },
  // Customer Success: technical customer-facing roles at tech companies
  {
    pattern:
      /\b(customer success|customer success manager|customer success engineer|technical account manager|technical support engineer|support engineer|customer engineer|implementation consultant|onboarding specialist)\b/i,
    roleFamily: "Customer Success",
  },
  // Engineering (non-software): mechanical, civil, electrical, chemical,
  // biomedical, materials, aerospace, environmental, industrial,
  // manufacturing. The 12-priority "Engineering" category. Must come
  // BEFORE the SWE catch-all so "Mechanical Engineer" → Engineering, not
  // SWE.
  {
    pattern:
      /\b(mechanical engineer|mechanical design engineer|hardware engineer|mechatronics engineer|civil engineer|structural engineer|transportation engineer|geotechnical engineer|electrical engineer|electronics engineer|power systems engineer|controls engineer|chemical engineer|process engineer|process safety engineer|aerospace engineer|avionics engineer|propulsion engineer|biomedical engineer|validation engineer|industrial engineer|manufacturing engineer|quality engineer|environmental engineer|energy engineer|renewable energy engineer|sustainability engineer|materials engineer|metallurgical engineer)\b/i,
    roleFamily: "Engineering",
  },
  // SWE: broad engineering catch-all — listed last among tech so specific roles above take priority
  // "web" is scoped to "web engineer|web developer" to avoid matching design/content titles.
  // Avoid generic "engineer", "developer", and "mobile" matches here; those
  // caused non-software engineers, developer advocates, and article/product
  // pages to leak into Software Engineering filters.
  {
    pattern:
      /\b(software engineer|software developer|software architect|software engineering|frontend engineer|front-end engineer|frontend developer|front-end developer|backend engineer|back-end engineer|backend developer|back-end developer|full[- ]stack engineer|full[- ]stack developer|web engineer|web developer|mobile engineer|mobile developer|ios engineer|ios developer|android engineer|android developer|embedded software engineer|embedded engineer|firmware engineer|firmware developer|sdet|software development engineer in test|qa automation engineer|test automation engineer|développeur|ingénieur logiciel)\b/i,
    roleFamily: "SWE",
  },

  // ── Finance roles ────────────────────────────────────────────────────────────

  {
    pattern: /\b(financial analyst|corporate finance|finance analyst|treasury|finance manager|finance director|controller|comptroller)\b/i,
    roleFamily: "Financial Analyst",
  },
  // FP&A: includes finance-and-strategy roles at tech companies (e.g. "Finance & Strategy")
  {
    pattern:
      /\b(fp&a|financial planning|finance.{0,5}strategy|strategy.{0,5}finance)\b/i,
    roleFamily: "FP&A",
  },
  // Accounting: accountants, auditors, tax specialists, bookkeepers,
  // payroll accountants, AP/AR specialists. Also catches "tax preparer"
  // and "bookkeeping" titles that previously slipped through.
  {
    pattern:
      /\b(accountant|accounting|accounting manager|fund accountant|staff accountant|senior accountant|cost accountant|forensic accountant|corporate accountant|general ledger accountant|revenue accountant|tax analyst|tax manager|tax preparer|tax associate|tax consultant|tax accountant|tax senior|auditor|audit manager|audit associate|audit senior|external audit|internal audit|bookkeeper|bookkeeping|accounts payable|accounts receivable|ap specialist|ar specialist|billing specialist|collections specialist|cpa|payroll accountant|comptable|controller|assistant controller)\b/i,
    roleFamily: "Accounting",
  },
  // Quantitative / Trading: quants, traders, portfolio management
  {
    pattern:
      /\b(quantitative analyst|quant analyst|quant developer|quantitative developer|quantitative researcher|quant researcher|trader|trading analyst|trading desk|portfolio manager|portfolio analyst|fund manager|asset manager|investment analyst)\b/i,
    roleFamily: "Quantitative Finance",
  },
  // (Actuarial / Insurance was historically classified as FINANCE here.
  // It's been moved to GENERAL/Insurance below — the product treats
  // insurance underwriting + claims as a distinct white-collar family,
  // not a finance sub-family. The pre-existing pattern is intentionally
  // removed so the GENERAL family wins.)
  {
    pattern: /\b(investment banking|investment bank)\b/i,
    roleFamily: "Investment Banking",
  },
  // Lending / Banking: loan officers, mortgage, banking operations
  {
    pattern:
      /\b(loan officer|mortgage|loan analyst|credit analyst|banking|banker|bank manager|branch manager|teller|relationship manager|commercial banker|private banker|personal banker)\b/i,
    roleFamily: "Banking",
  },
  {
    pattern: /\b(risk)\b/i,
    roleFamily: "Risk",
  },
  {
    pattern: /\b(compliance|aml|anti-money laundering|kyc|know your customer|regulatory)\b/i,
    roleFamily: "Compliance",
  },
  {
    pattern: /\b(credit)\b/i,
    roleFamily: "Credit",
  },
  {
    pattern: /\b(wealth management|wealth|financial advisor|financial planner|financial planning)\b/i,
    roleFamily: "Wealth Management",
  },
  // (Generic Operations was historically classified as FINANCE/Operations
  // here. With GENERAL live, "operations manager / business operations /
  // operations analyst / director of operations" all route to GENERAL
  // through the Ops/Admin family further down, or to the General
  // Professional catch-all when titled less specifically. Finance-specific
  // ops (treasury operations, trading operations) stays under their own
  // FINANCE families above.)

  // ── White-collar cross-industry roles ────────────────────────────────────────

  // Marketing: brand, growth, content, demand gen, digital marketing
  {
    pattern:
      /\b(marketing manager|marketing director|marketing coordinator|brand manager|brand director|growth marketing|demand generation|product marketing|content marketing|digital marketing|seo manager|sem manager|email marketing|performance marketing|lifecycle marketing|field marketing|marketing analyst|marketing specialist|copywriter|content strategist|marketing operations)\b/i,
    roleFamily: "Marketing",
  },
  // HR / People: HR business partners, people ops, talent acquisition leaders,
  // payroll, HRBP shorthand, recruiter variants. (Previously excluded —
  // restored as a legitimate white-collar function.)
  {
    pattern:
      /\b(hr manager|hr director|hr generalist|hr partner|hr business partner|hrbp|human resources|people partner|people operations|people ops|chief people officer|chro|head of people|talent acquisition|head of talent|talent partner|compensation analyst|benefits manager|hris analyst|hr analyst|hr coordinator|people analytics|learning and development|l&d manager|training manager|organizational development|culture manager|employee relations|payroll manager|payroll analyst|payroll specialist|payroll coordinator|payroll administrator|service de la paie|technical recruiter|corporate recruiter|executive recruiter|university recruiter|campus recruiter|diversity recruiter|recruiting coordinator|recruiting manager|head of recruiting|head of recruitment|talent sourcer|total rewards|rewards analyst|dei manager|diversity equity inclusion|leadership development|employee experience)\b/i,
    roleFamily: "HR / People",
  },
  // Sales & Revenue: direct revenue-generating roles. Includes "sales
  // advisor", "membership sales", "account manager" — common variants that
  // were silently falling to General Professional.
  {
    pattern:
      /\b(account executive|sales manager|sales director|sales representatives?|sales lead|sales advisor|membership sales|account manager|inside sales|outside sales|sales operations|revenue manager|revenue operations|sales development|sdr\b|bdr\b|business development representative|enterprise sales|regional sales|national sales|sales analyst|sales enablement|channel sales|partner sales|sales consultant|inbound sales|sales executive|sales team|sales trainer|vendeur|vendeuse|ventes|représentant.*ventes?)\b/i,
    roleFamily: "Sales",
  },
  // Business Development: partnerships, strategic BD
  {
    pattern:
      /\b(business development|partnerships manager|partnerships director|strategic partnerships|partner manager|alliances manager|channel manager|bd manager)\b/i,
    roleFamily: "Business Development",
  },
  // Consulting / Advisory: professional services, management consulting
  {
    pattern:
      /\b(consultant|consulting|advisory|practice lead|practice manager|engagement manager|managing consultant|principal consultant|senior consultant)\b/i,
    roleFamily: "Consulting",
  },
  // Legal: corporate legal, contracts, IP, regulatory counsel
  {
    pattern:
      /\b(attorney|lawyer|counsel|general counsel|paralegal|legal analyst|legal operations|legal manager|contracts manager|contract manager|ip counsel|corporate counsel|legal director)\b/i,
    roleFamily: "Legal",
  },
  // Supply Chain / Procurement: sourcing, logistics, procurement
  {
    pattern:
      /\b(supply chain|procurement|purchasing|logistics manager|logistics analyst|sourcing manager|sourcing analyst|inventory manager|demand planner|supply planner|materials manager|vendor manager)\b/i,
    roleFamily: "Supply Chain",
  },
  // Communications / PR: corporate communications and public relations.
  // Editor titles ("editorial", "managing editor", "editor in chief") moved
  // out — they live in the dedicated Editorial family below where they
  // belong.
  {
    pattern:
      /\b(communications manager|communications director|public relations|pr manager|corporate communications|internal communications|media relations|investor relations|media manager|content manager|publicist|spokesperson)\b/i,
    roleFamily: "Communications",
  },
  // Administrative / Executive Support: EA, office management
  {
    pattern:
      /\b(executive assistant|administrative assistant|office manager|office administrator|chief of staff|admin assistant|administrative coordinator|operations coordinator|department coordinator)\b/i,
    roleFamily: "Administrative",
  },
  // Operations (non-finance, non-IT): general business operations,
  // ops analysts, ops directors. Filled the gap left when we removed
  // the FINANCE/Operations catch-all pattern.
  {
    pattern:
      /\b(operations manager|operations director|operations analyst|operations lead|operations associate|operations specialist|business operations|biz ops|bizops|head of operations|director of operations|vp of operations|strategy and operations|strategy & operations)\b/i,
    roleFamily: "Operations",
  },
  // Insurance: underwriters, adjusters, brokers, actuarial roles. Pulled
  // by the new Jooble insurance-* shards.
  {
    pattern:
      /\b(underwriter|underwriting analyst|underwriting manager|claims analyst|claims adjuster|claim rep|claims representative|claims examiner|claims specialist|insurance broker|insurance agent|insurance specialist|reinsurance analyst|actuarial analyst|actuary)\b/i,
    roleFamily: "Insurance",
  },
  // Healthcare Administration (non-clinical): hospital admin, practice
  // managers, medical billing/coding, health systems analysts. Distinct
  // from the clinical roles that EXCLUDED_TITLE_PATTERNS filters out.
  {
    pattern:
      /\b(hospital administrator|healthcare operations|healthcare program manager|healthcare admin|practice manager|clinic operations|medical office manager|medical biller|medical billing|medical coder|medical coding|revenue cycle|patient experience|credentialing|health policy|health systems analyst|hospital operations|health insurance analyst)\b/i,
    roleFamily: "Healthcare Admin",
  },
  // Real Estate: investment analysts, asset managers, leasing, property
  // managers — non-trades. Trades-side roles (contractor, plumber, etc.)
  // already excluded by EXCLUDED_TITLE_PATTERNS.
  {
    pattern:
      /\b(real estate analyst|real estate associate|real estate manager|real estate director|asset manager.*real estate|real estate.*asset manager|leasing manager|leasing director|leasing consultant|property manager|property administrator|portfolio analyst.*real estate|real estate.*portfolio|acquisitions analyst|investment analyst.*real estate|commercial real estate|reit analyst|reit manager)\b/i,
    roleFamily: "Real Estate",
  },
  // Hospitality Management (corporate / revenue / events, not frontline):
  // hotel ops, revenue managers, events managers. Frontline (cook,
  // server, bartender, etc.) already excluded.
  {
    pattern:
      /\b(hotel manager|hotel operations|revenue manager.*(?:hotel|hospitality)|guest experience|events manager|event operations|catering operations|hospitality program|travel operations manager)\b/i,
    roleFamily: "Hospitality Management",
  },
  // Government / Public Sector: policy, regulatory, program officers,
  // public administration. Excludes military / law enforcement (in
  // EXCLUDED_TITLE_PATTERNS).
  {
    pattern:
      /\b(policy analyst|policy advisor|policy researcher|program officer|program analyst|public administrator|government affairs|regulatory analyst|regulatory affairs(?!.*pharma)|intelligence analyst|legislative analyst|legislative aide|federal contractor|public sector consultant|municipal analyst|grants analyst)\b/i,
    roleFamily: "Government",
  },
  // Editorial & Publishing: editors, content directors, copy editors,
  // staff writers, producers. Distinct from Marketing/Comms.
  {
    pattern:
      /\b(senior editor|managing editor|editor in chief|copy editor|production editor|editorial manager|editorial assistant|staff writer|content director|video producer|podcast producer|creative producer|content producer|publisher\b)\b/i,
    roleFamily: "Editorial",
  },
  // Nonprofit & Philanthropy: development directors, grant writers,
  // fundraising managers, foundation program officers.
  {
    pattern:
      /\b(development director.*nonprofit|nonprofit program|grant writer|grants manager|fundraising manager|donor relations|foundation program officer|advocacy manager|philanthropy manager|nonprofit executive director)\b/i,
    roleFamily: "Nonprofit",
  },
  // Education Administration (non-classroom): registrars, admissions,
  // student affairs, academic advisors, institutional research. Teaching
  // titles still excluded by EXCLUDED_TITLE_PATTERNS.
  {
    pattern:
      /\b(registrar|admissions counselor|admissions director|admissions officer|student affairs|academic advisor|career counselor|financial aid administrator|academic program manager|institutional research|education program manager|edtech program|university administrator)\b/i,
    roleFamily: "Education Admin",
  },

  // (Engineering pattern was moved above the SWE catch-all so non-software
  // engineering routes correctly — see line ~395.)
  // Technical / Engineering misc: inspectors, lab techs, QC, plant/field
  // techs, statisticians, researchers — the bench-side roles that don't
  // fit the Engineering family but are still tech-adjacent.
  {
    pattern:
      /\b(quality inspector|quality control|environmental.*(?:analyst|monitor|specialist)|lab(?:oratory)?\s+(?:technician|analyst|assistant)|test(?:er|ing)\b|quality assurance.*(?:analyst|inspector)|maintenance.*(?:engineer|leader|manager|technician)|plant.*(?:manager|engineer)|field\s+(?:engineer|technician)|biostatistic|statistician|scientist|researcher|research\s+(?:analyst|assistant|associate)|webmestre|webmaster)\b/i,
    roleFamily: "Technical",
  },
  // Internships / Co-ops / Students (tech and finance focused)
  {
    pattern:
      /\b(intern\b|internship|co-?op\b|stagiaire|summer\s+student|work\s+(?:term|placement))\b/i,
    roleFamily: "Internship",
  },

  // ── General Professional catch-all ─────────────────────────────────────────────
  // Matches any remaining title with common professional keywords.
  // Listed LAST so specific families above always take priority.
  // Captures the long tail of white-collar roles that didn't match a more
  // specific family above.
  {
    pattern:
      /\b(manager|director|analyst|coordinator|specialist|advisor|officer|lead\b|head of|vp\b|vice president|associate|supervisor|administrator|strategist|planner|representative|clerk|technologist|receptionist|technician|assistant|operator|programmer|buyer|reviewer|trainer|consultant|executive|gestionnaire|analyste|conseill(?:er|ère)|comptable|responsable|coordonnateur|coordonnatrice|technicien(?:ne)?|agent(?:e)?|préposé|commis|adjoint(?:e)?|directeur|directrice|gérant(?:e)?|courtier|inspecteur|opérateur|webmestre|merchant|ambassador)\b/i,
    roleFamily: "General Professional",
  },
];

export const EXCLUDED_TITLE_PATTERNS = [
  // NOTE: HR/People/Recruiting roles were previously excluded but are now
  // legitimate white-collar pool members. Removed.
  // Healthcare / Medical
  /\b(registered nurse|\bRN\b|nurse practitioner|nursing|physician|surgeon|medical director|pharmacist|pharmacy|dental|dentist|veterinar|therapist|physiotherapist|occupational therapist|radiolog|pathologist|optometrist|chiropract|paramedic|midwife|phlebotom|sonograph|respiratory|speech.lang|audiolog|dietitian|nutritionist|oncology|hematology|cardiolog|neurolog|dermatolog|psychiatr|anesthesi|medical science liaison|clinical research associate|clinical nurse)\b/i,
  // Trades / Manual labour
  /\b(mechanic|electrician|plumber|welder|carpenter|painter|roofer|mason|hvac|installer(?!\s+(?:software|engineer))|pipefitter|millwright|machinist|sheet metal|ironworker|boilermaker|glazier|drywall|framing)\b/i,
  // Driving / Transportation
  /\b(cdl|truck driver|bus driver|delivery driver|forklift|warehouse associate|sorter|picker|packer)\b/i,
  // Childcare / Domestic
  /\b(babysitter|nanny|caregiver|childcare|au pair)\b/i,
  // Food service / Retail frontline
  /\b(barista|server|cook\b|chef\b|dishwasher|busser|bartender|cashier|stocker|grocery)\b/i,
  // Education (non-tech). "dean" alone is too broad — academic deans of
  // operations / career services / student affairs / business admin /
  // research are legitimate white-collar admin roles. Allow those by
  // requiring "dean" NOT be followed by an admin-flavoured noun, mirroring
  // the same lookahead trick used for "principal" above. "associate dean"
  // / "assistant dean" of operations / administration / finance also pass.
  /\b(teacher|professor|lecturer|tutor(?!ial)|principal(?!\s+(?:engineer|architect|consultant|analyst|developer|scientist|designer|manager|director|swe|technical|planning|product|data|security|program|software|cloud|platform|solutions|financial|investment))|superintendent|librarian|dean\b(?!\s+(?:of\s+)?(?:operations|administration|admin|finance|business|career\s+services|student\s+affairs|enrollment|research|admissions|advancement|external\s+affairs|institutional))|provost)\b/i,
  // Skilled trades / Construction
  /\b(crane operator|heavy equipment|excavat|concrete|paving|asphalt|demolition|scaffolding|surveyor)\b/i,
  // Law enforcement / Emergency / Military (not corporate security)
  /\b(police|sheriff|firefighter|paramedic|corrections officer|probation officer|dispatch(?!er\b.*(?:software|tech|logistics)))\b/i,
  // Agriculture / Outdoors
  /\b(farm worker|rancher|horticultur|arborist|landscap|groundskeeper)\b/i,
  // French healthcare / trades / manual exclusions
  /\b(infirmi(?:er|ère)|médecin|chirurgien|pharmacien|dentiste|vétérinaire|ambulancier|sage-femme|préposé aux bénéficiaires|aide-soignant|ouvrier|soudeur|mécanicien|électricien|plombier|charpentier|camionneur|chauffeur(?:\s+de\s+camion)?|enseignant|professeur|journalier|manoeuvre|assembleur|magasinier|opérateur de machinerie|éducateur.*petite enfance|ajusteur|monteur d'avions)\b/i,
  // General spam / non-job patterns
  /\b(door\s+to\s+door|brand\s+ambassador.*activation|remote\s+recruiter.*\$\d|personal\s+development\s+sales)\b/i,
];

const JUNK_TITLE_PATTERNS = [
  /^(jobs?|job search|search results|career opportunities|careers?|open positions?|job openings?)$/i,
  /^(page not found|404|access denied|forbidden|sign in|log in)$/i,
];

const JUNK_CONTENT_PATTERNS = [
  /\b(access denied|forbidden|captcha|cloudflare|security check|enable javascript|page not found|404 not found)\b/i,
  /\b(sign in to continue|log in to continue|session expired)\b/i,
];

const DEAD_CONTENT_PATTERNS = [
  /\b(job (?:posting )?(?:has )?(?:closed|expired)|position has been filled|role has been filled|no longer accepting applications)\b/i,
  /\b(this posting is no longer available|this job is no longer available|application window has closed)\b/i,
  /\b(job not found|posting not found|position not found|requisition not found|listing not found)\b/i,
  /\b(position (?:is )?(?:closed|filled)|posting (?:is )?(?:closed|inactive)|role (?:is )?no longer open)\b/i,
  /\b(we (?:are|re) no longer accepting applications|this opportunity is no longer open|this requisition has been cancelled)\b/i,
];

export type DeadSignalResult = {
  detected: boolean;
  reason: string | null;
};

type NormalizeSourceJobOptions = {
  job: SourceConnectorJob;
  fetchedAt: Date;
  sourceName?: string | null;
};

export function normalizeSourceJob({
  job,
  fetchedAt,
  sourceName,
}: NormalizeSourceJobOptions): NormalizationResult {
  const company =
    sanitizeCompanyName(job.company, {
      urls: [job.applyUrl, job.sourceUrl],
    }) || "Unknown";
  const extractedFacts = extractNormalizedJobFacts(job, {
    company,
    urls: [job.applyUrl, job.sourceUrl],
    sourceName,
    metadata: job.metadata,
    fetchedAt,
  });
  const title = extractedFacts.title.value;
  const normalizedLocation = extractedFacts.location?.value || "Unknown";
  const description = extractedFacts.description.text ?? sanitizeText(job.description, {
    title,
    location: normalizedLocation,
  });
  const applyUrl =
    compactWhitespace(job.applyUrl) ||
    (job.sourceUrl ? compactWhitespace(job.sourceUrl) : "") ||
    "";

  if (!title) {
    return {
      kind: "rejected",
      reason: "missing_minimum_identity",
    };
  }

  if (!applyUrl) {
    return {
      kind: "rejected",
      reason: "missing_apply_or_detail_path",
    };
  }

  if (!isApplyableHttpUrl(applyUrl)) {
    return {
      kind: "rejected",
      reason: "invalid_apply_url",
    };
  }

  if (!extractedFacts.quality.shouldIndex) {
    return {
      kind: "rejected",
      reason:
        extractedFacts.quality.rejectionReasons[0]?.toLowerCase() ??
        "extraction_quality_gate",
    };
  }

  if (isObviouslyJunkJob({ title, description, applyUrl })) {
    return {
      kind: "rejected",
      reason: "obvious_junk",
    };
  }

  if (
    isObviouslyDeadAtIntake({
      title,
      description,
      deadline: extractedFacts.metadata.applicationDeadline.value,
      fetchedAt,
    })
  ) {
    return {
      kind: "rejected",
      reason: "obvious_dead_at_intake",
    };
  }

  const dataQuality = assessJobDataQuality({
    title,
    company,
    description,
    applyUrl,
  });
  if (dataQuality.severity === "reject") {
    return {
      kind: "rejected",
      reason: dataQuality.rejectionReason ?? "bad_core_fields",
    };
  }

  const location = normalizedLocation;

  const region = inferRegion(location);

  // NA-only product scope: when no US/CA region could be inferred and the
  // location explicitly names a non-NA geography ("Jakarta", "Berlin,
  // Germany"), the job is out of scope. Ambiguous region-less locations
  // ("Remote") stay eligible.
  if (region === UNKNOWN_REGION && isClearlyNonNorthAmericanLocation(location)) {
    return {
      kind: "rejected",
      reason: "out_of_scope_geography",
    };
  }

  const roleProfile = inferRoleProfile(title);
  const roleFamily = roleProfile?.roleFamily ?? "Unknown";

  const workMode = extractedFacts.metadata.workMode.value;
  const employmentType = mapNormalizedEmploymentTypeToLegacy(
    extractedFacts.metadata.employmentType.value
  );
  const metadata = classifyJobMetadata({
    title,
    rawTitle: job.title,
    company,
    description,
    location,
    roleFamily,
    legacyIndustry: null,
    sourceEmploymentType: job.employmentType,
    inferredEmploymentType: employmentType,
    workMode,
    sourceMetadata: job.metadata,
    applyUrl,
    sourceUrl: job.sourceUrl,
  });
  const experienceLevel = metadata.experienceLevel;
  const postedAt = extractedFacts.metadata.datePosted.value ?? fetchedAt;
  const deadline =
    extractedFacts.metadata.applicationDeadline.status === "invalid"
      ? null
      : extractedFacts.metadata.applicationDeadline.value;
  const resolvedSalary = extractedFacts.salary;
  const dedupeFields = buildCanonicalDedupeFields({
    company,
    title,
    description,
    location,
    region,
    applyUrl,
  });

  const normalized: NormalizedJobInput = {
    title,
    company,
    companyKey: dedupeFields.companyKey,
    titleKey: dedupeFields.titleKey,
    titleCoreKey: dedupeFields.titleCoreKey,
    descriptionFingerprint: dedupeFields.descriptionFingerprint,
    location,
    locationKey: dedupeFields.locationKey,
    region,
    workMode,
    workModeConfidence: extractedFacts.metadata.workMode.confidence,
    workModeStatus: extractedFacts.metadata.workMode.status,
    workModeSource: extractedFacts.metadata.workMode.source,
    workModeCandidatesJson: extractedFacts.metadata.workModeCandidates as unknown as Prisma.InputJsonValue,
    salaryMin: resolvedSalary.annualizedMin,
    salaryMax: resolvedSalary.annualizedMax,
    salaryCurrency: resolvedSalary.currency,
    employmentType,
    employmentTypeGroup: extractedFacts.metadata.employmentTypeGroup,
    employmentTypeConfidence: extractedFacts.metadata.employmentType.confidence,
    employmentTypeStatus: extractedFacts.metadata.employmentType.status,
    employmentTypeSource: extractedFacts.metadata.employmentType.source,
    employmentTypeCandidatesJson:
      extractedFacts.metadata.employmentTypeCandidates as unknown as Prisma.InputJsonValue,
    experienceLevel,
    description,
    shortSummary: buildShortSummary(title, company, workMode, description),
    industry: null,
    roleFamily,
    normalizedEmploymentType: extractedFacts.metadata.employmentType.value,
    normalizedEmploymentTypeConfidence: extractedFacts.metadata.employmentType.confidence,
    normalizedCareerStage: metadata.normalizedCareerStage,
    normalizedCareerStageConfidence: metadata.confidence.careerStage,
    experienceLevelGroup: metadata.experienceLevelGroup,
    experienceLevelSource: metadata.experienceLevelSource,
    experienceLevelEvidenceJson:
      metadata.experienceLevelEvidence as unknown as Prisma.InputJsonValue,
    experienceLevelWarningsJson:
      metadata.experienceLevelWarnings as unknown as Prisma.InputJsonValue,
    normalizedIndustry: metadata.normalizedIndustry,
    normalizedIndustries: metadata.normalizedIndustries,
    normalizedIndustryConfidence: metadata.confidence.industry,
    normalizedRoleCategory: metadata.normalizedRoleCategory,
    normalizedRoleCategoryConfidence: metadata.confidence.roleCategory,
    normalizedRoleCategoryGroup: metadata.normalizedRoleCategoryGroup,
    normalizedRoleCategoryStatus: metadata.normalizedRoleCategoryStatus,
    normalizedRoleCategorySource: metadata.normalizedRoleCategorySource,
    normalizedRoleCategoryCandidatesJson:
      metadata.normalizedRoleCategoryCandidates as unknown as Prisma.InputJsonValue,
    normalizedRoleCategoryEvidenceJson:
      metadata.normalizedRoleCategoryEvidence as unknown as Prisma.InputJsonValue,
    normalizedRoleCategoryWarningsJson:
      metadata.normalizedRoleCategoryWarnings as unknown as Prisma.InputJsonValue,
    classificationStatus: metadata.classificationStatus,
    displayTitle: extractedFacts.displayTitle ?? null,
    titleConfidence: extractedFacts.title.confidence,
    titleStatus: extractedFacts.title.status,
    titleSource: extractedFacts.title.source,
    titleCandidatesJson: extractedFacts.titleCandidates as unknown as Prisma.InputJsonValue,
    titleRejectedFragmentsJson:
      extractedFacts.titleRejectedFragments as unknown as Prisma.InputJsonValue,
    titleExtractionWarnings:
      extractedFacts.titleExtractionWarnings as unknown as Prisma.InputJsonValue,
    jobPageType: extractedFacts.jobPageType ?? "unknown",
    locationConfidence: extractedFacts.location?.confidence ?? null,
    locationStatus: extractedFacts.location?.status ?? "missing",
    locationSource: extractedFacts.location?.source ?? null,
    locationCandidatesJson: extractedFacts.locationCandidates as unknown as Prisma.InputJsonValue,
    salaryStatus: extractedFacts.salary.status,
    salaryPeriod: extractedFacts.salary.period,
    salaryRawText: extractedFacts.salary.rawText,
    salaryConfidence: extractedFacts.salary.confidence,
    salarySource: extractedFacts.salary.source,
    descriptionStatus: extractedFacts.description.status,
    descriptionConfidence: extractedFacts.description.confidence,
    descriptionWordCount: extractedFacts.description.wordCount,
    datePostedConfidence: extractedFacts.metadata.datePosted.confidence,
    datePostedStatus: extractedFacts.metadata.datePosted.status,
    datePostedSource: extractedFacts.metadata.datePosted.source,
    datePostedRawText: extractedFacts.metadata.datePosted.rawValue ?? null,
    applicationDeadlineConfidence: extractedFacts.metadata.applicationDeadline.confidence,
    applicationDeadlineStatus: extractedFacts.metadata.applicationDeadline.status,
    applicationDeadlineSource: extractedFacts.metadata.applicationDeadline.source,
    applicationDeadlineRawText:
      extractedFacts.metadata.applicationDeadline.rawValue ?? null,
    metadataExtractionWarnings:
      extractedFacts.metadata.warnings as unknown as Prisma.InputJsonValue,
    extractionWarnings: extractedFacts.quality.warnings as unknown as Prisma.InputJsonValue,
    extractionRejectionReasons:
      extractedFacts.quality.rejectionReasons as unknown as Prisma.InputJsonValue,
    applyUrl,
    applyUrlKey: dedupeFields.applyUrlKey,
    postedAt,
    deadline,
    duplicateClusterId: dedupeFields.duplicateClusterId,
  };

  return {
    kind: "accepted",
    job: normalized,
  };
}

export function inferRegion(location: string): Region | null {
  const normalizedLocation = location.toUpperCase();
  if (
    normalizedLocation.includes("NORTH AMERICA") ||
    normalizedLocation.includes("AMERICAS") ||
    normalizedLocation.includes("US & CANADA") ||
    normalizedLocation.includes("US/CANADA") ||
    normalizedLocation.includes("US AND CANADA")
  ) {
    return "CA";
  }

  if (
    normalizedLocation.includes("UNITED STATES") ||
    normalizedLocation.includes("USA") ||
    normalizedLocation.includes("U.S.")
  ) {
    return "US";
  }

  if (normalizedLocation.includes("CANADA")) {
    return "CA";
  }

  // Unambiguous foreign country/admin-region names beat everything below:
  // both the city markers and the trailing-code parsing collide with foreign
  // strings ("Cambridge, UK" tripping the US Cambridge marker; "..., DKI
  // Jakarta, ID" reading Indonesia's country code as Idaho — production had
  // thousands of foreign jobs stamped US/CA this way).
  if (hasStrongNonNorthAmericanGeoEvidence(location)) {
    return null;
  }

  const loweredLocation = location.toLowerCase();
  if (US_CITY_MARKERS.some((cityMarker) => loweredLocation.includes(cityMarker))) {
    return "US";
  }
  if (CA_CITY_MARKERS.some((cityMarker) => loweredLocation.includes(cityMarker))) {
    return "CA";
  }

  const parts = location
    .split(",")
    .map((segment) => segment.trim().toUpperCase())
    .filter(Boolean);
  const trailingPart = parts[parts.length - 1] ?? "";
  const secondTrailingPart = parts[parts.length - 2] ?? "";

  // Structured ATS feeds often emit Canadian locations as "City, BC, CA".
  // Treat the province + trailing country pair as Canada before the lone "CA"
  // token can be misread as California.
  if (trailingPart === "CA" && CA_PROVINCE_CODES.has(secondTrailingPart)) {
    return "CA";
  }

  // Handle trailing country codes: "City, STATE, US" or "City, PROVINCE, CA"
  // Many ATS feeds (Workday, iCIMS, etc.) append country code after state/province.
  if (
    (trailingPart === "US" || trailingPart === "USA") &&
    US_STATE_CODES.has(secondTrailingPart)
  ) {
    return "US";
  }
  if (trailingPart === "CANADA" && CA_PROVINCE_CODES.has(secondTrailingPart)) {
    return "CA";
  }

  if (US_STATE_CODES.has(trailingPart)) return "US";
  if (CA_PROVINCE_CODES.has(trailingPart)) return "CA";
  if (US_STATE_NAMES.has(trailingPart)) return "US";
  if (CA_PROVINCE_NAMES.has(trailingPart)) return "CA";
  if (US_STATE_NAMES.has(secondTrailingPart)) return "US";
  if (CA_PROVINCE_NAMES.has(secondTrailingPart)) return "CA";

  // Handle remote, worldwide, and work-from-home locations.
  // Pure "Remote" and similar strings are treated as US-eligible: the structured
  // ATS sources we ingest (Greenhouse, Lever, Ashby) are predominantly NA-based
  // companies whose unqualified remote roles target US/CA applicants.
  // Reject only when an explicit non-NA qualifier is present.
  if (
    normalizedLocation.includes("REMOTE") ||
    normalizedLocation.includes("WORK FROM HOME") ||
    normalizedLocation.includes("WORLDWIDE") ||
    normalizedLocation.includes("ANYWHERE") ||
    normalizedLocation === "GLOBAL"
  ) {
    const NON_NA_REMOTE_QUALIFIERS = [
      "EUROPE",
      "EMEA",
      "LATAM",
      "APAC",
      "ASIA",
      "AUSTRALIA",
      "INDIA",
      "AFRICA",
      "MIDDLE EAST",
      "UNITED KINGDOM",
      "GERMANY",
      "FRANCE",
      "BRAZIL",
      "JAPAN",
      "SINGAPORE",
      "NETHERLANDS",
      "SWEDEN",
      "POLAND",
    ];
    if (!NON_NA_REMOTE_QUALIFIERS.some((q) => normalizedLocation.includes(q))) {
      if (
        normalizedLocation.includes("WORLDWIDE") ||
        normalizedLocation.includes("ANYWHERE") ||
        normalizedLocation === "GLOBAL" ||
        normalizedLocation.includes("NORTH AMERICA") ||
        normalizedLocation.includes("AMERICAS") ||
        normalizedLocation.includes("CANADA") ||
        normalizedLocation.includes("US & CANADA") ||
        normalizedLocation.includes("US/CANADA") ||
        normalizedLocation.includes("US AND CANADA")
      ) {
        return "CA";
      }
      return "US";
    }
  }

  return null;
}

// Exported for unit tests covering the per-family expansion (marketing,
// sales, HR, legal, ops/admin, supply chain, consulting, communications,
// customer success, biz dev). Not part of the stable public ingestion API
// — call sites in the codebase still go through `normalizeSourceJob`.
export function inferRoleProfile(title: string) {
  return ROLE_PATTERNS.find((rolePattern) => rolePattern.pattern.test(title)) ?? null;
}

function buildShortSummary(
  title: string,
  company: string,
  workMode: WorkMode,
  description: string
) {
  // Find the first substantive sentence: skip blank lines, ALL-CAPS section
  // headers (e.g. "ABOUT THE ROLE"), and lines shorter than 20 chars.
  const lines = description
    .split(/\n/)
    .map((line) => sanitizeSummaryLine(line))
    .filter(Boolean);
  const SECTION_HEADER_RE = /^[A-Z][A-Z\s&'/():-]{3,}$|^#{1,3}\s/;
  const BOILERPLATE_RE = /^(equal opportunity|we are an? |disclaimer|eoe|accommodation|diversity|note to|about us$|about the company$)/i;
  let firstSentence = "";
  for (const line of lines) {
    if (line.length < 20) continue;
    if (SECTION_HEADER_RE.test(line)) continue;
    if (BOILERPLATE_RE.test(line)) continue;
    // Take up to first sentence boundary
    const sentenceEnd = line.search(/[.!?]/);
    firstSentence = sentenceEnd > 0 ? line.slice(0, sentenceEnd + 1).trim() : line;
    break;
  }
  if (!firstSentence) firstSentence = `${company} is hiring for ${title}.`;

  const modeSummary =
    workMode === "REMOTE"
      ? "Remote-friendly."
      : workMode === "HYBRID"
        ? "Hybrid schedule."
        : workMode === "FLEXIBLE"
          ? "Flexible work arrangement."
          : workMode === "ONSITE"
            ? "On-site expectation."
            : "";

  return compactWhitespace(`${firstSentence} ${modeSummary}`).slice(0, 280);
}

function isObviouslyJunkJob(input: {
  title: string;
  description: string;
  applyUrl: string;
}) {
  const nonJobClassification = classifyNonJobPosting(input);
  if (nonJobClassification.detected) {
    return true;
  }

  if (JUNK_TITLE_PATTERNS.some((pattern) => pattern.test(input.title))) {
    return true;
  }

  const combined = `${input.title}\n${input.description}\n${input.applyUrl}`;
  const hasJobLikeSignals =
    /\b(responsibilities|requirements|qualifications|what you(?:'|’)ll do|what we(?:'|’)re looking for|benefits|compensation|about the role|about the job|job description)\b/i.test(
      combined
    ) || input.description.length >= 240;

  return (
    JUNK_CONTENT_PATTERNS.some((pattern) => pattern.test(combined)) &&
    !hasJobLikeSignals
  );
}

function isObviouslyDeadAtIntake(input: {
  title: string;
  description: string;
  deadline: Date | null;
  fetchedAt: Date;
}) {
  return detectDeadSignal(input).detected;
}

function isApplyableHttpUrl(url: string) {
  try {
    const protocol = new URL(url).protocol.toLowerCase();
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function detectDeadSignal(input: {
  title: string;
  description: string;
  deadline: Date | null;
  fetchedAt: Date;
}): DeadSignalResult {
  if (input.deadline && input.deadline.getTime() <= input.fetchedAt.getTime()) {
    return {
      detected: true,
      reason: "Posting deadline has passed.",
    };
  }

  const combined = `${input.title}\n${input.description}`;
  let matchedText: string | null = null;
  for (const pattern of DEAD_CONTENT_PATTERNS) {
    const match = combined.match(pattern);
    if (!match) continue;

    const candidate = match[0]?.trim() ?? null;
    if (candidate && isDeadSignalFalsePositive({ combined, match, matchedText: candidate })) {
      continue;
    }

    matchedText = candidate;
    break;
  }

  if (!matchedText) {
    return {
      detected: false,
      reason: null,
    };
  }

  return {
    detected: true,
    reason: matchedText
      ? `Explicit dead signal detected: ${matchedText}`
      : "Explicit dead signal detected in source content.",
  };
}

function isDeadSignalFalsePositive({
  combined,
  match,
  matchedText,
}: {
  combined: string;
  match: RegExpMatchArray;
  matchedText: string;
}) {
  const index = match.index ?? -1;
  if (index < 0) return false;

  const normalizedMatch = matchedText.toLowerCase();
  if (
    normalizedMatch !== "position is filled" &&
    normalizedMatch !== "position filled" &&
    normalizedMatch !== "role is filled" &&
    normalizedMatch !== "role filled"
  ) {
    return false;
  }

  const precedingContext = combined.slice(Math.max(0, index - 80), index).toLowerCase();
  return /\buntil\s+(?:the\s+)?$/.test(precedingContext);
}

function sanitizeSummaryLine(line: string) {
  const withoutLeadingBullets = line.replace(/^[\s>*•\-–—]+/, "").trim();
  const withoutUrls = withoutLeadingBullets
    .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/www\.\S+/gi, " ");

  return compactWhitespace(withoutUrls);
}

/**
 * Sanitize raw description text, preserving paragraph structure.
 *
 * For HTML sources (Greenhouse, Lever): converts block-level tags to newlines
 * before stripping all remaining HTML, so <p>, <li>, <h2> etc. become breaks.
 *
 * For plain-text sources (Ashby descriptionPlainText): the existing newlines
 * are already meaningful — we just compact within-line spaces.
 *
 * Output: newlines preserved, spaces within lines compacted, max 2 consecutive
 * blank lines, no leading/trailing whitespace.
 */
function sanitizeText(
  value: unknown,
  context?: { title?: string | null; location?: string | null }
) {
  return sanitizeJobDescriptionText(value, context);
}

function compactWhitespace(value: unknown) {
  return asText(value).replace(/\s+/g, " ").trim();
}

function asText(value: unknown) {
  // Strip null bytes (\u0000) and other PostgreSQL-unsafe C0 control characters
  // before any further processing. These appear in scraped HTML from some company
  // career pages (e.g. Deloitte, KPMG, EY) and cause a DriverAdapterError when
  // Prisma tries to store the value in a PostgreSQL text or jsonb column.
  const strip = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  if (typeof value === "string") return strip(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}
