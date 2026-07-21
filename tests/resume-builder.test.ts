import assert from "node:assert/strict";
import test from "node:test";

import { normalizeResumeBullets, seedResumeLibraryFromProfile } from "../src/lib/resume-builder";

test("resume builder normalizes manual bullet input without retaining formatting markers", () => {
  assert.deepEqual(normalizeResumeBullets("- Improved latency\n* Built API contracts\n\n  Reviewed releases"), [
    "Improved latency",
    "Built API contracts",
    "Reviewed releases",
  ]);
});

test("resume builder seeds only the structured application-profile content", () => {
  const entries = seedResumeLibraryFromProfile({
    headline: "",
    summary: "",
    location: "",
    workAuthorization: "",
    contact: {
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phone: "",
      location: "",
      linkedInUrl: "",
      githubUrl: "",
      portfolioUrl: "",
    },
    experiences: [
      {
        title: "Software Engineer",
        company: "Analytical Engines",
        time: "2023 - Present",
        location: "Toronto",
        description: "Built internal systems.",
      },
    ],
    projects: [
      {
        name: "Compiler",
        title: "",
        time: "2022",
        location: "",
        description: "Designed a parser.",
      },
    ],
    educations: [],
    skills: [{ name: "TypeScript" }, { name: "PostgreSQL" }],
  });

  assert.deepEqual(entries.map((entry) => entry.sourceProfileKey), [
    "experience:0",
    "project:0",
    "skills:primary",
  ]);
  assert.deepEqual(entries.map((entry) => entry.type), ["EXPERIENCE", "PROJECT", "SKILL"]);
  assert.deepEqual(entries.at(-1)?.technologies, ["TypeScript", "PostgreSQL"]);
});
