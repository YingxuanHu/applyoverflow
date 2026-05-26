/**
 * Distinguishing names for AI-generated documents.
 *
 * When the app saves a generated resume or cover letter to the user's
 * profile storage, the title is what they see in the Documents tab. The
 * title must:
 *   - Clearly mark the doc as AI-generated (so it's separable from uploads)
 *   - Encode the company + role so the user can pick the right artefact
 *     out of dozens of similar files
 *   - Stay reasonable in length so the UI doesn't blow up
 */

const MAX_SEGMENT_CHARS = 70;
const MAX_TITLE_CHARS = 180;

type AiDocumentKind = "RESUME" | "COVER_LETTER";

type Input = {
  kind: AiDocumentKind;
  company: string;
  roleTitle: string;
};

function normalizeSegment(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function softTruncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

const PREFIX: Record<AiDocumentKind, string> = {
  RESUME: "AI tailored resume",
  COVER_LETTER: "AI cover letter",
};

export function buildAiGeneratedDocumentTitle(input: Input): string {
  const prefix = PREFIX[input.kind];
  const company = softTruncate(normalizeSegment(input.company), MAX_SEGMENT_CHARS);
  const role = softTruncate(normalizeSegment(input.roleTitle), MAX_SEGMENT_CHARS);

  if (!company && !role) {
    return prefix;
  }

  if (!role) {
    return softTruncate(`${prefix} — ${company}`, MAX_TITLE_CHARS);
  }

  if (!company) {
    return softTruncate(`${prefix} — ${role}`, MAX_TITLE_CHARS);
  }

  return softTruncate(`${prefix} — ${company} · ${role}`, MAX_TITLE_CHARS);
}
