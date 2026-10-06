import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";

const source = `(${createInspector})(${applicationContext},(${createHistoryInspector})(),(${createAutofillInspector})())`;
const browser = await chromium.launch();
let passed = 0;
try {
  const page = await browser.newPage();
  let body;
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body }));
  const load = async html => {
    body = `<h1>Job application</h1><form><label>First name<input></label><label>Email<input type="email"></label>${html}<button>Submit application</button></form>`;
    await page.goto("https://careers.fixture.example/jobs/123/apply");
    await page.evaluate(code => { window.inspect = (0, eval)(code); window.submits = 0; document.addEventListener("submit", e => { e.preventDefault(); window.submits++; }, true); }, source);
  };
  const inspect = (mode = "inspect", payload = {}) => page.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
  const label = "Do you have experience building Python applications?";
  const radios = name => `<div><label><input type="radio" name="${name}" value="yes">Yes</label><label><input type="radio" name="${name}" value="no">No</label></div>`;
  const layouts = [
    `<fieldset><legend>${label}</legend>${radios("q")}</fieldset>`,
    `<div role="radiogroup" aria-label="${label}">${radios("q")}</div>`,
    `<div role="radiogroup" aria-labelledby="prompt"><p id="prompt">${label}</p>${radios("q")}</div>`,
    `<div><p>${label}</p>${radios("q")}</div>`,
    `<section><h3>${label}</h3>${radios("q")}</section>`,
    `<div><div><span>${label}</span></div><div>${radios("q")}</div></div>`,
  ];
  for (const html of layouts) for (const choice of ["Yes", "No"]) {
    await load(html);
    const before = await inspect();
    const question = before.fields.find(field => field.label === label);
    assert.equal(question?.kind, "radio", html);
    assert.deepEqual(question.options, ["Yes", "No"]);
    const after = await inspect("autofill", { commonAnswers: [{ label, answer: choice }] });
    assert.equal(after.fields.find(field => field.label === label)?.state, "filled");
    assert.equal(await page.locator(`input[value="${choice.toLowerCase()}"]`).isChecked(), true);
    assert.equal(await page.locator('input[type=radio]:checked').count(), 1);
    await inspect("autofill");
    assert.equal(await page.locator('input[type=radio]:checked').count(), 1, "Second pass is idempotent");
    assert.equal(await page.evaluate(() => window.submits), 0);
    passed++;
  }
  await load(`<div><p>${label}</p>${radios("first")}</div><div><p>Do you have SQL experience?</p>${radios("second")}</div>`);
  await inspect("autofill", { commonAnswers: [{ label, answer: "Yes" }] });
  assert.equal(await page.locator('input[name=first][value=yes]').isChecked(), true);
  assert.equal(await page.locator('input[name=second]:checked').count(), 0);
  passed++;
  for (const field of ["Current company", "Current employer", "Current job title", "Current title", "Current role", "Other website", "Street"]) {
    await load(`<label>${field}<input></label>`);
    const contact = { currentCompany: "Example Company", currentTitle: "Engineer", portfolioGithubUrl: "https://github.com/example-test", streetAddress: "123 Example Street" };
    const scan = await inspect("autofill", { contact });
    const row = scan.fields.find(item => item.label === field);
    assert.equal(await page.getByLabel(field).inputValue(), contact[row.profileKey]);
    assert.equal(row.canRemember, field === "Street");
    passed++;
  }
  for (const unsafe of [`<div><p>${label}</p><p>Different question</p>${radios("q")}</div>`,
    `<div><p>${label}</p>${radios("q")}<label>Other question<input></label></div>`]) {
    await load(unsafe); await inspect("autofill", { commonAnswers: [{ label, answer: "Yes" }] });
    assert.equal(await page.locator('input[type=radio]:checked').count(), 0);
    passed++;
  }
  await load(`<div><p>${label}</p>${radios("q")}</div>`);
  await page.locator('input[value=no]').check();
  await inspect("autofill", { commonAnswers: [{ label, answer: "Yes" }] });
  assert.equal(await page.locator('input[value=no]').isChecked(), true);
  passed++;
  await load('<label>LinkedIn profile *<input></label>');
  assert.equal((await inspect()).fields.find(field => field.label.startsWith("LinkedIn"))?.required, true);
  passed++;
  await load('<label>Phone number<input type="tel" value="+1"></label>');
  assert.equal((await inspect()).fields.find(field => field.profileKey === "phone")?.state, "needed");
  await inspect("autofill", { contact: { phone: "2025550148", phoneCountry: "US" } });
  assert.equal(await page.getByLabel("Phone number").inputValue(), "+12025550148");
  await inspect("autofill-undo");
  assert.equal(await page.getByLabel("Phone number").inputValue(), "+1");
  passed++;
  await load('<label>Phone number<input type="tel" value="+1"></label>');
  await inspect();
  await page.getByLabel("Phone number").fill("+44");
  await inspect("autofill", { contact: { phone: "2025550148", phoneCountry: "US" } });
  assert.equal(await page.getByLabel("Phone number").inputValue(), "+44", "A trusted edit to a prefix is preserved");
  passed++;
  await load('<label>Phone number<input type="tel" value="+12025550199"></label><label>Current role<input type="checkbox"></label>');
  await inspect("autofill", { contact: { phone: "2025550148", phoneCountry: "US", currentTitle: "Engineer" } });
  assert.equal(await page.getByLabel("Phone number").inputValue(), "+12025550199");
  assert.equal((await inspect()).fields.find(field => field.label === "Current role")?.profileKey, undefined);
  assert.equal(await page.getByLabel("Current role").isChecked(), false);
  passed++;
  const sponsorship = "Will you now or in the future require sponsorship for employment visa status?";
  await load(`<section><h3>Employment eligibility</h3><div><p>${sponsorship}</p>${radios("sponsor")}</div></section>`);
  const eligibility = (await inspect("autofill", { commonAnswers: [{ label: sponsorship, answer: "No" }] })).fields.find(field => field.label === sponsorship);
  assert.equal(eligibility?.state, "filled");
  assert.equal(await page.locator('input[name=sponsor][value=no]').isChecked(), true);
  passed++;
  console.log(`PASS ${passed} independent control matrix scenarios: prompt grouping, option readback, user edits, ambiguous groups, idempotence, required metadata, no submission`);
} finally { await browser.close(); }
