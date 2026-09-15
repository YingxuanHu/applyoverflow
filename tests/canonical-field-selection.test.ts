import assert from "node:assert/strict";
import test from "node:test";
import { shouldUseIncomingExtractedValue } from "../src/lib/ingestion/canonical-field-selection";

test("structured field evidence can replace weaker description inference", () => {
  assert.equal(shouldUseIncomingExtractedValue({
    preferIncomingSource: false,
    currentConfidence: 0.6294,
    currentSource: "description_text",
    nextConfidence: 0.853,
    nextSource: "connector_raw",
    nextValueIsKnown: true,
  }), true);
});

test("secondary evidence cannot replace a stronger structured field", () => {
  assert.equal(shouldUseIncomingExtractedValue({
    preferIncomingSource: false,
    currentConfidence: 0.95,
    currentSource: "ats_api",
    nextConfidence: 0.98,
    nextSource: "connector_raw",
    nextValueIsKnown: true,
  }), false);
  assert.equal(shouldUseIncomingExtractedValue({
    preferIncomingSource: true,
    currentConfidence: 0.4,
    currentSource: "description_text",
    nextConfidence: 0.2,
    nextSource: "fallback",
    nextValueIsKnown: false,
  }), false);
});

test("primary refresh cannot undo structured repairs using weaker text inference", () => {
  assert.equal(shouldUseIncomingExtractedValue({
    preferIncomingSource: true,
    currentConfidence: 0.853,
    currentSource: "connector_raw",
    nextConfidence: 0.6294,
    nextSource: "description_text",
    nextValueIsKnown: true,
  }), false);
});
