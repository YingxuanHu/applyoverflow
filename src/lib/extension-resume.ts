import { z } from "zod";
import {
  captureSchema,
  exchangeSchema,
  extensionRequestSchema,
} from "@/lib/application-assistant";

export const EXTENSION_RESUME_MAX_BYTES = 5 * 1024 * 1024;
export const EXTENSION_RESUME_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const resumeRequestSchema = z
  .object({
    url: captureSchema.shape.url,
    challenge: extensionRequestSchema.shape.challenge,
    state: extensionRequestSchema.shape.state,
  })
  .strict();
export const resumeExchangeSchema = z
  .object({
    id: z.string().cuid(),
    code: exchangeSchema.shape.code,
    verifier: exchangeSchema.shape.verifier,
    url: captureSchema.shape.url,
  })
  .strict();
export const resumeApprovalSchema = z
  .object({
    id: z.string().cuid(),
    documentId: z.string().cuid(),
  })
  .strict();

export function canShareExtensionResume(document: {
  type: string;
  mimeType: string;
  sizeBytes: number;
  originalFileName: string;
}) {
  return (
    document.type === "RESUME" &&
    document.sizeBytes > 0 &&
    document.sizeBytes <= EXTENSION_RESUME_MAX_BYTES &&
    ((document.mimeType === EXTENSION_RESUME_MIME_TYPES[0] &&
      /\.pdf$/i.test(document.originalFileName)) ||
      (document.mimeType === EXTENSION_RESUME_MIME_TYPES[1] &&
        /\.docx$/i.test(document.originalFileName)))
  );
}

export function resumeTransferFilename(name: string, mimeType: string) {
  const extension =
    mimeType === EXTENSION_RESUME_MIME_TYPES[0] ? ".pdf" : ".docx";
  const base = name
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9 _.-]/g, "_")
    .slice(0, 120)
    .trim();
  return `${base || "resume"}${extension}`;
}
