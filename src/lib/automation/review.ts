import {
  isSensitiveFieldLabel,
  matchLabelToConcept,
} from "@/lib/automation/field-map";
import type {
  ATSFillerResult,
  AutoApplyReviewField,
  AutoApplyReviewSummary,
  AutoApplyFieldSource,
  AutoApplyReadinessStatus,
} from "@/lib/automation/types";

export function buildAutoApplyReviewSummary(input: {
  atsName: string | null;
  result: ATSFillerResult | null;
  error?: string | null;
  savedAnswers?: Record<string, string>;
}) {
  const { atsName, result, error, savedAnswers = {} } = input;

  if (!result) {
    return makeReviewSummary({
      status: "BLOCKED_OR_UNSUPPORTED",
      atsName,
      fields: [],
      blockers: error
        ? [{ type: "unknown", detail: error }]
        : [{ type: "unknown", detail: "Could not inspect the application form." }],
      screenshots: [],
      notes: error ?? "Could not inspect the application form.",
      durationMs: 0,
    });
  }

  const filledFields = result.filledFields.map((field, index) =>
    buildReviewField({
      id: `filled:${index}`,
      label: field.label,
      selector: field.selector,
      value: field.value,
      required: field.required ?? false,
      fieldType: field.fieldType,
      options: field.options,
      sourcePlatform: field.sourcePlatform,
      confidence: field.confidence,
      sensitive: field.sensitive,
      custom: field.custom,
      reviewRequired: field.reviewRequired,
      source: inferFieldSource(field.label, field.value, savedAnswers),
      reason: null,
    })
  );
  const missingFields = result.unfillableFields.map((field, index) =>
    buildReviewField({
      id: `missing:${index}`,
      label: field.label,
      selector: `missing:${index}`,
      value: null,
      required: field.required,
      fieldType: field.fieldType,
      options: field.options,
      sourcePlatform: field.sourcePlatform,
      confidence: field.confidence,
      sensitive: field.sensitive,
      custom: field.custom,
      reviewRequired: field.reviewRequired,
      source: "Manual input required",
      reason: field.reason,
    })
  );
  const fields = [...filledFields, ...missingFields];
  const requiredMissingFields = missingFields.filter((field) => field.required);
  const hasBlockers = result.status === "blocked" || result.status === "failed" || result.blockers.length > 0;
  const hasReviewRequiredField = fields.some(
    (field) => field.reviewRequired || field.sensitive || field.custom
  );
  const hasOptionalSkippedFields = missingFields.some((field) => !field.required);

  const status: AutoApplyReadinessStatus = hasBlockers
    ? "BLOCKED_OR_UNSUPPORTED"
    : requiredMissingFields.length > 0
      ? "NEEDS_EXTRA_ANSWERS"
      : hasReviewRequiredField || hasOptionalSkippedFields
          ? "NEEDS_USER_REVIEW"
          : "AUTO_APPLY_READY";

  return makeReviewSummary({
    status,
    atsName: result.atsName ?? atsName,
    fields,
    blockers: result.blockers,
    screenshots: result.screenshots,
    notes: result.notes,
    durationMs: result.durationMs,
  });
}

function buildReviewField(input: {
  id: string;
  label: string;
  selector: string;
  value: string | null;
  required: boolean;
  fieldType?: AutoApplyReviewField["fieldType"];
  options?: string[];
  sourcePlatform?: string;
  confidence?: AutoApplyReviewField["confidence"];
  sensitive?: boolean;
  custom?: boolean;
  reviewRequired?: boolean;
  source: AutoApplyFieldSource;
  reason: string | null;
}): AutoApplyReviewField {
  const concept = matchLabelToConcept(input.label);
  const sensitive = input.sensitive ?? isSensitiveFieldLabel(input.label);
  const custom =
    input.custom ??
    (!concept || input.selector.includes(":") || input.selector.startsWith("missing:"));
  const reviewRequired = input.reviewRequired ?? (sensitive || custom);
  return {
    id: input.id,
    label: cleanLabel(input.label),
    selector: input.selector,
    value: input.value,
    required: input.required,
    source: input.source,
    fieldType: input.fieldType,
    options: input.options,
    sourcePlatform: input.sourcePlatform,
    confidence: input.confidence ?? (concept && !custom ? "high" : concept ? "medium" : "low"),
    sensitive,
    custom,
    reviewRequired,
    editable: input.value === null || input.source === "Saved answer" || input.source === "User-entered answer",
    reason: input.reason,
  };
}

function makeReviewSummary(input: {
  status: AutoApplyReadinessStatus;
  atsName: string | null;
  fields: AutoApplyReviewField[];
  blockers: AutoApplyReviewSummary["blockers"];
  screenshots: string[];
  notes: string;
  durationMs: number;
}): AutoApplyReviewSummary {
  const missingRequiredFields = input.fields.filter(
    (field) => field.required && !field.value
  );
  return {
    status: input.status,
    ...getReadinessCopy(input.status, missingRequiredFields.length),
    canSubmit:
      input.status === "AUTO_APPLY_READY" ||
      input.status === "NEEDS_USER_REVIEW",
    atsName: input.atsName,
    fields: input.fields,
    missingRequiredFields,
    blockers: input.blockers,
    screenshots: input.screenshots,
    notes: input.notes,
    durationMs: input.durationMs,
  };
}

function getReadinessCopy(status: AutoApplyReadinessStatus, missingCount: number) {
  switch (status) {
    case "AUTO_APPLY_READY":
      return {
        statusLabel: "Auto Apply Ready",
        statusDescription:
          "The form loaded and required fields were mapped to trusted data. Review once before submitting.",
      };
    case "NEEDS_USER_REVIEW":
      return {
        statusLabel: "Needs Review",
        statusDescription:
          "The form can be filled, but one or more sensitive or custom fields should be explicitly reviewed first.",
      };
    case "NEEDS_EXTRA_ANSWERS":
      return {
        statusLabel: "Needs Extra Answers",
        statusDescription: `${missingCount} required field${missingCount === 1 ? "" : "s"} need user input before this can be submitted.`,
      };
    case "PARTIAL_AUTOFILL_ONLY":
      return {
        statusLabel: "Autofill Only",
        statusDescription:
          "Some fields can be filled, but unresolved fields remain. Use this as assisted autofill, not full auto-apply.",
      };
    case "NOT_AUTO_APPLICABLE":
      return {
        statusLabel: "Unsupported",
        statusDescription:
          "This job should stay in the manual application path.",
      };
    case "BLOCKED_OR_UNSUPPORTED":
      return {
        statusLabel: "Blocked",
        statusDescription:
          "The form could not be verified safely. Do not submit through automation.",
      };
  }
}

function inferFieldSource(
  label: string,
  value: string,
  savedAnswers: Record<string, string>
): AutoApplyFieldSource {
  const normalizedLabel = normalize(label);
  const savedMatch = Object.entries(savedAnswers).some(([key, savedValue]) => {
    const normalizedKey = normalize(key);
    return (
      savedValue === value &&
      (normalizedLabel.includes(normalizedKey) ||
        normalizedKey.includes(normalizedLabel.slice(0, 40)))
    );
  });
  if (savedMatch) return "Saved answer";
  if (/resume|cv/i.test(label)) return "Resume";
  if (/cover\s*letter/i.test(label)) return "Generated cover letter";
  return "Profile";
}

function cleanLabel(label: string) {
  return label.replace(/\s+/g, " ").replace(/\*/g, "").trim() || "Application field";
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
