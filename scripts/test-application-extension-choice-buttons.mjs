import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";
import * as answersModule from "../src/lib/profile-application-answers.ts";
import { questionAssistance } from "../extensions/chrome/question-policy.mjs";
const { applicationAnswerPlan } = answersModule.default || answersModule;

const source = `(${createInspector})(${applicationContext},undefined,(${createAutofillInspector})())`;
const contact = { fullName: "Jordan Example", email: "jordan@example.test", phone: "4165550123", phoneCountry: "CA",
  linkedInUrl: "https://www.linkedin.com/in/example-test", city: "Toronto", region: "ON", country: "CA" };
const saved = { enabled: true, values: { authorizedCA: "Yes", jobSource: "ApplyOverflow" } };
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, serviceWorkers: "block" });
  await page.routeWebSocket("**/*", socket => socket.close());
  let submissions = 0;
  const inject = async () => page.evaluate(code => {
    window.inspect = (0, eval)(code);
    window.submissions = 0;
    document.addEventListener("submit", event => { event.preventDefault(); event.stopImmediatePropagation(); window.submissions++; }, true);
  }, source);
  const scan = (mode = "inspect", payload = {}) => page.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
  const fill = async (choices = saved, residence = contact) => {
    const scanned = await scan();
    assert.ok(!scanned.error, scanned.error);
    const plan = applicationAnswerPlan(choices, scanned.questions, page.url(), undefined, residence);
    return scan("autofill", { contact: residence, commonAnswers: plan.answers, answerDetails: plan.details });
  };
  if (process.argv.includes("--live-beacon")) {
    await page.goto("https://jobs.ashbyhq.com/beaconsoftware/be0e101c-faba-41c2-996e-d70e98b9d4ee/application?utm_source=LinkedInPaid", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.getByRole("textbox", { name: "Email*", exact: true }).waitFor({ timeout: 30_000 });
    await page.route("**/*", route => route.abort());
    await inject();
    const result = await fill();
    for (const [label, value] of [["Name*", contact.fullName], ["Email*", contact.email], ["Phone Number*", contact.phone],
      ["LinkedIn Profile*", contact.linkedInUrl], ["How did you hear about Beacon?", "ApplyOverflow"]])
      assert.equal(await page.getByRole("textbox", { name: label, exact: true }).inputValue(), value, JSON.stringify(result.fields));
    const choice = result.fields.find(field => field.label.startsWith("Are you comfortable working onsite"));
    assert.equal(choice?.kind, "radio");
    assert.deepEqual(choice.options, ["Yes", "No"]);
    assert.equal(choice.state, "needed", "A commute commitment is not inferred from an address");
    // This explicit synthetic answer exercises the real segmented control.
    const answered = await scan("autofill-answer", { id: choice.id, label: choice.label, answer: "Yes" });
    assert.equal(answered.fields.find(field => field.id === choice.id)?.state, "filled");
    assert.equal(await page.getByRole("button", { name: "Yes", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator('input[type="radio"]:checked,input[type="checkbox"]:checked').count(), 1, "Only the mirrored onsite choice is selected; demographics are untouched");
    assert.equal(await page.evaluate(() => window.submissions), 0);
    await page.getByRole("textbox", { name: "Name*", exact: true }).scrollIntoViewIfNeeded();
    await mkdir("output/playwright/choice-buttons", { recursive: true });
    await page.screenshot({ path: "output/playwright/choice-buttons/live-beacon.png", fullPage: true });
    console.log("PASS live Beacon: five profile/source text fields, segmented choice with explicit test answer, demographic isolation, no submission. Location lookup intentionally blocked with outbound traffic.");
  } else if (process.argv.includes("--live")) {
    const url = "https://jobs.ashbyhq.com/7shifts/8628abcd-e033-4337-be63-1fcd04235601/application?utm_source=linkedinpaid";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.getByRole("button", { name: "Yes", exact: true }).first().waitFor({ timeout: 30_000 });
    // All network traffic is denied before any synthetic value reaches the DOM.
    // No account, real resume, uploads, analytics or application writes.
    await page.route("**/*", route => route.abort());
    await inject();
    const result = await fill();
    const authorization = page.locator('.ashby-application-form-field-entry').filter({ hasText: "Are you legally entitled to work in Canada?" });
    const residence = page.locator('.ashby-application-form-field-entry').filter({ hasText: "Are you currently located in the GTA or Saskatoon?" });
    assert.equal(await authorization.getByRole("button", { name: "Yes", exact: true }).getAttribute("aria-pressed"), "true", JSON.stringify(result.fields));
    assert.equal(await residence.getByRole("button", { name: "Yes", exact: true }).getAttribute("aria-pressed"), "true", JSON.stringify(result.fields));
    assert.equal(await page.getByRole("textbox", { name: "If in the GTA, in what city are you located?*", exact: true }).inputValue(), "Toronto");
    for (const label of ["Are you legally entitled to work in Canada?", "Are you currently located in the GTA or Saskatoon?", "If in the GTA, in what city are you located?"])
      assert.equal(result.fields.find(field => field.label === label)?.state, "filled", JSON.stringify(result.fields));
    const tools = result.fields.find(field => field.label.startsWith("What AI tools"));
    assert.ok(tools?.canAnswer);
    assert.equal(questionAssistance(tools.label), "draft");
    assert.equal(await page.evaluate(() => window.submissions), 0);
    await residence.scrollIntoViewIfNeeded();
    await mkdir("output/playwright/choice-buttons", { recursive: true });
    await page.screenshot({ path: "output/playwright/choice-buttons/live-7shifts.png", fullPage: true });
    console.log("PASS live 7shifts: confirmed Yes/Yes/Toronto readback; AI-tool draft route; synthetic profile only; all outbound traffic blocked; no submission");
  } else {
    let html;
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
    const load = async url => { await page.goto(url); await inject(); };
    const group = (id, prompt, semantics, type = 'type="button"') => `<div><label>${prompt}</label><div id="${id}">
      <button ${type} ${semantics}="false">Yes</button><button ${type} ${semantics}="false">No</button>
      <input type="checkbox" tabindex="-1" style="opacity:0;width:0"></div></div>`;
    for (const [url, semantics, type] of [
      ['https://jobs.ashbyhq.com/fixture/11111111-1111-4111-8111-111111111111/application', 'aria-pressed', ''],
      ['https://careers.fixture.example/job/application', 'aria-pressed', 'type="button"'],
      ['https://careers.fixture.example/job/application', 'role="radio" aria-checked', 'type="button"'],
    ]) {
      html = `<h1>Job Application</h1><div class="ashby-application-form-container"><form id="job-application-form">
        <label>Full name<input name="_systemfield_name"></label><label>Email<input name="_systemfield_email" type="email"></label>
        ${group('authorization', 'Are you legally entitled to work in Canada?', semantics, url.includes('ashby') ? 'type="button"' : type)}
        ${group('residence', 'Are you currently located in the GTA or Saskatoon?', semantics, 'type="button"')}
        <label>If in the GTA, in what city are you located?<input id="city"></label>
        <label>What AI tools are you using in your role today, and how have they changed how you work?<input id="tools"></label>
        <button>Submit application</button></form></div><script>
        document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submissions++};
        for(const button of document.querySelectorAll('[aria-pressed],[aria-checked]'))button.onclick=()=>{
          const attr=button.hasAttribute('aria-pressed')?'aria-pressed':'aria-checked';
          for(const other of button.parentElement.querySelectorAll('button'))other.setAttribute(attr,String(other===button));
          button.parentElement.querySelector('input').checked=button.textContent==='Yes';
        };</script>`;
      await load(url);
      const result = await fill();
      const attr = semantics === "aria-pressed" ? "aria-pressed" : "aria-checked";
      assert.equal(await page.locator('#authorization button').first().getAttribute(attr), 'true', JSON.stringify(result.fields));
      assert.equal(await page.locator('#residence button').first().getAttribute(attr), 'true');
      assert.equal(await page.locator('#city').inputValue(), 'Toronto');
      assert.equal((await scan()).questions.filter(label => label === 'Are you legally entitled to work in Canada?').length, 1);
      await page.locator('#authorization button').last().click();
      await page.locator('#city').fill('My edited city');
      await fill();
      assert.equal(await page.locator('#authorization button').last().getAttribute(attr), 'true', 'preserve user choice');
      assert.equal(await page.locator('#city').inputValue(), 'My edited city');
      assert.equal(await page.locator('#tools').inputValue(), '', 'tool usage is not invented client-side');
      assert.equal(await page.evaluate(() => window.submissions), 0);
      submissions += await page.evaluate(() => window.submissions);
      await load(url);
      await fill({ enabled: true, values: { authorizedCA: "No" } }, { ...contact, city: "Vancouver", region: "BC" });
      assert.equal(await page.locator('#authorization button').last().getAttribute(attr), 'true', 'explicit No is not an unchecked mirror input');
      assert.equal(await page.locator('#residence button').last().getAttribute(attr), 'true');
      assert.equal(await page.locator('#city').inputValue(), '', 'conditional GTA city must not receive Vancouver');
      await load(url);
      await fill({ enabled: false, values: { authorizedCA: "Yes" } }, { ...contact, city: '', region: '' });
      assert.equal(await page.locator('#authorization button').first().getAttribute(attr), 'false', 'authorization requires explicit sharing');
      assert.equal(await page.locator('#residence button').first().getAttribute(attr), 'false', 'missing location is not Yes or No');
      await load(url);
      await page.locator('#authorization button').evaluateAll(nodes => nodes.forEach(node => node.onclick = null));
      const rejected = await fill();
      assert.equal(rejected.fields.find(field => field.label === 'Are you legally entitled to work in Canada?')?.state, 'needed', 'click without selected-state readback is not success');
      assert.equal(await page.evaluate(() => window.submissions), 0);
    }
    // No explicit button type inside a native form is a submit control, even
    // when it looks like an accessible choice. Never click it automatically.
    html = `<h1>Job Application</h1><form id="job-application-form"><label>Full name<input></label><label>Email<input type="email"></label>
      ${group('unsafe','Are you legally entitled to work in Canada?','aria-pressed','')}<button>Submit application</button></form>`;
    await load('https://careers.fixture.example/job/application');
    await fill();
    assert.equal(await page.locator('#unsafe button').first().getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => window.submissions), 0);
    assert.equal(submissions, 0);
    console.log('PASS choice buttons across Ashby/generic/ARIA controls, exact readback, distinct question groups, preserved edits, safe submit exclusion, no submissions');
  }
} finally { await browser.close(); }
