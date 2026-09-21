import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";

const source = `(${createInspector.toString()})(${applicationContext.toString()},(${createHistoryInspector.toString()})(),(${createAutofillInspector.toString()})())`;
const urls = {
  greenhouse: "https://job-boards.greenhouse.io/fixture/jobs/123",
  lever: "https://jobs.lever.co/fixture/00000000-0000-4000-8000-000000000000/apply",
  ashby: "https://jobs.ashbyhq.com/fixture/00000000-0000-4000-8000-000000000000/application",
  workday: "https://fixture.wd1.myworkdayjobs.com/en-US/External/job/Toronto/Analyst_R123/apply/myInformation",
  icims: "https://careers-fixture.icims.com/jobs/123/analyst/job?mode=apply",
  workable: "https://apply.workable.com/fixture/j/ABCD123456/apply/",
  generic: "https://careers.fixture.example/application/123",
};
const names = {
  greenhouse: ['id="first_name"', 'id="last_name"', 'id="email"'],
  lever: ['name="first" autocomplete="given-name"', 'name="last" autocomplete="family-name"', 'name="email"'],
  ashby: ['id="first" autocomplete="given-name"', 'id="last" autocomplete="family-name"', 'id="_systemfield_email"'],
  workday: ['data-automation-id="legalNameSection_firstName"', 'data-automation-id="legalNameSection_lastName"', 'data-automation-id="email"'],
  icims: ['name="PersonProfileFields.FirstName"', 'name="PersonProfileFields.LastName"', 'name="PersonProfileFields.Email"'],
  workable: ['id="firstname" name="firstname" data-ui="firstname"', 'id="lastname" name="lastname" data-ui="lastname"', 'id="email" name="email" data-ui="email"'],
  generic: ['autocomplete="given-name"', 'autocomplete="family-name"', 'autocomplete="email"'],
};
const base = provider => `<h1>Analyst application</h1><form data-ui="application-form" class="ashby-application-form-container">
  <label>First name<input ${names[provider][0]}></label><label>Last name<input ${names[provider][1]}></label><label>Email<input type="email" ${names[provider][2]}></label>
  <label>Address line 1<input autocomplete="address-line1"></label><label>City<input autocomplete="address-level2"></label>
  <label>Country<select autocomplete="country"><option value="">Choose</option><option value="can">Canada</option><option value="usa">United States</option></select></label>
  <label>Province<select autocomplete="address-level1"><option value="">Choose</option><option value="ont">Ontario</option><option value="cal">California</option></select></label>
  <label>Relevant project<textarea></textarea></label><label>Preferred name<input></label><label>Pronouns<input></label>
  <fieldset><legend>Reference details</legend><label>Email<input autocomplete="email"></label></fieldset>
  <label>Do you require visa sponsorship?<input></label><label>I agree<input type="checkbox"></label>
  <button type="button" id="next">Next</button><button id="submit">Submit</button></form>
  <script>window.actions=0;document.querySelector('form').onsubmit=e=>e.preventDefault();document.querySelectorAll('button').forEach(b=>b.onclick=()=>window.actions++)</script>`;
const plan = { contact: { givenName: "Jordan", familyName: "Example", email: "jordan@example.test", streetAddress: "123 Test St", city: "Toronto", country: "CA", region: "ON", preferredName: "Jo", pronouns: "they/them" }, answers: [{ label: "Relevant project", answer: "Built a test application." }] };
const browser = await chromium.launch();
try {
  const page = await browser.newPage(); let html;
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
  const load = async (provider, extra = "") => {
    html = base(provider).replace("</form>", `${extra}</form>`);
    await page.goto(urls[provider]); await page.evaluate(code => { window.inspect = (0, eval)(code); }, source);
  };
  const inspect = (mode = "inspect", payload = {}) => page.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
  for (const provider of Object.keys(urls)) {
    await load(provider);
    const started = performance.now();
    const result = await inspect("autofill", plan);
    assert.equal(result.error, undefined, provider);
    assert.equal(await page.getByLabel("First name", { exact: true }).inputValue(), "Jordan", provider);
    assert.equal(await page.getByLabel("Last name", { exact: true }).inputValue(), "Example", provider);
    assert.equal(await page.locator('select[autocomplete="country"]').inputValue(), "can", provider);
    assert.equal(await page.locator('select[autocomplete="address-level1"]').inputValue(), "ont", provider);
    assert.equal(await page.getByLabel("Address line 1").inputValue(), "123 Test St", provider);
    assert.equal(await page.getByLabel("Relevant project").inputValue(), "Built a test application.");
    assert.equal(await page.locator("fieldset input").inputValue(), "");
    assert.equal(await page.getByLabel("Do you require visa sponsorship?").inputValue(), "");
    assert.equal(await page.getByLabel("I agree").isChecked(), false);
    assert.equal(await page.evaluate(() => window.actions), 0);
    assert.ok(performance.now() - started < 1500, `${provider}: local fill under 1.5 seconds`);
    await page.getByLabel("Last name", { exact: true }).fill("User edited");
    await inspect("autofill", plan);
    assert.equal(await page.getByLabel("Last name", { exact: true }).inputValue(), "User edited");
    await inspect("autofill-undo");
    assert.equal(await page.getByLabel("First name", { exact: true }).inputValue(), "");
    assert.equal(await page.getByLabel("Last name", { exact: true }).inputValue(), "User edited");
    console.log(`PASS ${provider}: one-click profile, address, selects, saved answer, preserve/undo, no submission`);
  }
  await load("greenhouse");
  let result = await inspect("autofill", { contact: { email: "jordan@example.test" } });
  const first = result.fields.find(item => item.profileKey === "givenName");
  assert.equal(first.state, "needed");
  result = await inspect("autofill-answer", { id: first.id, label: first.label, answer: "Jordan" });
  assert.equal(result.answered.profileKey, "givenName");
  assert.equal(await page.getByLabel("First name", { exact: true }).inputValue(), "Jordan");
  assert.match((await inspect("autofill-answer", { id: first.id, label: "Changed label", answer: "Other" })).error, /changed/);
  await page.getByLabel("First name", { exact: true }).evaluate(input => input.replaceWith(input.cloneNode()));
  assert.match((await inspect("autofill-answer", { id: first.id, label: first.label, answer: "Other" })).error, /changed/);
  await load("greenhouse", '<label>First name<input autocomplete="given-name"></label>');
  result = await inspect("autofill", plan);
  assert.equal(await page.getByLabel("First name", { exact: true }).first().inputValue(), "");
  assert.equal(result.fields.filter(item => item.profileKey === "givenName").every(item => !item.canAnswer), true);
  console.log("PASS missing-profile checklist, direct answer, stale token and duplicate identity protection");
  await load("greenhouse", '<fieldset><legend>Phone</legend><label>Country<select><option value="">Choose</option><option value="can">Canada +1</option></select></label><label>Phone<input id="phone" type="tel" autocomplete="off"></label></fieldset>');
  result = await inspect("autofill", { ...plan, contact: { ...plan.contact, phone: "+14165550123" }, answers: [{ label: "Country", answer: "Canada +1" }] });
  assert.equal(await page.locator("#phone").inputValue(), "+14165550123");
  assert.equal(await page.locator("fieldset select").inputValue(), "", "phone country is not inferred from residence or reusable custom answers");
  assert.equal(await page.locator('select[autocomplete="country"]').inputValue(), "can");
  console.log("PASS live Greenhouse phone grouping and separate phone-country semantics");
  await inspect("autofill", { contact: { phoneCountry: "CA" } });
  assert.equal(await page.locator("fieldset select").inputValue(), "can", "explicit phone country may select Canada +1");
  await load("greenhouse", '<label>Preferred First Name<input></label><label>Address<input></label>');
  result = await inspect("autofill", { contact: { fullAddress: "123 Test St, Toronto, ON, M1A 1A1, Canada", preferredName: "Jo" } });
  assert.equal(await page.getByLabel("Address", { exact: true }).inputValue(), "123 Test St, Toronto, ON, M1A 1A1, Canada");
  assert.equal(result.fields.find(field => field.profileKey === "fullAddress").canRemember, false, "full address is derived, not a parallel profile value");
  assert.equal(await page.getByLabel("Preferred First Name", { exact: true }).inputValue(), "", "duplicate preferred-name fields need review");
  await load("greenhouse", '<fieldset><legend>Gender identity</legend><label><input type="radio" name="gender" value="woman">Woman</label><label><input type="radio" name="gender" value="man">Man</label></fieldset><label>Disability Status<select><option value="">Select</option><option>No, I do not have a disability and have not had one in the past</option><option>Yes, I have a disability, or have had one in the past</option></select></label>');
  await inspect("autofill", plan);
  assert.equal(await page.locator('[name="gender"]:checked').count(), 0, "no inferred sensitive answers");
  result = await inspect("autofill", { commonAnswers: [{ label: "Gender identity", answer: "Woman" }, { label: "Disability Status", answer: "No, I do not have a disability and have not had one in the past" }] });
  assert.equal(await page.locator('[name="gender"]:checked').inputValue(), "woman");
  assert.equal(result.fields.find(field => field.label === "Gender identity").state, "filled");
  await inspect("autofill", { commonAnswers: [{ label: "Gender identity", answer: "Man" }] });
  assert.equal(await page.locator('[name="gender"]:checked').inputValue(), "woman", "never replace an existing radio choice");
  assert.equal(await page.locator('select').last().inputValue(), "No, I do not have a disability and have not had one in the past");
  assert.equal(await page.getByLabel("I agree").isChecked(), false);
  console.log("PASS explicit phone country, full address, voluntary radio/select answers and no inferred sensitive values");
  await load("greenhouse");
  await page.locator('select[autocomplete="address-level1"]').evaluate(select => {
    select.outerHTML = '<button id="region" type="button" role="combobox" aria-label="Province" aria-controls="regions" aria-expanded="false">Select one</button><div id="regions" role="listbox" hidden><div role="option">Ontario</div><div role="option">California</div></div>';
    const button = document.getElementById("region"), list = document.getElementById("regions");
    button.onclick = () => { list.hidden = !list.hidden; button.setAttribute("aria-expanded", String(!list.hidden)); };
    list.onclick = e => { button.textContent = e.target.textContent; button.setAttribute("aria-expanded", "false"); list.hidden = true; };
  });
  const region = (await inspect()).fields.find(field => field.profileKey === "region");
  const choices = await inspect("autofill-options", { id: region.id, label: region.label });
  assert.deepEqual(choices.fields.find(field => field.id === region.id).options, ["Ontario", "California"]);
  assert.equal(await page.locator("#region").textContent(), "Select one", "loading choices must not select a value");
  assert.equal(await page.locator("#regions").isVisible(), false, "loading choices closes a menu it opened");
  assert.deepEqual((await inspect()).fields.find(field => field.id === region.id).options, ["Ontario", "California"]);
  await inspect("autofill", plan);
  assert.equal(await page.locator("#region").textContent(), "Ontario");
  assert.equal(await page.locator("#regions").isVisible(), false);
  console.log("PASS associated custom dropdown exact selection");
  await load("greenhouse");
  await page.locator('select[autocomplete="address-level1"]').evaluate(select => {
    select.closest("label").outerHTML = '<label for="region">Province</label><div class="select__value-container"><input id="region" role="combobox" aria-controls="regions" aria-expanded="false"></div><div id="regions" role="listbox" hidden><div role="option">Ontario</div><div role="option">California</div></div>';
    const input = document.getElementById("region"), list = document.getElementById("regions");
    input.onclick = () => { list.hidden = !list.hidden; input.setAttribute("aria-expanded", String(!list.hidden)); };
    list.onclick = e => {
      const value = document.createElement("div"); value.className = "select__single-value"; value.textContent = e.target.textContent;
      input.parentElement.append(value); input.value = ""; input.setAttribute("aria-expanded", "false"); list.hidden = true;
    };
  });
  result = await inspect("autofill", plan);
  assert.equal(result.fields.find(field => field.profileKey === "region").state, "filled");
  await inspect("autofill", { contact: { region: "CA" } });
  assert.equal(await page.locator(".select__single-value").textContent(), "Ontario", "preserve selected React Select value despite empty search input");
  console.log("PASS React Select readback and preservation of existing selections");
  await load("greenhouse");
  await page.evaluate(() => { window.poll = setInterval(() => void window.inspect(), 10); });
  result = await inspect("autofill", plan);
  assert.equal(result.fields.filter(item => item.state === "filled").length, 10, "read-only scans must not lose fill results");
  await page.evaluate(() => clearInterval(window.poll));
  await load("greenhouse");
  await page.getByLabel("First name", { exact: true }).evaluate(input => input.addEventListener("change", () => {
    history.pushState({}, "", location.pathname + "?different-job=1"); void window.inspect();
  }));
  await inspect("autofill", plan);
  assert.equal(await page.getByLabel("Last name", { exact: true }).inputValue(), "", "in-flight fill stops on navigation even if a scan resets state");
  console.log("PASS concurrent detection scans and mid-fill navigation guard");
  await load("workday", `<fieldset><legend>Work experience 1</legend><label>Job title<input id="job1"></label><label>Company<input></label></fieldset><fieldset><legend>Work experience 2</legend><label>Job title<input id="job2"></label><label>Company<input></label></fieldset>`);
  result = await inspect("autofill", { ...plan, history: [
    { kind: "experience", entry: { title: "Analyst", company: "Fixture One" } },
    { kind: "experience", entry: { title: "Engineer", company: "Fixture Two" } },
  ] });
  assert.equal(result.historyFilled, 4);
  assert.equal(await page.locator("#job1").inputValue(), "Analyst");
  assert.equal(await page.locator("#job2").inputValue(), "Engineer");
  assert.equal((await inspect("autofill", { ...plan, history: [{ kind: "experience", entry: { title: "Analyst", company: "Fixture One" } }] })).historyFilled, 0);
  console.log("PASS one-click existing history rows and no duplicate history entries");
  await load("greenhouse");
  await page.getByLabel("Email", { exact: true }).first().evaluate(input => input.addEventListener("change", () => { input.value = ""; }));
  result = await inspect("autofill", plan);
  assert.equal(result.fields.find(item => item.profileKey === "email").state, "needed");
  assert.equal(JSON.stringify(result).includes("Built a test application."), false, "report contains no filled values");
  console.log("PASS rejected writes stay pending; report excludes profile/answer values");
  await page.getByLabel("Email", { exact: true }).first().fill("not-an-email");
  const invalid = (await inspect()).fields.find(item => item.profileKey === "email");
  assert.equal(invalid.state, "needed");
  assert.equal(invalid.canAnswer, false, "invalid existing values need correction, not overwrite");

  const popup = await browser.newPage({ viewport: { width: 320, height: 780 } });
  await popup.route("https://extension.fixture/*", async route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    await route.fulfill({ contentType: file.endsWith("mjs") ? "text/javascript" : file.endsWith("css") ? "text/css" : file.endsWith("png") ? "image/png" : "text/html",
      body: file === "config.mjs" ? 'export const APP_ORIGIN="http://127.0.0.1:3004";export const BUILD_ID="fixture";' :
        await readFile(file === "icon.png" ? "public/brand/applyoverflow-favicon.png" : `extensions/chrome/${file}`) });
  });
  await popup.addInitScript(report => {
    window.calls = [];
    window.chrome = { permissions: { getAll: async () => ({ origins: [] }) }, runtime: { sendMessage: async message => {
      window.calls.push(message);
      return { buildId: "fixture", connected: true, email: "jordan@example.test", message: `${report.fields.filter(field => field.state === "filled").length} filled · ${report.fields.filter(field => field.state === "needed").length} to review. Nothing submitted.`, ...(message.type !== "status" ? { fields: report.fields } : {}) };
    } } };
  }, result);
  await popup.goto("https://extension.fixture/popup.html");
  await popup.getByRole("button", { name: "Autofill", exact: true }).click();
  await popup.locator("#fill-progress").waitFor();
  await popup.locator(".pending-field").filter({ hasText: "Email" }).first().locator("summary").click();
  assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await popup.getByRole("button", { name: "Change resume" }).isVisible(), true);
  assert.equal(await popup.evaluate(() => window.calls.some(call => call.type === "autofill")), true);
  await mkdir("output/playwright", { recursive: true });
  await popup.screenshot({ path: "output/playwright/extension-autofill-checklist.png", fullPage: true });
  console.log("PASS compact popup, single Autofill action, expandable checklist, no horizontal overflow");
  await popup.evaluate(() => {
    window.chrome.runtime.sendMessage = async message => { window.calls.push(message); return { connected: true, message: "Old worker" }; };
    window.chrome.runtime.reload = () => { window.reloaded = true; };
  });
  await popup.getByRole("button", { name: "Autofill", exact: true }).click();
  await popup.getByRole("button", { name: "Reload extension", exact: true }).waitFor();
  assert.equal(await popup.getByRole("button", { name: "Autofill", exact: true }).isDisabled(), true);
  await popup.getByRole("button", { name: "Reload extension", exact: true }).click();
  assert.equal(await popup.evaluate(() => window.reloaded), true);
  console.log("PASS mixed-version recovery without misleading Unsupported action");
} finally { await browser.close(); }
