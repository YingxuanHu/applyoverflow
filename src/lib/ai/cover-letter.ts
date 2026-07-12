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
import { ensureCoverLetterFormat } from "./cover-letter-format";
import { getCoverLetterJobContextIssue } from "./cover-letter-readiness";

export type { CoverLetterResult } from "./types";

export type GenerateCoverLetterOptions = {
  revisionInstruction?: string;
  currentText?: string;
};

const SYSTEM_PROMPT = `You are a professional career writer. Write a concise, targeted cover letter for a job application.

Rules:
- 3 to 4 compact paragraphs: why this role, what you bring, relevant evidence, call to action
- No generic filler ("I am writing to apply...", "Please find attached...")
- Specific — reference the company name, role, job responsibilities, and 2-3 concrete achievements when the profile supports them
- Ground every claim in the user's saved profile. Do not invent experience, employers, metrics, tools, or credentials.
- Confident and direct tone
- 220–360 words total after the app adds salutation and signature
- Do not write the salutation, closing, or signature. The app will add: Hi [name], and Sincerely, plus the user's full name.
- Do NOT include a date, mailing address, JSON, markdown, or code fences
- Return ONLY the cover letter text, no JSON, no markdown`;

export async function generateCoverLetter(
  job: JobContext,
  profile: ProfileContext,
  options: GenerateCoverLetterOptions = {}
): Promise<CoverLetterResult> {
  const jobIssue = getCoverLetterJobContextIssue(job);
  if (jobIssue) {
    throw new Error(jobIssue);
  }

  const profileText = buildAiProfileText(profile);
  const revisionInstruction = options.revisionInstruction?.trim();
  const currentText = options.currentText?.trim();
  const userContent =
    revisionInstruction && currentText
      ? `Revise this cover letter for the requested change while preserving accurate facts and the required format.

REQUESTED CHANGE:
${revisionInstruction}

CURRENT COVER LETTER:
${currentText}

ROLE: ${job.title} at ${job.company} (${job.location}, ${job.workMode})

JOB DESCRIPTION:
${job.description.slice(0, 2000)}

YOUR PROFILE:
${profileText}`
      : `Write a cover letter for this position.${
          revisionInstruction ? `\n\nAdditional user direction: ${revisionInstruction}` : ""
        }

ROLE: ${job.title} at ${job.company} (${job.location}, ${job.workMode})

JOB DESCRIPTION:
${job.description.slice(0, 2000)}

YOUR PROFILE:
${profileText}`;

  const text = await aiComplete({
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
    modelFlavor: "standard",
    maxTokens: 800,
    temperature: 0.4,
  });

  const trimmed = ensureCoverLetterFormat(text, profile);
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

  return { text: trimmed, wordCount };
}
