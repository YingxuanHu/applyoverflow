import type { ProfileFormValues } from "@/lib/profile";

export const RESUME_LIBRARY_ENTRY_TYPES = [
  "EDUCATION",
  "EXPERIENCE",
  "PROJECT",
  "SKILL",
  "CUSTOM",
] as const;

export type ResumeLibraryEntryTypeValue = (typeof RESUME_LIBRARY_ENTRY_TYPES)[number];

/**
 * The resume workspace intentionally keeps the output order fixed. This matches
 * the unified moderncv template and prevents a selection's click order from
 * changing the document hierarchy.
 */
export const RESUME_BUILD_SECTION_ORDER = [
  "EDUCATION",
  "EXPERIENCE",
  "PROJECT",
  "SKILL",
] as const;

export type ResumeLibrarySeed = {
  sourceProfileKey: string;
  type: Exclude<ResumeLibraryEntryTypeValue, "CUSTOM">;
  title: string;
  organization: string | null;
  dateRange: string | null;
  location: string | null;
  summary: string | null;
  technologies: string[];
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function normalizeResumeBullets(value: unknown) {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split("\n")
      : [];

  return candidates
    .map((candidate) => cleanText(candidate, 1_000).replace(/^[-*•]\s*/, ""))
    .filter(Boolean)
    .slice(0, 20);
}

export function seedResumeLibraryFromProfile(values: ProfileFormValues): ResumeLibrarySeed[] {
  const experiences = values.experiences.map((experience, index) => ({
    sourceProfileKey: `experience:${index}`,
    type: "EXPERIENCE" as const,
    title: cleanText(experience.title, 160) || cleanText(experience.company, 160) || "Experience",
    organization: cleanText(experience.company, 160) || null,
    dateRange: cleanText(experience.time, 120) || null,
    location: cleanText(experience.location, 160) || null,
    summary: cleanText(experience.description, 4_000) || null,
    technologies: [],
  }));
  const projects = values.projects.map((project, index) => ({
    sourceProfileKey: `project:${index}`,
    type: "PROJECT" as const,
    title: cleanText(project.name, 160) || cleanText(project.title, 160) || "Project",
    organization: cleanText(project.title, 160) || null,
    dateRange: cleanText(project.time, 120) || null,
    location: cleanText(project.location, 160) || null,
    summary: cleanText(project.description, 4_000) || null,
    technologies: [],
  }));
  const education = values.educations.map((entry, index) => ({
    sourceProfileKey: `education:${index}`,
    type: "EDUCATION" as const,
    title: cleanText(entry.degree, 160) || cleanText(entry.school, 160) || "Education",
    organization: cleanText(entry.school, 160) || null,
    dateRange: cleanText(entry.time, 120) || null,
    location: cleanText(entry.location, 160) || null,
    summary: cleanText(entry.description, 4_000) || null,
    technologies: [],
  }));
  const skills = values.skills.map((skill) => cleanText(skill.name, 120)).filter(Boolean);
  const skillEntry =
    skills.length > 0
      ? [
          {
            sourceProfileKey: "skills:primary",
            type: "SKILL" as const,
            title: "Skills",
            organization: null,
            dateRange: null,
            location: null,
            summary: null,
            technologies: skills,
          },
        ]
      : [];

  return [...education, ...experiences, ...projects, ...skillEntry];
}

export function displayResumeEntryType(type: ResumeLibraryEntryTypeValue) {
  return (
    {
      EDUCATION: "Education",
      EXPERIENCE: "Experience",
      PROJECT: "Project",
      SKILL: "Skills",
      CUSTOM: "Additional",
    } as const
  )[type];
}
