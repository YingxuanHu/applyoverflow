import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";

const source = `(${createInspector.toString()})(${applicationContext.toString()},(${createHistoryInspector.toString()})(),(${createAutofillInspector.toString()})())`;
const contact = { givenName: "Jordan", familyName: "Example", fullName: "Jordan Example", preferredName: "Jay", email: "jordan@example.test", phone: "4165550123", city: "Toronto", region: "ON", country: "CA", linkedInUrl: "https://www.linkedin.com/in/example-test", githubUrl: "https://github.com/example-test" };
const field = (label, attrs = "") => `<label>${label}<input ${attrs}></label>`;
const base = `<h1>Job application</h1><form>${field("First name")}${field("Email")}`;
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  let html;
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
  const load = async (body, url = "https://careers.fixture.example/jobs/123/apply") => {
    html = body;
    await page.goto(url);
    await page.evaluate(code => { window.inspect = (0, eval)(code); }, source);
  };
  const inspect = (mode = "inspect", plan = {}) => page.evaluate(({ mode, plan }) => window.inspect(mode, plan, location.href), { mode, plan });
  for (const url of ["https://careers.fixture.example/jobs/123/apply", "https://jobs.ashbyhq.com/fixture/00000000-0000-4000-8000-000000000000/application", "https://job-boards.greenhouse.io/fixture/jobs/123"]) {
    await load(`${base.replace('<form>', '<form class="ashby-application-form-container">')}${field("Please provide your LinkedIn profile URL")}${field("Contact number")}${field("Legal full name")}${field("State/Province/Region")}${field("GitHub profile link")}</form>`, url);
    const result = await inspect("autofill", { contact });
    assert.equal(result.error, undefined);
    for (const [label, value] of [["First name", contact.givenName], ["Please provide your LinkedIn profile URL", contact.linkedInUrl], ["Contact number", contact.phone], ["Legal full name", contact.fullName], ["State/Province/Region", contact.region], ["GitHub profile link", contact.githubUrl]])
      assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), value, `${url}: ${label}`);
  }
  console.log("PASS label meaning across generic, Greenhouse and Ashby without brittle IDs/autocomplete");
  await load(`${base}<fieldset><legend>Reference details</legend>${field("LinkedIn URL")}${field("Contact number")}</fieldset>${field("Your LinkedIn experience")}${field("Employer email")}${field("First name", 'autocomplete="family-name"')}${field("Preferred name")}</form>`);
  await inspect("autofill", { contact });
  for (const label of ["LinkedIn URL", "Contact number", "Your LinkedIn experience", "Employer email"])
    assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), "");
  assert.equal(await page.locator('input[autocomplete="family-name"]').inputValue(), "");
  assert.equal(await page.getByLabel("Preferred name").inputValue(), "Jay", "preferred is not a referral");
  console.log("PASS reference context, conflicting semantics and false-positive protection");

  await load(`${base}${field("Please provide a link to your LinkedIn, GitHub, portfolio or similar professional profile or website.")}
    <label>During this application process I agree to use only my own words. I understand that the use of AI or other generated content will disqualify my application.<input type="checkbox"></label>
    <label>Describe a project<textarea></textarea></label></form>`);
  const restricted = await inspect("autofill", { contact: { ...contact, professionalUrl: contact.linkedInUrl } });
  assert.equal(restricted.aiRestricted, true);
  assert.equal(restricted.fields.find(f => f.label === "Describe a project").aiRestricted, true);
  assert.equal(await page.getByLabel("Please provide a link to your LinkedIn, GitHub, portfolio or similar professional profile or website.").inputValue(), contact.linkedInUrl);
  assert.equal(await page.locator('input[type=checkbox]').isChecked(), false);

  await load(`<h1>Job application</h1><form id="application-form">${field("Full name", 'name="name"')}${field("Email", 'name="email"')}
    <li class="application-question custom-question"><div><div class="application-label"><div class="text">Are you legally authorized to work in the United States?<span>\u2731</span></div></div>
    <div class="application-field"><label><input type="radio" name="auth" value="yes">Yes</label><label><input type="radio" name="auth" value="no">No</label></div></div></li>
    <li class="application-question custom-question"><div><div class="application-label">Describe your relevant experience</div><div class="application-field"><textarea></textarea></div></div></li></form>`, "https://jobs.lever.co/fixture/00000000-0000-4000-8000-000000000000/apply");
  const leverScan = await inspect();
  const workAuth = leverScan.fields.find(f => f.label.startsWith("Are you legally authorized"));
  assert.equal(workAuth.kind, "radio");
  assert.ok(leverScan.fields.some(f => f.label === "Describe your relevant experience"));
  await inspect("autofill", { contact, commonAnswers: [{ label: workAuth.label, answer: "Yes", answerKey: "authorizedUS" }] });
  assert.equal(await page.locator('input[type=radio][value=yes]').isChecked(), true);
  assert.equal(await page.locator('input[type=radio][value=no]').isChecked(), false);
  console.log("PASS mixed professional links, employer AI restriction, and Lever custom question/radio labels");

  await load(`<h1>Submit your job application</h1><main>${field("First name")}${field("Email")}<label>Resume<input type="file" accept=".pdf"></label>${field("LinkedIn profile link")}</main>`);
  await inspect("autofill", { contact });
  assert.equal(await page.getByLabel("LinkedIn profile link").inputValue(), contact.linkedInUrl);
  await load(`${base.replace("Job application", "Newsletter signup")}</form>`);
  assert.match((await inspect()).error, /application form/);
  await load(`<h1>Apply for a job</h1><form aria-label="Job alerts">${field("First name")}${field("Email")}</form>`);
  assert.match((await inspect()).error, /application form/);
  console.log("PASS form-less employer container; newsletter is not an application");

  await load(`${base}<label>Tell us about a project (maximum 8 words)<textarea maxlength="70"></textarea></label><label>Date available<input placeholder="dd-mm-yyyy"></label></form>`);
  let report = await inspect("autofill", { contact });
  const question = report.fields.find(f => f.label.startsWith("Tell us"));
  assert.equal(question.maxWords, 8); assert.equal(question.maxLength, 70);
  assert.match((await inspect("autofill-answer", { id: question.id, label: question.label, answer: "one two three four five six seven eight nine" })).error, /Shorten/);
  await inspect("autofill-answer", { id: question.id, label: question.label, answer: "Built a reporting tool with Python." });
  assert.equal(await page.locator("textarea").inputValue(), "Built a reporting tool with Python.");
  const date = report.fields.find(f => f.label === "Date available");
  assert.match(date.suggestedAnswer, /^\d{2}-\d{2}-\d{4}$/);
  assert.equal(await page.getByLabel("Date available").inputValue(), "", "availability defaults require user approval");
  console.log("PASS answer limits and reviewable availability suggestion");

  await load(`${base}<section aria-label="Work experience"><button type="button" id="add">Add experience</button></section><button type="button" id="next">Next</button><button type="submit">Submit</button></form><script>
    window.submissions=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submissions++};
    document.getElementById('next').onclick=()=>window.submissions++;
    document.getElementById('add').onclick=()=>{const row=document.createElement('fieldset');row.innerHTML='<legend>Work experience</legend><label>Position<input></label><label>Employer<input></label><label>Start date<input type="month"></label><label>End date<input type="month"></label>';document.querySelector('section').append(row)};
  </script>`);
  const history = [
    { kind: "experience", entry: { title: "Engineer", company: "Fixture One", dates: { start: "2020-01", end: "2021-02", current: false } } },
    { kind: "experience", entry: { title: "Analyst", company: "Fixture Two", dates: { start: "2022-03", end: "2023-04", current: false } } },
  ];
  assert.equal((await inspect()).historyAvailable, true);
  await inspect("autofill", { contact, history: [{ kind: "experience", entry: { title: "Engineer" } }] });
  assert.equal(await page.locator("fieldset").count(), 0, "incomplete profile identity does not open an empty editor");
  report = await inspect("autofill", { contact, history });
  assert.equal(report.historyFilled, 8, JSON.stringify(report));
  assert.deepEqual(await page.getByLabel("Position").evaluateAll(fields => fields.map(f => f.value)), ["Engineer", "Analyst"]);
  await inspect("autofill", { contact, history });
  assert.equal(await page.locator("fieldset").count(), 2, "repeat fill does not duplicate history");
  assert.equal(await page.evaluate(() => window.submissions), 0);
  console.log("PASS bounded generic repeaters, complete multi-row history, idempotence and no submission");

  if (process.argv.includes("--live-hibob")) {
    // Exercise the live Angular form in an isolated browser. Block ALL outbound
    // requests before writing synthetic test values. Never press Apply.
    const live = await context.newPage();
    await live.goto("https://synpulse.careers.hibob.com/jobs/fdf3f02f-4c3b-472d-bf53-305dc0296650/apply", { waitUntil: "networkidle" });
    await live.locator('input[name="/candidate/email"]').waitFor();
    await live.route("**/*", route => route.abort());
    await live.routeWebSocket("**/*", socket => socket.close());
    await live.evaluate(code => { window.inspect = (0, eval)(code); }, source);
    const scan = (mode = "inspect", plan = {}) => live.evaluate(({ mode, plan }) => window.inspect(mode, plan, location.href), { mode, plan });
    const history = [
      { kind: "experience", entry: { title: "Test Engineer", company: "Fixture One", description: "Synthetic offline test record", dates: { start: "2020-01-02", end: "2021-02-03", current: false } } },
      { kind: "experience", entry: { title: "Test Analyst", company: "Fixture Two", dates: { start: "2022-03-04", end: "2023-04-05", current: false } } },
      { kind: "education", entry: { school: "Fixture University", degree: "Bachelor of Science", fieldOfStudy: "Computer Science", dates: { start: "2016-09-01", end: "2020-06-01", current: false } } },
    ];
    const before = await scan();
    assert.equal(before.manualResume, true, "detached upload button reports manual attachment");
    console.log("HiBob detected:", before.fields?.map(f => ({ label: f.label, key: f.profileKey, kind: f.kind })), before.error);
    const result = await scan("autofill", { contact, history, skills: ["Python", "TypeScript"] });
    console.log("HiBob report:", { historyFilled: result.historyFilled, warnings: result.historyWarnings, fields: result.fields?.filter(f => f.state === "needed").map(f => ({ label: f.label, reason: f.reason })) });
    assert.equal(await live.locator('input[name="/candidate/socialMediaLinkedIn"]').inputValue(), contact.linkedInUrl);
    assert.equal(await live.locator('input[name="/candidate/phone"]').inputValue(), contact.phone);
    assert.match(await live.locator('[id="/candidate/country"]').innerText(), /Canada/);
    assert.equal(await live.locator('b-chip-input b-chip').count(), 2, "profile skills accepted as chips");
    assert.equal(await live.locator('careers-ui-experience-edit-item').count(), 0, "all complete history editors saved");
    assert.equal(result.historyFilled, 14);
    assert.match(await live.locator('[data-testid="efc-experiences"]').innerText(), /Fixture One/);
    assert.match(await live.locator('[data-testid="efc-experiences"]').innerText(), /Fixture Two/);
    assert.match(await live.locator('[data-testid="efc-education"]').innerText(), /Fixture University/);
    const questionnaire = result.fields.filter(f => f.label.includes("AI project"));
    assert.equal(questionnaire.length, 1, "questionnaire is included despite separate form elements");
    assert.equal(await live.locator('[name="extendedConsent"]').isChecked(), false);
    const again = await scan("autofill", { contact, history });
    assert.equal(again.historyFilled, 0, "saved rows not duplicated");
    await mkdir("output/playwright", { recursive: true });
    await live.screenshot({ path: "output/playwright/hibob-isolated-autofill.png", fullPage: true });
    console.log("PASS live HiBob Angular DOM with outbound network blocked: contacts, country, LinkedIn, work/education editors and questionnaire; nothing uploaded/submitted");
  }
} finally { await browser.close(); }
