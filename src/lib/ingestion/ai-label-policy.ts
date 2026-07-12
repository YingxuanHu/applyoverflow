/**
 * Pure persist-decision policy for the AI label-fallback pass
 * (scripts/backfill-labels-ai.ts).
 *
 * The cheap-LLM fallback classifies role category and career stage for jobs
 * that lack filter-grade labels. These helpers decide whether a model
 * classification is trustworthy enough to persist. They deliberately touch
 * neither the database nor the OpenAI client so they can be unit-tested in
 * isolation (tests/ai-label-policy.test.ts).
 */

export const AI_LABEL_SOURCE = "ai-fallback";

/** Minimum model confidence required before an AI label is persisted. */
export const AI_LABEL_MIN_CONFIDENCE = 0.6;

/**
 * AI-fallback labels are never written with a confidence above this cap so a
 * cheap-model guess stays below fully verified deterministic evidence and can
 * always be superseded later.
 */
export const AI_LABEL_MAX_CONFIDENCE = 0.9;

export type AiRoleLabelSkipReason =
  | "invalid_confidence"
  | "low_confidence"
  | "unknown_category";

export type AiCareerStageSkipReason =
  | "invalid_confidence"
  | "low_confidence"
  | "unknown_stage"
  | "existing_label_is_stronger";

export type AiLabelDecision<SkipReason extends string> =
  | { persist: true; confidence: number }
  | { persist: false; reason: SkipReason };

/** Clamp a model confidence into the persistable range [0, AI_LABEL_MAX_CONFIDENCE]. */
export function clampAiLabelConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(AI_LABEL_MAX_CONFIDENCE, value));
}

/**
 * Status string for an AI-assigned role label, mirroring the confidence
 * thresholds used by the deterministic job-function extractor.
 */
export function aiRoleLabelStatus(
  confidence: number
): "verified" | "confident" | "usable_review" | "ambiguous" | "unknown" {
  if (confidence >= 0.85) return "verified";
  if (confidence >= 0.75) return "confident";
  if (confidence >= 0.6) return "usable_review";
  if (confidence >= 0.45) return "ambiguous";
  return "unknown";
}

/**
 * Decide whether an AI role-category classification should be persisted.
 *
 * Persist only when the category is a real category (not OTHER_UNKNOWN) and
 * the model confidence clears the threshold. The returned confidence is the
 * value to write: min(model confidence, AI_LABEL_MAX_CONFIDENCE).
 */
export function shouldPersistAiRoleLabel(input: {
  category: string;
  confidence: number;
  minConfidence?: number;
}): AiLabelDecision<AiRoleLabelSkipReason> {
  const minConfidence = input.minConfidence ?? AI_LABEL_MIN_CONFIDENCE;
  if (!Number.isFinite(input.confidence)) {
    return { persist: false, reason: "invalid_confidence" };
  }
  if (input.category === "OTHER_UNKNOWN") {
    return { persist: false, reason: "unknown_category" };
  }
  if (input.confidence < minConfidence) {
    return { persist: false, reason: "low_confidence" };
  }
  return { persist: true, confidence: clampAiLabelConfidence(input.confidence) };
}

/**
 * Decide whether an AI career-stage classification should be persisted.
 *
 * Same thresholds as role labels, plus a never-downgrade rule: an existing
 * career-stage label (non-null, non-UNKNOWN) whose recorded confidence is
 * already >= the capped new confidence must be left untouched.
 */
export function shouldPersistAiCareerStage(input: {
  careerStage: string;
  confidence: number;
  existingStage?: string | null;
  existingConfidence?: number | null;
  minConfidence?: number;
}): AiLabelDecision<AiCareerStageSkipReason> {
  const minConfidence = input.minConfidence ?? AI_LABEL_MIN_CONFIDENCE;
  if (!Number.isFinite(input.confidence)) {
    return { persist: false, reason: "invalid_confidence" };
  }
  if (input.careerStage === "UNKNOWN") {
    return { persist: false, reason: "unknown_stage" };
  }
  if (input.confidence < minConfidence) {
    return { persist: false, reason: "low_confidence" };
  }

  const confidence = clampAiLabelConfidence(input.confidence);
  const hasExistingLabel =
    input.existingStage != null &&
    input.existingStage !== "" &&
    input.existingStage !== "UNKNOWN";
  if (
    hasExistingLabel &&
    typeof input.existingConfidence === "number" &&
    Number.isFinite(input.existingConfidence) &&
    input.existingConfidence >= confidence
  ) {
    return { persist: false, reason: "existing_label_is_stronger" };
  }

  return { persist: true, confidence };
}
