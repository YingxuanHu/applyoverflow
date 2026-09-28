import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { createFormDetection } from "../extensions/chrome/form-detection.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";

const source = `(${createInspector})(${applicationContext},undefined,(${createAutofillInspector})())`;
const runtimePath = process.argv.find(arg => arg.startsWith("--runtime="))?.slice(10);
const installer = runtimePath ? `${await readFile(runtimePath, "utf8")}\nwindow.inspect=globalThis.__applyOverflowInspect;` : `window.inspect=${source};`;
const url = "https://jobs.ashbyhq.com/example/00000000-0000-4000-8000-000000000000/application";
const authorization = "Are you authorized to work in the country where this job is posted?";
const sponsorship = "Will you now or in the future require visa sponsorship to work in the location where this job is posted?";
const consent = "I consent to the processing of my personal information";
const pressed = (label, id, selected = "") => `<div><label for="${id}">${label}</label>
  <div id="${id}-buttons"><button aria-pressed="${selected === "yes"}" data-option="yes">Yes</button>
  <button aria-pressed="${selected === "no"}" data-option="no">No</button>
  <input type="checkbox" name="${id}" style="display:none" tabindex="-1"></div></div>`;
const radio = (title, name, values, selected = "") => `<fieldset><label for="${name}">${title}</label>
  <div><p>Choose an option</p></div>${values.map((value, index) => `<div><span>
  <input type="radio" name="${name}" id="${name}-${index}" ${value === selected ? "checked" : ""}></span>
  <label for="${name}-${index}">${value}</label></div>`).join("")}</fieldset>`;
const primary = `<div class="ashby-application-form-container" id="primary"><h2>Contact Information</h2>
  <label for="name">First and Last Name</label><input id="name" required>
  <label for="email">Email</label><input id="email" type="email" required>
  <div data-field-path="_systemfield_location"><label for="_systemfield_location">Location</label><div>
  <input id="location-control" placeholder="Start typing..." role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false">
  <button aria-label="Toggle suggestions"></button></div></div>
  ${pressed(authorization, "authorization")}${pressed(sponsorship, "sponsorship")}
  ${pressed("Can you attend the office?", "office", "yes")}${pressed(consent, "consent")}</div>`;
const survey = `<div class="ashby-survey-form-container"><div class="ashby-application-form-container">
  ${radio("Gender", "gender", ["Male", "Female", "Decline to self-identify"])}
  ${radio("Race", "race", ["Asian", "White", "Decline to self-identify"], "Decline to self-identify")}
  ${radio("Veteran status", "veteran", ["Yes", "No", "Decline to self-identify"])}</div></div>`;

const browser = await chromium.launch();
try {
  async function fixture(body, run, target = url) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><title>Application fixture</title>
        <h1>Analyst application</h1>${body}<script>window.clicks=0;window.submissions=0;
        document.addEventListener('click',e=>{if(e.target.closest('button'))window.clicks++});
        document.addEventListener('submit',e=>{e.preventDefault();window.submissions++});</script>` }));
      await page.goto(target);
      await page.evaluate(code => { (0, eval)(code); }, installer);
      const inspect = (mode = "inspect", payload = {}) => page.evaluate(
        ({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
      await run(page, inspect);
      assert.equal(await page.evaluate(() => window.submissions), 0);
    } finally { await context.close(); }
  }

  await test("Ashby compound Location, pressed questions and sibling demographic survey are reported", async () => {
    await fixture(`<div role="tabpanel" id="application"><div><input type="file"></div>${primary}${survey}
      <button type="submit">Submit application</button></div>`, async (page, inspect) => {
      const report = await inspect();
      assert.equal(report.error, undefined);
      const location = report.fields.find(field => field.label === "Location");
      assert.equal(location?.kind, "combobox", JSON.stringify(report));
      assert.equal(location.profileKey, "city");
      for (const label of [authorization, sponsorship, consent]) {
        const field = report.fields.find(field => field.label === label);
        assert.equal(field?.kind, "radio", label);
        assert.deepEqual(field.options, ["Yes", "No"]);
        assert.equal(field.state, "needed");
        assert.equal(field.canAnswer, false);
        assert.equal(field.canPlan, false);
      }
      assert.equal(report.fields.find(field => field.label === "Can you attend the office?")?.state, "kept");
      for (const label of ["Gender", "Race", "Veteran status"]) {
        const matches = report.fields.filter(field => field.label === label);
        assert.equal(matches.length, 1, `one grouped ${label} question`);
        assert.equal(matches[0].kind, "radio");
        assert.equal(matches[0].options.length, 3);
      }
      assert.equal(report.fields.find(field => field.label === "Race").state, "kept");
      assert.equal(report.employmentCountry, undefined);
      await inspect("autofill", { contact: { fullName: "Jordan Example", email: "fixture@example.test" },
        commonAnswers: [authorization, sponsorship, consent].map(label => ({ label, answerKey: "saved", answer: "Yes" })) });
      assert.equal(await page.locator("#name").inputValue(), "Jordan Example");
      assert.equal(await page.locator("#email").inputValue(), "fixture@example.test");
      assert.equal(await page.locator("#location-control").inputValue(), "");
      assert.equal(await page.locator('input[name="gender"]:checked,input[name="veteran"]:checked').count(), 0);
      assert.equal(await page.locator('input[name="race"]:checked').getAttribute("id"), "race-2");
      assert.equal(await page.locator('#authorization-buttons [aria-pressed="true"],#sponsorship-buttons [aria-pressed="true"],#consent-buttons [aria-pressed="true"]').count(), 0);
      assert.equal(await page.evaluate(() => window.clicks), 0, "detection never clicks submit-capable pressed buttons");
    });
  });

  for (const [name, body] of [
    ["survey outside the application panel", `<div role="tabpanel">${primary}</div>${survey}`],
    ["survey in another tab", `<div role="tabpanel">${primary}<div role="tabpanel">${survey}</div></div>`],
    ["unrelated native form in the panel", `<div role="tabpanel">${primary}${survey}<form><input aria-label="Account email"></form></div>`],
    ["unrelated value control in the panel", `<div role="tabpanel">${primary}${survey}<input aria-label="Account email"></div>`],
    ["hidden survey", `<div role="tabpanel">${primary}<div hidden>${survey}</div></div>`],
  ]) await test(`Ashby scope excludes ${name}`, async () => {
    await fixture(body, async (page, inspect) => {
      const report = await inspect();
      assert.equal(report.error, undefined);
      assert.ok(report.fields.some(field => field.label === "Location"));
      assert.ok(!report.fields.some(field => ["Gender", "Race", "Veteran status", "Account email"].includes(field.label)));
      assert.equal(await page.evaluate(() => window.clicks), 0);
    });
  });

  await test("multiple Ashby applications remain ambiguous", async () => {
    const second = `<div class="ashby-application-form-container"><label for="other-email">Email</label><input id="other-email" type="email"></div>`;
    await fixture(`<div role="tabpanel">${primary}${second}${survey}</div>`, async (page, inspect) => {
      assert.match((await inspect("autofill", { contact: { email: "fixture@example.test" } })).error, /single application form/);
      assert.equal(await page.locator('input[type="email"]').evaluateAll(nodes => nodes.some(node => node.value)), false);
    });
  });

  const labelCases = [
    ["one compound control", '<div><label for="missing">Current location</label><div><input id="target"><button type="button">Open</button></div></div>', "Current location"],
    ["competing controls", '<div><label for="missing">Current location</label><div><input id="target"><input></div></div>', ""],
    ["label bound elsewhere", '<input id="bound"><div><label for="bound">Current location</label><div><input id="target"></div></div>', ""],
    ["competing labels", '<div><label>City</label><label>Employer</label><input id="target"></div>', ""],
    ["invalid explicit ARIA", '<div><label>City</label><input id="target" aria-labelledby="missing"></div>', ""],
    ["popup search", '<div><label>City</label><div role="listbox"><input id="target"></div></div>', ""],
    ["outer form label", '<label>City</label><input id="target">', ""],
    ["nested group boundary", '<div><label>City</label><fieldset><input id="target"></fieldset></div>', ""],
  ];
  for (const [name, markup, expected] of labelCases) await test(`structural label recovery: ${name}`, async () => {
    await fixture(`<form>${markup}</form>`, async page => {
      const actual = await page.evaluate(({ source }) => (0, eval)(source)().labelFor(document.getElementById("target"), () => undefined), { source: `(${createFormDetection})` });
      assert.equal(actual, expected);
    });
  });

  await test("generic pressed groups are reported without provider classes and never answered", async () => {
    await fixture(`<form><label for="name">Full name</label><input id="name"><label for="email">Email</label><input id="email" type="email">
      ${pressed(authorization, "authorization")}${pressed(consent, "consent")}
      <button type="submit">Submit application</button></form>`, async (page, inspect) => {
      const report = await inspect("autofill", { contact: { email: "fixture@example.test" }, commonAnswers: [
        { label: authorization, answerKey: "work_authorization", answer: "Yes" },
        { label: consent, answerKey: "consent", answer: "Yes" },
      ] });
      assert.equal(report.error, undefined);
      for (const label of [authorization, consent]) {
        const field = report.fields.find(field => field.label === label);
        assert.equal(field?.kind, "radio");
        assert.equal(field.canAnswer, false);
        assert.equal(field.state, "needed");
      }
      assert.equal(await page.evaluate(() => window.clicks), 0);
    }, "https://careers.compound.example/jobs/42/apply");
  });
} finally { await browser.close(); }
