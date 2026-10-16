import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createFillProgress } from "../extensions/chrome/fill-progress.mjs";
import { testExtensionRecovery } from "./test-extension-recovery.mjs";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 720 } });
  await page.setContent('<main id="progress"></main>');
  await page.addStyleTag({ content: await readFile("extensions/chrome/popup.css", "utf8") });
  await page.evaluate(source => {
    const render = (0, eval)(`(${source})`)();
    window.calls = [];
    window.showProgress = fields => render(document.getElementById("progress"), fields, async (type, payload) => window.calls.push({ type, ...payload }));
  }, createFillProgress.toString());
  const fields = [
    { id: "name", label: "First name", state: "filled" },
    { id: "answer", label: "Describe a relevant AI project and how you validated it", state: "needed", processing: true, suggestion: { answer: "Private generated answer must not be displayed" } },
    { id: "personal", label: "Are you related to an employee?", state: "needed", reason: "This information is not saved in your profile." },
  ];
  await page.evaluate(fields => window.showProgress(fields), fields);
  assert.equal(await page.locator("textarea,input,select,form").count(), 0);
  assert.equal(await page.getByText(/Private generated answer/).count(), 0);
  assert.ok(await page.getByText("Answering...", { exact: true }).isVisible());
  await page.getByRole("button", { name: "Show field: Are you related to an employee?" }).click();
  assert.deepEqual(await page.evaluate(() => window.calls), [{ type: "autofill-focus", id: "personal", label: "Are you related to an employee?" }]);
  await page.evaluate(fields => window.showProgress(fields.map(f => f.id === "answer" ? { ...f, state: "filled", processing: false } : f)), fields);
  assert.ok(await page.getByText(/2 filled/).isVisible());
  assert.equal(await page.getByText("Answering...", { exact: true }).count(), 0);
  await page.evaluate(() => window.showProgress([
    { id: 'city', label: 'City', state: 'filled', updated: true },
    { id: 'country', label: 'Country', state: 'kept', reviewRequired: true, reason: 'The selected value differs from your profile. Review it on the form.' },
  ]));
  assert.ok(await page.getByText(/1 updated from profile/).isVisible());
  assert.ok(await page.getByText('Saved values to review (1)', { exact: true }).isVisible());
  assert.equal(await page.getByText('Already complete', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Show field: Country' }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/extension-progress-320.png", fullPage: true });
  console.log("PASS progress-only assistant: no answer controls or values, live states, show-field action, 320px layout");
  await testExtensionRecovery(browser);
} finally { await browser.close(); }
