import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";

let browser, page;
before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.route("**/*", route => route.abort());
});
after(async () => { await browser?.close(); });

async function load({ industry = '<input aria-label="Industry">', invalidInside = false } = {}) {
  await page.setContent(`<style>careers-ui-experience-form-control,careers-ui-experience-edit-item{display:block}</style><form>
    <input aria-label="Email" type="email" required aria-invalid="true"><input aria-label="AI question" required><input aria-label="Consent" type="checkbox" required>
    <careers-ui-experience-form-control data-testid="efc-experiences">
      <careers-ui-experience-edit-item>
        <input aria-label="Title" required><input aria-label="Company" required>
        <input aria-label="Start date" placeholder="dd-mm-yyyy" required><input aria-label="End date" placeholder="dd-mm-yyyy" required>
        <input aria-label="Is current" type="checkbox" required><textarea aria-label="Summary"></textarea>
        ${industry}${invalidInside ? '<input aria-label="Required record identifier" required>' : ''}
        <button type="button" data-save>Save</button>
      </careers-ui-experience-edit-item>
      <button type="button">Add</button>
    </careers-ui-experience-form-control><button type="submit">Apply</button></form>`);
  await page.evaluate(source => {
    window.saves = 0; window.submissions = 0; window.industryClicks = 0;
    document.querySelector("form").onsubmit = event => { event.preventDefault(); window.submissions++; };
    document.querySelector('[aria-label="Industry"]')?.addEventListener("click", () => window.industryClicks++);
    document.querySelector("careers-ui-experience-edit-item [data-save]").onclick = () => {
      window.saves++;
      const row = document.querySelector("careers-ui-experience-edit-item");
      const summary = document.createElement("div"); summary.textContent = "ML Software Engineer | Example Company";
      row.after(summary); row.remove();
    };
    window.inspectHistory = (0, eval)(`(${source})`)();
  }, createHistoryInspector.toString());
}
const fill = () => page.evaluate(() => window.inspectHistory("fill-history", {
  kind: "experience", automatic: true, entry: { title: "ML Software Engineer", company: "Example Company", description: "Built reporting tools.", dates: { start: "2025-01", end: "2025-08", current: false } },
}, document.querySelector("form"), field => field.getAttribute("aria-label") || "", field => field.isConnected && Boolean(field.getClientRects().length)));
const state = () => page.evaluate(() => ({ saves: window.saves, submissions: window.submissions, industryClicks: window.industryClicks }));

test("HiBob work Save validates only its editor, allows blank optional Industry and accepts current=false", async () => {
  for (const industry of [
    '<input aria-label="Industry">',
    '<select aria-label="Industry"><option value="">Select</option><option value="tech">Technology</option></select>',
    '<button type="button" role="combobox" aria-label="Industry" aria-expanded="false">Select</button>',
  ]) {
    await load({ industry });
    const result = await fill();
    assert.equal(result.saved, 1, JSON.stringify(result));
    assert.equal(result.filled, 5, "title, company, start, end and summary only");
    assert.equal(result.dateAdjusted, 2);
    assert.equal(result.warning, undefined);
    assert.deepEqual(await state(), { saves: 1, submissions: 0, industryClicks: 0 });
    assert.equal(await page.locator('form > [aria-label="Consent"]').isChecked(), false);
  }
});

test("optional Industry exception does not ignore real row invalidity, required values, consent or unknown questions", async () => {
  for (const config of [
    { industry: '<input aria-label="Industry" required>' },
    { industry: '<input aria-label="Industry" aria-required="true">' },
    { industry: '<input aria-label="Industry" aria-invalid="true">' },
    { industry: '<input aria-label="Industry" value="Unconfirmed industry">' },
    { industry: '<input aria-label="I agree to the terms" type="checkbox">' },
    { industry: '<input aria-label="Unknown optional question">' },
    { invalidInside: true },
  ]) {
    await load(config);
    const result = await fill();
    assert.equal(result.saved || 0, 0, JSON.stringify(config));
    assert.deepEqual(await state(), { saves: 0, submissions: 0, industryClicks: 0 });
    assert.match(result.warning || result.error || "", /review|incomplete|partially/i);
    if (config.invalidInside) assert.match(result.warning, /Required record identifier/);
  }
});
