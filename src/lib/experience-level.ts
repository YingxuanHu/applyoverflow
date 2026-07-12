import type { EmploymentType, ExperienceLevel } from "@/generated/prisma/client";

export type DetailedExperienceLevel =
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

export type ExperienceLevelGroup =
  | "STUDENT_INTERN"
  | "ENTRY_JUNIOR"
  | "MID_EXPERIENCED"
  | "SENIOR_LEAD_STAFF"
  | "MANAGER_DIRECTOR_EXECUTIVE"
  | "UNKNOWN";

export type ExperienceEvidenceSource =
  | "structured"
  | "title"
  | "description"
  | "years_required"
  | "years_preferred"
  | "management_scope"
  | "industry_rule"
  | "fallback";

export type ExperienceEvidence = {
  source: ExperienceEvidenceSource;
  level: DetailedExperienceLevel;
  confidence: number;
  text: string;
};

export type ExperienceLevelExtractionInput = {
  title: string;
  rawTitle?: string | null;
  company?: string | null;
  description?: string | null;
  employmentType?: EmploymentType | string | null;
  normalizedEmploymentType?: string | null;
  roleFamily?: string | null;
  industry?: string | null;
  structuredExperienceLevel?: string | null;
  sourceMetadata?: unknown;
};

export type ExperienceLevelExtractionResult = {
  experienceLevel: ExperienceLevel;
  normalizedCareerStage: DetailedExperienceLevel;
  experienceLevelGroup: ExperienceLevelGroup;
  confidence: number;
  source: ExperienceEvidenceSource;
  evidence: string[];
  evidenceDetails: ExperienceEvidence[];
  warnings: string[];
};

type Candidate = ExperienceEvidence & {
  warnings?: string[];
};

const GROUP_BY_STAGE: Record<DetailedExperienceLevel, ExperienceLevelGroup> = {
  INTERNSHIP_COOP_STUDENT: "STUDENT_INTERN",
  ENTRY_LEVEL_NEW_GRAD: "ENTRY_JUNIOR",
  ASSOCIATE_JUNIOR: "ENTRY_JUNIOR",
  MID_LEVEL: "MID_EXPERIENCED",
  SENIOR: "SENIOR_LEAD_STAFF",
  STAFF_PRINCIPAL: "SENIOR_LEAD_STAFF",
  MANAGER: "MANAGER_DIRECTOR_EXECUTIVE",
  DIRECTOR: "MANAGER_DIRECTOR_EXECUTIVE",
  EXECUTIVE: "MANAGER_DIRECTOR_EXECUTIVE",
  UNKNOWN: "UNKNOWN",
};

const LEGACY_BY_STAGE: Record<DetailedExperienceLevel, ExperienceLevel> = {
  INTERNSHIP_COOP_STUDENT: "ENTRY",
  ENTRY_LEVEL_NEW_GRAD: "ENTRY",
  ASSOCIATE_JUNIOR: "ENTRY",
  MID_LEVEL: "MID",
  SENIOR: "SENIOR",
  STAFF_PRINCIPAL: "LEAD",
  MANAGER: "LEAD",
  DIRECTOR: "LEAD",
  EXECUTIVE: "EXECUTIVE",
  UNKNOWN: "UNKNOWN",
};

const STAGE_PRIORITY: Record<DetailedExperienceLevel, number> = {
  UNKNOWN: 0,
  INTERNSHIP_COOP_STUDENT: 1,
  ENTRY_LEVEL_NEW_GRAD: 2,
  ASSOCIATE_JUNIOR: 3,
  MID_LEVEL: 4,
  SENIOR: 5,
  STAFF_PRINCIPAL: 6,
  MANAGER: 7,
  DIRECTOR: 8,
  EXECUTIVE: 9,
};

const MANAGER_TITLE_FALSE_POSITIVES = [
  "product manager",
  "project manager",
  "program manager",
  "account manager",
  "customer success manager",
  "marketing manager",
  "social media manager",
  "brand manager",
  "campaign manager",
  "community manager",
  "partnerships manager",
  "partnership manager",
  "relationship manager",
  "operations manager",
  "office manager",
  "case manager",
];

const MANAGER_TITLE_STRONG_PATTERNS = [
  /\bsenior manager\b/i,
  /\bengineering manager\b/i,
  /\bsoftware engineering manager\b/i,
  /\bstore manager\b/i,
  /\bassistant store manager\b/i,
  /\bdistrict manager\b/i,
  /\bbranch manager\b/i,
  /\bdepartment manager\b/i,
  /\bnurse manager\b/i,
  /\bgeneral manager\b/i,
];

const PEOPLE_MANAGEMENT_PATTERNS = [
  /\bpeople management\b/i,
  /\bdirect reports?\b/i,
  /\bmanag(?:e|es|ed|ing|ement)\s+(?:a\s+)?team\b/i,
  /\blead(?:s|ing)?\s+a\s+team\s+of\b/i,
  /\bhire(?:s|d|ing)?\s+and\s+(?:develop|coach|manage)\b/i,
  /\bperformance reviews?\b/i,
  /\bresponsible for staffing\b/i,
  /\bmanag(?:e|es|ed|ing|ement)\s+(?:engineers|designers|analysts|employees|staff)\b/i,
  /\bteam budget\b/i,
  /\bresource planning\b/i,
];

const EXECUTIVE_FALSE_POSITIVES = [
  /\baccount executive\b/i,
  /\bsales executive\b/i,
  /\bexecutive assistant\b/i,
  /\bexecutive chef\b/i,
  /\bexecutive recruiter\b/i,
  /\bexecutive coordinator\b/i,
  /\bexecutive producer\b/i,
];

const EXECUTIVE_PATTERNS = [
  /\b(?:ceo|cfo|coo|cto|cio|ciso|cro|cmo)\b/i,
  /\bchief\s+(?:executive|financial|operating|technology|information|security|revenue|marketing|product|people|legal)\s+officer\b/i,
  /\b(?:president|vice president|vp|svp|evp)\b/i,
  /\bmanaging director\b/i,
  /\b(?:founder|co-founder)\b/i,
  /\bhead of (?:engineering|product|sales|legal|marketing|finance|people|operations|data|design)\b/i,
];

const STAFF_TECH_PATTERNS = [
  /\bstaff\s+(?:software\s+)?engineer\b/i,
  /\bstaff\s+(?:data|machine learning|ml|ai)\s+(?:scientist|engineer)\b/i,
  /\bprincipal\s+(?:software\s+)?engineer\b/i,
  /\bprincipal\s+(?:data|machine learning|ml|ai)\s+(?:scientist|engineer)\b/i,
  /\bprincipal\s+architect\b/i,
  /\bprincipal\s+product manager\b/i,
  /\bprincipal\s+scientist\b/i,
  /\bdistinguished\s+engineer\b/i,
  /\btechnical fellow\b/i,
];

const STAFF_FALSE_POSITIVES = [
  /\bstaff accountant\b/i,
  /\bstaff nurse\b/i,
  /\bstaff writer\b/i,
  /\bstaff attorney\b/i,
  /\bstaff pharmacist\b/i,
  /\bstaff assistant\b/i,
  /\bstaff researcher\b/i,
  /\bchief of staff\b/i,
];

const SENIOR_FALSE_POSITIVES = [
  /\bsenior living\b/i,
  /\bsenior care\b/i,
  /\bsenior services\b/i,
  /\bsenior home care\b/i,
  /\bsenior center\b/i,
];

const SENIOR_PATTERNS = [
  /\b(?:senior|sr\.?|snr)\s+[a-z0-9+#/.&-]+/i,
  /\b[a-z0-9+#/.&-]+\s+(?:senior|sr\.?|snr)\b/i,
];

const LEAD_STRONG_PATTERNS = [
  /\blead\s+(?:software|backend|frontend|front-end|data|machine learning|ml|platform|product|ux|ui|design|designer|engineer|scientist)\b/i,
  /\b(?:tech|technical|team)\s+lead\b/i,
];

const LEAD_FALSE_POSITIVES = [
  /\blead generation\b/i,
  /\bsales lead\b/i,
  /\blead cook\b/i,
  /\blead cashier\b/i,
  /\blead hand\b/i,
  /\blead installer\b/i,
];

const PRINCIPAL_FALSE_POSITIVES = [
  /\bschool principal\b/i,
  /\bassistant principal\b/i,
  /\bprincipal investigator\b/i,
  /\bprincipal consultant\b/i,
];

const INTERN_FALSE_POSITIVES = [
  /\bintern(?:ship)? program manager\b/i,
  /\binternship programs?\b/i,
  /\binternship coordinator\b/i,
  /\bstudent success manager\b/i,
  /\bstudent advisor\b/i,
  /\bstudent services coordinator\b/i,
  /\bgraduate program manager\b/i,
  /\bgraduate admissions officer\b/i,
];

const INTERN_PATTERNS = [
  /\bsoftware engineer intern\b/i,
  /\bintern(?:ship)?\b/i,
  /\bstudent intern\b/i,
  /\bsummer intern\b/i,
  /\bco[-\s]?op\b/i,
  /\bwork term\b/i,
  /\bnew grad program\b/i,
  /\bgraduate program\b/i,
  /\bcampus hire\b/i,
  /\bearly talent\b/i,
  /\bapprentice(?:ship)?\b/i,
  /\bgraduate research assistant\b/i,
  /\blegal intern\b/i,
  /\bsummer associate\b/i,
];

const ENTRY_PATTERNS = [
  /\bnew grad(?:uate)?\b/i,
  /\brecent graduate\b/i,
  /\bearly career\b/i,
  /\bentry[-\s]?level\b/i,
  /\bno experience required\b/i,
  /\btraining provided\b/i,
  /\bcampus hire\b/i,
  /\bresident physician\b/i,
  /\bsales development representative\b/i,
  /\bbusiness development representative\b/i,
  /\bstore associate\b/i,
  /\bsales associate\b/i,
  /\bcrew member\b/i,
  /\bteam member\b/i,
  /\badministrative assistant\b/i,
  /\bresearch assistant\b/i,
];

const JUNIOR_PATTERNS = [
  /\bjunior\b/i,
  /\bjr\.?\b/i,
  /\bassociate\s+(?:software engineer|engineer|developer|data analyst|analyst|consultant|product manager|attorney)\b/i,
  /\bassociate attorney\b/i,
  /\bparalegal\b/i,
];

const ASSOCIATE_NOT_JUNIOR_PATTERNS = [
  /\bassociate director\b/i,
  /\bassociate professor\b/i,
  /\bassociate general counsel\b/i,
  /\bassociate partner\b/i,
];

const ASSISTANT_MANAGEMENT_PATTERNS = [
  /\bassistant manager\b/i,
  /\bassistant director\b/i,
  /\bassistant principal\b/i,
];

const MID_TITLE_PATTERNS = [
  /\bmid[-\s]?level\b/i,
  /\bintermediate\b/i,
  /\bexecutive assistant\b/i,
  /\boffice manager\b/i,
  /\bpostdoctoral fellow\b/i,
  /\bcharge nurse\b/i,
  /\bjourneyman\b/i,
  /\bowner operator\b/i,
];

function normalizeText(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value?: string | null) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleWithoutCompany(title: string | null | undefined, company?: string | null) {
  const compactTitle = compactText(title);
  const compactCompany = compactText(company);
  if (!compactTitle || !compactCompany) return compactTitle;

  const escapedCompany = escapeRegex(compactCompany);
  return compactTitle
    .replace(new RegExp(`\\s*[-–—|•·]\\s*${escapedCompany}\\s*$`, "i"), "")
    .replace(new RegExp(`^\\s*${escapedCompany}\\s*[-–—|•·]\\s*`, "i"), "")
    .trim();
}

function matchesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function addCandidate(candidates: Candidate[], candidate: Candidate | null | undefined) {
  if (!candidate) return;
  candidates.push(candidate);
}

function candidate(
  level: DetailedExperienceLevel,
  confidence: number,
  source: ExperienceEvidenceSource,
  text: string,
  warnings: string[] = []
): Candidate {
  return { level, confidence: clamp(confidence), source, text, warnings };
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function stageDistance(a: DetailedExperienceLevel, b: DetailedExperienceLevel) {
  return Math.abs(STAGE_PRIORITY[a] - STAGE_PRIORITY[b]);
}

function isManagerFalsePositive(title: string) {
  return MANAGER_TITLE_FALSE_POSITIVES.some((phrase) => title.includes(phrase));
}

function hasPeopleManagementEvidence(description: string) {
  if (/\b(no|without)\s+(?:direct reports?|people management|management responsibility)\b/i.test(description)) {
    return false;
  }
  return matchesAny(description, PEOPLE_MANAGEMENT_PATTERNS);
}

function extractStructuredExperience(value?: string | null): Candidate | null {
  const text = normalizeText(value);
  if (!text) return null;
  if (/\bintern|co[-\s]?op|student\b/.test(text)) {
    return candidate("INTERNSHIP_COOP_STUDENT", 0.93, "structured", value ?? "structured internship");
  }
  if (/\bentry|new grad|junior|associate\b/.test(text)) {
    return candidate("ASSOCIATE_JUNIOR", 0.9, "structured", value ?? "structured junior");
  }
  if (/\bmid|intermediate|experienced\b/.test(text)) {
    return candidate("MID_LEVEL", 0.9, "structured", value ?? "structured mid");
  }
  if (/\bstaff|principal|distinguished|fellow\b/.test(text)) {
    return candidate("STAFF_PRINCIPAL", 0.91, "structured", value ?? "structured staff/principal");
  }
  if (/\bsenior|lead\b/.test(text)) {
    return candidate("SENIOR", 0.9, "structured", value ?? "structured senior");
  }
  if (/\bmanager\b/.test(text)) {
    return candidate("MANAGER", 0.9, "structured", value ?? "structured manager");
  }
  if (/\bdirector\b/.test(text)) {
    return candidate("DIRECTOR", 0.91, "structured", value ?? "structured director");
  }
  if (/\bexecutive|vp|vice president|chief\b/.test(text)) {
    return candidate("EXECUTIVE", 0.92, "structured", value ?? "structured executive");
  }
  return null;
}

function extractMetadataExperience(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const stack: unknown[] = [metadata];
  const keyPattern = /(?:seniority|experience[_\s-]?level|career[_\s-]?stage|job[_\s-]?level|level)/i;

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      if (keyPattern.test(key) && typeof value === "string" && compactText(value)) {
        return value;
      }
      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }

  return null;
}

function extractYearsCandidates(description: string): Candidate[] {
  const candidates: Candidate[] = [];
  const patterns = [
    {
      regex: /(.{0,45})(\d{1,2})\s*\+\s*years?(.{0,35})/gi,
      minIndex: 2,
      suffixIndex: 3,
    },
    {
      regex: /(.{0,45})(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*years?(.{0,35})/gi,
      minIndex: 2,
      maxIndex: 3,
      suffixIndex: 4,
    },
    {
      regex: /(.{0,45})(?:no|0)\s+(?:years?\s+of\s+)?experience\s+(?:required|needed)?(.{0,35})/gi,
      suffixIndex: 2,
    },
  ];

  for (const pattern of patterns) {
    for (const match of description.matchAll(pattern.regex)) {
      const full = compactText(match[0]);
      const prefix = normalizeText(match[1]);
      const suffix = normalizeText(match[pattern.suffixIndex]);
      const context = `${prefix} ${suffix}`;
      const isPreferred = /\b(preferred|nice to have|asset|plus)\b/.test(context);
      const source: ExperienceEvidenceSource = isPreferred ? "years_preferred" : "years_required";
      const baseConfidence = isPreferred ? 0.52 : 0.66;

      const minValue = pattern.minIndex ? match[pattern.minIndex] : null;
      if (!minValue) {
        candidates.push(candidate("ENTRY_LEVEL_NEW_GRAD", baseConfidence, source, full));
        continue;
      }

      const min = Number.parseInt(minValue, 10);
      const maxValue = pattern.maxIndex ? match[pattern.maxIndex] : null;
      const max = maxValue ? Number.parseInt(maxValue, 10) : min;
      const high = Math.max(min, max);
      let level: DetailedExperienceLevel = "UNKNOWN";
      let confidence = baseConfidence;

      if (high <= 1) {
        level = "ENTRY_LEVEL_NEW_GRAD";
      } else if (high <= 2) {
        level = "ASSOCIATE_JUNIOR";
      } else if (min <= 3 && high <= 5) {
        level = "MID_LEVEL";
      } else if (min >= 5 && high <= 10) {
        level = "SENIOR";
        confidence -= 0.04;
      } else if (min >= 10) {
        level = "SENIOR";
        confidence -= 0.08;
      } else {
        level = "MID_LEVEL";
      }

      candidates.push(candidate(level, confidence, source, full));
    }
  }

  return candidates;
}

function levelFromRomanOrNumeric(title: string): Candidate | null {
  const romanMatch = title.match(
    /\b(?:software engineer|swe|engineer|developer|analyst|scientist|designer|consultant)\s+(i{1,3}|iv|v|vi)\b/i
  );
  if (romanMatch?.[1]) {
    const roman = romanMatch[1].toUpperCase();
    const level =
      roman === "I"
        ? "ENTRY_LEVEL_NEW_GRAD"
        : roman === "II"
          ? "ASSOCIATE_JUNIOR"
          : roman === "III"
            ? "MID_LEVEL"
            : roman === "IV"
              ? "SENIOR"
              : roman === "V"
                ? "SENIOR"
                : "STAFF_PRINCIPAL";
    const confidence = roman === "V" ? 0.7 : 0.74;
    return candidate(level, confidence, "title", romanMatch[0]);
  }

  const levelMatch = title.match(/\b(?:l|ic|p|m)([1-9])\b/i);
  if (!levelMatch?.[1]) return null;
  const numeric = Number.parseInt(levelMatch[1], 10);
  if (numeric <= 1) return candidate("ENTRY_LEVEL_NEW_GRAD", 0.68, "title", levelMatch[0]);
  if (numeric === 2) return candidate("ASSOCIATE_JUNIOR", 0.68, "title", levelMatch[0]);
  if (numeric === 3) return candidate("MID_LEVEL", 0.7, "title", levelMatch[0]);
  if (numeric === 4) return candidate("SENIOR", 0.7, "title", levelMatch[0]);
  if (numeric === 5) return candidate("SENIOR", 0.68, "title", levelMatch[0], ["company_level_number_varies"]);
  return candidate("STAFF_PRINCIPAL", 0.68, "title", levelMatch[0], ["company_level_number_varies"]);
}

function extractTitleCandidates(title: string, description: string, employmentType?: string | null): Candidate[] {
  const candidates: Candidate[] = [];

  if (
    (employmentType === "INTERNSHIP" || employmentType === "CO_OP" || employmentType === "APPRENTICESHIP") &&
    !matchesAny(title, INTERN_FALSE_POSITIVES)
  ) {
    candidates.push(
      candidate("INTERNSHIP_COOP_STUDENT", 0.86, "structured", `${employmentType} employment type`)
    );
  }

  if (matchesAny(title, INTERN_PATTERNS) && !matchesAny(title, INTERN_FALSE_POSITIVES)) {
    candidates.push(candidate("INTERNSHIP_COOP_STUDENT", 0.92, "title", "target worker is intern/student/co-op"));
  }
  if (matchesAny(title, INTERN_FALSE_POSITIVES)) {
    candidates.push(
      candidate("UNKNOWN", 0.22, "title", "intern/student appears to describe a program or population", [
        "intern_student_false_positive",
      ])
    );
  }

  if (matchesAny(title, ENTRY_PATTERNS)) {
    candidates.push(candidate("ENTRY_LEVEL_NEW_GRAD", 0.8, "title", "entry/new-grad title signal"));
  }

  if (matchesAny(title, ASSOCIATE_NOT_JUNIOR_PATTERNS)) {
    if (/\bassociate director\b/i.test(title)) {
      candidates.push(candidate("DIRECTOR", 0.82, "title", "Associate Director"));
    } else if (/\bassociate professor\b/i.test(title)) {
      candidates.push(candidate("SENIOR", 0.72, "industry_rule", "Associate Professor"));
    } else {
      candidates.push(candidate("SENIOR", 0.76, "industry_rule", "senior associate title"));
    }
  } else if (matchesAny(title, JUNIOR_PATTERNS)) {
    candidates.push(candidate("ASSOCIATE_JUNIOR", 0.78, "title", "junior/associate title signal"));
  }

  if (matchesAny(title, ASSISTANT_MANAGEMENT_PATTERNS)) {
    if (/\bassistant director\b|\bassistant principal\b/i.test(title)) {
      candidates.push(candidate("DIRECTOR", 0.74, "title", "assistant director/principal management title"));
    } else {
      candidates.push(candidate("MANAGER", 0.7, "title", "assistant manager title", ["junior_manager_track"]));
    }
  }

  if (matchesAny(title, EXECUTIVE_FALSE_POSITIVES)) {
    candidates.push(
      candidate("MID_LEVEL", 0.5, "title", "executive is not C-suite/senior leadership here", [
        "executive_keyword_false_positive",
      ])
    );
  } else if (matchesAny(title, EXECUTIVE_PATTERNS)) {
    candidates.push(candidate("EXECUTIVE", 0.9, "title", "executive leadership title"));
  }

  if (/\bdirector of nursing\b/i.test(title)) {
    candidates.push(candidate("DIRECTOR", 0.88, "industry_rule", "Director of Nursing"));
  } else if (/\b(?:director|deputy director)\b/i.test(title) && !/\bdirector of first impressions\b/i.test(title)) {
    candidates.push(candidate("DIRECTOR", 0.86, "title", "director title"));
  }

  const managerFalsePositive = isManagerFalsePositive(title);
  if (matchesAny(title, MANAGER_TITLE_STRONG_PATTERNS)) {
    const confidence =
      /\bengineering manager\b/i.test(title) && !hasPeopleManagementEvidence(description) ? 0.68 : 0.86;
    const warnings =
      /\bengineering manager\b/i.test(title) && !hasPeopleManagementEvidence(description)
        ? ["manager_title_without_people_management_evidence"]
        : [];
    candidates.push(candidate("MANAGER", confidence, "title", "manager title with stronger context", warnings));
  } else if (/\bmanager\b/i.test(title) && managerFalsePositive) {
    candidates.push(
      candidate("MID_LEVEL", 0.48, "title", "manager is a role noun, not necessarily people management", [
        "manager_keyword_ambiguous",
      ])
    );
  } else if (/\bmanager\b|\bsupervisor\b/i.test(title) && hasPeopleManagementEvidence(description)) {
    candidates.push(candidate("MANAGER", 0.84, "management_scope", "people-management evidence"));
  }

  if (matchesAny(title, STAFF_FALSE_POSITIVES)) {
    candidates.push(
      candidate("MID_LEVEL", 0.5, "title", "staff is not a senior technical IC ladder here", [
        "staff_keyword_false_positive",
      ])
    );
  } else if (matchesAny(title, STAFF_TECH_PATTERNS)) {
    candidates.push(candidate("STAFF_PRINCIPAL", 0.9, "title", "staff/principal technical IC title"));
  }

  if (matchesAny(title, PRINCIPAL_FALSE_POSITIVES)) {
    if (/\bschool principal\b|\bassistant principal\b/i.test(title)) {
      candidates.push(candidate("DIRECTOR", 0.74, "industry_rule", "school principal management title"));
    } else if (/\bprincipal investigator\b/i.test(title)) {
      candidates.push(candidate("SENIOR", 0.76, "industry_rule", "Principal Investigator"));
    } else {
      candidates.push(candidate("SENIOR", 0.72, "industry_rule", "Principal Consultant"));
    }
  }

  if (matchesAny(title, SENIOR_FALSE_POSITIVES)) {
    candidates.push(
      candidate("UNKNOWN", 0.24, "title", "senior describes older adults, not job level", [
        "senior_keyword_false_positive",
      ])
    );
  } else if (matchesAny(title, SENIOR_PATTERNS)) {
    candidates.push(candidate("SENIOR", 0.84, "title", "senior title signal"));
  }

  if (matchesAny(title, LEAD_FALSE_POSITIVES)) {
    candidates.push(
      candidate("MID_LEVEL", 0.52, "title", "lead is ambiguous or not senior corporate level", [
        "lead_keyword_ambiguous",
      ])
    );
  } else if (matchesAny(title, LEAD_STRONG_PATTERNS)) {
    candidates.push(candidate("SENIOR", 0.82, "title", "senior lead title signal"));
  }

  if (matchesAny(title, MID_TITLE_PATTERNS)) {
    candidates.push(candidate("MID_LEVEL", 0.68, "title", "mid-level or experienced title signal"));
  }

  addCandidate(candidates, levelFromRomanOrNumeric(title));

  if (/\bassociate general counsel\b/i.test(title)) {
    candidates.push(candidate("SENIOR", 0.82, "industry_rule", "Associate General Counsel"));
  } else if (/\bgeneral counsel\b/i.test(title)) {
    candidates.push(candidate("EXECUTIVE", 0.9, "industry_rule", "General Counsel"));
  } else if (/\bsenior counsel\b/i.test(title)) {
    candidates.push(candidate("SENIOR", 0.84, "industry_rule", "Senior Counsel"));
  } else if (/\blegal counsel\b|\bcounsel\b/i.test(title)) {
    candidates.push(candidate("SENIOR", 0.62, "industry_rule", "Counsel title is usually mid/senior"));
  }

  if (/\bresident physician\b/i.test(title)) {
    candidates.push(candidate("ENTRY_LEVEL_NEW_GRAD", 0.78, "industry_rule", "Resident Physician"));
  }
  if (/\bstaff nurse\b/i.test(title)) {
    candidates.push(candidate("MID_LEVEL", 0.46, "industry_rule", "Staff Nurse does not mean staff/principal"));
  }
  if (/\bnurse manager\b/i.test(title)) {
    candidates.push(candidate("MANAGER", 0.86, "industry_rule", "Nurse Manager"));
  }
  if (/\bsenior account executive\b/i.test(title)) {
    candidates.push(candidate("SENIOR", 0.84, "industry_rule", "Senior Account Executive"));
  } else if (/\benterprise account executive\b/i.test(title)) {
    candidates.push(candidate("SENIOR", 0.66, "industry_rule", "Enterprise Account Executive"));
  }
  if (/\bregional sales manager\b/i.test(title)) {
    candidates.push(
      candidate(
        hasPeopleManagementEvidence(description) ? "MANAGER" : "MID_LEVEL",
        hasPeopleManagementEvidence(description) ? 0.78 : 0.56,
        "industry_rule",
        "Regional Sales Manager",
        hasPeopleManagementEvidence(description) ? [] : ["territory_manager_without_team_evidence"]
      )
    );
  }
  if (/\bjourneyman\b/i.test(title)) {
    candidates.push(candidate("MID_LEVEL", 0.72, "industry_rule", "Journeyman trades title"));
  }
  if (/\bmaster electrician\b/i.test(title)) {
    candidates.push(candidate("SENIOR", 0.82, "industry_rule", "Master Electrician"));
  }

  return candidates;
}

function extractDescriptionScope(description: string): Candidate[] {
  const candidates: Candidate[] = [];
  if (!description) return candidates;

  if (hasPeopleManagementEvidence(description)) {
    candidates.push(candidate("MANAGER", 0.78, "management_scope", "people-management responsibility"));
  }
  if (
    /\b(department strategy|business unit strategy|organization-wide leadership|executive leadership|p&l responsibility|board reporting)\b/i.test(
      description
    )
  ) {
    candidates.push(candidate("DIRECTOR", 0.72, "description", "director/executive scope signal"));
  }
  if (
    /\b(technical strategy|architecture across teams|company-wide impact|cross-functional technical leadership|technical leadership)\b/i.test(
      description
    )
  ) {
    candidates.push(candidate("STAFF_PRINCIPAL", 0.72, "description", "staff/principal scope signal"));
  }
  if (
    /\b(mentor junior|drive architecture|own large projects|lead complex initiatives|subject matter expert)\b/i.test(
      description
    )
  ) {
    candidates.push(candidate("SENIOR", 0.66, "description", "senior scope signal"));
  }
  if (/\b(independently deliver|own features|professional experience|hands-on experience|working knowledge)\b/i.test(description)) {
    candidates.push(candidate("MID_LEVEL", 0.56, "description", "mid-level responsibility signal"));
  }
  if (
    /\b(no experience required|new graduate|recent graduate|campus hire|training provided|0\s*[-–—to]+\s*[12]\s+years?)\b/i.test(
      description
    )
  ) {
    candidates.push(candidate("ENTRY_LEVEL_NEW_GRAD", 0.66, "description", "strong entry-level description signal"));
  }
  if (/\b(under supervision|learn and grow)\b/i.test(description)) {
    candidates.push(
      candidate("ENTRY_LEVEL_NEW_GRAD", 0.42, "description", "weak entry-level growth signal", [
        "weak_entry_growth_phrase",
      ])
    );
  }

  return candidates;
}

function resolveBestCandidate(candidates: Candidate[]): ExperienceLevelExtractionResult {
  if (candidates.length === 0) {
    return buildResult({
      level: "UNKNOWN",
      confidence: 0.2,
      source: "fallback",
      text: "no reliable experience-level signal",
    });
  }

  const ordered = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const top = ordered[0];
  const warnings = new Set(top.warnings ?? []);
  const evidence = ordered
    .filter((entry) => entry.confidence >= 0.45 && entry.level !== "UNKNOWN")
    .slice(0, 5);
  let confidence = top.confidence;

  for (const other of ordered.slice(1)) {
    if (other.level === "UNKNOWN" || top.level === "UNKNOWN") {
      for (const warning of other.warnings ?? []) warnings.add(warning);
      continue;
    }
    if (other.confidence >= 0.58 && stageDistance(top.level, other.level) >= 2) {
      confidence -= 0.08;
      warnings.add(`conflicting_${other.level.toLowerCase()}_signal`);
    } else if (other.level === top.level && other.confidence >= 0.55) {
      confidence += 0.04;
    }
    for (const warning of other.warnings ?? []) warnings.add(warning);
  }

  if (top.level === "UNKNOWN" || confidence < 0.35) {
    return buildResult({
      level: "UNKNOWN",
      confidence: Math.min(confidence, 0.34),
      source: top.source,
      text: top.text,
      warnings: [...warnings],
      evidenceDetails: ordered,
    });
  }

  return buildResult({
    level: top.level,
    confidence: clamp(confidence),
    source: top.source,
    text: top.text,
    warnings: [...warnings],
    evidenceDetails: evidence.length > 0 ? evidence : [top],
  });
}

function buildResult(input: {
  level: DetailedExperienceLevel;
  confidence: number;
  source: ExperienceEvidenceSource;
  text: string;
  warnings?: string[];
  evidenceDetails?: ExperienceEvidence[];
}): ExperienceLevelExtractionResult {
  const normalizedCareerStage =
    input.level === "UNKNOWN" || input.confidence < 0.35 ? "UNKNOWN" : input.level;
  const confidence = normalizedCareerStage === "UNKNOWN" ? Math.min(input.confidence, 0.34) : input.confidence;
  const evidenceDetails = (input.evidenceDetails ?? [
    {
      level: normalizedCareerStage,
      confidence,
      source: input.source,
      text: input.text,
    },
  ]).map((entry) => ({
    ...entry,
    text: sanitizeJsonText(entry.text),
  }));
  const warnings = (input.warnings ?? []).map(sanitizeJsonText).filter(Boolean);

  return {
    experienceLevel: LEGACY_BY_STAGE[normalizedCareerStage],
    normalizedCareerStage,
    experienceLevelGroup: GROUP_BY_STAGE[normalizedCareerStage],
    confidence: clamp(confidence),
    source: input.source,
    evidence: evidenceDetails.map((entry) => entry.text),
    evidenceDetails,
    warnings,
  };
}

function sanitizeJsonText(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF]/g, "")
    .trim();
}

export function extractExperienceLevel(
  input: ExperienceLevelExtractionInput
): ExperienceLevelExtractionResult {
  const title = normalizeText(titleWithoutCompany(input.title, input.company));
  const rawTitle = normalizeText(titleWithoutCompany(input.rawTitle, input.company));
  const description = truncateEvidenceText(normalizeText(input.description));
  const candidates: Candidate[] = [];
  const structured =
    input.structuredExperienceLevel ?? extractMetadataExperience(input.sourceMetadata);

  addCandidate(candidates, extractStructuredExperience(structured));
  candidates.push(...extractTitleCandidates(title, description, input.normalizedEmploymentType ?? input.employmentType));
  if (rawTitle && rawTitle !== title) {
    candidates.push(...extractTitleCandidates(rawTitle, description, input.normalizedEmploymentType ?? input.employmentType));
  }
  candidates.push(...extractYearsCandidates(description));
  candidates.push(...extractDescriptionScope(description));

  if (/\bproduct manager\b/i.test(title) && /\b(?:7|8|9|10)\+?\s+years\b/i.test(description)) {
    candidates.push(candidate("SENIOR", 0.66, "years_required", "product manager with senior years requirement"));
  }

  return resolveBestCandidate(candidates);
}

function truncateEvidenceText(value: string) {
  return value.length > 12_000 ? value.slice(0, 12_000) : value;
}

export function groupForCareerStage(stage: DetailedExperienceLevel): ExperienceLevelGroup {
  return GROUP_BY_STAGE[stage] ?? "UNKNOWN";
}

export function legacyExperienceLevelForCareerStage(stage: DetailedExperienceLevel): ExperienceLevel {
  return LEGACY_BY_STAGE[stage] ?? "UNKNOWN";
}

export function normalizeExperienceLevelGroupToken(value?: string | null): ExperienceLevelGroup | null {
  const token = (value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\/]+/g, "_")
    .replace(/[\s-]+/g, "_")
    .replace(/_+&_*|_AND_/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

  switch (token) {
    case "STUDENT":
    case "INTERN":
    case "INTERNSHIP":
    case "CO_OP":
    case "COOP":
    case "APPRENTICESHIP":
    case "INTERNSHIP_COOP_STUDENT":
    case "STUDENT_INTERN":
      return "STUDENT_INTERN";
    case "ENTRY":
    case "ENTRY_LEVEL":
    case "ENTRY_LEVEL_NEW_GRAD":
    case "NEW_GRAD":
    case "JUNIOR":
    case "ASSOCIATE":
    case "ASSOCIATE_JUNIOR":
    case "ENTRY_JUNIOR":
      return "ENTRY_JUNIOR";
    case "MID":
    case "MID_LEVEL":
    case "MID_LEVEL_EXPERIENCED":
    case "MID_EXPERIENCED":
      return "MID_EXPERIENCED";
    case "SENIOR":
    case "LEAD":
    case "STAFF":
    case "PRINCIPAL":
    case "STAFF_PRINCIPAL":
    case "SENIOR_LEAD_STAFF":
      return "SENIOR_LEAD_STAFF";
    case "MANAGER":
    case "DIRECTOR":
    case "EXECUTIVE":
    case "MANAGER_DIRECTOR_EXECUTIVE":
      return "MANAGER_DIRECTOR_EXECUTIVE";
    case "UNKNOWN":
      return "UNKNOWN";
    default:
      return null;
  }
}
