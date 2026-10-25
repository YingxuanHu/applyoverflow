import "server-only";
import { NextResponse } from "next/server";

import { parseResume, validateInput, LIMITS, ResumeParserError } from "../../scripts/resume-parser/runtime.cjs";

export { LIMITS as RESUME_PARSER_LIMITS, ResumeParserError };

export function resumeParserErrorResponse(error: unknown) {
  if (!(error instanceof ResumeParserError)) return null;

  const headers = new Headers({ "Cache-Control": "no-store" });
  if (error.status === 503) {
    headers.set("Retry-After", String(Math.ceil(LIMITS.deadlineMs / 1000)));
  }
  return NextResponse.json(
    { error: error.message, code: error.code, retryable: error.retryable },
    { status: error.status, headers },
  );
}

export function validateResumeFile(buffer: Buffer, fileName: string, mimeType: string) {
  return validateInput(buffer, fileName, mimeType) as { kind: string; mimeType: string };
}

export async function parseResumeFile(input: {
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  preview: boolean;
  signal?: AbortSignal;
}): Promise<{ text: string; previews: string[]; pages: number; kind: string; mimeType: string }> {
  return parseResume(input.fileBuffer, input.fileName, input.mimeType, {
    preview: input.preview,
    signal: input.signal,
  });
}
