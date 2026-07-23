import { z } from "zod";

import { aiComplete } from "@/lib/ai/provider";
import { normalizeResumeBullets } from "@/lib/resume-builder";

const generatedVariationSchema = z.object({
  name: z.string().trim().min(1).max(100),
  rewrites: z
    .array(
      z.object({
        index: z.number().int().min(1).max(20),
        bullet: z.string().trim().min(1).max(1_000),
      })
    )
    .min(1)
    .max(20),
});

export type ResumeEntryRevisionRequest = {
  entryTitle: string;
  entryType: "EXPERIENCE" | "PROJECT";
  organization: string | null;
  currentBullets: string[];
  selectedBulletIndexes?: number[];
  instruction: string;
  profileContext: string;
};

const SYSTEM_PROMPT = `You revise one verified resume entry for a specific audience. Return ONLY valid JSON with exactly this shape:
{"name":"short focus label","rewrites":[{"index":1,"bullet":"rewritten bullet"}]}

Rules:
- Use only evidence in the supplied entry and profile. Never invent employers, technologies, ownership, scope, metrics, credentials, outcomes, or dates.
- Return exactly one rewrite for every requested bullet index, and do not include any other indexes.
- Preserve the factual meaning of every rewritten bullet. Make the requested emphasis clearer through wording and organization, rather than adding unrelated claims.
- Keep each rewritten bullet within roughly 20% of the original bullet's word count. Keep metrics and concrete details when supplied.
- This is not a chat response. No explanation, markdown, code fences, or extra fields.`;

function stripCodeFences(value: string) {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function parseResponse(raw: string) {
  const cleaned = stripCodeFences(raw);
  const candidates = [cleaned];
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = generatedVariationSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      // Try the next bounded JSON candidate.
    }
  }

  throw new Error("The revision could not be parsed. Please try the instruction again.");
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function capToComparableLength(rewrite: string, original: string) {
  const maxWords = Math.max(4, Math.ceil(wordCount(original) * 1.2));
  const words = rewrite.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(" ").slice(0, 1_000);
}

function selectedIndexes(input: number[] | undefined, bulletCount: number) {
  const indexes = input?.length ? input : Array.from({ length: bulletCount }, (_, index) => index);
  const uniqueIndexes = [...new Set(indexes)].sort((left, right) => left - right);
  if (uniqueIndexes.length === 0 || uniqueIndexes.some((index) => index < 0 || index >= bulletCount)) {
    throw new Error("Select one or more bullets to rewrite.");
  }
  return uniqueIndexes;
}

export function applyResumeBulletRewrites(
  currentBullets: string[],
  requestedIndexes: number[],
  rewrites: Array<{ index: number; bullet: string }>
) {
  const requested = new Set(requestedIndexes);
  const rewrittenByIndex = new Map<number, string>();

  for (const rewrite of rewrites) {
    const zeroBasedIndex = rewrite.index - 1;
    if (!requested.has(zeroBasedIndex) || rewrittenByIndex.has(zeroBasedIndex)) {
      throw new Error("The rewrite could not be matched to the selected bullets. Please try again.");
    }
    rewrittenByIndex.set(zeroBasedIndex, rewrite.bullet);
  }

  if (rewrittenByIndex.size !== requested.size) {
    throw new Error("The rewrite did not return every selected bullet. Please try again.");
  }

  return currentBullets.map((bullet, index) => {
    const rewrite = rewrittenByIndex.get(index);
    return rewrite ? capToComparableLength(rewrite, bullet) : bullet;
  });
}

export async function generateResumeEntryVariation(
  request: ResumeEntryRevisionRequest
) {
  const currentBullets = normalizeResumeBullets(request.currentBullets);
  if (currentBullets.length === 0) {
    throw new Error("Add verified bullets before requesting a focused revision.");
  }
  const rewriteIndexes = selectedIndexes(request.selectedBulletIndexes, currentBullets.length);

  const raw = await aiComplete({
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `ENTRY TYPE: ${request.entryType}\nTITLE: ${request.entryTitle}\nORGANIZATION: ${request.organization ?? ""}\n\nREQUESTED EMPHASIS:\n${request.instruction}\n\nREWRITE ONLY THESE BULLET INDEXES:\n${rewriteIndexes.map((index) => index + 1).join(", ")}\n\nCURRENT VERIFIED BULLETS:\n${currentBullets.map((bullet, index) => `${index + 1}. ${bullet}`).join("\n")}\n\nPROFILE EVIDENCE:\n${request.profileContext.slice(0, 8_000)}`,
      },
    ],
    modelFlavor: "standard",
    maxTokens: 1_000,
    temperature: 0.2,
  });

  const result = parseResponse(raw);

  return {
    name: result.name,
    bullets: applyResumeBulletRewrites(currentBullets, rewriteIndexes, result.rewrites),
  };
}
