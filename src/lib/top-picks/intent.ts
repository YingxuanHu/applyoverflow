import { createHash } from "node:crypto";

import type { ExperienceLevel, WorkMode } from "@/generated/prisma/client";
import type {
  ProfileEducation,
  ProfileExperience,
  ProfileProject,
  ProfileSkill,
} from "@/lib/profile";

export type TopPickSignalJob = {
  id?: string | null;
  title?: string | null;
  company?: string | null;
  normalizedRoleCategory?: string | null;
  workMode?: string | null;
  location?: string | null;
};

export type TopPickFeedbackSignal = {
  jobId: string;
  feedbackType: string;
  job: TopPickSignalJob;
};

export type UserJobIntent = {
  userId: string;
  profileVersion: number;
  explicitTargetTitles: string[];
  inferredTargetTitles: string[];
  explicitTargetRoleCategories: string[];
  inferredTargetRoleCategories: string[];
  excludedRoleCategories: string[];
  targetCareerStages: string[];
  minAcceptableCareerStage?: string;
  maxAcceptableCareerStage?: string;
  inferredYearsExperience?: number;
  maxRequiredYears?: number;
  mustHaveSkills: string[];
  strongSkills: string[];
  niceToHaveSkills: string[];
  weakSkills: string[];
  preferredLocationCity?: string;
  preferredLocationRegion?: string;
  preferredLocationCountry?: string;
  openToRemote?: boolean;
  preferredWorkModes: string[];
  targetSalaryMin?: number;
  targetSalaryMax?: number;
  targetSalaryCurrency?: string;
  positiveSignals: {
    savedJobIds: string[];
    appliedJobIds: string[];
    likedRoleCategories: string[];
    likedTitles: string[];
    likedCompanies: string[];
    likedSkills: string[];
  };
  negativeSignals: {
    rejectedJobIds: string[];
    dislikedRoleCategories: string[];
    dislikedTitles: string[];
    dislikedSeniorityLevels: string[];
    dislikedLocations: string[];
    dislikedWorkModes: string[];
  };
  confidence: {
    roleIntent: number;
    seniorityIntent: number;
    skillIntent: number;
    locationIntent: number;
  };
  experienceSummary: string;
  profileHash: string;
};

export type TopPicksProfileReadiness = {
  canGenerate: boolean;
  missingSignals: string[];
  message: string;
};

export type BuildUserJobIntentInput = {
  userId: string;
  profileVersion: number;
  headline?: string | null;
  summary?: string | null;
  location?: string | null;
  skillsText?: string | null;
  experienceText?: string | null;
  educationText?: string | null;
  projectsText?: string | null;
  skills: ProfileSkill[];
  experiences: ProfileExperience[];
  educations: ProfileEducation[];
  projects: ProfileProject[];
  preferredWorkMode?: WorkMode | null;
  experienceLevel?: ExperienceLevel | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  savedJobs?: TopPickSignalJob[];
  appliedJobs?: TopPickSignalJob[];
  feedback?: TopPickFeedbackSignal[];
};

type WeightedTextSignal = {
  text: string;
  weight: number;
  source: "title" | "headline" | "summary" | "experience" | "project" | "education" | "skill" | "behavior";
};

type RoleRule = {
  category: string;
  titlePatterns: RegExp[];
  textPatterns: RegExp[];
  skillPatterns: RegExp[];
};

const ROLE_RULES: RoleRule[] = [
  {
    category: "SOFTWARE_ENGINEERING",
    titlePatterns: [
      /\bsoftware\b.*\b(engineer|developer)\b/i,
      /\b(backend|front[-\s]?end|frontend|full[-\s]?stack|web|mobile)\b.*\b(engineer|developer)\b/i,
      /\bdeveloper\b/i,
    ],
    textPatterns: [/\b(api|distributed systems|web application|microservices)\b/i],
    skillPatterns: [/\b(typescript|javascript|react|node|java|python|go|golang|c\+\+|ruby|rails|next\.?js)\b/i],
  },
  {
    category: "AI_MACHINE_LEARNING",
    titlePatterns: [/\b(machine learning|ml|ai|artificial intelligence|nlp|computer vision)\b/i],
    textPatterns: [/\b(model training|llm|deep learning|pytorch|tensorflow|generative ai)\b/i],
    skillPatterns: [/\b(pytorch|tensorflow|scikit|keras|llm|nlp|computer vision)\b/i],
  },
  {
    category: "DATA_ANALYTICS",
    titlePatterns: [/\b(data|analytics|bi|business intelligence)\b.*\b(analyst|engineer|scientist|developer)\b/i],
    textPatterns: [/\b(dashboard|etl|data pipeline|warehouse|analytics|business intelligence)\b/i],
    skillPatterns: [/\b(sql|tableau|power bi|looker|snowflake|dbt|spark|airflow)\b/i],
  },
  {
    category: "PRODUCT_MANAGEMENT",
    titlePatterns: [/\bproduct (manager|owner|lead)\b/i],
    textPatterns: [/\b(roadmap|product strategy|user stories|go-to-market)\b/i],
    skillPatterns: [/\b(product management|roadmap|jira|user research)\b/i],
  },
  {
    category: "DESIGN_UX",
    titlePatterns: [/\b(product designer|ux|ui|user experience|visual designer|interaction designer)\b/i],
    textPatterns: [/\b(wireframe|prototype|design systems|user research|usability)\b/i],
    skillPatterns: [/\b(figma|sketch|adobe xd|prototyping|design systems)\b/i],
  },
  {
    category: "IT_SYSTEMS_DEVOPS",
    titlePatterns: [/\b(devops|sre|site reliability|platform|systems|cloud|network)\b.*\b(engineer|administrator|specialist)\b/i],
    textPatterns: [/\b(kubernetes|terraform|linux|ci\/cd|infrastructure|network operations)\b/i],
    skillPatterns: [/\b(kubernetes|docker|terraform|aws|azure|gcp|linux|ansible)\b/i],
  },
  {
    category: "CYBERSECURITY",
    titlePatterns: [/\b(security|cybersecurity|cyber|soc|vulnerability|threat|incident response)\b/i],
    textPatterns: [/\b(vulnerability management|threat detection|siem|incident response|penetration test)\b/i],
    skillPatterns: [/\b(siem|splunk|crowdstrike|iam|okta|security\+|cissp)\b/i],
  },
  {
    category: "FINANCE_ACCOUNTING",
    titlePatterns: [/\b(accountant|accounting|fp&a|financial analyst|controller|auditor|tax|treasury|payroll|accounts payable|accounts receivable)\b/i],
    textPatterns: [/\b(financial statements|month-end close|variance analysis|gaap|ifrs|budgeting)\b/i],
    skillPatterns: [/\b(excel|quickbooks|sap fi|oracle financials|gaap|ifrs)\b/i],
  },
  {
    category: "INVESTMENT_BANKING",
    titlePatterns: [/\b(investment banking|asset management|private equity|capital markets|portfolio|wealth management)\b/i],
    textPatterns: [/\b(m&a|valuation|financial modeling|portfolio management|securities)\b/i],
    skillPatterns: [/\b(financial modeling|valuation|bloomberg|capital markets)\b/i],
  },
  {
    category: "CONSULTING",
    titlePatterns: [/\b(consultant|consulting|advisory|strategy associate|strategy analyst)\b/i],
    textPatterns: [/\b(client engagement|business transformation|strategy consulting|advisory practice)\b/i],
    skillPatterns: [/\b(stakeholder management|strategy|consulting|powerpoint)\b/i],
  },
  {
    category: "SALES",
    titlePatterns: [/\b(sales|account executive|business development|sales development|revenue)\b/i],
    textPatterns: [/\b(pipeline|quota|prospecting|lead generation|crm)\b/i],
    skillPatterns: [/\b(salesforce|hubspot|cold outreach|negotiation)\b/i],
  },
  {
    category: "MARKETING",
    titlePatterns: [
      /\b(marketing|brand|demand generation|seo|content strategist)\b/i,
      /\bgrowth\b.*\b(marketing|manager|lead|specialist|analyst)\b/i,
      /\b(marketing|manager|lead|specialist|analyst)\b.*\bgrowth\b/i,
    ],
    textPatterns: [/\b(campaign|conversion|brand strategy|paid media|content marketing)\b/i],
    skillPatterns: [/\b(google analytics|seo|sem|hubspot|marketo|paid media)\b/i],
  },
  {
    category: "OPERATIONS",
    titlePatterns: [/\b(operations|supply chain|logistics|procurement|sourcing|vendor manager)\b/i],
    textPatterns: [/\b(process improvement|procurement|inventory|vendor management|operations strategy)\b/i],
    skillPatterns: [/\b(procurement|erp|supply chain|inventory|process improvement)\b/i],
  },
  {
    category: "CUSTOMER_SUCCESS_SUPPORT",
    titlePatterns: [/\b(customer success|customer support|technical support|implementation specialist|solutions consultant)\b/i],
    textPatterns: [/\b(onboarding customers|support tickets|customer retention|implementation)\b/i],
    skillPatterns: [/\b(zendesk|intercom|customer success|implementation)\b/i],
  },
  {
    category: "HUMAN_RESOURCES_RECRUITING",
    titlePatterns: [/\b(recruiter|talent acquisition|human resources|\bhr\b|people operations)\b/i],
    textPatterns: [/\b(candidate pipeline|employee relations|people programs|onboarding employees)\b/i],
    skillPatterns: [/\b(workday|greenhouse|lever|ats|recruiting)\b/i],
  },
  {
    category: "LEGAL_COMPLIANCE",
    titlePatterns: [/\b(legal|attorney|lawyer|counsel|paralegal|compliance|privacy|risk)\b/i],
    textPatterns: [/\b(contract review|regulatory|compliance program|legal research|risk controls)\b/i],
    skillPatterns: [/\b(legal research|compliance|contracts|privacy)\b/i],
  },
  {
    category: "HEALTHCARE_CLINICAL",
    titlePatterns: [/\b(nurse|physician|clinical|medical assistant|pharmacist|therapist)\b/i],
    textPatterns: [/\b(patient care|clinical care|medical records|healthcare provider)\b/i],
    skillPatterns: [/\b(epic|clinical|patient care|medical)\b/i],
  },
  {
    category: "RESEARCH_SCIENCE",
    titlePatterns: [/\b(researcher|research scientist|scientist|lab|policy analyst|quantitative researcher)\b/i],
    textPatterns: [/\b(research methods|experiments|laboratory|policy research|scientific)\b/i],
    skillPatterns: [/\b(research|stata|r programming|matlab|laboratory)\b/i],
  },
  {
    category: "EDUCATION_TEACHING",
    titlePatterns: [/\b(teacher|instructor|professor|education|curriculum|academic advisor)\b/i],
    textPatterns: [/\b(curriculum|lesson plans|student learning|academic programs)\b/i],
    skillPatterns: [/\b(teaching|curriculum|classroom|lms)\b/i],
  },
  {
    category: "ENGINEERING_HARDWARE",
    titlePatterns: [/\b(mechanical|electrical|hardware|aerospace|civil|manufacturing|industrial)\b.*\b(engineer|designer)\b/i],
    textPatterns: [/\b(cad|solidworks|mechanical design|pcb|aerospace|manufacturing process)\b/i],
    skillPatterns: [/\b(solidworks|autocad|cad|pcb|matlab|ansys)\b/i],
  },
  {
    category: "ADMINISTRATIVE",
    titlePatterns: [/\b(administrative|coordinator|office manager|executive assistant|receptionist)\b/i],
    textPatterns: [/\b(scheduling|calendar management|office administration|coordination)\b/i],
    skillPatterns: [/\b(microsoft office|scheduling|administration)\b/i],
  },
  {
    category: "MEDIA_CONTENT_COMMUNICATIONS",
    titlePatterns: [/\b(content|communications|editor|writer|journalist|copywriter|social media)\b/i],
    textPatterns: [/\b(editorial|communications plan|content calendar|copywriting)\b/i],
    skillPatterns: [/\b(copywriting|cms|wordpress|social media|editing)\b/i],
  },
];

const SENIORITY_RANK: Record<string, number> = {
  STUDENT_INTERN: 0,
  ENTRY_JUNIOR: 1,
  MID_EXPERIENCED: 2,
  SENIOR_LEAD_STAFF: 3,
  MANAGER_DIRECTOR_EXECUTIVE: 4,
};

export function normalizeIntentText(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(parts: Array<string | null | undefined>, maxLength = 2400) {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, maxLength);
}

function unique(values: string[], limit = 50) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeIntentText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function uniqueCodes(values: string[], limit = 8) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toUpperCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function splitLooseTerms(value: string | null | undefined) {
  return normalizeIntentText(value)
    .split(/[,;\n|/]+|\s{2,}/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 2);
}

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function inferRoleScores(signals: WeightedTextSignal[]) {
  const scores = new Map<string, number>();
  const evidence = new Map<string, string[]>();

  for (const signal of signals) {
    const text = normalizeIntentText(signal.text);
    if (!text) continue;
    for (const rule of ROLE_RULES) {
      let add = 0;
      if (matchesAny(text, rule.titlePatterns)) {
        add += signal.weight * (signal.source === "skill" ? 0.25 : 1);
      } else if (matchesAny(text, rule.textPatterns)) {
        add += signal.weight * 0.55;
      } else if (matchesAny(text, rule.skillPatterns)) {
        add += signal.weight * 0.28;
      }
      if (add <= 0) continue;
      scores.set(rule.category, (scores.get(rule.category) ?? 0) + add);
      const current = evidence.get(rule.category) ?? [];
      if (current.length < 4) current.push(signal.text.slice(0, 90));
      evidence.set(rule.category, current);
    }
  }

  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([, score]) => score >= 2.8);
  const topScore = ranked[0]?.[1] ?? 0;
  const minimumRelativeScore = topScore >= 8 ? topScore * 0.58 : topScore * 0.68;
  return {
    categories: ranked
      .filter(([, score], index) => index < 4 && score >= 4 && score >= minimumRelativeScore)
      .map(([category]) => category),
    confidence: Math.min(0.95, topScore / 14),
    evidence,
  };
}

function cleanTitle(value: string | null | undefined) {
  const normalized = normalizeIntentText(value)
    .replace(/\b(internship|co[-\s]?op|full[-\s]?time|part[-\s]?time)\b/g, " ")
    .replace(/\b(senior|sr|staff|principal|lead|junior|jr|entry level|new grad|manager|director)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length < 4) return null;
  return normalized.slice(0, 90);
}

function inferYearsFromProfile(experiences: ProfileExperience[], summaryText: string) {
  let best = 0;
  const currentYear = new Date().getFullYear();
  for (const entry of experiences) {
    const years = [...entry.time.matchAll(/\b(20\d{2}|19\d{2})\b/g)]
      .map((match) => Number(match[1]))
      .filter((year) => year >= 1980 && year <= currentYear + 1);
    if (years.length === 0) continue;
    const start = Math.min(...years);
    const end = /present|current|now/i.test(entry.time) ? currentYear : Math.max(...years);
    if (end >= start) best += Math.min(8, end - start + 1);
  }

  const explicit = summaryText.match(/\b(\d{1,2})\+?\s+years?\b/i);
  if (explicit?.[1]) {
    best = Math.max(best, Number.parseInt(explicit[1], 10));
  }
  return best > 0 ? Math.min(best, 20) : undefined;
}

function inferSeniority(input: BuildUserJobIntentInput, summaryText: string) {
  const explicit = input.experienceLevel;
  if (explicit === "ENTRY") {
    const studentLike = /\b(student|intern|co[-\s]?op|new grad|recent graduate)\b/i.test(summaryText);
    return {
      stages: studentLike ? ["STUDENT_INTERN", "ENTRY_JUNIOR"] : ["ENTRY_JUNIOR"],
      minStage: studentLike ? "STUDENT_INTERN" : "ENTRY_JUNIOR",
      maxStage: "ENTRY_JUNIOR",
      years: inferYearsFromProfile(input.experiences, summaryText) ?? (studentLike ? 0 : 1),
      maxRequiredYears: studentLike ? 2 : 3,
      confidence: 0.86,
    };
  }
  if (explicit === "MID") {
    return {
      stages: ["MID_EXPERIENCED"],
      minStage: "ENTRY_JUNIOR",
      maxStage: "MID_EXPERIENCED",
      years: inferYearsFromProfile(input.experiences, summaryText) ?? 3,
      maxRequiredYears: 5,
      confidence: 0.85,
    };
  }
  if (explicit === "SENIOR" || explicit === "LEAD") {
    return {
      stages: ["SENIOR_LEAD_STAFF"],
      minStage: "MID_EXPERIENCED",
      maxStage: "SENIOR_LEAD_STAFF",
      years: inferYearsFromProfile(input.experiences, summaryText) ?? 6,
      maxRequiredYears: 10,
      confidence: 0.85,
    };
  }
  if (explicit === "EXECUTIVE") {
    return {
      stages: ["MANAGER_DIRECTOR_EXECUTIVE"],
      minStage: "SENIOR_LEAD_STAFF",
      maxStage: "MANAGER_DIRECTOR_EXECUTIVE",
      years: inferYearsFromProfile(input.experiences, summaryText) ?? 10,
      maxRequiredYears: 15,
      confidence: 0.85,
    };
  }

  const normalized = normalizeIntentText(summaryText);
  const years = inferYearsFromProfile(input.experiences, summaryText);
  if (/\b(student|co[-\s]?op|intern|new grad|recent graduate|campus)\b/.test(normalized)) {
    return {
      stages: ["STUDENT_INTERN", "ENTRY_JUNIOR"],
      minStage: "STUDENT_INTERN",
      maxStage: "ENTRY_JUNIOR",
      years: years ?? 0,
      maxRequiredYears: 2,
      confidence: 0.78,
    };
  }
  if (/\b(director|head of|vp|vice president|executive)\b/.test(normalized)) {
    return {
      stages: ["MANAGER_DIRECTOR_EXECUTIVE"],
      minStage: "SENIOR_LEAD_STAFF",
      maxStage: "MANAGER_DIRECTOR_EXECUTIVE",
      years: years ?? 10,
      maxRequiredYears: 15,
      confidence: 0.74,
    };
  }
  if (/\b(senior|staff|principal|lead)\b/.test(normalized) || (years ?? 0) >= 5) {
    return {
      stages: ["SENIOR_LEAD_STAFF"],
      minStage: "MID_EXPERIENCED",
      maxStage: "SENIOR_LEAD_STAFF",
      years: years ?? 6,
      maxRequiredYears: 10,
      confidence: 0.72,
    };
  }
  if ((years ?? 0) >= 3 || /\b(mid|intermediate|experienced)\b/.test(normalized)) {
    return {
      stages: ["MID_EXPERIENCED"],
      minStage: "ENTRY_JUNIOR",
      maxStage: "MID_EXPERIENCED",
      years: years ?? 3,
      maxRequiredYears: 5,
      confidence: 0.68,
    };
  }
  return {
    stages: ["ENTRY_JUNIOR"],
    minStage: "STUDENT_INTERN",
    maxStage: "MID_EXPERIENCED",
    years: years ?? 1,
    maxRequiredYears: 3,
    confidence: years ? 0.64 : 0.52,
  };
}

function parsePreferredLocation(location: string | null | undefined) {
  const raw = String(location ?? "").trim();
  if (!raw) return { city: undefined, region: undefined, country: undefined };
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  const joined = normalizeIntentText(raw);
  return {
    city: parts[0] || undefined,
    region:
      /\b(ontario|on)\b/.test(joined) ? "Ontario" :
      /\b(british columbia|bc)\b/.test(joined) ? "British Columbia" :
      /\b(quebec|qc)\b/.test(joined) ? "Quebec" :
      parts.length >= 2 ? parts[1] : undefined,
    country:
      /\b(canada|can)\b/.test(joined) ? "Canada" :
      /\b(united states|usa|us)\b/.test(joined) ? "United States" :
      parts.length >= 3 ? parts[parts.length - 1] : undefined,
  };
}

function expandPreferredWorkModes(workMode: WorkMode | null | undefined) {
  if (!workMode || workMode === "UNKNOWN") return [];
  if (workMode === "FLEXIBLE") return ["FLEXIBLE", "REMOTE", "HYBRID"];
  return [workMode];
}

function buildSkillBuckets(input: BuildUserJobIntentInput) {
  const weights = new Map<string, number>();
  const add = (value: string | null | undefined, weight: number) => {
    const normalized = normalizeIntentText(value);
    if (!normalized || normalized.length < 2 || normalized.length > 60) return;
    weights.set(normalized, (weights.get(normalized) ?? 0) + weight);
  };

  for (const skill of input.skills) add(skill.name, 5);
  for (const term of splitLooseTerms(input.skillsText)) add(term, 3);
  for (const exp of input.experiences) {
    for (const term of splitLooseTerms(exp.description)) add(term, 0.45);
  }
  for (const project of input.projects) {
    for (const term of splitLooseTerms(project.description)) add(term, 0.35);
  }

  const ranked = [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([skill]) => !/\b(responsible|experience|project|team|work|using|with|and|the)\b/.test(skill));

  return {
    mustHaveSkills: ranked.filter(([, weight]) => weight >= 5).map(([skill]) => skill).slice(0, 12),
    strongSkills: ranked.filter(([, weight]) => weight >= 3).map(([skill]) => skill).slice(0, 24),
    niceToHaveSkills: ranked.filter(([, weight]) => weight >= 1.2 && weight < 3).map(([skill]) => skill).slice(0, 24),
    weakSkills: ranked.filter(([, weight]) => weight < 1.2).map(([skill]) => skill).slice(0, 24),
    confidence: Math.min(0.95, ranked.slice(0, 12).reduce((sum, [, weight]) => sum + weight, 0) / 36),
  };
}

function buildHash(intent: Omit<UserJobIntent, "profileHash">) {
  const hashableIntent: Partial<Omit<UserJobIntent, "profileHash">> = { ...intent };
  delete hashableIntent.profileVersion;
  return createHash("sha256").update(JSON.stringify(hashableIntent)).digest("hex");
}

export function buildUserJobIntent(input: BuildUserJobIntentInput): UserJobIntent {
  const savedJobs = input.savedJobs ?? [];
  const appliedJobs = input.appliedJobs ?? [];
  const feedback = input.feedback ?? [];
  const experienceSummary = compactText([
    input.headline,
    input.summary,
    ...input.experiences.flatMap((entry) => [entry.title, entry.description]),
    ...input.educations.flatMap((entry) => [entry.degree, entry.description]),
    ...input.projects.flatMap((project) => [project.name, project.title, project.description]),
    input.experienceText,
    input.educationText,
    input.projectsText,
  ]);
  const textSignals: WeightedTextSignal[] = [
    { text: input.headline ?? "", weight: 5, source: "headline" },
    { text: input.summary ?? "", weight: 1.6, source: "summary" },
    ...input.experiences.flatMap((entry) => [
      { text: entry.title, weight: 7, source: "title" as const },
      { text: entry.description, weight: 2.4, source: "experience" as const },
    ]),
    ...input.projects.flatMap((project) => [
      { text: project.name || project.title, weight: 3.2, source: "project" as const },
      { text: project.description, weight: 1.1, source: "project" as const },
    ]),
    ...input.skills.map((skill) => ({ text: skill.name, weight: 1.4, source: "skill" as const })),
    ...splitLooseTerms(input.skillsText).map((skill) => ({ text: skill, weight: 1.1, source: "skill" as const })),
    ...savedJobs.flatMap((job) => [
      { text: job.title ?? "", weight: 4.5, source: "behavior" as const },
      { text: job.normalizedRoleCategory ?? "", weight: 5, source: "behavior" as const },
    ]),
    ...appliedJobs.flatMap((job) => [
      { text: job.title ?? "", weight: 5.5, source: "behavior" as const },
      { text: job.normalizedRoleCategory ?? "", weight: 6, source: "behavior" as const },
    ]),
  ];
  const roles = inferRoleScores(textSignals);
  const seniority = inferSeniority(input, experienceSummary);
  const skills = buildSkillBuckets(input);
  const location = parsePreferredLocation(input.location);
  const preferredWorkModes = expandPreferredWorkModes(input.preferredWorkMode);
  const explicitTargetRoleCategories: string[] = [];
  const explicitTargetTitles: string[] = [];
  const savedRoleCategories = savedJobs
    .map((job) => job.normalizedRoleCategory)
    .filter((value): value is string => Boolean(value));
  const appliedRoleCategories = appliedJobs
    .map((job) => job.normalizedRoleCategory)
    .filter((value): value is string => Boolean(value));
  const wrongRoleCategories = feedback
    .filter((item) => item.feedbackType === "WRONG_ROLE")
    .map((item) => item.job.normalizedRoleCategory)
    .filter((value): value is string => Boolean(value));
  const repeatedWrongRoles = wrongRoleCategories.filter(
    (category, index, list) => list.indexOf(category) !== index
  );
  const negativeJobIds = feedback
    .filter((item) =>
      ["NOT_INTERESTED", "LOW_QUALITY", "ALREADY_SEEN"].includes(item.feedbackType)
    )
    .map((item) => item.jobId);

  const intentWithoutHash: Omit<UserJobIntent, "profileHash"> = {
    userId: input.userId,
    profileVersion: input.profileVersion,
    explicitTargetTitles,
    inferredTargetTitles: unique([
      ...input.experiences.map((entry) => cleanTitle(entry.title) ?? ""),
      ...savedJobs.map((job) => cleanTitle(job.title) ?? ""),
      ...appliedJobs.map((job) => cleanTitle(job.title) ?? ""),
    ], 12),
    explicitTargetRoleCategories,
    inferredTargetRoleCategories: uniqueCodes(roles.categories, 8),
    excludedRoleCategories: uniqueCodes(repeatedWrongRoles, 8),
    targetCareerStages: seniority.stages,
    minAcceptableCareerStage: seniority.minStage,
    maxAcceptableCareerStage: seniority.maxStage,
    inferredYearsExperience: seniority.years,
    maxRequiredYears: seniority.maxRequiredYears,
    mustHaveSkills: skills.mustHaveSkills,
    strongSkills: unique([...skills.strongSkills, ...skills.mustHaveSkills], 30),
    niceToHaveSkills: skills.niceToHaveSkills,
    weakSkills: skills.weakSkills,
    preferredLocationCity: location.city,
    preferredLocationRegion: location.region,
    preferredLocationCountry: location.country,
    openToRemote: preferredWorkModes.length === 0 || preferredWorkModes.includes("REMOTE"),
    preferredWorkModes,
    targetSalaryMin: input.salaryMin ?? undefined,
    targetSalaryMax: input.salaryMax ?? undefined,
    targetSalaryCurrency: input.salaryCurrency ?? undefined,
    positiveSignals: {
      savedJobIds: savedJobs.map((job) => job.id).filter((id): id is string => Boolean(id)),
      appliedJobIds: appliedJobs.map((job) => job.id).filter((id): id is string => Boolean(id)),
      likedRoleCategories: uniqueCodes([...savedRoleCategories, ...appliedRoleCategories], 10),
      likedTitles: unique([
        ...savedJobs.map((job) => cleanTitle(job.title) ?? ""),
        ...appliedJobs.map((job) => cleanTitle(job.title) ?? ""),
      ], 16),
      likedCompanies: unique([
        ...savedJobs.map((job) => job.company ?? ""),
        ...appliedJobs.map((job) => job.company ?? ""),
      ], 16),
      likedSkills: skills.strongSkills.slice(0, 16),
    },
    negativeSignals: {
      rejectedJobIds: unique(negativeJobIds, 200),
      dislikedRoleCategories: uniqueCodes(wrongRoleCategories, 10),
      dislikedTitles: unique(
        feedback
          .filter((item) => item.feedbackType === "WRONG_ROLE")
          .map((item) => cleanTitle(item.job.title) ?? ""),
        16
      ),
      dislikedSeniorityLevels: unique(
        feedback
          .filter((item) => item.feedbackType === "TOO_SENIOR" || item.feedbackType === "TOO_JUNIOR")
          .map((item) => item.feedbackType),
        8
      ),
      dislikedLocations: unique(
        feedback
          .filter((item) => item.feedbackType === "WRONG_LOCATION")
          .map((item) => item.job.location ?? ""),
        16
      ),
      dislikedWorkModes: unique(
        feedback
          .filter((item) => item.feedbackType === "WRONG_WORK_MODE")
          .map((item) => item.job.workMode ?? ""),
        8
      ),
    },
    confidence: {
      roleIntent: Math.max(roles.confidence, savedRoleCategories.length > 0 ? 0.72 : 0),
      seniorityIntent: seniority.confidence,
      skillIntent: skills.confidence,
      locationIntent: location.city || location.region || location.country ? 0.85 : 0.2,
    },
    experienceSummary,
  };

  return {
    ...intentWithoutHash,
    profileHash: buildHash(intentWithoutHash),
  };
}

export function getAllowedRoleCategories(intent: UserJobIntent) {
  const directRoles = uniqueCodes(
    [
      ...intent.explicitTargetRoleCategories,
      ...intent.inferredTargetRoleCategories,
    ],
    12
  );
  const behaviorRoles =
    directRoles.length === 0 || intent.confidence.roleIntent < 0.65
      ? intent.positiveSignals.likedRoleCategories
      : [];
  return uniqueCodes(
    [
      ...directRoles,
      ...behaviorRoles,
    ],
    12
  );
}

export function assessUserJobIntentSignal(
  intent: UserJobIntent | null
): TopPicksProfileReadiness {
  if (!intent) {
    return {
      canGenerate: false,
      missingSignals: ["profile details"],
      message:
        "Top Picks need profile details before recommendations can be generated.",
    };
  }

  const hasRoleSignal =
    getAllowedRoleCategories(intent).length > 0 ||
    intent.explicitTargetTitles.length > 0 ||
    intent.inferredTargetTitles.length > 0;
  const hasSkillOrExperienceSignal =
    intent.mustHaveSkills.length > 0 ||
    intent.strongSkills.length > 0 ||
    intent.niceToHaveSkills.length > 0 ||
    normalizeIntentText(intent.experienceSummary).length >= 40 ||
    intent.positiveSignals.savedJobIds.length > 0 ||
    intent.positiveSignals.appliedJobIds.length > 0;
  const missingSignals: string[] = [];

  if (!hasRoleSignal) {
    missingSignals.push("target roles or recent job titles");
  }
  if (!hasSkillOrExperienceSignal) {
    missingSignals.push("skills, experience, or saved jobs");
  }

  return {
    canGenerate: hasRoleSignal && hasSkillOrExperienceSignal,
    missingSignals,
    message:
      missingSignals.length > 0
        ? `Add ${missingSignals.join(" and ")} to generate better Top Picks.`
        : "Your profile has enough signal to generate Top Picks.",
  };
}

export function stageRank(stage?: string | null) {
  return stage ? SENIORITY_RANK[stage] : undefined;
}
