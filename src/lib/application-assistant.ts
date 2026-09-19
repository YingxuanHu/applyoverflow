import { z } from "zod";
import type { AnswerKind } from "@/lib/application-answer-policy";
import {
  applicationContext,
  sameApplication,
} from "../../extensions/chrome/sites.mjs";
export {
  applicationContext,
  sameApplication,
} from "../../extensions/chrome/sites.mjs";

export const ANSWER_LIBRARY_KEY = "application-answer-library-v1";
export const extensionRequestSchema = z
  .object({
    clientId: z.string().regex(/^[a-p]{32}$/),
    challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    state: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
  })
  .strict();
export const exchangeSchema = z
  .object({
    clientId: extensionRequestSchema.shape.clientId,
    code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  })
  .strict();

export function allowedExtension(
  clientId: string,
  allowlist = process.env.APPLICATION_EXTENSION_IDS ?? "",
) {
  return (
    /^[a-p]{32}$/.test(clientId) &&
    allowlist
      .split(",")
      .map((id) => id.trim())
      .includes(clientId)
  );
}

export function extensionCallback(clientId: string) {
  if (!/^[a-p]{32}$/.test(clientId)) throw new Error("Invalid extension");
  return `https://${clientId}.chromiumapp.org/callback`;
}

// Tenant-scoped Greenhouse job URLs, including unambiguous hosted embed URLs.
export function greenhouseContext(raw: string) {
  const context = applicationContext(raw);
  if (context?.provider !== "greenhouse") return null;
  return {
    companyKey: context.companyKey,
    tenant: context.tenant,
    url: context.url,
  };
}

export function questionKey(label: string) {
  // Deliberately exact apart from presentation whitespace/case. No fuzzy reuse.
  return label.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function questionKind(label: string): AnswerKind {
  if (
    /disab|veteran|gender|pronoun|race|ethnic|sexual|religio|birth|social security|ssn|criminal|convict|consent|agree|certify|signature/i.test(
      label,
    )
  )
    return "sensitive";
  if (
    /authoriz|sponsor|visa|citizen|eligible to work|right to work/i.test(label)
  )
    return "work_authorization";
  if (/referr|refer you|hear about/i.test(label)) return "referral";
  if (
    /relative|family|relationship|related to|previously employed|worked (here|for)/i.test(
      label,
    )
  )
    return "company_relationship";
  return "custom";
}

export const captureSchema = z
  .object({
    url: z
      .string()
      .max(2048)
      .refine((value) => Boolean(applicationContext(value, true))),
    title: z.string().trim().min(1).max(180),
    questions: z.array(z.string().trim().min(1).max(500)).max(40),
  })
  .strict();

export const appliedConfirmationSchema = captureSchema
  .omit({ questions: true })
  .extend({
    company: z.string().trim().min(1).max(200),
    confirmed: z.literal(true),
  })
  .strict();

export const historySelectionSchema = z
  .object({
    kind: z.enum(["experience", "education"]),
    index: z.number().int().min(0).max(49),
    revision: z.string().datetime(),
  })
  .strict();

export const assistantStateSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  sourceUrl: z.string(),
  companyKey: z.string(),
  questions: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        answer: z.string().max(3000),
      }),
    )
    .max(40),
});
export type AssistantState = z.infer<typeof assistantStateSchema>;
export function parseAssistantState(value: unknown): AssistantState | null {
  const result = assistantStateSchema.safeParse(value);
  return result.success ? result.data : null;
}

export const reviewSaveSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    answers: z
      .array(
        z
          .object({
            key: z.string().max(500),
            answer: z.string().trim().max(3000),
            remember: z.boolean(),
          })
          .strict(),
      )
      .max(40),
  })
  .strict();

export const librarySchema = z
  .array(
    z.object({
      companyId: z.string(),
      companyLabel: z.string().max(200).optional(),
      questionKey: z.string(),
      questionLabel: z.string().max(500).optional(),
      answer: z.string().max(3000),
      kind: z.enum(["custom", "company_relationship", "referral"]),
      profileRevision: z.string(),
    }),
  )
  .max(60);
export type AnswerLibrary = z.infer<typeof librarySchema>;
export function parseAnswerLibrary(value?: string | null): AnswerLibrary {
  try {
    return librarySchema.parse(JSON.parse(value ?? "[]"));
  } catch {
    return [];
  }
}

export function mergeCapturedQuestions(
  previous: AssistantState | null,
  input: z.infer<typeof captureSchema>,
): AssistantState {
  const context = applicationContext(input.url, true);
  if (!context) throw new Error("Unsupported application URL");
  const existing =
    previous && sameApplication(previous.sourceUrl, context.url)
      ? previous.questions
      : [];
  const incoming = [...new Set(input.questions.map(questionKey))];
  // Preserve reviewed answers when another application step is captured.
  const questions = [...existing];
  for (const key of incoming) {
    if (!questions.some((question) => question.key === key)) {
      if (questions.length >= 40)
        throw new Error(
          "Review is full. Use the employer form for additional questions.",
        );
      questions.push({
        key,
        label: input.questions.find((label) => questionKey(label) === key)!,
        answer: "",
      });
    }
  }
  return {
    version: 1,
    revision: (previous?.revision ?? 0) + 1,
    sourceUrl: context.url,
    companyKey: context.companyKey,
    questions,
  };
}
