import type { FillerProfile, FillerResume, FillerPackage } from "./types";

/**
 * Canonical field concepts that auto-apply knows how to fill.
 * Each ATS filler maps its form selectors to these concepts.
 */
export type FieldConcept =
  | "first_name"
  | "last_name"
  | "preferred_name"
  | "full_name"
  | "email"
  | "phone"
  | "linkedin_url"
  | "github_url"
  | "portfolio_url"
  | "website_url"
  | "resume_file"
  | "cover_letter"
  | "work_authorization"
  | "sponsorship_needs"
  | "salary_expectation"
  | "availability"
  | "location"
  | "education"
  | "experience"
  | "skills"
  | "how_did_you_hear";

/**
 * Build the value map from profile + package data.
 * Returns null for fields where we don't have data.
 */
export function buildFieldValueMap(
  profile: FillerProfile,
  resume: FillerResume,
  pkg: FillerPackage
): Record<FieldConcept, string | null> {
  const salaryText =
    profile.salaryMin && profile.salaryMax
      ? `${profile.salaryMin}-${profile.salaryMax} ${profile.salaryCurrency ?? "USD"}`
      : profile.salaryMin
        ? `${profile.salaryMin}+ ${profile.salaryCurrency ?? "USD"}`
        : null;

  const savedAnswers = pkg.savedAnswers ?? {};
  const savedFullName = savedAnswerForConcept(savedAnswers, "full_name");
  const fallbackFullName = `${profile.firstName} ${profile.lastName}`.trim();
  const fullName = savedFullName ?? fallbackFullName;
  const splitSavedName = savedFullName ? splitFullName(savedFullName) : null;

  return {
    first_name:
      savedAnswerForConcept(savedAnswers, "first_name") ??
      splitSavedName?.firstName ??
      profile.firstName,
    last_name:
      savedAnswerForConcept(savedAnswers, "last_name") ??
      splitSavedName?.lastName ??
      profile.lastName,
    preferred_name: savedAnswerForConcept(savedAnswers, "preferred_name") ?? profile.preferredName,
    full_name: fullName,
    email: savedAnswerForConcept(savedAnswers, "email") ?? profile.email,
    phone: savedAnswerForConcept(savedAnswers, "phone") ?? profile.phone,
    linkedin_url: savedAnswerForConcept(savedAnswers, "linkedin_url") ?? profile.linkedinUrl,
    github_url: savedAnswerForConcept(savedAnswers, "github_url") ?? profile.githubUrl,
    portfolio_url:
      savedAnswerForConcept(savedAnswers, "portfolio_url") ?? profile.portfolioUrl,
    website_url:
      savedAnswerForConcept(savedAnswers, "website_url") ??
      savedAnswerForConcept(savedAnswers, "portfolio_url") ??
      profile.portfolioUrl ??
      profile.githubUrl,
    resume_file: resume.filePath,
    cover_letter: savedAnswerForConcept(savedAnswers, "cover_letter") ?? pkg.coverLetterContent,
    work_authorization:
      savedAnswerForConcept(savedAnswers, "work_authorization") ?? profile.workAuthorization,
    sponsorship_needs: savedAnswerForConcept(savedAnswers, "sponsorship_needs"),
    salary_expectation: savedAnswerForConcept(savedAnswers, "salary_expectation") ?? salaryText,
    availability: savedAnswerForConcept(savedAnswers, "availability"),
    location: savedAnswerForConcept(savedAnswers, "location") ?? profile.location,
    education: profile.educationText,
    experience: profile.experienceText,
    skills: profile.skillsText,
    how_did_you_hear: savedAnswerForConcept(savedAnswers, "how_did_you_hear"),
  };
}

const SAVED_ANSWER_LABELS: Record<FieldConcept, string[]> = {
  first_name: ["first name", "given name"],
  last_name: ["last name", "surname", "family name"],
  preferred_name: ["preferred name", "go by"],
  full_name: ["full name", "legal name", "name"],
  email: ["email", "email address", "e mail"],
  phone: ["phone", "phone number", "mobile", "cell", "telephone"],
  linkedin_url: ["linkedin", "linkedin url", "linkedin profile"],
  github_url: ["github", "github url", "github profile"],
  portfolio_url: ["portfolio", "portfolio url", "portfolio website"],
  website_url: ["website", "personal website", "other website", "web page", "url"],
  resume_file: ["resume", "cv"],
  cover_letter: ["cover letter"],
  work_authorization: ["work authorization", "legally authorized", "valid work authorization"],
  sponsorship_needs: ["sponsorship", "visa sponsorship", "immigration sponsorship"],
  salary_expectation: ["salary", "compensation", "desired compensation", "pay expectation"],
  availability: ["availability", "start date", "earliest start date", "notice period"],
  location: ["current location", "location", "city"],
  education: ["education", "school", "university", "degree"],
  experience: ["experience", "employment history", "work history"],
  skills: ["skills", "technologies"],
  how_did_you_hear: [
    "how did you hear",
    "how did you hear about us",
    "referral source",
    "where did you find",
    "where did you learn",
  ],
};

function savedAnswerForConcept(
  savedAnswers: Record<string, string>,
  concept: FieldConcept
) {
  const aliases = SAVED_ANSWER_LABELS[concept].map(normalizeLabel);
  const entries = Object.entries(savedAnswers)
    .map(([key, value]) => ({
      key: normalizeLabel(key),
      value: value.trim(),
    }))
    .filter((entry) => entry.value.length > 0);

  const exact = entries.find((entry) => aliases.includes(entry.key));
  if (exact) return exact.value;

  const anchored = entries.find((entry) =>
    aliases.some((alias) => isAnchoredLabelMatch(entry.key, alias))
  );
  return anchored?.value ?? null;
}

function isAnchoredLabelMatch(key: string, alias: string) {
  if (alias.length < 5) return false;
  return key.startsWith(`${alias} `) || key.endsWith(` ${alias}`);
}

function splitFullName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

function normalizeLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ─── Label-to-concept heuristic matching ─────────────────────────────────────

const LABEL_PATTERNS: Array<{ pattern: RegExp; concept: FieldConcept }> = [
  { pattern: /\bfirst\s*name\b/i, concept: "first_name" },
  { pattern: /\blast\s*name\b|surname\b|family\s*name\b/i, concept: "last_name" },
  { pattern: /\bpreferred\s*name\b|\bgo\s*by\b/i, concept: "preferred_name" },
  { pattern: /^name\b/i, concept: "full_name" },
  { pattern: /\bfull\s*name\b|\byour\s*name\b/i, concept: "full_name" },
  { pattern: /\be[\s-]*mail\b/i, concept: "email" },
  { pattern: /\bphone\b|\bmobile\b|\bcell\b|\btelephone\b/i, concept: "phone" },
  { pattern: /\blinkedin\b/i, concept: "linkedin_url" },
  { pattern: /\bgithub\b/i, concept: "github_url" },
  { pattern: /\bportfolio\b|\bpersonal\s*(?:site|website)\b/i, concept: "portfolio_url" },
  { pattern: /\bwebsite\b|\burl\b|\bweb\s*page\b/i, concept: "website_url" },
  { pattern: /\bresume\b|\bcv\b|\bcurriculum/i, concept: "resume_file" },
  { pattern: /\bcover\s*letter\b/i, concept: "cover_letter" },
  { pattern: /\bsponsor(?:ship)?\b|\bvisa\s*sponsor/i, concept: "sponsorship_needs" },
  { pattern: /\bauthoriz(?:ation|ed)\b|\bwork\s*(?:permit|visa)\b|\blegally\b/i, concept: "work_authorization" },
  { pattern: /\bsalary\b|\bcompensation\b|\bpay\s*(?:range|expectation)\b/i, concept: "salary_expectation" },
  { pattern: /\bavailable\b|\bstart\s*date\b|\bnotice\s*period\b/i, concept: "availability" },
  { pattern: /\blocation\b|\bcity\b|\bwhere.*(?:you|located)\b/i, concept: "location" },
  { pattern: /\beducation\b|\bschool\b|\buniversity\b|\bdegree\b/i, concept: "education" },
  { pattern: /\bexperience\b|\bemployment\s*history\b|\bwork\s*history\b/i, concept: "experience" },
  { pattern: /\bskills?\b|\btechnolog(?:y|ies)\b/i, concept: "skills" },
  { pattern: /\bhow\s*did\s*you\s*hear\b|\breferral\s*source\b|\bwhere.*(?:find|learn)\b/i, concept: "how_did_you_hear" },
];

/**
 * Given a form field label, try to match it to a known concept.
 * Returns null if no confident match.
 */
export function matchLabelToConcept(label: string): FieldConcept | null {
  const trimmed = label.trim();
  for (const { pattern, concept } of LABEL_PATTERNS) {
    if (pattern.test(trimmed)) return concept;
  }
  return null;
}

export function isSensitiveFieldLabel(label: string) {
  return /\bsponsor(?:ship)?\b|\bvisa\b|\bauthoriz(?:ation|ed)\b|\blegally\b|\bsalary\b|\bcompensation\b|\bpay\b|\bavailable\b|\bstart\s*date\b|\bnotice\s*period\b|\bveteran\b|\bdisabilit(?:y|ies)\b|\bgender\b|\brace\b|\bethnic/i.test(label);
}

export function isSensitiveFieldConcept(concept: FieldConcept | null) {
  return (
    concept === "work_authorization" ||
    concept === "sponsorship_needs" ||
    concept === "salary_expectation" ||
    concept === "availability"
  );
}
