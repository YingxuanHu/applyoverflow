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

export const COVER_LETTER_SYSTEM_PROMPT = `You are a professional career writer. Write a concise, targeted cover letter that makes a persuasive case for this specific application.

Rules:
- Treat the resume and profile as an evidence bank, not an outline. Never paraphrase their experience section or turn resume bullets into prose.
- Build the letter around one clear, role-specific thesis: identify the employer's likely need from the job description, explain the candidate's relevant point of view, then show how they would contribute.
- Use 1 or 2 high-value pieces of evidence at most. Prefer a meaningful decision, outcome, pattern of judgment, project, education, or career theme over a chronological job-history recap or a list of tools.
- The opening must begin with a substantive observation about the role or company need, not with the fact that the candidate is applying. Only make company-specific claims supported by the supplied job description.
- Make the final paragraph forward-looking: connect the candidate's demonstrated approach to the work they could help the team accomplish. Do not invent personal motivations, company facts, or future plans.
- 3 compact paragraphs: role thesis, evidence and transferable judgment, forward-looking contribution and call to action.
- No generic filler ("I am writing to apply...", "Please find attached..."), cliches, skill inventories, or repeated metrics.
- Ground every claim in the user's saved profile. Do not invent experience, employers, metrics, tools, credentials, company facts, or role responsibilities.
- Confident, specific, human tone. It should add context and judgment beyond what a recruiter can already scan on the resume.
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
    system: COVER_LETTER_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
    modelFlavor: "reasoning",
    maxTokens: 800,
    temperature: 0.4,
  });

  const trimmed = ensureCoverLetterFormat(text, profile);
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;

  return { text: trimmed, wordCount };
}
