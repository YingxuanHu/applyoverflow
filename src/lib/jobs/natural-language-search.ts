import { normalizeSalaryCurrency } from "@/lib/currency-conversion";
import type {
  NormalizedEmploymentTypeGroup,
  NormalizedIndustry,
  NormalizedRoleCategory,
} from "@/lib/job-metadata";

type WorkModeFilter = "REMOTE" | "HYBRID" | "ONSITE" | "FLEXIBLE";
type ExperienceGroupFilter =
  | "STUDENT_INTERN"
  | "ENTRY_JUNIOR"
  | "MID_EXPERIENCED"
  | "SENIOR_LEAD_STAFF"
  | "MANAGER_DIRECTOR_EXECUTIVE";

export type NaturalLanguageIntentEntry = {
  displayValue?: string;
  kind: "hard" | "soft" | "exclusion" | "keyword";
  label: string;
  param?: string;
  value: string;
};

export type NaturalLanguageJobSearchResult = {
  confidence: "high" | "medium" | "low";
  exclusions: NaturalLanguageIntentEntry[];
  hardFilters: NaturalLanguageIntentEntry[];
  href: string;
  originalText: string;
  params: Record<string, string | undefined>;
  softPreferences: NaturalLanguageIntentEntry[];
  warnings: string[];
};

type Rule<T extends string> = {
  label: string;
  patterns: RegExp[];
  titleSearch?: string;
  value: T;
};

const MAX_QUERY_LENGTH = 600;
const EXPERIENCE_GROUP_LABELS: Record<ExperienceGroupFilter, string> = {
  ENTRY_JUNIOR: "Entry / Junior",
  MANAGER_DIRECTOR_EXECUTIVE: "Manager / Director / Executive",
  MID_EXPERIENCED: "Mid-level / Experienced",
  SENIOR_LEAD_STAFF: "Senior / Lead / Staff",
  STUDENT_INTERN: "Internship / Co-op / Student",
};
const EMPLOYMENT_GROUP_LABELS: Record<NormalizedEmploymentTypeGroup, string> = {
  CONTRACT: "Contract",
  FREELANCE: "Freelance",
  FULL_TIME: "Full-time",
  INTERNSHIP_COOP: "Internship / Co-op",
  OTHER: "Other",
  PART_TIME: "Part-time",
  TEMPORARY_SEASONAL: "Temporary / Seasonal",
  UNKNOWN: "Unknown",
  VOLUNTEER: "Volunteer",
};
const WORK_MODE_LABELS: Record<WorkModeFilter, string> = {
  FLEXIBLE: "Flexible",
  HYBRID: "Hybrid",
  ONSITE: "On-site",
  REMOTE: "Remote",
};
const POSTED_LABELS: Record<string, string> = {
  "1d": "Past 24 hours",
  "3d": "Past 3 days",
  "7d": "Past week",
  "14d": "Past 2 weeks",
  "30d": "Past month",
};
const SORT_LABELS: Record<string, string> = {
  company: "Company A-Z",
  deadline: "Expiring soon",
  newest: "Newest",
};

const ROLE_RULES: Array<Rule<NormalizedRoleCategory>> = [
  rule("Data & Analytics", "DATA_ANALYTICS", [
    /\bdata\s+analysts?\b/i,
    /\banalytics?\s+(?:analysts?|roles?|jobs?)\b/i,
    /\bbi\s+analysts?\b/i,
    /\bbusiness\s+intelligence\b/i,
  ], "data analyst"),
  rule("Software Engineering", "SOFTWARE_ENGINEERING", [
    /\bsoftware\s+(?:engineer|developer|engineering|development)\b/i,
    /\bbackend\s+(?:engineer|developer|roles?|jobs?)\b/i,
    /\bfront[-\s]?end\s+(?:engineer|developer|roles?|jobs?)\b/i,
    /\bfull[-\s]?stack\s+(?:engineer|developer|roles?|jobs?)\b/i,
    /\bweb\s+developer\b/i,
  ]),
  rule("AI / Machine Learning", "AI_MACHINE_LEARNING", [
    /\bai\s*\/?\s*(?:and\s+)?machine\s+learning\b/i,
    /\b(?:machine\s+learning|ml)\s+(?:engineer|developer|scientist|roles?|jobs?)\b/i,
    /\bai\s+(?:engineer|developer|scientist|roles?|jobs?)\b/i,
    /\bllm\s+(?:engineer|developer|roles?|jobs?)\b/i,
  ]),
  rule("Product Management", "PRODUCT_MANAGEMENT", [
    /\bproduct\s+(?:manager|management|owner)\b/i,
    /\bpm\s+roles?\b/i,
  ], "product manager"),
  rule("Design / UX", "DESIGN_UX", [
    /\b(?:product|ux|ui)\s+designers?\b/i,
    /\bux\s+research(?:er| roles?| jobs?)\b/i,
    /\bdesign\s+(?:roles?|jobs?)\b/i,
  ]),
  rule("IT / Systems / DevOps", "IT_SYSTEMS_DEVOPS", [
    /\bdevops\b/i,
    /\bplatform\s+(?:engineer|engineering)\b/i,
    /\bsystems?\s+(?:administrator|engineer|analyst)\b/i,
    /\bcloud\s+(?:engineer|administrator|architect)\b/i,
    /\bnetwork\s+(?:engineer|administrator|analyst)\b/i,
  ]),
  rule("Cybersecurity", "CYBERSECURITY", [
    /\bcyber\s*security\b/i,
    /\bsecurity\s+(?:analyst|engineer|operations|roles?|jobs?)\b/i,
    /\bvulnerability\s+(?:analyst|management)\b/i,
  ]),
  rule("Finance / Accounting", "FINANCE_ACCOUNTING", [
    /\b(?:finance|financial|fp&a)\s+analysts?\b/i,
    /\baccount(?:ant|ing)\b/i,
    /\btax\s+analysts?\b/i,
    /\bpayroll\b/i,
    /\btreasury\s+analysts?\b/i,
  ], "finance analyst"),
  rule("Investment Banking / Asset Management", "INVESTMENT_BANKING", [
    /\binvestment\s+bank(?:ing|er)\b/i,
    /\basset\s+management\b/i,
    /\bwealth\s+management\b/i,
    /\bprivate\s+equity\b/i,
  ]),
  rule("Consulting", "CONSULTING", [/\bconsult(?:ant|ing)\b/i]),
  rule("Sales / Business Development", "SALES", [
    /\bsales\b/i,
    /\bbusiness\s+development\b/i,
    /\baccount\s+executive\b/i,
  ]),
  rule("Marketing / Growth", "MARKETING", [
    /\bmarketing\b/i,
    /\bgrowth\s+(?:roles?|jobs?|marketer|manager)\b/i,
  ]),
  rule("Operations / Supply Chain", "OPERATIONS", [
    /\boperations?\b/i,
    /\bsupply\s+chain\b/i,
    /\blogistics\b/i,
  ]),
  rule("Customer Success / Support", "CUSTOMER_SUCCESS_SUPPORT", [
    /\bcustomer\s+(?:success|support)\b/i,
    /\btechnical\s+support\b/i,
  ]),
  rule("Human Resources / Recruiting", "HUMAN_RESOURCES_RECRUITING", [
    /\bhuman\s+resources\b/i,
    /\brecruit(?:er|ing)\b/i,
    /\btalent\s+acquisition\b/i,
  ]),
  rule("Legal / Compliance", "LEGAL_COMPLIANCE", [
    /\blegal\b/i,
    /\bcompliance\b/i,
    /\bparalegal\b/i,
  ]),
  rule("Research / Science", "RESEARCH_SCIENCE", [
    /\bresearch\s+(?:scientist|analyst|associate)\b/i,
    /\bscientist\b/i,
  ]),
  rule("Engineering / Manufacturing", "ENGINEERING_HARDWARE", [
    /\bmechanical\s+engineer\b/i,
    /\belectrical\s+engineer\b/i,
    /\bhardware\s+engineer\b/i,
    /\baerospace\s+engineer\b/i,
    /\bmanufacturing\s+engineer\b/i,
  ]),
];

const INDUSTRY_RULES: Array<Rule<NormalizedIndustry>> = [
  rule("Technology", "TECHNOLOGY", [/\btechnology\b/i, /\btech\s+(?:company|companies|industry|sector)\b/i]),
  rule("Financial Services", "FINANCIAL_SERVICES", [
    /\bfinancial\s+services\b/i,
    /\b(?:in|within|at)\s+finance\b/i,
    /\bbank(?:ing|s)?\b/i,
    /\bfintech\b/i,
    /\binsurance\b/i,
  ]),
  rule("Healthcare & Life Sciences", "HEALTHCARE_LIFE_SCIENCES", [
    /\bhealth\s*care\b/i,
    /\blife\s+sciences?\b/i,
    /\bbiotech\b/i,
    /\bpharma(?:ceutical)?\b/i,
  ]),
  rule("Consulting & Professional Services", "CONSULTING_PROFESSIONAL_SERVICES", [
    /\bprofessional\s+services\b/i,
    /\bconsulting\s+(?:company|companies|industry|sector)\b/i,
  ]),
  rule("Education", "EDUCATION", [/\beducation\b/i, /\buniversit(?:y|ies)\b/i]),
  rule("Retail & Consumer Goods", "RETAIL_CONSUMER_GOODS", [
    /\bretail\b/i,
    /\bconsumer\s+goods\b/i,
    /\be[-\s]?commerce\b/i,
  ]),
  rule("Manufacturing & Automotive", "MANUFACTURING_AUTOMOTIVE", [
    /\bmanufacturing\b/i,
    /\bautomotive\b/i,
  ]),
  rule("Government & Public Sector", "GOVERNMENT_PUBLIC_SECTOR", [
    /\bgovernment\b/i,
    /\bpublic\s+sector\b/i,
  ]),
  rule("Media & Entertainment", "MEDIA_ENTERTAINMENT", [/\bmedia\b/i, /\bentertainment\b/i]),
  rule("Legal Services", "LEGAL_SERVICES", [/\blegal\s+services\b/i, /\blaw\s+firms?\b/i]),
];

const WORK_MODE_RULES: Array<Rule<WorkModeFilter>> = [
  rule("Remote", "REMOTE", [/\bremote\b/i, /\bwork\s+from\s+home\b/i, /\bwfh\b/i]),
  rule("Hybrid", "HYBRID", [/\bhybrid\b/i]),
  rule("On-site", "ONSITE", [/\bon[-\s]?site\b/i, /\bin\s+office\b/i]),
  rule("Flexible", "FLEXIBLE", [
    /\bflexible\s+(?:work|schedule|arrangements?|work\s+mode|jobs?|roles?)\b/i,
    /\bwork\s+mode\s+flexible\b/i,
  ]),
];

const LOCATION_RULES: Array<Rule<string>> = [
  rule("Toronto", "Toronto", [/\btoronto\b/i, /\bgta\b/i]),
  rule("Vancouver", "Vancouver", [/\bvancouver\b/i]),
  rule("Calgary", "Calgary", [/\bcalgary\b/i]),
  rule("Ottawa", "Ottawa", [/\bottawa\b/i]),
  rule("Montreal", "Montreal", [/\bmontr[eé]al\b/i]),
  rule("Waterloo", "Waterloo", [/\bwaterloo\b/i]),
  rule("New York", "New York", [/\bnew\s+york\b/i, /\bnyc\b/i]),
  rule("San Francisco", "San Francisco", [/\bsan\s+francisco\b/i, /\bsf\s+bay\b/i]),
  rule("Chicago", "Chicago", [/\bchicago\b/i]),
  rule("Seattle", "Seattle", [/\bseattle\b/i]),
  rule("Boston", "Boston", [/\bboston\b/i]),
  rule("Canada", "Canada", [/\bcanada\b/i, /\bcanadian\b/i]),
  rule("United States", "United States", [/\bunited\s+states\b/i, /\busa\b/i, /\bu\.s\.\b/i]),
  rule("Ontario", "Ontario", [/\bontario\b/i]),
  rule("British Columbia", "British Columbia", [/\bbritish\s+columbia\b/i, /\bbc\b/i]),
];

export function parseNaturalLanguageJobSearch(input: string): NaturalLanguageJobSearchResult {
  const originalText = input.slice(0, MAX_QUERY_LENGTH);
  const text = normalizeQueryText(originalText);
  const warnings: string[] = [];
  const hardFilters: NaturalLanguageIntentEntry[] = [];
  const softPreferences: NaturalLanguageIntentEntry[] = [];
  const exclusions: NaturalLanguageIntentEntry[] = [];
  const params: Record<string, string | undefined> = {};

  if (!text) {
    return {
      confidence: "low",
      exclusions,
      hardFilters,
      href: "/jobs",
      originalText,
      params,
      softPreferences,
      warnings: ["Describe a role, location, level, or work mode to generate filters."],
    };
  }

  const allRoleMatches = collectMatches(ROLE_RULES, originalText);
  const roleMatches = allRoleMatches.filter((match) => !isNegatedContext(originalText, match.index));
  const excludedRoleMatches = allRoleMatches.filter((match) => isNegatedContext(originalText, match.index));
  const hardRoles = uniqueValues(roleMatches.map((match) => match.rule.value)).slice(0, 3);
  if (hardRoles.length > 0) {
    params.jobFunction = hardRoles.join(",");
    addEntries(hardFilters, "hard", "Job Function", "jobFunction", roleMatches, hardRoles);
  }
  const excludedRoles = uniqueValues(excludedRoleMatches.map((match) => match.rule.value)).slice(0, 3);
  if (excludedRoles.length > 0) {
    addEntries(exclusions, "exclusion", "Excluded job function", undefined, excludedRoleMatches, excludedRoles);
  }

  const titleSearch = chooseTitleSearch(roleMatches, text);
  if (titleSearch) {
    params.searchScope = "title";
    params.titleSearch = titleSearch;
    hardFilters.push({
      kind: "keyword",
      label: "Title search",
      param: "titleSearch",
      value: titleSearch,
    });
  }

  const industryMatches = collectMatches(INDUSTRY_RULES, originalText);
  const hardIndustries = uniqueValues(
    industryMatches
      .filter((match) => !isSoftPreferenceContext(originalText, match.index))
      .map((match) => match.rule.value)
  ).slice(0, 3);
  const softIndustries = uniqueValues(
    industryMatches
      .filter((match) => isSoftPreferenceContext(originalText, match.index))
      .map((match) => match.rule.value)
  ).slice(0, 3);
  if (hardIndustries.length > 0) {
    params.industry = hardIndustries.join(",");
    addEntries(hardFilters, "hard", "Company Industry", "industry", industryMatches, hardIndustries);
  }
  if (softIndustries.length > 0) {
    addEntries(softPreferences, "soft", "Company Industry preference", undefined, industryMatches, softIndustries);
    warnings.push("Soft industry preferences are shown for review but are not applied as strict filters.");
  }

  const careerStages = inferCareerStages(text);
  if (careerStages.values.length > 0) {
    params.careerStage = careerStages.values.join(",");
    for (const value of careerStages.values) {
      hardFilters.push({
        displayValue: EXPERIENCE_GROUP_LABELS[value],
        kind: "hard",
        label: "Experience level",
        param: "careerStage",
        value,
      });
    }
  }
  for (const exclusion of careerStages.exclusions) {
    exclusions.push({
      displayValue: EXPERIENCE_GROUP_LABELS[exclusion],
      kind: "exclusion",
      label: "Excluded level",
      value: exclusion,
    });
  }
  if (careerStages.exclusions.length > 0 && careerStages.values.length === 0) {
    warnings.push("Seniority exclusions are strongest when paired with a target level like entry-level, intern, or mid-level.");
  }

  const employmentTypes = inferEmploymentTypes(text);
  if (employmentTypes.length > 0) {
    params.employmentType = employmentTypes.join(",");
    for (const value of employmentTypes) {
      hardFilters.push({
        displayValue: EMPLOYMENT_GROUP_LABELS[value],
        kind: "hard",
        label: "Employment type",
        param: "employmentType",
        value,
      });
    }
  }

  const workModes = uniqueValues(collectMatches(WORK_MODE_RULES, originalText).map((match) => match.rule.value));
  if (workModes.length > 0) {
    params.workMode = workModes.join(",");
    for (const value of workModes) {
      hardFilters.push({
        displayValue: WORK_MODE_LABELS[value],
        kind: "hard",
        label: "Work mode",
        param: "workMode",
        value,
      });
    }
  }

  const locations = uniqueValues(collectMatches(LOCATION_RULES, originalText).map((match) => match.rule.value));
  if (locations.length > 0) {
    params.locationSearch = locations.join(",");
    for (const value of locations) {
      hardFilters.push({
        displayValue: value,
        kind: "hard",
        label: "Location",
        param: "locationSearch",
        value,
      });
    }
  }

  const salary = inferSalaryParams(originalText);
  Object.assign(params, salary.params);
  for (const entry of salary.entries) hardFilters.push(entry);

  const posted = inferPostedParam(text);
  if (posted) {
    params.posted = posted;
    hardFilters.push({
      kind: "hard",
      label: "Posted",
      param: "posted",
      value: posted,
      displayValue: POSTED_LABELS[posted] ?? posted,
    });
  }

  const sortBy = inferSortParam(text);
  if (sortBy) {
    params.sortBy = sortBy;
    hardFilters.push({
      kind: "hard",
      label: "Sort",
      param: "sortBy",
      value: sortBy,
      displayValue: SORT_LABELS[sortBy] ?? sortBy,
    });
  }

  const meaningfulHardFilters = hardFilters.filter((entry) => entry.kind !== "keyword").length;
  if (meaningfulHardFilters === 0 && !params.titleSearch) {
    params.searchScope = "title";
    params.titleSearch = originalText.trim().slice(0, 80);
    hardFilters.push({
      kind: "keyword",
      label: "Title search",
      param: "titleSearch",
      value: params.titleSearch,
      displayValue: params.titleSearch,
    });
    warnings.push("No reliable structured filters were detected, so this will run as a title keyword search.");
  }

  const confidence =
    meaningfulHardFilters >= 3 || (meaningfulHardFilters >= 2 && Boolean(params.titleSearch))
      ? "high"
      : meaningfulHardFilters >= 1 || Boolean(params.titleSearch)
        ? "medium"
        : "low";

  return {
    confidence,
    exclusions,
    hardFilters: dedupeEntries(hardFilters),
    href: buildNaturalLanguageJobsHref({ params }),
    originalText,
    params: cleanParams(params),
    softPreferences: dedupeEntries(softPreferences),
    warnings: uniqueValues(warnings),
  };
}

export function buildNaturalLanguageJobsHref(input: Pick<NaturalLanguageJobSearchResult, "params">) {
  const params = new URLSearchParams();
  const cleaned = cleanParams(input.params);
  for (const key of NATURAL_LANGUAGE_PARAM_ORDER) {
    const value = cleaned[key];
    if (value) params.set(key, value);
  }

  const query = params.toString();
  return query ? `/jobs?${query}` : "/jobs";
}

const NATURAL_LANGUAGE_PARAM_ORDER = [
  "searchScope",
  "titleSearch",
  "jobFunction",
  "careerStage",
  "locationSearch",
  "companySearch",
  "workMode",
  "employmentType",
  "industry",
  "salaryMin",
  "salaryMax",
  "salaryCurrency",
  "posted",
  "sortBy",
];

function rule<T extends string>(
  label: string,
  value: T,
  patterns: RegExp[],
  titleSearch?: string
): Rule<T> {
  return { label, patterns, titleSearch, value };
}

function collectMatches<T extends string>(rules: Array<Rule<T>>, input: string) {
  const matches: Array<{ index: number; matchedText: string; rule: Rule<T> }> = [];
  for (const ruleItem of rules) {
    for (const pattern of ruleItem.patterns) {
      const match = pattern.exec(input);
      if (!match) continue;
      matches.push({
        index: match.index,
        matchedText: match[0],
        rule: ruleItem,
      });
      break;
    }
  }
  return matches;
}

function chooseTitleSearch(
  roleMatches: Array<{ matchedText: string; rule: Rule<NormalizedRoleCategory> }>,
  normalizedText: string
) {
  const explicit = roleMatches.find((match) => match.rule.titleSearch)?.rule.titleSearch;
  if (explicit) return explicit;
  if (/\bbackend\b/.test(normalizedText)) return "backend";
  if (/\bfront[-\s]?end\b/.test(normalizedText)) return "frontend";
  if (/\bfull[-\s]?stack\b/.test(normalizedText)) return "full stack";
  return undefined;
}

function inferCareerStages(text: string) {
  const values: ExperienceGroupFilter[] = [];
  const exclusions: ExperienceGroupFilter[] = [];

  if (/\b(?:internships?|intern|co[-\s]?op|student|summer\s+(?:analyst|associate|intern))\b/.test(text)) {
    values.push("STUDENT_INTERN");
  }
  if (/\b(?:entry[-\s]?level|new\s+grad|graduate|junior|early\s+career|0\s*[-–]\s*2\s+years?)\b/.test(text)) {
    values.push("ENTRY_JUNIOR");
  }
  if (/\b(?:mid[-\s]?level|intermediate|experienced|3\s*[-–]\s*5\s+years?|3\+?\s+years?)\b/.test(text)) {
    values.push("MID_EXPERIENCED");
  }
  if (/\b(?:senior|sr\.?|staff|principal|lead)\b/.test(text) && !hasNegativeSeniority(text)) {
    values.push("SENIOR_LEAD_STAFF");
  }
  if (/\b(?:manager|director|executive|vp|head\s+of)\b/.test(text) && !hasNegativeManager(text)) {
    values.push("MANAGER_DIRECTOR_EXECUTIVE");
  }

  if (hasNegativeSeniority(text)) exclusions.push("SENIOR_LEAD_STAFF");
  if (hasNegativeManager(text)) exclusions.push("MANAGER_DIRECTOR_EXECUTIVE");

  return {
    exclusions: uniqueValues(exclusions),
    values: uniqueValues(values),
  };
}

function inferEmploymentTypes(text: string): NormalizedEmploymentTypeGroup[] {
  const values: NormalizedEmploymentTypeGroup[] = [];
  if (/\bfull[-\s]?time\b/.test(text)) values.push("FULL_TIME");
  if (/\bpart[-\s]?time\b/.test(text)) values.push("PART_TIME");
  if (/\b(?:contract|contractor)\b/.test(text)) values.push("CONTRACT");
  if (/\b(?:internships?|intern|co[-\s]?op|student)\b/.test(text)) values.push("INTERNSHIP_COOP");
  if (/\b(?:temporary|temp|seasonal)\b/.test(text)) values.push("TEMPORARY_SEASONAL");
  if (/\bfreelance\b/.test(text)) values.push("FREELANCE");
  if (/\bvolunteer\b/.test(text)) values.push("VOLUNTEER");
  return uniqueValues(values);
}

function inferSalaryParams(input: string): {
  entries: NaturalLanguageIntentEntry[];
  params: Record<string, string | undefined>;
} {
  const params: Record<string, string | undefined> = {};
  const entries: NaturalLanguageIntentEntry[] = [];
  const currency = normalizeSalaryCurrency(
    /\b(?:cad|canadian\s+dollars?|ca\$)\b/i.test(input)
      ? "CAD"
      : /\b(?:usd|us\s+dollars?|us\$)\b/i.test(input)
        ? "USD"
        : undefined
  );

  const range = /(?:pay(?:ing)?|salary|comp(?:ensation)?|between|from)?\s*(?:cad|usd|ca\$|us\$|\$)?\s*(\d[\d,]*(?:\.\d+)?\s*k?)\s*(?:-|to|and)\s*(?:cad|usd|ca\$|us\$|\$)?\s*(\d[\d,]*(?:\.\d+)?\s*k?)\b/i.exec(input);
  if (range) {
    const first = parseSalaryAmount(range[1]);
    const second = parseSalaryAmount(range[2]);
    if (first && second) {
      params.salaryMin = String(Math.min(first, second));
      params.salaryMax = String(Math.max(first, second));
    }
  }

  if (!params.salaryMin) {
    const min = /(?:at\s+least|above|over|minimum|min(?:imum)?|from)\s*(?:cad|usd|ca\$|us\$|\$)?\s*(\d[\d,]*(?:\.\d+)?\s*k?)\b/i.exec(input);
    const value = min ? parseSalaryAmount(min[1]) : null;
    if (value) params.salaryMin = String(value);
  }

  if (!params.salaryMax) {
    const max = /(?:under|below|up\s+to|no\s+more\s+than|max(?:imum)?)\s*(?:cad|usd|ca\$|us\$|\$)?\s*(\d[\d,]*(?:\.\d+)?\s*k?)\b/i.exec(input);
    const value = max ? parseSalaryAmount(max[1]) : null;
    if (value) params.salaryMax = String(value);
  }

  if ((params.salaryMin || params.salaryMax) && currency) params.salaryCurrency = currency;

  if (params.salaryMin) {
    entries.push({
      displayValue: formatSalaryDisplay(params.salaryMin, params.salaryCurrency),
      kind: "hard",
      label: "Minimum salary",
      param: "salaryMin",
      value: params.salaryMin,
    });
  }
  if (params.salaryMax) {
    entries.push({
      displayValue: formatSalaryDisplay(params.salaryMax, params.salaryCurrency),
      kind: "hard",
      label: "Maximum salary",
      param: "salaryMax",
      value: params.salaryMax,
    });
  }
  if (params.salaryCurrency) {
    entries.push({
      displayValue: params.salaryCurrency,
      kind: "hard",
      label: "Salary currency",
      param: "salaryCurrency",
      value: params.salaryCurrency,
    });
  }

  return { entries, params };
}

function inferPostedParam(text: string) {
  if (/\b(?:today|past\s+24\s+hours?)\b/.test(text)) return "1d";
  if (/\b(?:past\s+3\s+days?|last\s+3\s+days?)\b/.test(text)) return "3d";
  if (/\b(?:this\s+week|past\s+week|last\s+week|recent(?:ly)?\s+posted)\b/.test(text)) return "7d";
  if (/\b(?:past\s+2\s+weeks?|last\s+2\s+weeks?)\b/.test(text)) return "14d";
  if (/\b(?:past\s+month|last\s+month|30\s+days?)\b/.test(text)) return "30d";
  return undefined;
}

function inferSortParam(text: string) {
  if (/\b(?:newest|latest|most\s+recent)\b/.test(text)) return "newest";
  if (/\b(?:deadline|expir(?:y|ing)\s+soon|closing\s+soon)\b/.test(text)) return "deadline";
  if (/\bcompany\s+(?:name|a[-\s]?z)\b/.test(text)) return "company";
  return undefined;
}

function hasNegativeSeniority(text: string) {
  return /\b(?:no|not|avoid|exclude|without|don't\s+want|do\s+not\s+want)\s+(?:senior|sr\.?|staff|principal|lead)\b/.test(text);
}

function hasNegativeManager(text: string) {
  return /\b(?:no|not|avoid|exclude|without|don't\s+want|do\s+not\s+want)\s+(?:manager|director|executive|vp|head\s+of)\b/.test(text);
}

function isSoftPreferenceContext(input: string, index: number) {
  const before = input.slice(Math.max(0, index - 52), index).toLowerCase();
  return /\b(?:prefer(?:ably)?|ideally|nice\s+to\s+have|would\s+like|if\s+possible|bonus)\b/.test(before);
}

function isNegatedContext(input: string, index: number) {
  const before = normalizeQueryText(input.slice(Math.max(0, index - 42), index)).replace(/[^\w\s']/g, " ");
  return /(?:^|\s)(?:no|not|avoid|exclude|excluding|without|don't\s+want|do\s+not\s+want|dont\s+want|not\s+looking\s+for)(?:\s+\w+){0,4}$/.test(before);
}

function normalizeQueryText(value: string) {
  return value
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSalaryAmount(raw: string | undefined) {
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
  const hasK = normalized.endsWith("k");
  const numeric = Number.parseFloat(hasK ? normalized.slice(0, -1) : normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const value = hasK || (numeric >= 30 && numeric < 1000) ? numeric * 1000 : numeric;
  if (value < 10_000 || value > 1_000_000) return null;
  return Math.round(value);
}

function formatSalaryDisplay(value: string | undefined, currency: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value ?? "";
  return `${currency ? `${currency} ` : ""}${parsed.toLocaleString()}`;
}

function addEntries<T extends string>(
  output: NaturalLanguageIntentEntry[],
  kind: NaturalLanguageIntentEntry["kind"],
  label: string,
  param: string | undefined,
  matches: Array<{ rule: Rule<T> }>,
  values: T[]
) {
  for (const value of values) {
    const match = matches.find((entry) => entry.rule.value === value);
    output.push({
      displayValue: match?.rule.label ?? value,
      kind,
      label,
      param,
      value,
    });
  }
}

function cleanParams(params: Record<string, string | undefined>) {
  const output: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    const trimmed = value?.trim();
    if (trimmed) output[key] = trimmed;
  }
  return output;
}

function dedupeEntries(entries: NaturalLanguageIntentEntry[]) {
  const seen = new Set<string>();
  const output: NaturalLanguageIntentEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.label}:${entry.param ?? ""}:${entry.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

function uniqueValues<T extends string>(values: T[]) {
  const seen = new Set<T>();
  const output: T[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}
