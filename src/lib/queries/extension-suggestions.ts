import "server-only";
import { ZodError } from "zod";
import { prisma } from "@/lib/db";
import { aiComplete } from "@/lib/ai/provider";
import { buildProfileFormValues } from "@/lib/profile";
import { AssistantError } from "@/lib/queries/application-assistant";
import { questionAssistance, suggestionEvidence, suggestionRequestSchema } from "@/lib/extension-suggestions";
import { generateApplicationAnswer } from "@/lib/application-answer-generation";

export async function suggestApplicationAnswer(userId: string, raw: unknown) {
  const input = suggestionRequestSchema.parse(raw);
  const kind = questionAssistance(input.label);
  if (kind === "personal") throw new AssistantError("This answer needs your decision. Choose it on the form or enter it in the assistant.");
  if (kind === "context" && !input.note && /part[ -]?time|career (?:break|change)|leaving|leave your/i.test(input.label))
    throw new AssistantError("Your profile does not explain this personal circumstance. Answer it on the form.");
  const profile = await prisma.userProfile.findUnique({ where: { authUserId: userId } });
  if (!profile || profile.updatedAt.toISOString() !== input.revision)
    throw new AssistantError("Your profile changed. Click Autofill again to use the latest details.", 409);
  const evidence = suggestionEvidence(buildProfileFormValues(profile), input.note, input.label);
  if (!evidence.length && kind !== "knowledge") throw new AssistantError("Add experience or a professional summary to Profile, or provide a short note here.");
  let suggestion;
  const generationDeadline = AbortSignal.timeout(26_000);
  try {
    suggestion = await generateApplicationAnswer(input, evidence, aiComplete, { signal: generationDeadline, budgetSubject: userId });
  } catch (error) {
    console.warn("[extension-suggestion] Draft failed", error instanceof ZodError
      ? error.issues.slice(0, 5).map(issue => `${issue.path.join(".")}:${issue.code}`).join(",")
      : error instanceof Error && ["Draft evidence could not be verified.", "Draft exceeds the employer's answer limit.", "Draft does not match an available answer choice."].includes(error.message)
        ? error.message : error instanceof Error ? error.name : "UnknownError");
    throw new AssistantError("Could not prepare a supported draft. Your form is unchanged; try again or write your answer.", 502);
  }
  const latest = await prisma.userProfile.findUnique({ where: { id: profile.id }, select: { updatedAt: true } });
  if (latest?.updatedAt.toISOString() !== input.revision)
    throw new AssistantError("Your profile changed while drafting. Autofill again before trying a new draft.", 409);
  return { suggestion };
}
