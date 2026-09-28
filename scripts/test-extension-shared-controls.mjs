import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";
import { fillSavedDetails } from "../extensions/chrome/answer-runner.mjs";

const source = `(${createInspector.toString()})(${applicationContext.toString()},(${createHistoryInspector.toString()})(),(${createAutofillInspector.toString()})())`;
const base = `<h1>Software engineer application</h1><form><label>First name<input></label><label>Email<input type="email"></label>`;
const contact = { givenName: "Jordan", email: "jordan@example.test", country: "CA", linkedInUrl: "https://www.linkedin.com/in/example" };
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  let html;
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
  const load = async extra => {
    html = `${base}${extra}<button id="submit">Submit application</button></form><script>window.submitted=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submitted++}</script>`;
    await page.goto("https://careers.custom-employer.example/jobs/42/apply");
    await page.evaluate(code => { window.inspect = (0, eval)(code); }, source);
  };
  const inspect = (mode = "inspect", payload = {}) => page.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
  await load(`<fieldset><legend>Gender identity</legend><label><input type="radio" name="gender">Female</label><label><input type="radio" name="gender">Male</label></fieldset>
    <label>Receive text messages about my application<input type="checkbox" id="sms"></label>
    <label>I certify all answers are accurate<input type="checkbox" id="certify"></label>
    <label>Country<input list="countries"><datalist id="countries"><option value="Canada"><option value="United States"></datalist></label>`);
  const plan = { contact, commonAnswers: [
    { label: "Gender identity", answer: "Woman", alternatives: ["Female"], answerKey: "gender" },
    { label: "Receive text messages about my application", answer: "No", answerKey: "smsUpdates" },
    { label: "I certify all answers are accurate", answer: "Yes", answerKey: "forbidden" },
  ] };
  let result = await inspect("autofill", plan);
  assert.equal(await page.getByLabel("Female", { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel("Country", { exact: true }).inputValue(), "Canada");
  assert.equal(await page.locator("#sms").isChecked(), false);
  assert.equal(result.fields.find(f => f.label.startsWith("Receive text")).state, "filled", "explicit No is an answered optional checkbox");
  assert.equal(await page.locator("#certify").isChecked(), false);
  await inspect("autofill", { commonAnswers: [{ ...plan.commonAnswers[1], answer: "Yes" }] });
  assert.equal(await page.locator("#sms").isChecked(), true);
  await inspect("autofill", plan);
  assert.equal(await page.locator("#sms").isChecked(), true, "existing checked choice is preserved");
  await page.locator("#sms").uncheck();
  await inspect("autofill", { commonAnswers: [{ ...plan.commonAnswers[1], answer: "Yes" }] });
  assert.equal(await page.locator("#sms").isChecked(), false, "user's unchecked choice is preserved on a repeat run");
  await inspect("autofill-undo");
  assert.equal(await page.locator("#sms").isChecked(), false, "undo does not restore an edited opt-in");
  console.log("PASS generic radios with explicit equivalents, checkbox preferences, datalist and protected attestations");
  await load(`<fieldset><legend>Gender identity</legend><label><input type="checkbox" name="gender">Female</label><label><input type="checkbox" name="gender">Male</label></fieldset>
    <label>Country<select multiple><option value="ca">Canada</option><option value="us">United States</option></select></label>`);
  await inspect("autofill", plan);
  assert.equal(await page.getByLabel("Female", { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel("Male", { exact: true }).isChecked(), false);
  assert.deepEqual(await page.locator("select").evaluate(select => [...select.selectedOptions].map(option => option.value)), ["ca"]);
  await inspect("autofill", { commonAnswers: [{ ...plan.commonAnswers[0], answer: "Man", alternatives: ["Male"] }] });
  assert.equal(await page.getByLabel("Male", { exact: true }).isChecked(), false, "existing multi-choice answers are not extended");
  console.log("PASS explicit saved choices in checkbox groups and empty native multi-selects");

  const countryQuestion = "Please select the country (or countries) where you have work authorization:";
  const countriesPlan = { commonAnswers: [{ label: countryQuestion, answer: "Canada", selections: ["Canada", "United States"], answerKey: "authorizedCountries" }] };
  await load(`<fieldset><legend>${countryQuestion}</legend><label><input type="checkbox" name="countries">Canada (CA)</label><label><input type="checkbox" name="countries">United Kingdom (UK)</label><label><input type="checkbox" name="countries">United States (USA)</label></fieldset>`);
  result = await inspect("autofill", countriesPlan);
  assert.equal(await page.getByLabel("Canada (CA)", { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel("United States (USA)", { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel("United Kingdom (UK)", { exact: true }).isChecked(), false);
  assert.equal(result.fields.find(field => field.label === countryQuestion).state, "filled");
  await page.getByLabel("Canada (CA)", { exact: true }).uncheck();
  await inspect("autofill", countriesPlan);
  assert.equal(await page.getByLabel("Canada (CA)", { exact: true }).isChecked(), false, "existing partial selections are preserved");
  await page.getByLabel("United States (USA)", { exact: true }).uncheck();
  result = await inspect("autofill", countriesPlan);
  assert.equal(await page.getByLabel("Canada (CA)", { exact: true }).isChecked(), false, "clearing every choice does not authorize reselection");
  assert.equal(await page.getByLabel("United States (USA)", { exact: true }).isChecked(), false);
  assert.equal(result.fields.find(field => field.label === countryQuestion).canAnswer, false);
  await load(`<label>${countryQuestion}<select multiple><option value="ca">Canada (CA)</option><option value="us">United States (USA)</option><option value="uk">United Kingdom</option></select></label>`);
  result = await inspect("autofill", countriesPlan);
  assert.deepEqual(await page.locator("select").evaluate(select => [...select.selectedOptions].map(option => option.value)), ["ca", "us"]);
  assert.equal(result.fields.find(field => field.label === countryQuestion).state, "filled");
  await load(`<label>${countryQuestion}<select multiple id="countries"><option value="ca">Canada (CA)</option><option value="us">United States (USA)</option><option value="uk">United Kingdom</option></select></label>
    <script>document.querySelector('#countries').onchange=()=>document.querySelector('[value=uk]').selected=true;</script>`);
  result = await inspect("autofill", { commonAnswers: [{ ...countriesPlan.commonAnswers[0], selections: ["Canada"] }] });
  assert.deepEqual(await page.locator("#countries").evaluate(select => [...select.selectedOptions].map(option => option.value)), ["ca", "uk"]);
  assert.equal(result.fields.find(field => field.label === countryQuestion).state, "needed", "unexpected additional option must not report successful authorization");
  assert.match(result.fields.find(field => field.label === countryQuestion).reason, /did not confirm every saved choice/);
  await load(`<fieldset><legend>${countryQuestion}</legend><label><input type="checkbox" name="countries">Canada (CA)</label><label><input type="checkbox" name="countries" disabled>United States (USA)</label></fieldset>`);
  await inspect("autofill", countriesPlan);
  assert.equal(await page.getByLabel("Canada (CA)", { exact: true }).isChecked(), false, "preflight prevents a partial write when any required choice is disabled");
  console.log("PASS explicit multi-country checkbox/native selections, no guessed countries or overwrites");

  const asyncPicker = `<label for="country">Country</label><input id="country" role="combobox" aria-controls="options" aria-expanded="false"><div id="options" role="listbox" hidden></div>
    <script>const input=document.querySelector('#country'),list=document.querySelector('#options');
    input.onclick=()=>{list.hidden=false;input.setAttribute('aria-expanded','true')};
    input.oninput=()=>{list.innerHTML='';setTimeout(()=>{if(input.value.toLowerCase()==='canada')list.innerHTML='<div role="option">Canada</div>'},90)};
    list.onclick=e=>{input.value=e.target.textContent;e.target.setAttribute('aria-selected','true');list.hidden=true;input.setAttribute('aria-expanded','false')};</script>`;
  await load(asyncPicker);
  result = await inspect("autofill", { contact });
  assert.equal(await page.locator("#country").inputValue(), "Canada");
  assert.equal(result.fields.find(f => f.profileKey === "country").state, "filled");
  await inspect("autofill", { contact: { country: "US" } });
  assert.equal(await page.locator("#country").inputValue(), "Canada");
  console.log("PASS generic asynchronous searchable combobox selects and verifies country");
  await load(asyncPicker.replace('<div role="option">Canada</div>', '<div role="option">Canada</div><div role="option">Canada</div>'));
  result = await inspect("autofill", { contact });
  assert.equal(await page.locator("#country").inputValue(), "", "ambiguous matches must clear transient search");
  assert.equal(result.fields.find(f => f.profileKey === "country").state, "needed");
  console.log("PASS ambiguous dropdown results remain empty, never silently choose the first");

  const shadowPicker = async (config = {}) => {
    await load("");
    await page.evaluate(({ base, config }) => {
      document.querySelector("form").remove();
      const host = document.createElement("div");
      host.id = "application-host";
      document.body.append(host);
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = `${base}<label for="country">Country</label>${config.input
        ? '<input id="country" role="combobox" aria-owns="options" aria-expanded="false">'
        : '<button id="country" type="button" role="combobox" aria-controls="options" aria-expanded="false">Select one</button>'}
        <label>Motivation<textarea aria-describedby="help"></textarea></label><p id="help">Maximum 8 words. Maximum 120 characters.</p>
        <button type="submit">Submit application</button></form>`;
      root.querySelector("form").onsubmit = event => { event.preventDefault(); window.submitted++; };
      document.body.insertAdjacentHTML("beforeend", '<p id="help">Maximum 1 word. Maximum 1 character.</p><input id="document-search" aria-label="Search" aria-controls="options"><div id="options" role="listbox"><div role="option">Canada</div></div>');
      window.documentClicks = 0;
      document.querySelector("#options").onclick = () => window.documentClicks++;
      const pane = document.createElement("div");
      pane.hidden = true;
      pane.innerHTML = '<input id="picker-search" aria-label="Search" type="search" aria-controls="options"><div id="options" role="listbox"><div role="option">United States</div></div>';
      (config.documentPortal ? document.body : root).append(pane);
      const field = root.querySelector("#country"), list = pane.querySelector('[role="listbox"]');
      const search = pane.querySelector("input");
      if (config.reflected) {
        field.ariaControlsElements = [list];
        search.ariaControlsElements = [list];
      }
      if (config.duplicateList) {
        const duplicate = document.createElement("div");
        duplicate.id = "options";
        duplicate.setAttribute("role", "listbox");
        duplicate.hidden = true;
        root.append(duplicate);
      }
      if (config.duplicateSearch) pane.append(search.cloneNode());
      if (config.duplicateHelp) root.querySelector("#help").after(root.querySelector("#help").cloneNode(true));
      field.onclick = () => { pane.hidden = !pane.hidden; field.setAttribute("aria-expanded", String(!pane.hidden)); };
      const filter = value => {
        list.replaceChildren();
        setTimeout(() => {
          if (value.toLowerCase() === "canada") list.innerHTML = '<div role="option">Canada</div>';
        }, 60);
      };
      if (config.input) field.oninput = () => filter(field.value);
      else search.oninput = () => filter(search.value);
      window.shadowClicks = 0;
      list.onclick = event => {
        if (event.target.getAttribute("role") !== "option") return;
        window.shadowClicks++;
        event.target.setAttribute("aria-selected", "true");
        if (config.input) field.value = event.target.textContent;
        else field.textContent = event.target.textContent;
        pane.hidden = true;
        field.setAttribute("aria-expanded", "false");
      };
    }, { base, config });
  };
  for (const config of [{}, { input: true }, { documentPortal: true, reflected: true }]) {
    await shadowPicker(config);
    const before = await inspect();
    const motivation = before.fields.find(field => field.label === "Motivation");
    assert.equal(motivation.maxWords, 8, "help resolves within the field root, not the document's duplicate ID");
    assert.equal(motivation.maxLength, 120);
    result = await inspect("autofill", { contact });
    assert.equal(result.fields.find(field => field.profileKey === "country").state, "filled", JSON.stringify(config));
    assert.equal(await page.evaluate(() => window.shadowClicks), 1);
    assert.equal(await page.evaluate(() => window.documentClicks), 0, "unowned document list is never selected");
    assert.equal(await page.locator("#document-search").inputValue(), "", "document search decoy is untouched");
    assert.equal(await page.evaluate(() => window.submitted), 0);
  }
  for (const config of [{ duplicateList: true }, { duplicateSearch: true }, { documentPortal: true }]) {
    await shadowPicker(config);
    result = await inspect("autofill", { contact });
    assert.equal(result.fields.find(field => field.profileKey === "country").state, "needed", JSON.stringify(config));
    assert.equal(await page.evaluate(() => window.shadowClicks + window.documentClicks), 0, "ambiguous or cross-root ID references remain manual");
    assert.equal(await page.locator("#document-search").inputValue(), "");
    assert.equal(await page.evaluate(() => window.submitted), 0);
  }
  await shadowPicker({ duplicateHelp: true });
  assert.equal((await inspect()).fields.find(field => field.label === "Motivation").maxWords, undefined, "duplicate root help IDs are not arbitrarily resolved");
  console.log("PASS whole-shadow comboboxes, root-scoped help/search, explicit reflected portals and ambiguous/unowned lookup guards");

  await load(asyncPicker);
  await page.evaluate(() => document.body.append(document.querySelector("#options")));
  result = await inspect("autofill", { contact });
  assert.equal(result.fields.find(field => field.profileKey === "country").state, "filled", "document-root portal outside the form stays supported");
  assert.equal(await page.evaluate(() => window.submitted), 0);
  console.log("PASS document-root portal remains owned through its explicit ARIA relation");

  await load(`<label>How did you hear about this job?<select id="source"><option value="">Choose</option><option>Other</option></select></label>
    <script>document.querySelector('#source').onchange=()=>setTimeout(()=>{if(!document.querySelector('#detail'))document.querySelector('#source').closest('label').insertAdjacentHTML('afterend','<label>If Other, please specify<input id="detail"></label>')},50)</script>`);
  const saved = await fillSavedDetails({ scan: await inspect(), inspect,
    getPlan: async scan => ({ contact, commonAnswers: scan.questions.map(label => label === "How did you hear about this job?"
      ? { label, answer: "ApplyOverflow", alternatives: ["Other"], answerKey: "jobSource" }
      : { label, answer: "ApplyOverflow", answerKey: "sourceDetails", dependsOn: { answerKey: "jobSource", answer: "Other" } }) }),
    progress: async () => {},
  });
  assert.equal(await page.locator("#source").inputValue(), "Other");
  assert.equal(await page.locator("#detail").inputValue(), "ApplyOverflow");
  assert.equal(saved.result.fields.filter(f => f.state === "filled").length, 4);
  assert.equal(await page.evaluate(() => window.submitted), 0);
  await page.getByLabel("First name", { exact: true }).fill("");
  const afterEdit = await inspect();
  assert.equal(afterEdit.fields.find(field => field.profileKey === "givenName").retryable, false);
  await fillSavedDetails({ scan: afterEdit, inspect, getPlan: async () => ({ contact }), progress: async () => {} });
  assert.equal(await page.getByLabel("First name", { exact: true }).inputValue(), "", "whole-plan reactivity passes cannot refill a user-cleared scalar");
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({ path: "output/playwright/autofill-shared-controls.png", fullPage: true });
  console.log("PASS one-click dynamic dependent question fill, final DOM readback, no submission");
} finally { await browser.close(); }
