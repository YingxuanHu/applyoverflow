/**
 * AI cover letter generation.
 *
 * Produces a concise, professional cover letter tailored to a specific job
 * and the user's profile. ~3 paragraphs, no filler.
 */
import { aiComplete } from "./provider";
import { buildAiProfileText } from "./profile-context";
import type { JobContext, ProfileContext } from "./job-fit";
import type { CoverLetterResult } from "./types";

export type { CoverLetterResult } from "./types";

const SYSTEM_PROMPT = `You are a professional career writer. Write a concise, targeted cover letter body for a job application.

Rules:
- 3 short paragraphs: why this role, what you bring, call to action
- No generic filler ("I am writing to apply...", "Please find attached...")
- Specific — reference the company name, role, and 1-2 concrete achievements
- Ground every claim in the user's saved profile. Do not invent experience, employers, metrics, tools, or credentials.
- Confident and direct tone
- 150–250 words total
- Do NOT include a salutation, date, address, or closing signature
- Return ONLY the cover letter body text, no JSON, no markdown`;

export async function generateCoverLetter(
  job: JobContext,
  profile: ProfileContext
): Promise<CoverLetterResult> {
  const profileText = buildAiProfileText(profile);

  const text = await aiComplete({
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Write a cover letter for this position:\n\nROLE: ${job.title} at ${job.company} (${job.location}, ${job.workMode})\n\nJOB DESCRIPTION:\n${job.description.slice(0, 2000)}\n\nYOUR PROFILE:\n${profileText}`,
      },
    ],
    modelFlavor: "standard",
    maxTokens: 512,
    temperature: 0.4,
  });

  const trimmed = text.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

  return { text: trimmed, wordCount };
}
