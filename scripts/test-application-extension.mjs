import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";
const inspectorSource = `(${createInspector.toString()})(${applicationContext.toString()})`;

// All employer traffic is intercepted. No requests or applications reach Greenhouse.
const fixtureUrl = "https://job-boards.greenhouse.io/fixture/jobs/123";
const fixture = `<!doctype html><html lang="en"><head><title>Fixture job</title><style>body{font:16px system-ui;margin:32px;max-width:640px}label{display:block;margin:12px 0}input,textarea{display:block;padding:8px;min-width:280px}fieldset{margin:12px 0}</style></head><body><h1>Financial Analyst - synthetic application</h1>
<form id="application_form"><label>First Name *<input id="first_name" name="first"></label><label>Last Name *<input id="last_name" name="last"></label>
<label>Email *<input id="email" name="email" type="email"></label><label>Phone<input id="phone" name="phone" type="tel" value="416-555-0100"></label>
<label>LinkedIn Profile<input name="linkedin" type="url"></label><label hidden>Full name<input name="hidden"></label>
<label>Portfolio<input name="readonly" readonly value="kept"></label><label>Github URL<input name="disabled" disabled></label>
<label>Why this role?<textarea name="story">Do not upload this existing answer</textarea></label>
<label>Referral name<input name="referral" autocomplete="name"></label>
<fieldset><legend>Reference details</legend><label>Email<input name="reference-email" type="email"></label></fieldset>
<fieldset><legend>Do you need sponsorship?</legend><label><input type="radio" name="visa" value="yes">Yes</label><label><input type="radio" name="visa" value="no">No</label></fieldset>
<label>Password<input type="password" name="password"></label><label>Resume<input type="file" name="resume"></label>
<label><input type="checkbox" name="consent">I agree to the terms</label><button type="button" id="next">Next</button><button type="submit">Submit</button></form>
<script>window.submitCount=0;window.nextCount=0;document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submitCount++});document.querySelector('#next').onclick=()=>window.nextCount++;</script></body></html>`;
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  await context.route("**/*", (route) =>
    route.fulfill({ contentType: "text/html", body: fixture }),
  );
  const page = await context.newPage();
  await page.goto(fixtureUrl);
  const contact = {
    givenName: "Jordan",
    familyName: "Example",
    fullName: "Jordan Example",
    email: "jordan@example.test",
    phone: "changed",
    linkedInUrl: "https://www.linkedin.com/in/example",
  };
  const scan = await page.evaluate(
    (source) => (0, eval)(source)(),
    inspectorSource,
  );
  assert.equal(scan.questions.includes("Why this role?"), true);
  assert.equal(scan.questions.includes("Do you need sponsorship?"), true);
  assert.equal(scan.questions.includes("Reference details: Email"), true);
  assert.equal(scan.questions.includes("Email"), false);
  assert.equal(
    JSON.stringify(scan).includes("Do not upload this existing answer"),
    false,
  );
  assert.equal(JSON.stringify(scan).includes("416-555-0100"), false);
  await page.evaluate(() => {
    document.querySelector("form").insertAdjacentHTML("beforeend", `
      <span id="country-label">Country of residence</span><button type="button" role="combobox" aria-labelledby="country-label">Existing private answer</button>
      <span id="pronouns-label">Pronouns</span><div role="combobox" tabindex="0" aria-labelledby="pronouns-label">Private choice</div>
      <label for="city-picker">Preferred office</label><button type="button" id="city-picker" aria-haspopup="listbox">Toronto</button>
      <button type="button" aria-haspopup="listbox" aria-label="Disabled question" aria-disabled="true">Disabled</button>
      <div role="combobox" aria-label="Hidden question" hidden></div>
      <input type="button" aria-label="Not a question" value="Go">
      <span id="self-label">Start date</span><button type="button" role="combobox" id="self-picker" aria-labelledby="self-label self-picker"><span id="selected-date">Private start date</span></button>
      <span id="descendant-label">Office preference</span><button type="button" role="combobox" aria-labelledby="descendant-label selected-office"><span id="selected-office">Private office</span></button>
      <span id="ambiguous-label">Ambiguous question</span><span id="external-selection">Private external selection</span><button type="button" role="combobox" aria-labelledby="ambiguous-label external-selection">Selected</button>
      <span id="option-label">Availability</span><span role="option" id="selected-option">Private option</span><div role="combobox" aria-labelledby="option-label selected-option"></div>
    `);
  });
  const widgets = await page.evaluate(source => (0, eval)(source)(), inspectorSource);
  assert.ok(widgets.questions.includes("Country of residence"));
  assert.ok(widgets.questions.includes("Pronouns"));
  assert.ok(widgets.questions.includes("Preferred office"));
  assert.ok(widgets.questions.includes("Start date"));
  assert.ok(widgets.questions.includes("Office preference"));
  assert.ok(widgets.questions.includes("Availability"));
  for (const excluded of ["Existing private answer", "Private choice", "Toronto", "Disabled question", "Hidden question", "Not a question", "Private start date", "Private office", "Ambiguous question", "Private external selection", "Private option"])
    assert.equal(JSON.stringify(widgets).includes(excluded), false, excluded);
  const started = Date.now();
  const result = await page.evaluate(
    async ({ source, contact, url }) => {
      return await (0, eval)(`(${source})`)("fill", contact, url);
    },
    { source: inspectorSource, contact, url: fixtureUrl },
  );
  assert.equal(result.filled, 4);
  assert.equal(result.preserved, 1);
  assert.equal(result.missing, 0);
  assert.equal(await page.locator('[aria-labelledby="country-label"]').innerText(), "Existing private answer");
  assert.equal(
    await page.locator('[name="phone"]').inputValue(),
    "416-555-0100",
  );
  for (const name of [
    "referral",
    "reference-email",
    "hidden",
    "disabled",
    "password",
    "resume",
  ])
    assert.equal(await page.locator(`[name="${name}"]`).inputValue(), "");
  assert.equal(await page.locator('[name="consent"]').isChecked(), false);
  assert.equal(await page.locator('[name="visa"]:checked').count(), 0);
  assert.deepEqual(
    await page.evaluate(() => [window.submitCount, window.nextCount]),
    [0, 0],
  );
  console.log(
    `PASS: 4/4 expected fields filled, 0 unsafe fills, 0 navigation/submission clicks (${Date.now() - started}ms)`,
  );
  const fill = () =>
    page.evaluate(
      async ({ source, contact, url }) =>
        (0, eval)(`(${source})`)("fill", contact, url),
      { source: inspectorSource, contact, url: fixtureUrl },
    );
  assert.equal((await fill()).filled, 0);
  await page.locator('[name="first"]').fill("");
  await page.evaluate(() => {
    const label = document.createElement("label");
    label.textContent = "First name";
    const input = document.createElement("input");
    input.id = "first_name";
    label.append(input);
    document.querySelector("form").append(label);
  });
  assert.equal((await fill()).missing, 2);
  assert.equal(await page.locator('[name="first"]').inputValue(), "");
  await page.goto(fixtureUrl);
  await page.evaluate(() => {
    document
      .querySelector('[name="first"]')
      .addEventListener("input", (event) => {
        setTimeout(() => {
          event.target.value = "";
        }, 20);
      });
  });
  assert.equal((await fill()).missing, 1);
  await page.goto(fixtureUrl);
  await page.evaluate(() => {
    document
      .querySelector("form")
      .after(document.querySelector("form").cloneNode(true));
  });
  assert.match((await fill()).error, /single application form/);
  await page.goto("https://unrelated.example/jobs/123");
  assert.match(
    (await page.evaluate((source) => (0, eval)(source)(), inspectorSource))
      .error,
    /single application form/,
  );
  await page.goto(fixtureUrl);
  const mismatch = await page.evaluate(
    async (source) =>
      (0, eval)(`(${source})`)(
        "fill",
        {},
        "https://job-boards.greenhouse.io/fixture/jobs/999",
      ),
    inspectorSource,
  );
  assert.match(mismatch.error, /page changed/);
  await fill();
  await mkdir("output/playwright", { recursive: true });
  await page.screenshot({
    path: "output/playwright/assistant-form-fixture.png",
    fullPage: true,
  });
  console.log(
    "PASS: existing answers preserved, repeated fill is idempotent, ambiguous fields skipped, controlled-field rejection detected, unsupported/multi-form/navigation mismatch blocked",
  );
} finally {
  await browser.close();
}
