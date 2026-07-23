import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { applyResumeBulletRewrites } from "../src/lib/ai/resume-entry-variation";
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

test("resume builder presents explicit resume-only versions without working-copy terminology", () => {
  const component = readFileSync(
    new URL("../src/components/profile/resume-builder.tsx", import.meta.url),
    "utf8"
  );

  assert.match(component, /Version for this resume/);
  assert.match(component, /Create AI version/);
  assert.match(component, /Manage versions/);
  assert.match(component, /<AddEntryForm type=\{section\.type\} \/>/);
  assert.match(component, /Imported from profile/);
  assert.match(component, /The role details stay stable/);
  assert.match(component, /Delete this version\?/);
  assert.match(component, /Choose bullets for this resume or a targeted AI rewrite/);
  assert.doesNotMatch(component, /Current working copy/);
  assert.doesNotMatch(component, /Approved version/);
  assert.doesNotMatch(component, /Approved versions/);
});

test("selected-bullet rewrites preserve every unselected bullet in the complete new version", () => {
  assert.deepEqual(
    applyResumeBulletRewrites(
      ["Built a reliable API.", "Monitored production systems.", "Reduced latency by 20%."],
      [0, 2],
      [
        { index: 1, bullet: "Engineered a reliable API." },
        { index: 3, bullet: "Reduced API latency by 20%." },
      ]
    ),
    [
      "Engineered a reliable API.",
      "Monitored production systems.",
      "Reduced API latency by 20%.",
    ]
  );
});

test("selected-bullet rewrites keep ordering and reject incomplete AI output", () => {
  const original = [
    "Built a reliable API.",
    "Monitored production systems.",
    "Reduced latency by 20%.",
    "Documented operational runbooks.",
  ];

  assert.deepEqual(
    applyResumeBulletRewrites(
      original,
      [0, 2],
      [
        { index: 3, bullet: "Reduced service latency by 20%." },
        { index: 1, bullet: "Engineered a reliable API." },
      ]
    ),
    [
      "Engineered a reliable API.",
      "Monitored production systems.",
      "Reduced service latency by 20%.",
      "Documented operational runbooks.",
    ]
  );

  assert.throws(
    () => applyResumeBulletRewrites(original, [0, 2], [{ index: 1, bullet: "Engineered a reliable API." }]),
    /did not return every selected bullet/
  );
});
