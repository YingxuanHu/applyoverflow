import type { ProfileContext } from "./job-fit";

const SALUTATION = "Hi [name],";
const CLOSING = "Sincerely,";

function clean(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function stripCodeFence(text: string) {
  return text
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function stripLeadingSalutation(text: string) {
  return text.replace(/^(?:dear|hello|hi)\s+[^\n]{0,100},\s*/i, "").trim();
}

function stripTrailingSignature(text: string) {
  return text
    .replace(
      /\n+(?:sincerely|best regards|kind regards|regards|thank you),?\s*\n+[\s\S]{0,260}$/i,
      ""
    )
    .trim();
}

export function buildCoverLetterSignature(profile: Pick<ProfileContext, "fullName">) {
  return `${CLOSING}\n${clean(profile.fullName) || "Your Name"}`;
}

export function ensureCoverLetterFormat(text: string, profile: Pick<ProfileContext, "fullName">) {
  const body = stripTrailingSignature(stripLeadingSalutation(stripCodeFence(text)));
  const safeBody =
    body ||
    "I am excited about this opportunity and would welcome the chance to discuss how my background can support the team.";

  return `${SALUTATION}\n\n${safeBody}\n\n${buildCoverLetterSignature(profile)}`;
}
