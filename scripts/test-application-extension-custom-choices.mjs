import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { require as tsxRequire } from "tsx/cjs/api";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";
import { fillSavedDetails, canPrepareAnswer } from "../extensions/chrome/answer-runner.mjs";

const { applicationAnswerPlan } = tsxRequire("../src/lib/profile-application-answers.ts", import.meta.url);

const source = `(${createInspector})(${applicationContext},undefined,(${createAutofillInspector})())`;
const prompt = "Check Yes or No to indicate your agreement to receive text message updates from Example regarding your job application. Frequency may vary.";
const labels = ["Yes - I consent to receiving text messages", "No - I do not consent to receiving text messages"];
// Live-observed semantics, with all vendor classes/test IDs removed. The native
// radios are hidden; visible ARIA radios are the actual interaction surface.
const choices = `<div><p>${prompt}</p><div><div><div role="radiogroup" id="sms">
  ${labels.map((label, index) => `<div role="radio" tabindex="${index ? -1 : 0}" aria-checked="false">
    <div><input style="display:none" type="radio" name="sms" aria-labelledby="option-${index}"></div>
    <div id="option-${index}"><p>${label}</p></div></div>`).join("")}
  </div></div></div></div>`;
const form = extra => `<h1>Job application</h1><form><label>First name<input></label><label>Email<input type="email"></label>
  <button type="submit">Apply</button>${extra}</form><script>window.clicks=0;window.submitted=0;
  document.addEventListener('click',()=>window.clicks++);
  for (const choice of document.querySelectorAll('[role="radio"],[role="checkbox"],[role="switch"]')) choice.onclick=()=>{
    if (window.reject) return;
    const group=choice.closest('[role="radiogroup"]');
    if (group) for (const option of group.querySelectorAll('[role="radio"]')) option.setAttribute('aria-checked',String(option===choice));
    else choice.setAttribute('aria-checked',String(choice.getAttribute('aria-checked')!=='true'));
  };
  document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submitted++};</script>`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  let html;
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
  const load = async (body, url = "https://careers.custom-employer.example/jobs/42/apply") => {
    html = `<!doctype html>${form(body)}`;
    await page.goto(url);
    await page.evaluate(code => { window.inspect = (0, eval)(code); }, source);
  };
  const inspect = (mode = "inspect", payload = {}) => page.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
  const plan = (label = prompt, answer = "Yes", alternatives = labels.slice(0, 1)) => ({ commonAnswers: [{ label, answer, alternatives, answerKey: "smsUpdates" }] });
  const savedPlan = (scan, saved, url) => {
    const common = applicationAnswerPlan(saved, scan.questions, url, scan.employmentCountry, scan.employmentLocation);
    return { commonAnswers: common.answers, answerDetails: common.details };
  };
  for (const saved of [{ enabled: true, values: { smsUpdates: "No" } }, { enabled: true, values: { smsUpdates: "Yes" } },
    { enabled: true, values: {} }, { enabled: false, values: { smsUpdates: "No" } }]) {
    await load(choices);
    const scan = await inspect();
    const choice = scan.fields.find(field => field.label === prompt);
    assert.equal(choice.canAnswer, false, "unplanned consent must not become answerable");
    assert.equal(choice.canPlan, true, "structurally safe saved-only questions reach the real planner");
    assert.equal(canPrepareAnswer(choice), false, "planning permission never enables AI");
    let received = false;
    const { result } = await fillSavedDetails({ scan, inspect, getPlan: async current => {
      received ||= current.questions.includes(prompt);
      return savedPlan(current, saved, page.url());
    }, progress: async () => {} });
    assert.ok(received);
    const expected = saved.enabled && saved.values.smsUpdates;
    assert.equal(await page.locator('[role="radio"][aria-checked="true"]').count(), expected ? 1 : 0);
    if (expected) {
      assert.equal(await page.locator('[role="radio"]').nth(expected === "No" ? 1 : 0).getAttribute("aria-checked"), "true");
      assert.equal(result.fields.find(field => field.label === prompt).state, "filled");
    }
    assert.equal(await page.evaluate(() => window.submitted), 0);
  }
  for (const suffix of [" I agree to marketing offers from third parties.", " I accept the privacy policy."]) {
    await load(choices.replace(prompt, prompt + suffix));
    await fillSavedDetails({ scan: await inspect(), inspect,
      getPlan: async scan => savedPlan(scan, { enabled: true, values: { smsUpdates: "Yes" } }, page.url()), progress: async () => {} });
    assert.equal(await page.evaluate(() => window.clicks), 0, "compound purposes and legal conditions are never answered by the SMS preference");
  }
  for (const url of ["https://careers.custom-employer.example/jobs/42/apply", "https://ats.rippling.com/example/jobs/d522f490-bd87-43a0-9383-b81c4bc91c44/apply"]) {
    await load(choices, url);
    const scan = await inspect();
    const choice = scan.fields.find(field => field.label === prompt);
    assert.ok(choice, "custom choices after Apply are enumerated");
    assert.deepEqual(choice.options, labels);
    assert.equal(choice.kind, "radio");
    assert.equal(choice.state, "needed");
    assert.equal(choice.canAnswer, false);
    assert.equal(choice.canRemember, false);
    assert.ok(scan.questions.includes(prompt));
    assert.equal((await inspect()).fields.find(field => field.label === prompt).id, choice.id, "stable core field token");
    assert.ok((await inspect("autofill-answer", { id: choice.id, label: prompt, answer: labels[0] })).error);
    const filled = await inspect("autofill", plan());
    assert.equal(filled.fields.find(field => field.label === prompt).state, "filled");
    assert.equal(await page.locator('input[type="radio"]:checked').count(), 0);
    assert.equal(await page.locator('[role="radio"][aria-checked="true"]').textContent().then(text => text.trim()), labels[0]);
    assert.deepEqual(await page.evaluate(() => [window.clicks, window.submitted]), [1, 0]);
    assert.equal((await inspect("autofill-focus", { id: choice.id, label: prompt })).error, undefined);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute("role")), "radio");
    assert.equal(await page.evaluate(() => window.clicks), 1, "focus never selects a consent choice");
    await page.locator('[role="radio"]').nth(1).click();
    const selected = (await inspect()).fields.find(field => field.label === prompt);
    assert.equal(selected.state, "kept");
    assert.equal(selected.canAnswer, false);
    assert.match(selected.reason, /You edited/);
    await inspect("autofill", plan());
    assert.equal(await page.locator('[role="radio"]').nth(1).getAttribute("aria-checked"), "true", "real trusted user selection survives a repeated pass");
    assert.equal(await page.evaluate(() => window.clicks), 2);
    assert.equal(Object.hasOwn(selected, "value"), false, "do not return selected applicant answers");
    await page.locator("#sms").evaluate(node => node.remove());
    assert.equal((await inspect()).fields.some(field => field.label === prompt), false, "detached controls disappear");
  }
  await load(choices);
  let result = await inspect("autofill", plan(prompt, "No", labels.slice(1)));
  assert.equal(result.fields.find(field => field.label === prompt).state, "filled");
  assert.equal(await page.locator('[role="radio"]').nth(1).getAttribute("aria-checked"), "true");
  await load(choices);
  await page.evaluate(() => { window.reject = true; });
  result = await inspect("autofill", plan());
  assert.equal(result.fields.find(field => field.label === prompt).state, "needed");
  assert.match(result.fields.find(field => field.label === prompt).reason, /did not confirm/);
  await inspect("autofill", plan());
  assert.equal(await page.evaluate(() => window.clicks), 1, "rejected widgets are not repeatedly clicked");
  for (const behavior of ["extra-selection", "rollback"]) {
    await load(choices);
    await page.evaluate(behavior => {
      document.querySelector('[role="radio"]').onclick = () => {
        for (const choice of document.querySelectorAll('[role="radio"]')) choice.setAttribute("aria-checked", "true");
        if (behavior === "rollback") setTimeout(() => {
          for (const choice of document.querySelectorAll('[role="radio"]')) choice.setAttribute("aria-checked", "false");
        }, 25);
      };
    }, behavior);
    result = await inspect("autofill", plan());
    assert.equal(result.fields.find(field => field.label === prompt).state, "needed", "extra/reverted selections must never report success");
  }
  for (const mutation of [
    body => body.replace('aria-checked="false"', 'aria-checked="mixed"'),
    body => body.replace('aria-checked="false"', 'aria-checked="false" aria-disabled="true"'),
    body => body.replace('role="radiogroup"', 'role="radiogroup" aria-readonly="true"'),
    body => body.replace(labels[1], labels[0]),
    body => body.replace('role="radiogroup"', 'role="group"'),
    body => body.replaceAll('aria-checked="false"', 'aria-checked="true"'),
    body => body.replace('role="radiogroup"', 'role="radiogroup" aria-owns="elsewhere"'),
  ]) {
    await load(mutation(choices));
    await inspect("autofill", plan());
    assert.equal(await page.evaluate(() => window.clicks), 0, "mixed/disabled/ambiguous/unowned choices are never clicked");
  }
  await load(choices + choices.replaceAll('id="sms"', 'id="other-sms"'));
  await inspect("autofill", plan());
  assert.equal(await page.evaluate(() => window.clicks), 0, "duplicate question scope is ambiguous");
  await load(choices);
  await inspect("autofill", plan(prompt, "Maybe", []));
  assert.equal(await page.evaluate(() => window.clicks), 0, "no fuzzy option matching");
  await load(choices.replace('</div></div></div></div>', '<div role="radio" hidden aria-checked="false">Later</div></div></div></div></div>'));
  result = await inspect("autofill", plan());
  assert.equal(result.fields.find(field => field.label === prompt).canAnswer, false, "incomplete visible groups remain enumerated but manual");
  assert.equal(await page.evaluate(() => window.clicks), 0);
  for (const role of ["checkbox", "switch"]) {
    const label = "Receive text messages about my application";
    await load(`<button type="button" role="${role}" aria-checked="false">${label}</button>`);
    result = await inspect("autofill", plan(label));
    assert.equal(result.fields.find(field => field.label === label).state, "filled");
    assert.equal(await page.locator(`[role="${role}"]`).getAttribute("aria-checked"), "true");
    await page.locator(`[role="${role}"]`).click();
    result = await inspect("autofill", plan(label));
    assert.equal(await page.locator(`[role="${role}"]`).getAttribute("aria-checked"), "false", "trusted user-cleared ARIA boolean is not refilled");
    assert.match(result.fields.find(field => field.label === label).reason, /You edited/);
    assert.equal(result.fields.find(field => field.label === label).canAnswer, false);
    await load(`<div role="${role}" tabindex="0" aria-checked="false">${label}</div>`);
    result = await inspect("autofill", plan(label, "No", []));
    assert.equal(result.fields.find(field => field.label === label).state, "filled");
    assert.equal(await page.evaluate(() => window.clicks), 0, "explicit No confirms false without toggling");
    await load(`<div role="${role}" tabindex="0" aria-checked="false">${label}</div>`);
    await inspect();
    await page.locator(`[role="${role}"]`).evaluate(node => {
      node.onkeydown = event => {
        if (event.code === "Space") {
          event.preventDefault();
          node.setAttribute("aria-checked", String(node.getAttribute("aria-checked") !== "true"));
        }
      };
    });
    await page.locator(`[role="${role}"]`).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Space");
    await inspect("autofill", plan(label));
    assert.equal(await page.evaluate(() => window.clicks), 0, "trusted keyboard edits are preserved");
  }
  for (const label of ["I consent to the privacy policy", `${prompt} I certify my answers are accurate.`]) {
    await load(`<div role="checkbox" aria-checked="false">${label}</div>`);
    await inspect("autofill", plan(label));
    assert.equal(await page.evaluate(() => window.clicks), 0, "saved communication preferences do not bypass legal attestations");
  }
  await load('<button role="checkbox" aria-checked="false">Receive text messages about my application</button>');
  await inspect("autofill", plan("Receive text messages about my application"));
  assert.deepEqual(await page.evaluate(() => [window.clicks, window.submitted]), [0, 0], "submit buttons never become choice targets");
  await load(choices.replace('role="radiogroup" id="sms"', 'role="radiogroup" id="sms" aria-label="Text message preference"'));
  assert.ok((await inspect()).fields.some(field => field.label === "Text message preference"), "explicit accessible group name takes precedence");
  await load(`<p>${prompt}</p><div role="radiogroup"><div role="radio" aria-checked="false">Yes</div><div role="radio" aria-checked="false">No</div></div>`);
  assert.ok((await inspect()).fields.some(field => field.label === prompt), "direct adjacent prompts work without vendor wrappers");
  await load('<p>Unrelated text</p><div><div role="checkbox" tabindex="0" aria-checked="false">Receive email updates</div><div role="switch" tabindex="0" aria-checked="true" aria-label="Job alerts"></div></div>');
  let scan = await inspect();
  assert.equal(scan.fields.find(field => field.label === "Receive email updates").canAnswer, false);
  assert.equal(scan.fields.find(field => field.label === "Job alerts").state, "kept");
  await load('<div role="radiogroup" aria-label="Native choice"><div role="radio"><label>Yes<input type="radio" name="native"></label></div><div role="radio"><label>No<input type="radio" name="native"></label></div></div>');
  scan = await inspect();
  assert.equal(scan.fields.filter(field => field.label === "Native choice").length, 1, "native-backed choices are not duplicated");
  assert.equal(scan.fields.find(field => field.label === "Native choice").canAnswer, true);
  await load(choices.replace('style="display:none"', 'style="display:block"'));
  scan = await inspect();
  assert.equal(scan.fields.filter(field => field.kind === "radio").length, 1);
  assert.equal(scan.fields.find(field => field.label === prompt).canAnswer, false, "partial native group remains entirely manual");
  for (const body of [`<div hidden>${choices}</div>`, `<div inert>${choices}</div>`, `<div aria-hidden="true">${choices}</div>`, `<p>${prompt}</p>`]) {
    await load(body);
    assert.equal((await inspect()).fields.some(field => field.label === prompt), false, "hidden controls and display-only consent prose are not questions");
  }
  await load('<div role="listbox"><div role="checkbox" aria-checked="false">Canada</div></div><div role="menu"><div role="radio" aria-checked="false">Menu option</div></div>');
  assert.equal((await inspect()).fields.some(field => ["Canada", "Menu option"].includes(field.label)), false, "popup options are not independent questions");
  await load('<div role="radio" aria-checked="false">Choice</div>'.repeat(501));
  assert.match((await inspect()).error, /too large/, "custom controls participate in the DOM budget");
  console.log("PASS generic ARIA radio/checkbox/switch DOM selection and rejection, exact saved answers, trusted click/keyboard edit preservation, no hidden writes or submissions");

  if (process.argv.includes("--live-readonly")) {
    const reports = JSON.parse(await readFile("output/playwright/live-forms/report.json", "utf8"));
    const url = reports.find(report => new URL(report.url).hostname === "ats.rippling.com")?.url;
    assert.ok(url, "Expected a public Rippling URL in the existing live report");
    const context = await browser.newContext({ serviceWorkers: "block" });
    let blockedWrites = 0;
    await context.route("**/*", route => {
      if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) { blockedWrites++; return route.abort(); }
      return route.continue();
    });
    await context.routeWebSocket("**/*", socket => socket.close());
    const live = await context.newPage();
    try {
      await live.goto(url, { waitUntil: "networkidle", timeout: 45000 });
      await live.locator('[role="radiogroup"]').waitFor();
      const evidence = await live.locator('[role="radiogroup"]').evaluate(group => ({
        insideForm: Boolean(group.closest("form")), frames: document.querySelectorAll("iframe").length,
        visibleChoices: [...group.querySelectorAll('[role="radio"]')].map(node => ({ role: node.role, checked: node.getAttribute("aria-checked"), rects: node.getClientRects().length })),
        nativeInputs: [...group.querySelectorAll('input[type="radio"]')].map(input => ({ display: getComputedStyle(input).display, checked: input.checked })),
      }));
      const result = await live.evaluate(code => (0, eval)(code)("inspect"), source);
      const field = result.fields.find(field => /agreement to receive text message updates/i.test(field.label));
      assert.ok(field, "live consent group is no longer omitted");
      assert.equal(field.canAnswer, false);
      assert.equal(field.options.length, 2);
      assert.equal(await live.locator('input[type="radio"]:checked').count(), evidence.nativeInputs.filter(input => input.checked).length);
      await mkdir("output/playwright/live-forms", { recursive: true });
      const report = { url, auditMode: "inspect only; no clicks, filling, uploads or submissions", evidence, field, blockedWrites };
      await writeFile("output/playwright/live-forms/rippling-consent-audit.json", JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
