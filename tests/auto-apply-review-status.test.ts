import assert from "node:assert/strict";
import test from "node:test";

import { buildAutoApplyReviewSummary } from "../src/lib/automation/review";
import type { ATSFillerResult } from "../src/lib/automation/types";

function makeResult(overrides: Partial<ATSFillerResult> = {}): ATSFillerResult {
  return {
    status: "filled",
    atsName: "Ashby",
    filledFields: [],
    unfillableFields: [],
    blockers: [],
    screenshots: [],
    submittedAt: null,
    notes: "test",
    durationMs: 10,
    ...overrides,
  };
}

test("required custom Ashby questions block auto-submit until explicitly answered", () => {
  const review = buildAutoApplyReviewSummary({
    atsName: "Ashby",
    result: makeResult({
      filledFields: [
        {
          label: "Email",
          selector: "#email",
          value: "candidate@example.com",
          required: true,
          fieldType: "email",
          sourcePlatform: "Ashby",
          confidence: "high",
        },
      ],
      unfillableFields: [
        {
          label: "How did you hear about Notable?",
          selector: "select[name=\"source\"]",
          reason: "Unknown required question; user input required",
          required: true,
          fieldType: "select",
          options: ["LinkedIn", "Referral", "Other"],
          sourcePlatform: "Ashby",
          confidence: "low",
          custom: true,
          reviewRequired: true,
        },
      ],
    }),
  });

  assert.equal(review.status, "NEEDS_EXTRA_ANSWERS");
  assert.equal(review.statusLabel, "Needs Info");
  assert.equal(review.canSubmit, false);
  assert.equal(review.missingRequiredFields.length, 1);
  assert.equal(review.missingRequiredFields[0]?.fieldType, "select");
  assert.deepEqual(review.missingRequiredFields[0]?.options, [
    "LinkedIn",
    "Referral",
    "Other",
  ]);
});

test("optional sensitive demographic questions are visible but skippable after review", () => {
  const review = buildAutoApplyReviewSummary({
    atsName: "Ashby",
    result: makeResult({
      filledFields: [
        {
          label: "Full name",
          selector: "#name",
          value: "Yingxuan Hu",
          required: true,
          fieldType: "text",
          sourcePlatform: "Ashby",
          confidence: "high",
        },
      ],
      unfillableFields: [
        {
          label: "Voluntary gender identity",
          selector: "radio:gender",
          reason: "Optional custom question skipped unless you answer it",
          required: false,
          fieldType: "radio",
          options: ["Woman", "Man", "Decline to self-identify"],
          sourcePlatform: "Ashby",
          confidence: "low",
          sensitive: true,
          custom: true,
          reviewRequired: true,
        },
      ],
    }),
  });

  assert.equal(review.status, "NEEDS_USER_REVIEW");
  assert.equal(review.statusLabel, "Auto Apply");
  assert.equal(review.canSubmit, true);
  assert.equal(review.missingRequiredFields.length, 0);
  assert.equal(review.fields[1]?.sensitive, true);
  assert.equal(review.fields[1]?.value, null);
});

test("blocked or failed preflight never allows submission", () => {
  const review = buildAutoApplyReviewSummary({
    atsName: "Ashby",
    result: makeResult({
      status: "blocked",
      blockers: [
        {
          type: "required_field_unknown",
          detail: "Required fields missing: sponsorship",
        },
      ],
    }),
  });

  assert.equal(review.status, "BLOCKED_OR_UNSUPPORTED");
  assert.equal(review.statusLabel, "Manual Apply");
  assert.equal(review.canSubmit, false);
});

test("blocked preflight still shows detected fields for review", () => {
  const review = buildAutoApplyReviewSummary({
    atsName: "Lever",
    result: makeResult({
      status: "blocked",
      atsName: "Lever",
      filledFields: [
        {
          label: "Full name",
          selector: 'input[name="name"]',
          value: "Yingxuan Hu",
          required: true,
          fieldType: "text",
          sourcePlatform: "Lever",
          confidence: "high",
        },
      ],
      unfillableFields: [
        {
          label: "Why are you interested in this role?",
          selector: "textarea:question",
          reason: "Unknown required question; user input required",
          required: true,
          fieldType: "textarea",
          sourcePlatform: "Lever",
          confidence: "low",
          custom: true,
          reviewRequired: true,
        },
      ],
      blockers: [
        {
          type: "captcha",
          detail: "hCaptcha iframe detected on the page. Automation cannot submit or bypass CAPTCHA-protected forms.",
        },
      ],
    }),
  });

  assert.equal(review.status, "BLOCKED_OR_UNSUPPORTED");
  assert.equal(review.canSubmit, false);
  assert.equal(review.fields.length, 2);
  assert.equal(review.fields[0]?.label, "Full name");
  assert.equal(review.fields[1]?.label, "Why are you interested in this role?");
  assert.equal(review.missingRequiredFields.length, 1);
});
