import type { Locator, Page } from "playwright";

import {
  isSensitiveFieldConcept,
  isSensitiveFieldLabel,
  matchLabelToConcept,
  type FieldConcept,
} from "./field-map";
import type {
  AutoApplyDetectedFieldType,
  FilledField,
  UnfillableField,
} from "./types";

type DetectionResult = {
  filled: FilledField[];
  unfillable: UnfillableField[];
};

type DetectionOptions = {
  platform?: string;
};

type DetectedControl = {
  locator: Locator;
  index: number;
  identity: string;
  label: string;
  selector: string;
  fieldType: AutoApplyDetectedFieldType;
  required: boolean;
  options: string[];
  concept: FieldConcept | null;
  sensitive: boolean;
  custom: boolean;
  reviewRequired: boolean;
};

const MAX_FIELDS_TO_ANALYZE = 120;
const MAX_OPTION_LABEL_LENGTH = 120;

const SKIPPED_INPUT_TYPES = new Set([
  "button",
  "hidden",
  "image",
  "reset",
  "submit",
]);

const CHOICE_INPUT_TYPES = new Set(["radio", "checkbox"]);

const EXPLICIT_ANSWER_CONCEPTS = new Set<FieldConcept>([
  "sponsorship_needs",
  "salary_expectation",
  "availability",
  "how_did_you_hear",
]);

const STANDARD_NON_CUSTOM_CONCEPTS = new Set<FieldConcept>([
  "first_name",
  "last_name",
  "preferred_name",
  "full_name",
  "email",
  "phone",
  "linkedin_url",
  "github_url",
  "portfolio_url",
  "website_url",
  "resume_file",
  "cover_letter",
  "location",
  "education",
  "experience",
  "skills",
]);

export async function detectMappedFieldsForReview(
  page: Page,
  values: Record<string, string | null>,
  savedAnswers: Record<string, string>,
  options: DetectionOptions = {}
): Promise<DetectionResult> {
  const filled: FilledField[] = [];
  const unfillable: UnfillableField[] = [];
  const seen = new Set<string>();
  const controls = page.locator("input, textarea, select");
  const count = Math.min(await controls.count(), MAX_FIELDS_TO_ANALYZE);

  for (let index = 0; index < count; index++) {
    const control = controls.nth(index);
    const tagName = await getTagName(control);
    const rawInputType = await getInputType(control);
    const inputType = rawInputType || "text";

    if (tagName === "input" && SKIPPED_INPUT_TYPES.has(inputType)) {
      continue;
    }

    const isChoiceControl = tagName === "input" && CHOICE_INPUT_TYPES.has(inputType);
    const isFileInput = tagName === "input" && inputType === "file";
    const visible = await control.isVisible().catch(() => false);
    if (!visible && !isFileInput && !isChoiceControl) {
      continue;
    }

    const detected = isChoiceControl
      ? await getChoiceControl(page, control, index, inputType as "radio" | "checkbox")
      : await getScalarControl(page, control, index, tagName, inputType);

    if (!detected || seen.has(detected.identity)) {
      continue;
    }
    seen.add(detected.identity);
    if (isNonSubmissionHelperControl(detected)) {
      continue;
    }

    const savedAnswer = findSavedAnswer(detected.label, savedAnswers);
    const conceptValue = getConceptValue(detected, values, savedAnswer !== null);
    const selectedValue =
      detected.fieldType === "select" ||
      detected.fieldType === "radio" ||
      detected.fieldType === "checkbox"
        ? selectOptionValue(savedAnswer ?? conceptValue, detected.options)
        : savedAnswer ?? conceptValue;

    const confidence = inferConfidence(detected, savedAnswer, selectedValue);

    if (selectedValue) {
      filled.push({
        label: buildDisplayLabel(detected.label, detected.concept),
        selector: detected.selector,
        value: summarizeFieldValue(detected.concept, selectedValue),
        required: detected.required,
        fieldType: detected.fieldType,
        options: detected.options,
        sourcePlatform: options.platform,
        confidence,
        sensitive: detected.sensitive,
        custom: detected.custom,
        reviewRequired: detected.reviewRequired,
      });
      continue;
    }

    if (shouldExposeUnfilledField(detected)) {
      unfillable.push({
        label: buildDisplayLabel(detected.label, detected.concept),
        selector: detected.selector,
        reason: buildMissingReason(detected, savedAnswer ?? conceptValue),
        required: detected.required,
        fieldType: detected.fieldType,
        options: detected.options,
        sourcePlatform: options.platform,
        confidence,
        sensitive: detected.sensitive,
        custom: detected.custom,
        reviewRequired: detected.reviewRequired,
      });
    }
  }

  return {
    filled: dedupeFilled(filled),
    unfillable: dedupeUnfillable(unfillable),
  };
}

function getConceptValue(
  control: DetectedControl,
  values: Record<string, string | null>,
  hasSavedAnswer: boolean
) {
  const concept = control.concept;
  if (!concept) return null;
  if (hasSavedAnswer) return null;

  if (requiresExplicitUserAnswer(control)) {
    return null;
  }

  return values[concept] ?? null;
}

function requiresExplicitUserAnswer(control: DetectedControl) {
  if (!control.concept) return false;
  if (EXPLICIT_ANSWER_CONCEPTS.has(control.concept)) return true;
  if (
    control.sensitive &&
    (control.fieldType === "select" ||
      control.fieldType === "radio" ||
      control.fieldType === "checkbox")
  ) {
    return true;
  }
  if (
    control.concept === "location" &&
    /\bable\b|\bwilling\b|\bwork\s+out\s+of\b|\brelocat/i.test(control.label)
  ) {
    return true;
  }
  return false;
}

async function getScalarControl(
  page: Page,
  control: Locator,
  index: number,
  tagName: string,
  inputType: string
): Promise<DetectedControl | null> {
  const identity = await getControlIdentity(control, index);
  const selector = await describeControl(control, index);
  const fieldType = getScalarFieldType(tagName, inputType);
  const label = await getFieldLabel(page, control, index);
  const fieldText = label || identity;
  const options = fieldType === "select" ? await getSelectOptions(control) : [];
  const concept = matchLabelToConcept(`${fieldText} ${identity}`);
  const required = await isRequiredControl(control, fieldText);
  const sensitive =
    isSensitiveFieldLabel(fieldText) || isSensitiveFieldConcept(concept);
  const custom = isCustomQuestion(fieldText, concept, fieldType);

  return {
    locator: control,
    index,
    identity,
    label: fieldText,
    selector,
    fieldType,
    required,
    options,
    concept,
    sensitive,
    custom,
    reviewRequired: sensitive || custom || fieldType === "select",
  };
}

async function getChoiceControl(
  page: Page,
  control: Locator,
  index: number,
  inputType: "radio" | "checkbox"
): Promise<DetectedControl | null> {
  const name = await control.getAttribute("name").catch(() => null);
  const selector = name
    ? `input[type="${inputType}"][name="${escapeAttributeValue(name)}"]`
    : `${inputType}-group:${index}`;
  const groupControls = name
    ? page.locator(selector)
    : control.locator("xpath=ancestor::*[self::fieldset or self::div][1]//input");
  const options = await getChoiceOptions(page, groupControls);
  const fallbackLabel = await getFieldLabel(page, control, index);
  const label = await getChoiceGroupLabel(page, control, fallbackLabel, options, name);
  const identity = `${inputType}:${name ?? (normalize(label) || String(index))}`;
  const concept = matchLabelToConcept(`${label} ${name ?? ""}`);
  const required = await isRequiredChoiceGroup(page, control, groupControls, label, name);
  const sensitive = isSensitiveFieldLabel(label) || isSensitiveFieldConcept(concept);
  const custom = isCustomQuestion(label, concept, inputType);

  return {
    locator: control,
    index,
    identity,
    label,
    selector,
    fieldType: inputType,
    required,
    options,
    concept,
    sensitive,
    custom,
    reviewRequired: true,
  };
}

async function getChoiceOptions(page: Page, controls: Locator) {
  const count = Math.min(await controls.count().catch(() => 0), 24);
  const options: string[] = [];
  for (let index = 0; index < count; index++) {
    const control = controls.nth(index);
    const type = await getInputType(control);
    if (!CHOICE_INPUT_TYPES.has(type)) continue;

    const label = await getOptionLabel(page, control);
    const value = label || (await control.getAttribute("value").catch(() => null)) || "";
    if (value.trim()) options.push(value.trim().slice(0, MAX_OPTION_LABEL_LENGTH));
  }

  if (options.length <= 1 && count > 0) {
    const buttonTexts = await controls
      .first()
      .locator("xpath=ancestor::div[1]//button")
      .allInnerTexts()
      .catch(() => []);
    const buttonOptions = uniqueStrings(
      buttonTexts
        .map((text) => text.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .map((text) => text.slice(0, MAX_OPTION_LABEL_LENGTH))
    );
    if (buttonOptions.length > 0) {
      return buttonOptions;
    }
  }

  return uniqueStrings(options);
}

async function getOptionLabel(page: Page, control: Locator) {
  const ariaLabel = await control.getAttribute("aria-label").catch(() => null);
  if (ariaLabel?.trim()) return ariaLabel.trim();

  const id = await control.getAttribute("id").catch(() => null);
  if (id) {
    const label = page.locator(`label[for="${escapeAttributeValue(id)}"]`).first();
    const text = await innerTextIfPresent(label);
    if (text.trim()) return text.trim();
  }

  const parentLabel = control.locator("xpath=ancestor::label[1]");
  const parentText = await innerTextIfPresent(parentLabel);
  if (parentText.trim()) return parentText.trim();

  const adjacentText = await control
    .locator("xpath=following-sibling::*[1]");
  const adjacentLabel = await innerTextIfPresent(adjacentText);
  if (adjacentLabel.trim()) return adjacentLabel.trim();

  return null;
}

async function getChoiceGroupLabel(
  page: Page,
  control: Locator,
  fallbackLabel: string,
  optionLabels: string[],
  name: string | null
) {
  if (name) {
    const namedLabel = await getExternalLabelText(page, name);
    if (namedLabel) return namedLabel;
  }

  const legendText = await control
    .locator("xpath=ancestor::fieldset[1]//legend[1]");
  const legendLabel = await innerTextIfPresent(legendText);
  if (legendLabel.trim()) return legendLabel.trim();

  const fieldsetLabel = await control
    .locator("xpath=ancestor::fieldset[1]/label[1]");
  const fieldsetLabelText = await innerTextIfPresent(fieldsetLabel);
  if (fieldsetLabelText.trim()) return fieldsetLabelText.trim();

  const labelledGroup = control.locator("xpath=ancestor::*[@aria-labelledby][1]");
  const groupLabel =
    (await labelledGroup.count().catch(() => 0)) > 0
      ? await labelledGroup
          .evaluate((element) => {
            const ids = element.getAttribute("aria-labelledby")?.split(/\s+/) ?? [];
            return ids
              .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
              .filter(Boolean)
              .join(" ");
          })
          .catch(() => "")
      : "";
  if (groupLabel.trim()) return groupLabel.trim();

  const questionText = await getQuestionContainerText(control, optionLabels);
  if (questionText) return questionText;

  const choiceContainer = control.locator(
    "xpath=ancestor::*[self::fieldset or self::div][1]"
  );
  const containerText = await innerTextIfPresent(choiceContainer);
  const firstQuestionLine = pickQuestionLine(containerText, optionLabels);
  if (firstQuestionLine) return firstQuestionLine;

  return fallbackLabel;
}

async function getSelectOptions(select: Locator) {
  const rawOptions = await select.locator("option").allInnerTexts().catch(() => []);
  return uniqueStrings(
    rawOptions
      .map((option) => option.replace(/\s+/g, " ").trim())
      .filter((option) => option && !/^select|choose|please select/i.test(option))
      .map((option) => option.slice(0, MAX_OPTION_LABEL_LENGTH))
  );
}

function selectOptionValue(value: string | null, options: string[]) {
  if (!value) return null;
  if (options.length === 0) return value;

  const normalizedValue = normalize(value);
  const exact = options.find((option) => normalize(option) === normalizedValue);
  if (exact) return exact;

  const partial = options.find((option) => {
    const normalizedOption = normalize(option);
    return (
      normalizedOption.length > 1 &&
      (normalizedOption.includes(normalizedValue) ||
        normalizedValue.includes(normalizedOption))
    );
  });
  return partial ?? null;
}

function shouldExposeUnfilledField(control: DetectedControl) {
  return control.required || control.sensitive || control.custom || Boolean(control.concept);
}

function isNonSubmissionHelperControl(control: DetectedControl) {
  return control.fieldType === "file" && /autofill\s+from\s+resume/i.test(control.label);
}

function buildMissingReason(control: DetectedControl, attemptedValue: string | null) {
  if (attemptedValue && control.options.length > 0) {
    return `No available option matched "${attemptedValue}"`;
  }
  if (control.fieldType === "file") {
    return "Required upload could not be matched to an available file";
  }
  if (!control.concept) {
    return control.required
      ? "Unknown required question; user input required"
      : "Optional custom question skipped unless you answer it";
  }
  if (requiresExplicitUserAnswer(control)) {
    return `Explicit user answer required for ${formatConcept(control.concept)}`;
  }
  return `No trusted ${formatConcept(control.concept)} value is available`;
}

function inferConfidence(
  control: DetectedControl,
  savedAnswer: string | null,
  selectedValue: string | null
): "high" | "medium" | "low" {
  if (!selectedValue) return control.concept ? "medium" : "low";
  if (savedAnswer) return "high";
  if (!control.concept) return "low";
  if (control.fieldType === "select" || control.fieldType === "radio" || control.fieldType === "checkbox") {
    return "medium";
  }
  return STANDARD_NON_CUSTOM_CONCEPTS.has(control.concept) ? "high" : "medium";
}

function isCustomQuestion(
  label: string,
  concept: FieldConcept | null,
  fieldType: AutoApplyDetectedFieldType
) {
  if (!concept) return true;
  if (!STANDARD_NON_CUSTOM_CONCEPTS.has(concept)) return true;
  if (fieldType === "radio" || fieldType === "checkbox" || fieldType === "select") {
    return isSensitiveFieldLabel(label) || /\?/.test(label);
  }
  return false;
}

function getScalarFieldType(
  tagName: string,
  inputType: string
): AutoApplyDetectedFieldType {
  if (tagName === "textarea") return "textarea";
  if (tagName === "select") return "select";
  if (inputType === "email") return "email";
  if (inputType === "tel" || inputType === "phone") return "phone";
  if (inputType === "file") return "file";
  if (inputType === "url" || inputType === "text" || !inputType) return "text";
  return "unknown";
}

function findSavedAnswer(label: string, savedAnswers: Record<string, string>) {
  const normalizedLabel = normalize(label);
  for (const [key, value] of Object.entries(savedAnswers)) {
    if (!value.trim()) continue;
    const normalizedKey = normalize(key);
    if (
      normalizedLabel.includes(normalizedKey) ||
      normalizedKey.includes(normalizedLabel.slice(0, 40))
    ) {
      return value.trim();
    }
  }
  return null;
}

async function getTagName(control: Locator) {
  return control.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
}

async function getInputType(control: Locator) {
  return ((await control.getAttribute("type").catch(() => null)) ?? "").toLowerCase();
}

async function getControlIdentity(control: Locator, index: number) {
  const id = await control.getAttribute("id").catch(() => null);
  const name = await control.getAttribute("name").catch(() => null);
  const type = await control.getAttribute("type").catch(() => null);
  return `${id ?? ""}:${name ?? ""}:${type ?? ""}:${index}`;
}

async function describeControl(control: Locator, index: number) {
  const id = await control.getAttribute("id").catch(() => null);
  if (id) return `#${id}`;
  const name = await control.getAttribute("name").catch(() => null);
  if (name) return `[name="${name}"]`;
  const tagName = await getTagName(control) || "field";
  return `${tagName}:nth(${index})`;
}

async function getFieldLabel(page: Page, control: Locator, index: number) {
  const ariaLabel = await control.getAttribute("aria-label").catch(() => null);
  if (ariaLabel?.trim()) return ariaLabel.trim();

  const id = await control.getAttribute("id").catch(() => null);
  if (id) {
    const text = await getExternalLabelText(page, id);
    if (text) return text;
  }

  const fieldName = await control.getAttribute("name").catch(() => null);
  if (fieldName) {
    const text = await getExternalLabelText(page, fieldName);
    if (text) return text;
  }

  const questionText = await getQuestionContainerText(control);
  if (questionText) return questionText;

  const placeholder = await control.getAttribute("placeholder").catch(() => null);
  if (placeholder?.trim() && !isGenericControlText(placeholder)) {
    return placeholder.trim();
  }

  const parentLabel = control.locator("xpath=ancestor::label[1]");
  const parentText = await innerTextIfPresent(parentLabel);
  if (parentText.trim()) return parentText.trim();

  const container = control.locator(
    "xpath=ancestor::*[self::div or self::fieldset or self::section][1]"
  );
  const containerText = await innerTextIfPresent(container);
  const firstLine = pickQuestionLine(containerText);
  if (firstLine) return firstLine;

  if (fieldName?.trim()) return humanizeName(fieldName);

  return `Field ${index + 1}`;
}

async function isRequiredControl(control: Locator, label: string) {
  const required = await control.getAttribute("required").catch(() => null);
  if (required !== null) return true;

  const ariaRequired = await control.getAttribute("aria-required").catch(() => null);
  if (ariaRequired === "true") return true;

  if (/\*/.test(label)) return true;

  const container = control.locator(
    "xpath=ancestor::*[self::div or self::fieldset or self::label][1]"
  );
  return isRequiredContainer(container);
}

async function isRequiredChoiceGroup(
  page: Page,
  firstControl: Locator,
  controls: Locator,
  label: string,
  name: string | null
) {
  if (/\*/.test(label)) return true;
  if (name && (await isExternalLabelRequired(page, name))) return true;

  const count = Math.min(await controls.count().catch(() => 0), 24);
  for (let index = 0; index < count; index++) {
    const control = controls.nth(index);
    const required = await control.getAttribute("required").catch(() => null);
    const ariaRequired = await control.getAttribute("aria-required").catch(() => null);
    if (required !== null || ariaRequired === "true") return true;
  }

  const fieldset = firstControl.locator("xpath=ancestor::fieldset[1]");
  if (
    (await fieldset.count().catch(() => 0)) > 0 &&
    (await isRequiredContainer(fieldset))
  ) {
    return true;
  }

  const container = firstControl.locator(
    "xpath=ancestor::*[self::div or self::label][1]"
  );
  return isRequiredContainer(container);
}

async function getExternalLabelText(page: Page, forValue: string) {
  const label = page.locator(`label[for="${escapeAttributeValue(forValue)}"]`).first();
  const text = await innerTextIfPresent(label);
  return text.replace(/\s+/g, " ").trim();
}

async function isExternalLabelRequired(page: Page, forValue: string) {
  const label = page.locator(`label[for="${escapeAttributeValue(forValue)}"]`).first();
  if ((await label.count().catch(() => 0)) === 0) return false;
  const className = await label.getAttribute("class").catch(() => "");
  if (/\brequired\b|_required_/i.test(className ?? "")) return true;
  const text = await innerTextIfPresent(label);
  return /\*/.test(text) || /\brequired\b/i.test(text);
}

async function isRequiredContainer(container: Locator) {
  const requiredMarkerCount = await container
    .locator(".required, .asterisk, [class*='required'], [data-required='true'], [aria-required='true']")
    .count()
    .catch(() => 0);
  if (requiredMarkerCount > 0) return true;

  const containerText = await innerTextIfPresent(container);
  const firstLine = containerText.split("\n")[0] ?? "";
  return /\brequired\b/i.test(containerText) || /\*/.test(firstLine);
}

function buildDisplayLabel(label: string, concept: FieldConcept | null) {
  const cleanLabel = label.replace(/\s+/g, " ").replace(/\*/g, "").trim().slice(0, 160);
  if (cleanLabel && !/^field\s+\d+$/i.test(cleanLabel)) return cleanLabel;
  if (concept) return formatConcept(concept);
  return cleanLabel || "Application field";
}

function summarizeFieldValue(concept: FieldConcept | null, value: string) {
  if (concept === "resume_file") return "Selected resume file";
  if (concept === "cover_letter") return value.length > 80 ? `${value.slice(0, 80)}...` : value;
  return value.length > 140 ? `${value.slice(0, 140)}...` : value;
}

function dedupeFilled(fields: FilledField[]) {
  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = `${normalize(field.label)}:${field.selector}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeUnfillable(fields: UnfillableField[]) {
  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = `${normalize(field.label)}:${field.required ? "required" : "optional"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = normalize(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function formatConcept(concept: FieldConcept) {
  return concept.replace(/_/g, " ");
}

function humanizeName(value: string) {
  return value
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeAttributeValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function innerTextIfPresent(locator: Locator, timeout = 100) {
  if ((await locator.count().catch(() => 0)) === 0) return "";
  return locator.innerText({ timeout }).catch(() => "");
}

async function getQuestionContainerText(
  control: Locator,
  optionLabels: string[] = []
) {
  const candidates = [
    control.locator(
      "xpath=ancestor::*[contains(translate(@class, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'application-question') or contains(translate(@class, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'posting-form-question') or contains(translate(@class, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'question') or self::fieldset][1]"
    ),
    control.locator("xpath=ancestor::*[self::div or self::section][3]"),
    control.locator("xpath=ancestor::*[self::div or self::section][2]"),
    control.locator("xpath=ancestor::*[self::div or self::section][1]"),
  ];

  for (const candidate of candidates) {
    const text = await innerTextIfPresent(candidate);
    const line = pickQuestionLine(text, optionLabels);
    if (line) return line;
  }

  return "";
}

function pickQuestionLine(text: string, optionLabels: string[] = []) {
  const optionSet = new Set(optionLabels.map(normalize).filter(Boolean));
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find((line) => {
      const normalized = normalize(line);
      return (
        normalized.length > 2 &&
        !optionSet.has(normalized) &&
        !isGenericControlText(line)
      );
    }) ?? "";
}

function isGenericControlText(value: string) {
  return /^(required|optional|yes|no|choose|select|select\.\.\.|choose\.\.\.|type your response|attach|attach resume\/?cv|resume|cv)$/i.test(
    value.trim()
  );
}
