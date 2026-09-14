import { mkdir, writeFile } from "node:fs/promises";
import { generateResumeTeX, generateUnifiedResumeTeX, type TailoredResume } from "../src/lib/resume-generator";

const resume: TailoredResume = {
  contact: { name: "Taylor Applicant", email: "taylor@example.com", phone: "555 0100", location: "Toronto, ON", linkedin: "https://linkedin.com/in/taylor", github: "https://github.com/taylor", portfolio: "https://example.com" },
  summary: "Software engineer building reliable services and accessible interfaces.",
  skills: ["TypeScript", "PostgreSQL", "Testing & observability"],
  experience: [{ title: "Software Engineer", company: "Example Co", time: "2024 - Present", location: "Toronto, ON", bullets: ["Reduced request latency by 25%.", "Built reliable services for 10,000 users."] }],
  education: [{ degree: "Bachelor of Science", school: "Example University", time: "2020 - 2024", location: "Toronto, ON", description: "Computer Science" }],
  projects: [{ name: "Search Platform", time: "2025", bullets: ["Delivered a searchable, accessible job board."] }],
};

async function main() {
  const directory = process.argv[2] ?? "output/pdf-smoke";
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/fixtures.json`, JSON.stringify({
    tailored: generateResumeTeX(resume),
    builder: generateUnifiedResumeTeX({ ...resume, projects: [{ title: "Search Platform", role: "Engineer", time: "2025", location: "Toronto, ON", bullets: resume.projects[0].bullets }] }),
  }));
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
