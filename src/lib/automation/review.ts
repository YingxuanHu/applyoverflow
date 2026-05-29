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
    editable: true,
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
        statusLabel: "Ready to submit",
        statusDescription:
          "Everything required has a value. Review the answers before submitting.",
      };
    case "NEEDS_USER_REVIEW":
      return {
        statusLabel: "Ready to submit",
        statusDescription:
          "The form can be completed, but custom or sensitive answers should be reviewed before submitting.",
      };
    case "NEEDS_EXTRA_ANSWERS":
      return {
        statusLabel: "Needs your input",
        statusDescription: `${missingCount} required field${missingCount === 1 ? "" : "s"} need an answer before this can be submitted.`,
      };
    case "PARTIAL_AUTOFILL_ONLY":
      return {
        statusLabel: "Needs your input",
        statusDescription:
          "We can fill part of this application, but you need to complete the remaining fields.",
      };
    case "NOT_AUTO_APPLICABLE":
      return {
        statusLabel: "Cannot auto-apply",
        statusDescription:
          "This job needs to be completed on the employer site.",
      };
    case "BLOCKED_OR_UNSUPPORTED":
      return {
        statusLabel: "Cannot auto-apply",
        statusDescription:
          "The employer form could not be verified safely from the app.",
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
