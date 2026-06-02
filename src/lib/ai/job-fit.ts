/**
 * AI-powered job fit analysis.
 *
 * Given a job and a user profile, returns a structured fit assessment:
 * score, matching skills, gaps, strengths, and a brief narrative.
 */
import { aiComplete } from "./provider";
import { buildAiProfileText } from "./profile-context";
import type { FitAnalysis } from "./types";

export type JobContext = {
  title: string;
  company: string;
  location: string;
  workMode: string;
  experienceLevel: string | null;
  roleFamily: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  description: string;
};

export type ProfileContext = {
  headline: string | null;
  summary: string | null;
  fullName: string | null;
  email: string | null;
  location: string | null;
  linkedInUrl: string | null;
  githubUrl: string | null;
  portfolioUrl: string | null;
  skills: string[];
  skillsText: string | null;
  experienceLevel: string | null;
  experiences: Array<{
    title: string;
    time: string;
    company: string;
    location: string;
    description: string;
  }>;
  experienceText: string | null;
  educations: Array<{
    school: string;
    degree: string;
    time: string;
    location: string;
    description: string;
  }>;
  educationText: string | null;
  projects: Array<{
    name: string;
    title: string;
    time: string;
    location: string;
    description: string;
  }>;
  projectsText: string | null;
  workAuthorization: string | null;
  preferredWorkMode: string | null;
  selectedResume: {
    title: string;
    originalFileName: string;
    extractedText: string | null;
  } | null;
};

export type { FitAnalysis } from "./types";

const SYSTEM_PROMPT = `You are a career advisor and expert recruiter analyzing job-profile fit. Return ONLY valid JSON.

Analyze how well the user's profile matches the job, considering:
- Skills alignment (required vs. possessed)
- Experience level match
- Role family / function match
- Work mode preferences
- Any clear blockers or standout strengths
- The full saved profile context, including headline, summary, skills, experience, education, projects, links, and profile details

Return this exact JSON shape:
{
  "score": number (1-10, be realistic not generous),
  "tier": "strong" | "good" | "moderate" | "weak",
  "summary": "2-3 sentence narrative explaining the fit",
  "strengths": ["bullet 1", "bullet 2", ...],
  "gaps": ["gap 1", "gap 2", ...],
  "keywords": ["keyword1", "keyword2", ...]
}

Scoring guide: 8-10 = strong match, 6-7 = good fit, 4-5 = moderate, 1-3 = weak.
Be specific and actionable. Max 4 items per array.
Write all visible explanation text in second person. Use "you" and "your", never "the candidate".
Treat the saved profile as the primary evidence for fit. Do not over-index on any single resume or document. If profile evidence is thin, say that the profile should be completed for a more reliable analysis.`;

export async function analyzeJobFit(
  job: JobContext,
  profile: ProfileContext
): Promise<FitAnalysis> {
  const profileText = buildAiProfileText(profile);
  const jobText = buildJobText(job);

  const raw = await aiComplete({
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `JOB:\n${jobText}\n\nYOUR PROFILE:\n${profileText}`,
      },
    ],
    modelFlavor: "standard",
    maxTokens: 1024,
    temperature: 0,
  });

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`AI returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  return normalizeFit(parsed);
}

function buildJobText(job: JobContext): string {
  const lines = [
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location} (${job.workMode})`,
    `Role family: ${job.roleFamily}`,
  ];
  if (job.experienceLevel) lines.push(`Experience level: ${job.experienceLevel}`);
  if (job.salaryMin || job.salaryMax) {
    const range = [job.salaryMin, job.salaryMax].filter(Boolean).join("–");
    lines.push(`Salary: ${range} ${job.salaryCurrency ?? "USD"}`);
  }
  lines.push(`\nDescription:\n${job.description.slice(0, 3000)}`);
  return lines.join("\n");
}

function normalizeFit(data: unknown): FitAnalysis {
  if (typeof data !== "object" || data === null) {
    throw new Error("Invalid AI response shape");
  }
  const d = data as Record<string, unknown>;
  const score = typeof d.score === "number" ? Math.min(10, Math.max(1, Math.round(d.score))) : 5;
  const tier = ["strong", "good", "moderate", "weak"].includes(d.tier as string)
    ? (d.tier as FitAnalysis["tier"])
    : scoreTier(score);

  return {
    score,
    tier,
    summary: typeof d.summary === "string" ? d.summary : "Analysis unavailable.",
    strengths: strArr(d.strengths),
    gaps: strArr(d.gaps),
    keywords: strArr(d.keywords),
  };
}

function scoreTier(score: number): FitAnalysis["tier"] {
  if (score >= 8) return "strong";
  if (score >= 6) return "good";
  if (score >= 4) return "moderate";
  return "weak";
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((s): s is string => typeof s === "string");
}
