import type { ProfileContext } from "./job-fit";

export type ProfileReadiness = {
  canUseAi: boolean;
  isEmpty: boolean;
  missingCritical: string[];
  missingRecommended: string[];
  blockingMessage: string | null;
  profileNotice: string | null;
};

const PROFILE_BASE_MESSAGE = "Complete your profile for better results";

function clean(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function hasText(value: string | null | undefined) {
  return clean(value).length > 0;
}

function hasAnyText(values: Array<string | null | undefined>) {
  return values.some(hasText);
}

function formatList(values: string[]) {
  if (values.length <= 1) {
    return values[0] ?? "";
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

export function assessProfileForAi(profile: ProfileContext): ProfileReadiness {
  const hasHeadlineOrSummary = hasAnyText([profile.headline, profile.summary]);
  const hasSkills = profile.skills.length > 0 || hasText(profile.skillsText);
  const hasExperience =
    profile.experiences.length > 0 || hasText(profile.experienceText);
  const hasEducation =
    profile.educations.length > 0 || hasText(profile.educationText);
  const hasProjects = profile.projects.length > 0 || hasText(profile.projectsText);
  const hasCareerEvidence =
    hasExperience || hasProjects || hasEducation || hasHeadlineOrSummary;

  const isEmpty =
    !hasHeadlineOrSummary &&
    !hasSkills &&
    !hasExperience &&
    !hasEducation &&
    !hasProjects &&
    !hasAnyText([
      profile.fullName,
      profile.email,
      profile.location,
      profile.linkedInUrl,
      profile.githubUrl,
      profile.portfolioUrl,
      profile.workAuthorization,
      profile.preferredWorkMode,
    ]);

  const missingCritical: string[] = [];
  if (isEmpty) {
    missingCritical.push("headline or summary", "skills", "experience or projects");
  } else {
    if (!hasSkills) {
      missingCritical.push("skills");
    }
    if (!hasCareerEvidence) {
      missingCritical.push("experience, projects, education, or summary");
    }
  }

  const missingRecommended: string[] = [];
  if (!profile.fullName) missingRecommended.push("full name");
  if (!profile.email) missingRecommended.push("email");
  if (!profile.location) missingRecommended.push("location");
  if (!hasHeadlineOrSummary) missingRecommended.push("headline or summary");
  if (!hasSkills) missingRecommended.push("skills");
  if (!hasExperience) missingRecommended.push("experience");
  if (!hasProjects) missingRecommended.push("projects");
  if (!profile.workAuthorization) missingRecommended.push("work authorization");
  if (!profile.linkedInUrl && !profile.githubUrl && !profile.portfolioUrl) {
    missingRecommended.push("professional links");
  }

  const canUseAi = missingCritical.length === 0;
  const blockingMessage = canUseAi
    ? null
    : `Please add ${formatList(missingCritical)} in Profile to use this feature.`;

  const profileNotice =
    canUseAi && missingRecommended.length > 0
      ? `${PROFILE_BASE_MESSAGE}: add ${formatList(missingRecommended.slice(0, 4))}.`
      : null;

  return {
    canUseAi,
    isEmpty,
    missingCritical,
    missingRecommended,
    blockingMessage,
    profileNotice,
  };
}

export function buildAiProfileText(profile: ProfileContext): string {
  const lines: string[] = [];
  if (profile.fullName) lines.push(`Name: ${profile.fullName}`);
  if (profile.email) lines.push(`Email: ${profile.email}`);
  if (profile.headline) lines.push(`Headline: ${profile.headline}`);
  if (profile.summary) lines.push(`Summary: ${profile.summary}`);
  if (profile.location) lines.push(`Location: ${profile.location}`);
  if (profile.experienceLevel) lines.push(`Level: ${profile.experienceLevel}`);
  if (profile.workAuthorization) lines.push(`Work authorization: ${profile.workAuthorization}`);
  if (profile.preferredWorkMode) lines.push(`Preferred work mode: ${profile.preferredWorkMode}`);
  if (profile.skills.length > 0) lines.push(`Skills: ${profile.skills.join(", ")}`);
  else if (profile.skillsText?.trim()) lines.push(`Skills: ${profile.skillsText}`);

  const links = [
    profile.linkedInUrl ? `LinkedIn: ${profile.linkedInUrl}` : null,
    profile.githubUrl ? `GitHub: ${profile.githubUrl}` : null,
    profile.portfolioUrl ? `Portfolio: ${profile.portfolioUrl}` : null,
  ].filter((value): value is string => Boolean(value));
  if (links.length > 0) {
    lines.push(...links);
  }

  if (profile.experiences.length > 0) {
    lines.push("\nExperience:");
    for (const entry of profile.experiences.slice(0, 8)) {
      const headline = [entry.title, entry.company ? `at ${entry.company}` : ""]
        .filter(Boolean)
        .join(" ");
      const details = [entry.time, entry.location].filter(Boolean).join(" | ");
      lines.push(`- ${headline || "Experience entry"}`);
      if (details) lines.push(`  ${details}`);
      if (entry.description) lines.push(`  ${entry.description.slice(0, 600)}`);
    }
  }
  if (profile.experienceText?.trim()) {
    lines.push(`\nExperience details:\n${profile.experienceText.slice(0, 2500)}`);
  }

  if (profile.educations.length > 0) {
    lines.push("\nEducation:");
    for (const entry of profile.educations.slice(0, 4)) {
      const headline = [entry.degree, entry.school ? `at ${entry.school}` : ""]
        .filter(Boolean)
        .join(" ");
      const details = [entry.time, entry.location].filter(Boolean).join(" | ");
      lines.push(`- ${headline || entry.school || "Education entry"}`);
      if (details) lines.push(`  ${details}`);
      if (entry.description) lines.push(`  ${entry.description.slice(0, 500)}`);
    }
  }
  if (profile.educationText?.trim()) {
    lines.push(`\nEducation details:\n${profile.educationText.slice(0, 1600)}`);
  }

  if (profile.projects.length > 0) {
    lines.push("\nProjects:");
    for (const project of profile.projects.slice(0, 6)) {
      const headline = [project.name, project.title].filter(Boolean).join(" | ");
      const details = [project.time, project.location].filter(Boolean).join(" | ");
      lines.push(`- ${headline || "Project"}`);
      if (details) lines.push(`  ${details}`);
      if (project.description) lines.push(`  ${project.description.slice(0, 700)}`);
    }
  }
  if (profile.projectsText?.trim()) {
    lines.push(`\nProject details:\n${profile.projectsText.slice(0, 1800)}`);
  }

  return lines.join("\n");
}
