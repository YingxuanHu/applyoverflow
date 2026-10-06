import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";
import * as answersModule from "../src/lib/profile-application-answers.ts";
const { applicationAnswerPlan } = answersModule.default || answersModule;

// Offline behavior checks, not additional live employers or authenticated flows.
const source = `(${createInspector})(${applicationContext},(${createHistoryInspector})(),(${createAutofillInspector})())`;
const browser = await chromium.launch();
let passed = 0;
try {
  const page = await browser.newPage();
  let html;
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
  const load = async (country, step) => {
    await page.goto(`https://fixture.wd5.myworkdayjobs.com/en-US/External/job/Test-${country}/Engineer_R1/apply/${step}`);
    await page.evaluate(code => window.inspect = (0, eval)(code), source);
  };
  const scan = (mode = "inspect", payload = {}) => page.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
  const shell = (heading, contents) => `<h3>${heading}</h3><div data-automation-id="applyFlowPage">${contents}
    <button id="next" type="button">Save and Continue</button><button id="submit" type="button">Submit Application</button></div>
    <script>window.steps=0;window.submissions=0;document.querySelector('#next').onclick=()=>window.steps++;
    document.querySelector('#submit').onclick=()=>window.submissions++;</script>`;
  const safe = async () => {
    assert.equal(await page.evaluate(() => window.steps), 0, "autofill never advances steps");
    assert.equal(await page.evaluate(() => window.submissions), 0, "autofill never submits");
  };
  const choice = (id, label, options, kind) => `<label for="${id}">${label}</label>${kind === "native"
    ? `<select id="${id}"><option value="">Select One</option>${options.map(text => `<option>${text}</option>`).join("")}</select>`
    : `<button id="${id}" type="button" aria-haspopup="listbox">Select One</button><script>
      document.querySelector('#${id}').onclick=()=>{const list=document.createElement('ul');list.setAttribute('role','listbox');list.id='${id}-options';
      document.querySelector('#${id}').setAttribute('aria-controls',list.id);document.body.append(list);
      setTimeout(()=>{for(const text of ${JSON.stringify(options)}){const option=document.createElement('li');option.setAttribute('role','option');option.textContent=text;
      option.onclick=()=>{document.querySelector('#${id}').textContent=text;list.remove()};list.append(option)}},80)};</script>`}`;

  for (const country of ["CAN", "USA"]) for (const kind of ["native", "async-button"]) {
    html = shell("My Information", `<label>First Name*<input id="first"></label><label>Middle Name<input id="middle"></label>
      <label>Last Name*<input id="last"></label><label>Address Line 1<input id="street"></label><label>City*<input id="city"></label>
      ${choice("region", country === "CAN" ? "Province or Territory*" : "State*", ["Ontario", "Virginia"], kind)}
      ${choice("country", "Country*", ["Canada", "United States"], kind)}<label>Postal Code*<input id="postal"></label>
      <p>Email Address</p><span>jordan@example.test</span>${choice("type", "Phone Device Type*", ["Mobile", "Home", "Work"], kind)}
      <label>Phone Number*<input id="phone" type="tel"></label><label>Phone Extension<input id="extension"></label>`);
    await load(country, "myInformation");
    const contact = { givenName: "Jordan", middleName: "Taylor", familyName: "Example", streetAddress: "123 Test Street",
      city: country === "CAN" ? "Toronto" : "Richmond", region: country === "CAN" ? "ON" : "VA",
      country: country === "CAN" ? "CA" : "US", postalCode: country === "CAN" ? "M5V 1A1" : "23220",
      phone: "2025550148", phoneCountry: "US", phoneType: "Mobile", phoneExtension: "123" };
    const result = await scan("autofill", { contact });
    assert.equal(result.fields.filter(field => field.state === "filled").length, 11, JSON.stringify(result.fields));
    assert.equal(await page.locator('#middle').inputValue(), "Taylor");
    assert.equal(await page.locator('#extension').inputValue(), "123");
    await page.locator('#city').fill("User chosen city");
    await scan("autofill", { contact });
    assert.equal(await page.locator('#city').inputValue(), "User chosen city");
    await safe(); passed++;
  }

  for (const country of ["CAN", "USA"]) for (const kind of ["native", "async-button"]) {
    const labels = ["Are you legally authorized to work in the country where this job is located?",
      "Will you now or in the future require visa sponsorship?", "How Did You Hear About Us?"];
    html = shell("Application Questions", labels.map((label, index) => choice(`q${index}`, label, index === 2 ? ["Employee", "Other"] : ["Yes", "No"], kind)).join(""));
    await load(country, "applicationQuestions");
    const before = await scan();
    const common = applicationAnswerPlan({ enabled: true, values: { authorizedCA: "Yes", authorizedUS: "No", sponsorshipCA: "No", sponsorshipUS: "Yes", jobSource: "ApplyOverflow" } },
      before.fields.map(field => field.label), page.url(), before.employmentCountry);
    const result = await scan("autofill", { contact: { country: "CA" }, commonAnswers: common.answers });
    assert.equal(result.fields.filter(field => field.state === "filled").length, 3, JSON.stringify(result.fields));
    const value = id => kind === "native" ? page.locator(`#${id}`).inputValue() : page.locator(`#${id}`).textContent();
    assert.equal(await value("q0"), country === "CAN" ? "Yes" : "No", "authorization follows job country, not applicant residence");
    assert.equal(await value("q1"), country === "CAN" ? "No" : "Yes");
    assert.equal(await value("q2"), "Other");
    await safe(); passed++;
  }

  for (const count of [1, 4]) for (const dates of ["segmented", "native"]) {
    const date = part => dates === "native" ? `<label>${part === "From" ? "Start date" : "End date"}<input type="month"></label>` :
      `<fieldset><legend>${part}*</legend><div role="group"><input aria-label="Month" role="spinbutton"><input aria-label="Year" role="spinbutton"></div></fieldset>`;
    const row = `<h4>Work Experience RECORD</h4><label>Job Title*<input></label><label>Company*<input></label><label>Location<input></label>
      <label>I currently work here<input type="checkbox"></label>${date("From")}${date("To")}<label>Role Description<textarea></textarea></label>`;
    html = shell("My Experience", `<section aria-labelledby="work"><h4 id="work">Work Experience</h4><div id="rows"></div><button id="add" type="button">Add Another</button></section>`)+
      `<script>let n=0;document.querySelector('#add').onclick=()=>{n++;const row=document.createElement('div');row.setAttribute('role','group');row.setAttribute('aria-label','Work Experience '+n);
      row.innerHTML=${JSON.stringify(row)}.replace('RECORD',n);document.querySelector('#rows').append(row)};document.querySelector('#add').click();</script>`;
    await load("CAN", "myExperience");
    const history = Array.from({ length: count }, (_, index) => ({ kind: "experience", entry: { title: `Engineer ${index}`, company: `Test Company ${index}`,
      location: "Toronto", description: "Built reporting tools.", dates: { start: "2023-01", end: "2023-08", current: false } } }));
    const result = await scan("autofill", { history });
    assert.equal(result.historyFilled, count * (dates === "native" ? 6 : 8), JSON.stringify(result.historyWarnings));
    assert.equal(await page.locator('#rows > [role="group"]').count(), count);
    assert.deepEqual(await page.locator('#rows textarea').evaluateAll(nodes => nodes.map(node => node.value)), Array(count).fill("Built reporting tools."));
    await scan("autofill", { history });
    assert.equal(await page.locator('#rows > [role="group"]').count(), count, "reruns do not duplicate work records");
    await safe(); passed++;
  }

  for (const expected of ["Website", "Job Site", "Job Sites"]) {
    html = shell("My Information", choice("source", "How Did You Hear About Us?", ["Career Site", "Referral", expected], "async-button"));
    await load("CAN", "myInformation");
    const sourceScan = await scan();
    const sourcePlan = applicationAnswerPlan({ enabled: true, values: { jobSource: "ApplyOverflow" } }, sourceScan.fields.map(field => field.label), page.url());
    await scan("autofill", { commonAnswers: sourcePlan.answers });
    assert.equal(await page.locator('#source').textContent(), expected);
    await safe(); passed++;
  }

  for (const hasOtherWebsite of [true, false]) for (const jobSource of ["ApplyOverflow", "Other"]) {
    html = shell("My Information", `<label for="source">How Did You Hear About Us?*</label>
      <input id="source" data-uxi-widget-type="selectinput" data-uxi-multiselect-id="source-prompt" data-automation-id="searchBox">
      <ul role="listbox" data-automation-id="selectedItemList" data-uxi-multiselect-id="source-prompt" id="selected"></ul>`)+
      `<script>const field=document.querySelector('#source');let list;let nested=false;
      const render=(texts)=>{list.replaceChildren();for(const text of texts){const option=document.createElement('div');option.setAttribute('role','option');
        option.setAttribute('aria-label',text+' not checked');option.innerHTML='<div data-uxi-widget-type="multiselectlistitem" data-uxi-multiselect-id="source-prompt">'+text+'</div>';
        option.onclick=()=>{if(text==='Website'){nested=true;setTimeout(()=>render(${JSON.stringify(hasOtherWebsite ? ["Glassdoor", "Other Website"] : ["Glassdoor", "Employee Referral"])}),60)}
        else{const selected=document.createElement('span');selected.setAttribute('data-automation-id','promptOption');selected.textContent=text;
          document.querySelector('#selected').append(selected);field.value='';list.remove()}};list.append(option)}};
      field.onclick=()=>{if(list?.isConnected)return;list=document.createElement('div');list.setAttribute('role','listbox');document.body.append(list);
        render(nested?${JSON.stringify(hasOtherWebsite ? ["Glassdoor", "Other Website"] : ["Glassdoor", "Employee Referral"])}:['Career Site','Referral','Website'])};</script>`;
    await load("CAN", "myInformation");
    const before = await scan();
    const plan = applicationAnswerPlan({ enabled: true, values: { jobSource, sourceDetails: "ApplyOverflow" } }, before.fields.map(field => field.label), page.url());
    const result = await scan("autofill", { commonAnswers: plan.answers });
    assert.equal(await page.locator('#selected').textContent(), hasOtherWebsite ? "Other Website" : "");
    assert.equal(result.fields[0].state, hasOtherWebsite ? "filled" : "needed", "a category is not a committed source selection");
    await safe(); passed++;
  }

  for (const kind of ["native", "async-button"]) {
    html = shell("My Experience", `<div role="group" aria-label="Education 1"><h4>Education 1</h4><label>School or University*<input id="school"></label>
      ${choice("degree", "Degree*", ["Bachelor's Degree", "Master's Degree"], kind)}<label>Field of Study<input id="major"></label>
      <label>Start year<input id="start"></label><label>End year<input id="end"></label></div>`);
    await load("CAN", "myExperience");
    const result = await scan("autofill", { history: [{ kind: "education", entry: { school: "University of Toronto", degree: "Master of Engineering",
      fieldOfStudy: "Computer Engineering", dates: { start: "2025-09", end: "2026-09", current: false } } }] });
    assert.equal(result.historyFilled, 5, JSON.stringify(result.historyWarnings));
    assert.equal(await page.locator('#school').inputValue(), "University of Toronto");
    assert.equal(await page.locator('#major').inputValue(), "Computer Engineering");
    assert.equal(await page.locator('#start').inputValue(), "2025");
    assert.equal(await page.locator('#end').inputValue(), "2026");
    await safe(); passed++;
  }

  html = shell("Voluntary Disclosures", `${choice("gender", "Gender", ["Female", "Male", "Choose not to disclose"], "async-button")}
    <label>I certify that this application is complete and accurate<input id="certify" type="checkbox" required></label>
    <label>Electronic signature<input id="signature"></label>`);
  await load("USA", "voluntaryDisclosures");
  await scan("autofill", { contact: { fullName: "Jordan Example" }, commonAnswers: [
    { label: "Gender", answer: "Prefer not to answer", answerKey: "gender", alternatives: ["Choose not to disclose"] },
    { label: "I certify that this application is complete and accurate", answer: "Yes", answerKey: "custom" },
  ] });
  assert.equal(await page.locator('#gender').textContent(), "Choose not to disclose");
  assert.equal(await page.locator('#certify').isChecked(), false);
  assert.equal(await page.locator('#signature').inputValue(), "");
  await safe(); passed++;
  console.log(`PASS ${passed} Workday offline step/control cases; no continuation, signatures or application submission`);
} finally { await browser.close(); }
