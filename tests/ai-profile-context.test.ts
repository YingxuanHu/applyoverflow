import assert from "node:assert/strict";
import test from "node:test";

import { assessProfileForAi } from "../src/lib/ai/profile-context";
import type { ProfileContext } from "../src/lib/ai/job-fit";

function makeProfile(overrides: Partial<ProfileContext> = {}): ProfileContext {
  return {
    headline: null,
    summary: null,
    fullName: null,
    email: null,
    location: null,
    linkedInUrl: null,
    githubUrl: null,
    portfolioUrl: null,
    skills: [],
    skillsText: null,
    experienceLevel: null,
    experiences: [],
    experienceText: null,
    educations: [],
    educationText: null,
    projects: [],
    projectsText: null,
    workAuthorization: null,
    preferredWorkMode: null,
    selectedResume: null,
    ...overrides,
  };
}

test("profile readiness blocks an empty profile", () => {
  const readiness = assessProfileForAi(makeProfile());

  assert.equal(readiness.canUseAi, false);
  assert.match(readiness.blockingMessage ?? "", /headline or summary/);
  assert.match(readiness.blockingMessage ?? "", /skills/);
});

test("profile readiness allows usable profile and returns improvement notice", () => {
  const readiness = assessProfileForAi(
    makeProfile({
      headline: "Software engineer",
      summary: "New grad focused on backend and data systems.",
      skills: ["TypeScript", "Python", "SQL"],
      experiences: [
        {
          title: "Software Engineer Intern",
          company: "Example Co",
          time: "2025",
          location: "Toronto",
          description: "Built APIs and automated data workflows.",
        },
      ],
    })
  );

  assert.equal(readiness.canUseAi, true);
  assert.match(readiness.profileNotice ?? "", /Complete your profile/);
});

test("profile readiness has no notice for a well-rounded profile", () => {
  const readiness = assessProfileForAi(
    makeProfile({
      headline: "Software engineer",
      summary: "Backend engineer with applied ML project experience.",
      fullName: "Alvin Hu",
      email: "alvin@example.com",
      location: "Toronto, ON",
      linkedInUrl: "https://linkedin.com/in/example",
      workAuthorization: "Canadian PR",
      skills: ["TypeScript", "Python", "SQL"],
      experiences: [
        {
          title: "Software Engineer Intern",
          company: "Example Co",
          time: "2025",
          location: "Toronto",
          description: "Built APIs and automated data workflows.",
        },
      ],
      projects: [
        {
          name: "Job matching system",
          title: "Creator",
          time: "2026",
          location: "Toronto",
          description: "Built ranking and search features.",
        },
      ],
    })
  );

  assert.equal(readiness.canUseAi, true);
  assert.equal(readiness.profileNotice, null);
});
