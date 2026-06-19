import type { GenerateCoverLetterOptions } from "./cover-letter";

const MAX_INSTRUCTION_CHARS = 2000;
const MAX_CURRENT_TEXT_CHARS = 8000;

function stringField(body: unknown, key: string) {
  if (typeof body !== "object" || body === null || !(key in body)) {
    return "";
  }

  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

export async function readCoverLetterRequestOptions(
  request: Request
): Promise<GenerateCoverLetterOptions> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return {};
  }

  const instruction =
    stringField(body, "instruction") ||
    stringField(body, "prompt") ||
    stringField(body, "changeRequest");
  const currentText = stringField(body, "currentText");

  return {
    revisionInstruction: instruction.slice(0, MAX_INSTRUCTION_CHARS),
    currentText: currentText.slice(0, MAX_CURRENT_TEXT_CHARS),
  };
}
