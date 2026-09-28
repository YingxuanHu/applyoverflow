import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";

const source = `(${createInspector})(${applicationContext},undefined,(${createAutofillInspector})())`;
const runtimePath = process.argv.find(arg => arg.startsWith("--runtime="))?.slice(10);
const installer = runtimePath ? `${await readFile(runtimePath, "utf8")}\nwindow.inspect=globalThis.__applyOverflowInspect;` : `window.inspect=${source};`;
const workday = "https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers/job/Analyst_R123/apply/myInformation";
const lever = "https://jobs.lever.co/achievers/00000000-0000-4000-8000-000000000000/apply";
const contact = {
  givenName: "Jordan", familyName: "Example", preferredName: "Jo", streetAddress: "123 Example Street",
  addressLine2: "Unit 2", city: "Toronto", region: "ON", postalCode: "M5V 1A1",
  phoneCountry: "CA", phone: "4165550100", linkedInUrl: "https://www.linkedin.com/in/fixture",
  portfolioUrl: "https://portfolio.example.test", email: "new@example.test", country: "US", currentCompany: "Saved Company",
};
const text = (label, id, attrs = "") => `<label for="${id}">${label}</label><input id="${id}" ${attrs}>`;
const contacts = `<div data-automation-id="legalNameSection">
  ${text("First name", "name--legalName--firstName", 'name="legalName--firstName"')}
  ${text("Last name", "name--legalName--lastName", 'name="legalName--lastName"')}
  ${text("Preferred name", "preferred")}</div><div data-automation-id="addressSection">
  ${text("Address line 1", "address--addressLine1", 'name="addressLine1"')}
  ${text("Address line 2", "address--addressLine2", 'name="addressLine2"')}
  ${text("City", "address--city", 'name="city"')}
  <label for="province">Province</label><select id="province"><option value="">Select</option><option value="ON">Ontario</option></select>
  ${text("Postal code", "address--postalCode", 'name="postalCode"')}
  <label for="country">Country</label><select id="country"><option value="CA" selected>Canada</option><option value="US">United States</option></select></div>
  <div data-automation-id="phoneSection"><label for="phone-country">Phone country</label>
  <select id="phone-country"><option value="">Select</option><option value="CA">Canada +1</option></select>
  ${text("Phone number", "phoneNumber--phoneNumber", 'name="phoneNumber" type="tel"')}</div>
  ${text("LinkedIn", "linkedin")}${text("Portfolio", "portfolio")}
  ${text("Email", "emailAddress--emailAddress", 'name="emailAddress" type="email" value="existing@example.test"')}`;
const prior = `<fieldset id="prior"><legend>Prior TD employment</legend>
  <label><input type="radio" name="prior" value="yes">Yes</label><label><input type="radio" name="prior" value="no">No</label>
  ${text("Previous employer", "previous-employer")}</fieldset>`;
const isolation = `<fieldset><legend>Reference details</legend><section aria-label="Contact information">${text("Email", "reference-email")}</section></fieldset>
  <section aria-labelledby="history-heading"><h3 id="history-heading">Work experience</h3>
  <section aria-label="Contact information">${text("City", "employer-city")}</section></section>
  <div data-automation-id="workExperience-1">${text("First name", "history-name")}</div>
  <div data-automation-id="education-1">${text("City", "school-city")}</div>
  <fieldset aria-label="Emergency contact">${text("Phone number", "emergency-phone")}</fieldset>`;
const workdayBody = (outside = false) => `<h1>Analyst application</h1>${outside ? '<section><h2>Employment opportunities</h2>' : ""}
  <form><section data-automation-id="applyFlowPage">
  <nav aria-label="Application progress"><ol><li aria-current="step">My Information</li><li>My Experience</li><li>Application Questions</li></ol></nav>
  <div data-automation-id="pageHeaderTitle">My Information</div>${prior}${contacts}${isolation}</section>
  <button type="button" id="next">Save and Continue</button><button type="submit">Submit application</button></form>${outside ? "</section>" : ""}`;

const browser = await chromium.launch();
try {
  async function fixture(body, url, run) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const html = `<!doctype html><title>Application fixture</title>${body}<script>
        window.submissions=0;window.navigation=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submissions++};
        document.querySelector('#next').onclick=()=>window.navigation++;</script>`;
      await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
      await page.goto(url);
      await page.evaluate(code => { (0, eval)(code); }, installer);
      const inspect = (mode = "inspect", payload = {}) => page.evaluate(
        ({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload },
      );
      await run(page, inspect);
      assert.deepEqual(await page.evaluate(() => [window.submissions, window.navigation]), [0, 0]);
    } finally { await context.close(); }
  }
  for (const outside of [false, true]) await test(`Workday contact scope with prior-employment question${outside ? " and outer employment heading" : ""}`, async () => {
    await fixture(workdayBody(outside), workday, async (page, inspect) => {
      const report = await inspect("autofill", { contact });
      assert.equal(report.error, undefined);
      assert.equal(report.fields.filter(field => field.state === "filled").length, 12, JSON.stringify(report));
      assert.equal(report.fields.filter(field => field.state === "kept").length, 2);
      for (const [id, value] of Object.entries({
        "name--legalName--firstName": contact.givenName, "name--legalName--lastName": contact.familyName,
        "address--addressLine1": contact.streetAddress, "address--city": contact.city, province: "ON",
        "address--postalCode": contact.postalCode, "phone-country": "CA", "phoneNumber--phoneNumber": contact.phone,
        "emailAddress--emailAddress": "existing@example.test", country: "CA",
      })) assert.equal(await page.locator(`[id="${id}"]`).inputValue(), value, id);
      for (const id of ["reference-email", "employer-city", "history-name", "school-city", "emergency-phone", "previous-employer"])
        assert.equal(await page.locator(`#${id}`).inputValue(), "", `${id} remains isolated`);
      assert.equal(await page.locator('#prior input:checked').count(), 0, "contact location does not answer prior employment");
      for (const field of report.fields.filter(field => field.state === "filled" || field.state === "kept"))
        assert.doesNotMatch(field.reason, /Review work, education or reference/);
      assert.ok(report.fields.some(field => /Review work, education or reference/.test(field.reason)), "real history remains protected");
    });
  });
  await test("history headings outside the selected form cannot contaminate contacts", async () => {
    await fixture(`<section><h2>Employment opportunities</h2><h1>Analyst application</h1><form>
      ${text("First name", "first", 'data-automation-id="legalNameSection_firstName"')}
      ${text("Email", "email", 'type="email"')}<button id="next" type="button">Next</button></form></section>`, workday, async (page, inspect) => {
      await inspect("autofill", { contact });
      assert.equal(await page.locator("#first").inputValue(), contact.givenName);
      assert.equal(await page.locator("#email").inputValue(), contact.email);
    });
  });
  await test("Lever Current location uses saved city, without employer or authorization inference", async () => {
    await fixture(`<h1>Analyst application</h1><form>
      ${text("Full name", "name", 'name="name"')}${text("Email", "email", 'name="email" type="email"')}
      <div class="application-question"><div class="application-label">Current location</div><input name="location" id="location"></div>
      <div class="application-question"><div class="application-label">Current company</div><input name="org" id="company" value="Ericsson"></div>
      <fieldset><legend>Reference details</legend>${text("Current location", "reference-location")}</fieldset>
      ${text("Current employer location", "employer-location")}${text("Preferred work location", "preferred-location")}
      <fieldset><legend>Are you authorized to work in the country where this role is located?</legend>
      <label><input type="radio" name="authorized">Yes</label><label><input type="radio" name="authorized">No</label></fieldset>
      <button id="next" type="button">Next</button><button type="submit">Submit application</button></form>`, lever, async (page, inspect) => {
      const report = await inspect("autofill", { contact });
      assert.equal(await page.locator("#location").inputValue(), "Toronto");
      assert.equal(report.fields.find(field => field.label === "Current location" && field.profileKey === "city")?.state, "filled");
      assert.equal(await page.locator("#company").inputValue(), "Ericsson");
      assert.equal(report.fields.find(field => field.label === "Current company")?.state, "kept", "resume-parser values are not extension-filled");
      for (const id of ["reference-location", "employer-location", "preferred-location"])
        assert.equal(await page.locator(`#${id}`).inputValue(), "");
      assert.equal(await page.locator('input[name="authorized"]:checked').count(), 0);
      assert.equal(report.employmentCountry, undefined, "applicant city never establishes employment-country authorization");
    });
  });
} finally { await browser.close(); }
