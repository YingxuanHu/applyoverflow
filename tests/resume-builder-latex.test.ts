import assert from "node:assert/strict";
import test from "node:test";

import { generateUnifiedResumeTeX } from "../src/lib/resume-generator";

test("unified resume output follows the fixed moderncv builder hierarchy", () => {
  const tex = generateUnifiedResumeTeX({
    contact: {
      name: "Taylor Applicant",
      email: "taylor@example.com",
      phone: "555 0100",
      location: "Toronto, ON",
      linkedin: "https://www.linkedin.com/in/taylor-applicant",
      github: "https://github.com/taylor-applicant",
      portfolio: "",
    },
    education: [
      {
        degree: "Bachelor of Science",
        school: "Example University",
        time: "2020 - 2024",
        location: "Toronto, ON",
        description: "",
      },
    ],
    experience: [
      {
        title: "Software Engineer",
        company: "Example Co",
        time: "2024 - Present",
        location: "Toronto, ON",
        bullets: ["Built a reliable service with measurable latency improvements."],
      },
    ],
    projects: [
      {
        title: "Job Search Platform",
        role: "Founder",
        time: "2025 - Present",
        location: "Toronto, ON",
        bullets: ["Designed a profile-backed document workflow."],
      },
    ],
    skills: ["TypeScript", "PostgreSQL"],
  });

  assert.match(tex, /\\moderncvstyle\[nosymbols\]\{banking\}/);
  assert.match(tex, /\\extrainfo\{%/);
  assert.match(tex, /\\patchcmd\{\\makehead\}/);
  assert.match(tex, /\\section\{Recent Projects\}/);
  assert.ok(tex.indexOf("\\section{Education}") < tex.indexOf("\\section{Work Experience}"));
  assert.ok(tex.indexOf("\\section{Work Experience}") < tex.indexOf("\\section{Recent Projects}"));
  assert.ok(tex.indexOf("\\section{Recent Projects}") < tex.indexOf("\\section{Skills}"));
});
