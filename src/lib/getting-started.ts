import { z } from "zod";

export const GETTING_STARTED_KEY = "getting-started-v1";
export const GUIDE_STEP_COUNT = 5;
export const guideStateSchema = z.object({
  version: z.literal(1),
  status: z.enum(["new", "deferred", "complete"]),
  step: z.number().int().min(0).max(GUIDE_STEP_COUNT - 1),
}).strict();
export type GuideState = z.infer<typeof guideStateSchema>;
export type GuideSnapshot = { accountId: string; state: GuideState };
export const INITIAL_GUIDE: GuideState = { version: 1, status: "new", step: 0 };

export function parseGuideState(value?: string | null): GuideState {
  try {
    const parsed = guideStateSchema.safeParse(JSON.parse(value ?? "null"));
    if (parsed.success) return parsed.data;
  } catch { /* A missing or old preference must not interrupt existing users. */ }
  return { version: 1, status: "deferred", step: 0 };
}

export const saveGuideSchema = z.object({
  accountId: z.string().min(1).max(200),
  step: guideStateSchema.shape.step,
  status: z.enum(["deferred", "complete"]),
}).strict();
