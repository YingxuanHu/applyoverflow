import { describe, it } from "node:test";
import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";

import {
  AI_LABEL_MAX_CONFIDENCE,
  AI_LABEL_MIN_CONFIDENCE,
  aiRoleLabelStatus,
  clampAiLabelConfidence,
  shouldPersistAiCareerStage,
  shouldPersistAiRoleLabel,
} from "@/lib/ingestion/ai-label-policy";

describe("shouldPersistAiRoleLabel", () => {
  it("persists a real category at or above the default threshold", () => {
    const decision = shouldPersistAiRoleLabel({
      category: "SOFTWARE_ENGINEERING",
      confidence: 0.75,
    });
    deepStrictEqual(decision, { persist: true, confidence: 0.75 });
  });

  it("caps persisted confidence at AI_LABEL_MAX_CONFIDENCE", () => {
    const decision = shouldPersistAiRoleLabel({
      category: "DATA_ANALYTICS",
      confidence: 0.97,
    });
    ok(decision.persist);
    strictEqual(decision.confidence, AI_LABEL_MAX_CONFIDENCE);
  });

  it("skips categories below the default threshold as low confidence", () => {
    const decision = shouldPersistAiRoleLabel({
      category: "MARKETING",
      confidence: AI_LABEL_MIN_CONFIDENCE - 0.01,
    });
    deepStrictEqual(decision, { persist: false, reason: "low_confidence" });
  });

  it("never persists OTHER_UNKNOWN, even at high confidence", () => {
    const decision = shouldPersistAiRoleLabel({
      category: "OTHER_UNKNOWN",
      confidence: 0.95,
    });
    deepStrictEqual(decision, { persist: false, reason: "unknown_category" });
  });

  it("respects a --min-role-confidence override", () => {
    const rejected = shouldPersistAiRoleLabel({
      category: "SALES",
      confidence: 0.65,
      minConfidence: 0.7,
    });
    deepStrictEqual(rejected, { persist: false, reason: "low_confidence" });

    const accepted = shouldPersistAiRoleLabel({
      category: "SALES",
      confidence: 0.65,
    });
    ok(accepted.persist);
  });

  it("rejects non-finite confidences", () => {
    const decision = shouldPersistAiRoleLabel({
      category: "SOFTWARE_ENGINEERING",
      confidence: Number.NaN,
    });
    deepStrictEqual(decision, { persist: false, reason: "invalid_confidence" });
  });
});

describe("shouldPersistAiCareerStage", () => {
  it("persists a stage when no existing label is present", () => {
    const decision = shouldPersistAiCareerStage({
      careerStage: "SENIOR_LEAD_STAFF",
      confidence: 0.8,
      existingStage: null,
      existingConfidence: null,
    });
    deepStrictEqual(decision, { persist: true, confidence: 0.8 });
  });

  it("never persists UNKNOWN", () => {
    const decision = shouldPersistAiCareerStage({
      careerStage: "UNKNOWN",
      confidence: 0.95,
    });
    deepStrictEqual(decision, { persist: false, reason: "unknown_stage" });
  });

  it("skips stages below the threshold as low confidence", () => {
    const decision = shouldPersistAiCareerStage({
      careerStage: "MID_EXPERIENCED",
      confidence: 0.5,
    });
    deepStrictEqual(decision, { persist: false, reason: "low_confidence" });
  });

  it("never downgrades an existing label with equal or higher confidence", () => {
    const stronger = shouldPersistAiCareerStage({
      careerStage: "SENIOR_LEAD_STAFF",
      confidence: 0.75,
      existingStage: "SENIOR",
      existingConfidence: 0.8,
    });
    deepStrictEqual(stronger, { persist: false, reason: "existing_label_is_stronger" });

    const equal = shouldPersistAiCareerStage({
      careerStage: "SENIOR_LEAD_STAFF",
      confidence: 0.7,
      existingStage: "SENIOR",
      existingConfidence: 0.7,
    });
    deepStrictEqual(equal, { persist: false, reason: "existing_label_is_stronger" });
  });

  it("compares the never-downgrade rule against the capped confidence", () => {
    // Model reports 0.98 but only 0.9 would be written; an existing 0.92
    // label is stronger than what we would persist, so it must be kept.
    const decision = shouldPersistAiCareerStage({
      careerStage: "MANAGER_DIRECTOR_EXECUTIVE",
      confidence: 0.98,
      existingStage: "MANAGER",
      existingConfidence: 0.92,
    });
    deepStrictEqual(decision, { persist: false, reason: "existing_label_is_stronger" });
  });

  it("overwrites an existing label with strictly lower confidence", () => {
    const decision = shouldPersistAiCareerStage({
      careerStage: "ENTRY_JUNIOR",
      confidence: 0.72,
      existingStage: "MID_LEVEL",
      existingConfidence: 0.5,
    });
    deepStrictEqual(decision, { persist: true, confidence: 0.72 });
  });

  it("treats an existing UNKNOWN label as absent", () => {
    const decision = shouldPersistAiCareerStage({
      careerStage: "STUDENT_INTERN",
      confidence: 0.7,
      existingStage: "UNKNOWN",
      existingConfidence: 0.9,
    });
    deepStrictEqual(decision, { persist: true, confidence: 0.7 });
  });

  it("allows overwriting an existing label with no recorded confidence", () => {
    const decision = shouldPersistAiCareerStage({
      careerStage: "MID_EXPERIENCED",
      confidence: 0.65,
      existingStage: "MID_LEVEL",
      existingConfidence: null,
    });
    deepStrictEqual(decision, { persist: true, confidence: 0.65 });
  });

  it("rejects non-finite confidences", () => {
    const decision = shouldPersistAiCareerStage({
      careerStage: "MID_EXPERIENCED",
      confidence: Number.POSITIVE_INFINITY / Number.POSITIVE_INFINITY,
    });
    deepStrictEqual(decision, { persist: false, reason: "invalid_confidence" });
  });
});

describe("confidence helpers", () => {
  it("clamps confidences into [0, AI_LABEL_MAX_CONFIDENCE]", () => {
    strictEqual(clampAiLabelConfidence(1.2), AI_LABEL_MAX_CONFIDENCE);
    strictEqual(clampAiLabelConfidence(-0.3), 0);
    strictEqual(clampAiLabelConfidence(0.66), 0.66);
    strictEqual(clampAiLabelConfidence(Number.NaN), 0);
  });

  it("mirrors the deterministic status thresholds for role labels", () => {
    strictEqual(aiRoleLabelStatus(0.9), "verified");
    strictEqual(aiRoleLabelStatus(0.8), "confident");
    strictEqual(aiRoleLabelStatus(0.6), "usable_review");
    strictEqual(aiRoleLabelStatus(0.5), "ambiguous");
    strictEqual(aiRoleLabelStatus(0.2), "unknown");
  });
});
