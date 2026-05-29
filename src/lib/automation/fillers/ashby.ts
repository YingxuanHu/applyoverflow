/**
 * Ashby ATS form filler.
 *
 * Ashby forms are React SPAs hosted at:
 *   jobs.ashbyhq.com/{company}/application/{jobId}
 *   or embedded in company career pages.
 *
 * Unlike Greenhouse/Lever, Ashby renders everything via React hydration.
 * Fields are identified by aria-labels, data-testid, and label associations.
 *
 * Common form structure:
 *   - Name field (full name or first + last)
 *   - Email field
 *   - Phone field
 *   - Resume file upload
 *   - LinkedIn URL
 *   - Custom questions as div containers with labels
 *   - Submit button
 */
import type { Page } from "playwright";
import type {
  ATSFiller,
  ATSFillerContext,
  ATSFillerResult,
  FilledField,
  UnfillableField,
  AutomationBlocker,
} from "../types";
import { buildFieldValueMap, matchLabelToConcept } from "../field-map";
import { detectMappedFieldsForReview } from "../form-detection";
import { navigateToForm, detectBlockers } from "../browser";
import { captureScreenshot } from "../screenshots";

async function fillAshbyForm(ctx: ATSFillerContext): Promise<ATSFillerResult> {
  const start = Date.now();
  const { page, mode, screenshotDir } = ctx;
  const filledFields: FilledField[] = [];
  const unfillableFields: UnfillableField[] = [];
  const blockers: AutomationBlocker[] = [];
  const screenshots: string[] = [];

  const values = buildFieldValueMap(ctx.profile, ctx.resume, ctx.applicationPackage);

  // ─── Navigate ──────────────────────────────────────────────────────
  const nav = await navigateToForm(page, ctx.applyUrl);
  if (!nav.ok) {
    screenshots.push(await captureScreenshot(page, screenshotDir, "01_navigation_failed"));
    const blockerType = nav.statusHint === "position_closed" ? "position_closed" as const : "timeout" as const;
    return makeResult("failed", filledFields, unfillableFields, [
      { type: blockerType, detail: nav.statusHint },
    ], screenshots, start);
  }

  // Ashby is a SPA — wait for React to hydrate
  await page.waitForTimeout(3000);
  await openAshbyApplicationForm(page);

  // Wait for form to appear
  const formLoaded = await page
    .locator('form, [data-testid="application-form"], [role="form"]')
    .first()
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);

  if (!formLoaded) {
    // Try looking for individual inputs as a fallback
    const hasInputs = await page.locator('input[type="text"], input[type="email"]').count();
    if (hasInputs === 0) {
      screenshots.push(await captureScreenshot(page, screenshotDir, "01_no_form"));
      return makeResult("failed", filledFields, unfillableFields, [
        { type: "form_changed", detail: "Ashby form not found after SPA hydration" },
      ], screenshots, start);
    }
  }

  await hydrateAshbyApplicationFields(page);
  screenshots.push(await captureScreenshot(page, screenshotDir, "01_form_loaded"));

  // ─── Check blockers ────────────────────────────────────────────────
  const detectedBlockers = await detectBlockers(page);
  if (detectedBlockers.length > 0) {
    for (const b of detectedBlockers) {
      blockers.push({ type: b.type as AutomationBlocker["type"], detail: b.detail });
    }
  }

  const detectedForReview = await detectMappedFieldsForReview(
    page,
    values,
    ctx.applicationPackage.savedAnswers,
    { platform: "Ashby" }
  );

  if (blockers.length > 0) {
    screenshots.push(await captureScreenshot(page, screenshotDir, "02_blocked_preflight"));
    return makeResult("blocked", detectedForReview.filled, detectedForReview.unfillable, blockers, screenshots, start,
      "Ashby form inspected, but automation is blocked by site protection or another unsupported step.");
  }

  if (mode === "dry_run") {
    screenshots.push(await captureScreenshot(page, screenshotDir, "02_dry_run"));
    return makeResult("filled", detectedForReview.filled, detectedForReview.unfillable, blockers, screenshots, start,
      "Dry run: Ashby SPA form detected. Fields identified but not filled.");
  }

  mergeUnfillableFields(unfillableFields, detectedForReview.unfillable);

  // ─── Fill fields by label matching ─────────────────────────────────
  // Ashby doesn't use consistent IDs — we rely on label text
  await fillFieldByLabel(page, /^name$|^full\s*name$/i, values.full_name, "Full name", true, filledFields, unfillableFields);
  await fillFieldByLabel(page, /^first\s*name$/i, values.first_name, "First name", false, filledFields, unfillableFields);
  await fillFieldByLabel(page, /^last\s*name$/i, values.last_name, "Last name", false, filledFields, unfillableFields);
  await fillFieldByLabel(page, /^e[\s-]*mail/i, values.email, "Email", true, filledFields, unfillableFields);
  await fillFieldByLabel(page, /^phone|^mobile/i, values.phone, "Phone", false, filledFields, unfillableFields);
  await fillFieldByLabel(page, /linkedin/i, values.linkedin_url, "LinkedIn", false, filledFields, unfillableFields);
  await fillFieldByLabel(page, /github/i, values.github_url, "GitHub", false, filledFields, unfillableFields);
  await fillFieldByLabel(page, /portfolio|website|personal/i, values.website_url, "Website", false, filledFields, unfillableFields);

  // ─── Resume upload ─────────────────────────────────────────────────
  if (ctx.resume.filePath) {
    const fileInput = page.locator('input[type="file"]').first();
    const fileCount = await fileInput.count();
    if (fileCount > 0) {
      try {
        await fileInput.setInputFiles(ctx.resume.filePath);
        filledFields.push({ label: "Resume", selector: 'input[type="file"]', value: ctx.resume.label });
      } catch {
        unfillableFields.push({ label: "Resume", reason: "File upload failed", required: true });
      }
    } else {
      unfillableFields.push({ label: "Resume", reason: "No file input found", required: true });
    }
  } else {
    unfillableFields.push({ label: "Resume", reason: "No resume file available", required: true });
  }

  // ─── Cover letter ──────────────────────────────────────────────────
  if (values.cover_letter) {
    await fillFieldByLabel(page, /cover\s*letter/i, values.cover_letter, "Cover letter", false, filledFields, unfillableFields);
  }

  // ─── Structured choice/select controls detected during preflight ────
  await fillAshbyDetectedChoiceFields(page, detectedForReview.filled, filledFields);

  // ─── Custom questions (heuristic) ──────────────────────────────────
  await fillAshbyCustomQuestions(page, values, ctx.applicationPackage.savedAnswers, filledFields);

  screenshots.push(await captureScreenshot(page, screenshotDir, "03_form_filled"));

  // ─── Required gaps check ───────────────────────────────────────────
  const hasRequiredGaps = unfillableFields.some((f) => f.required);
  if (hasRequiredGaps && mode === "fill_and_submit") {
    blockers.push({
      type: "required_field_unknown",
      detail: `Required fields missing: ${unfillableFields.filter((f) => f.required).map((f) => f.label).join(", ")}`,
    });
    return makeResult("blocked", filledFields, unfillableFields, blockers, screenshots, start,
      "Filled but blocked due to missing required fields.");
  }

  // ─── Submit ────────────────────────────────────────────────────────
  if (mode === "fill_and_submit") {
    screenshots.push(await captureScreenshot(page, screenshotDir, "04_pre_submit"));

    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Submit")',
      'button:has-text("Apply")',
      'button:has-text("Submit application")',
    ];

    let clicked = false;
    for (const selector of submitSelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        await page.locator(selector).first().click();
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      return makeResult("failed", filledFields, unfillableFields, [
        { type: "form_changed", detail: "Submit button not found" },
      ], screenshots, start);
    }

    await page.waitForTimeout(3000);
    screenshots.push(await captureScreenshot(page, screenshotDir, "05_post_submit"));

    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    const confirmed = /thank you|application.*received|submitted|successfully/i.test(bodyText);

    return makeResult("submitted", filledFields, unfillableFields, blockers, screenshots, start,
      confirmed ? "Submitted and confirmed." : "Submit clicked, confirmation unclear.",
      new Date()
    );
  }

  return makeResult("filled", filledFields, unfillableFields, blockers, screenshots, start,
    "Ashby form filled. Ready for review.");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function openAshbyApplicationForm(page: Page) {
  const controls = await page.locator("input, textarea, select").count();
  if (controls > 0 || /\/application\/?$/i.test(new URL(page.url()).pathname)) {
    return;
  }

  const applicationLink = page
    .locator(
      'a[href$="/application"], a:has-text("Apply for this Job"), a:has-text("Application")'
    )
    .first();
  if ((await applicationLink.count()) > 0) {
    const href = await applicationLink.getAttribute("href").catch(() => null);
    if (href) {
      await page
        .goto(new URL(href, page.url()).toString(), {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        })
        .catch(() => null);
      await page.waitForTimeout(3000);
      return;
    }
    await applicationLink.click({ timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(3000);
    return;
  }

  const applyButton = page.getByRole("button", { name: /apply/i }).first();
  if ((await applyButton.count()) > 0) {
    await applyButton.click({ timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(3000);
  }
}

async function hydrateAshbyApplicationFields(page: Page) {
  await page
    .evaluate(async () => {
      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const maxScroll = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      for (let y = 0; y <= maxScroll; y += 700) {
        window.scrollTo(0, y);
        await delay(120);
      }
      window.scrollTo(0, 0);
    })
    .catch(() => null);
  await page.waitForTimeout(500);
}

async function fillFieldByLabel(
  page: Page,
  labelPattern: RegExp,
  value: string | null,
  label: string,
  required: boolean,
  filledFields: FilledField[],
  unfillableFields: UnfillableField[]
) {
  if (!value) {
    if (required) unfillableFields.push({ label, reason: "No value in profile", required });
    return;
  }

  // Strategy 1: Find label element, then associated input
  const labels = page.locator("label");
  const count = await labels.count();
  for (let i = 0; i < count; i++) {
    const labelEl = labels.nth(i);
    const text = await labelEl.innerText().catch(() => "");
    if (!labelPattern.test(text.trim())) continue;

    // Find the associated input
    const forAttr = await labelEl.getAttribute("for");
    if (forAttr) {
      const input = page.locator(`#${CSS.escape(forAttr)}`);
      if ((await input.count()) > 0) {
        const tag = await input.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
        if (tag === "textarea") {
          await input.fill(value);
        } else {
          await input.fill(value);
        }
        filledFields.push({ label, selector: `#${forAttr}`, value: value.slice(0, 50) });
        return;
      }
    }

    // Input inside or next to the label
    const nearbyInput = labelEl.locator("~ input, ~ textarea, ~ div input, ~ div textarea").first();
    if ((await nearbyInput.count()) > 0) {
      await nearbyInput.fill(value);
      filledFields.push({ label, selector: `label-sibling:${i}`, value: value.slice(0, 50) });
      return;
    }
  }

  // Strategy 2: Try aria-label or placeholder
  const byAria = page.locator(`input[aria-label*="${label}" i], textarea[aria-label*="${label}" i]`).first();
  if ((await byAria.count()) > 0) {
    await byAria.fill(value);
    filledFields.push({ label, selector: `aria-label:${label}`, value: value.slice(0, 50) });
    return;
  }

  const byPlaceholder = page.locator(`input[placeholder*="${label}" i], textarea[placeholder*="${label}" i]`).first();
  if ((await byPlaceholder.count()) > 0) {
    await byPlaceholder.fill(value);
    filledFields.push({ label, selector: `placeholder:${label}`, value: value.slice(0, 50) });
    return;
  }

  if (required) {
    unfillableFields.push({ label, reason: "Could not find matching field", required });
  }
}

async function fillAshbyCustomQuestions(
  page: Page,
  values: Record<string, string | null>,
  savedAnswers: Record<string, string>,
  filledFields: FilledField[]
) {
  // Look for question-like containers not already handled
  const allLabels = page.locator("label");
  const count = await allLabels.count();
  const standardPatterns = /^(name|first|last|email|phone|linkedin|github|portfolio|website|resume|cover)/i;

  for (let i = 0; i < Math.min(count, 30); i++) {
    const labelEl = allLabels.nth(i);
    const text = await labelEl.innerText().catch(() => "");
    if (!text || text.length < 3 || standardPatterns.test(text.trim())) continue;

    // Already covered by standard fields
    const concept = matchLabelToConcept(text);

    // Try saved answers
    const savedKey = Object.keys(savedAnswers).find((k) =>
      text.toLowerCase().includes(k.toLowerCase())
    );

    const answerValue = savedKey
      ? savedAnswers[savedKey]
      : concept && values[concept]
        ? values[concept]
        : null;

    if (answerValue) {
      const forAttr = await labelEl.getAttribute("for");
      const input = forAttr
        ? page.locator(`#${CSS.escape(forAttr)}`)
        : labelEl.locator("~ input, ~ textarea, ~ select, ~ div input, ~ div textarea").first();

      if ((await input.count()) > 0) {
        const tag = await input.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
        if (tag === "select") {
          const options = await input.locator("option").allInnerTexts();
          const lower = answerValue.toLowerCase();
          const match = options.find((o) => o.toLowerCase().includes(lower));
          if (match) await input.selectOption({ label: match }).catch(() => {});
        } else {
          await input.fill(answerValue).catch(() => {});
        }
        filledFields.push({ label: text.slice(0, 60), selector: `ashby-q:${i}`, value: answerValue.slice(0, 50) });
      }
    }
  }
}

async function fillAshbyDetectedChoiceFields(
  page: Page,
  detectedFields: FilledField[],
  filledFields: FilledField[]
) {
  for (const field of detectedFields) {
    if (
      field.fieldType !== "select" &&
      field.fieldType !== "radio" &&
      field.fieldType !== "checkbox"
    ) {
      continue;
    }

    if (field.fieldType === "select") {
      const select = page.locator(field.selector).first();
      if ((await select.count().catch(() => 0)) === 0) continue;
      const selected = await select.selectOption({ label: field.value }).then(
        () => true,
        () => false
      );
      if (selected) {
        filledFields.push({
          label: field.label,
          selector: field.selector,
          value: field.value,
          required: field.required,
          fieldType: field.fieldType,
          options: field.options,
          sourcePlatform: field.sourcePlatform,
          confidence: field.confidence,
          sensitive: field.sensitive,
          custom: field.custom,
          reviewRequired: field.reviewRequired,
        });
      }
      continue;
    }

    const inputs = page.locator(field.selector);
    const count = Math.min(await inputs.count().catch(() => 0), 24);
    for (let index = 0; index < count; index++) {
      const input = inputs.nth(index);
      const optionLabel = await getAshbyOptionLabel(page, input);
      if (!optionMatches(optionLabel, field.value)) continue;

      const clickedButton = await clickAshbyButtonOption(input, field.value);
      const checked = clickedButton || await input.check({ force: true }).then(
        () => true,
        () => false
      );
      if (checked) {
        filledFields.push({
          label: field.label,
          selector: `${field.selector}:option(${index})`,
          value: field.value,
          required: field.required,
          fieldType: field.fieldType,
          options: field.options,
          sourcePlatform: field.sourcePlatform,
          confidence: field.confidence,
          sensitive: field.sensitive,
          custom: field.custom,
          reviewRequired: field.reviewRequired,
        });
      }
      break;
    }
  }
}

async function clickAshbyButtonOption(
  input: ReturnType<Page["locator"]>,
  value: string
) {
  const buttons = input.locator("xpath=ancestor::div[1]//button");
  const count = Math.min(await buttons.count().catch(() => 0), 8);
  for (let index = 0; index < count; index++) {
    const button = buttons.nth(index);
    const text = await button.innerText({ timeout: 500 }).catch(() => "");
    if (!optionMatches(text, value)) continue;
    return button.click({ timeout: 1000 }).then(
      () => true,
      () => false
    );
  }
  return false;
}

async function getAshbyOptionLabel(page: Page, input: ReturnType<Page["locator"]>) {
  const id = await input.getAttribute("id").catch(() => null);
  if (id) {
    const labelText = await page
      .locator(`label[for="${escapeAttributeValue(id)}"]`)
      .first()
      .innerText({ timeout: 500 })
      .catch(() => "");
    if (labelText.trim()) return labelText.trim();
  }

  const parentLabel = await input
    .locator("xpath=ancestor::label[1]")
    .innerText({ timeout: 500 })
    .catch(() => "");
  if (parentLabel.trim()) return parentLabel.trim();

  return (await input.getAttribute("value").catch(() => null)) ?? "";
}

function optionMatches(label: string, value: string) {
  const normalizedLabel = normalize(label);
  const normalizedValue = normalize(value);
  if (!normalizedLabel || !normalizedValue) return false;
  return (
    normalizedLabel === normalizedValue ||
    normalizedLabel.includes(normalizedValue) ||
    normalizedValue.includes(normalizedLabel)
  );
}

function mergeUnfillableFields(
  target: UnfillableField[],
  fields: UnfillableField[]
) {
  const existing = new Set(
    target.map((field) => `${normalize(field.label)}:${field.required}`)
  );
  for (const field of fields) {
    const key = `${normalize(field.label)}:${field.required}`;
    if (existing.has(key)) continue;
    target.push(field);
    existing.add(key);
  }
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeAttributeValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function makeResult(
  status: ATSFillerResult["status"],
  filledFields: FilledField[],
  unfillableFields: UnfillableField[],
  blockers: AutomationBlocker[],
  screenshots: string[],
  startTime: number,
  notes = "",
  submittedAt: Date | null = null
): ATSFillerResult {
  return {
    status,
    atsName: "Ashby",
    filledFields,
    unfillableFields,
    blockers,
    screenshots,
    submittedAt,
    notes,
    durationMs: Date.now() - startTime,
  };
}

export const ashbyFiller: ATSFiller = {
  atsName: "Ashby",
  urlPattern: /ashbyhq\.com/i,
  fill: fillAshbyForm,
};
