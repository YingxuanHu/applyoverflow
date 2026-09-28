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
    html = `<meta charset="utf-8">${body}`;
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

  const bobUrl = "https://fixture.careers.hibob.com/jobs/00000000-0000-4000-8000-000000000000/apply";
  const bobForm = `<careers-ui-job-ad-application-form>${base}${field("Country", 'value="Canada"')}</form></careers-ui-job-ad-application-form>`;
  for (const [place, expected] of [["Toronto, Canada, Canada", "CA"], ["Boston, United States", "US"],
    ["Toronto, Canada or United States", undefined], ["Toronto, Canada; London, United Kingdom", undefined],
    ["Canada", "CA"], ["Toronto", undefined], ["Toronto, CA", undefined], ["US / Canada", undefined]]) {
    await load(`<careers-ui-job-ad-header><div class="job-ad-subtitle">${place} \u00b7 Permanent Employee \u00b7 Hybrid</div></careers-ui-job-ad-header>${bobForm}`, bobUrl);
    assert.equal((await inspect()).employmentCountry, expected, place);
  }
  await load(bobForm, bobUrl);
  assert.equal((await inspect()).employmentCountry, undefined, "applicant country is not job country");
  await load(`<careers-ui-job-ad-header><div class="job-ad-subtitle">Canada</div><div class="job-ad-subtitle">United States</div></careers-ui-job-ad-header>${bobForm}`, bobUrl);
  assert.equal((await inspect()).employmentCountry, undefined, "ambiguous posting headers stay manual");
  console.log("PASS job-country context excludes applicant location and multi-country postings");

  const bobChoice = (id, label) => `<b-single-select><label id="label-${id}" for="${id}">${label}</label>
    <div role="button" tabindex="0" aria-haspopup="true" aria-expanded="false" aria-labelledby="label-${id}" id="${id}"></div></b-single-select>`;
  const bobChoices = `<style>b-single-select,[role=button]{display:block;min-height:24px}</style>${bobForm.replace('</form>',
    bobChoice('source', 'How did you learn about this job opening?') + bobChoice('auth', 'Are you legally authorized to work in Canada?') + '</form>')}
    <script>
    window.searches=[];window.submits=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++};
    for (const id of ['source','auth']) {
      const field=document.getElementById(id);
      const close=()=>{document.querySelector('.cdk-overlay-pane')?.remove();field.setAttribute('aria-expanded','false')};
      field.onkeydown=e=>{if(e.key==='Escape')close()};
      field.onclick=()=>{
        if(field.getAttribute('aria-expanded')==='true'){close();return;}
        const pane=document.createElement('div');pane.className='cdk-overlay-pane';
        pane.innerHTML='<input type="search" aria-controls="list__'+id+'"><div role="tree" id="list__'+id+'" aria-labelledby="label-'+id+'"></div>';
        document.body.append(pane);field.setAttribute('aria-expanded','true');
        const list=pane.querySelector('[role=tree]'),search=pane.querySelector('input');
        const render=values=>list.replaceChildren(...values.map(value=>{const option=document.createElement('div');option.role='treeitem';option.textContent=value;option.onclick=()=>{field.textContent=value;close()};return option}));
        render(id==='source'?['LinkedIn']:['Yes','No']);
        search.oninput=()=>{window.searches.push({id,value:search.value});list.replaceChildren();setTimeout(()=>render((id==='source'?['LinkedIn','Other']:['Yes','No']).filter(value=>value.toLowerCase().includes(search.value.toLowerCase()))),120)};
      };
    }
    </script>`;
  for (const sourceValue of ['ApplyOverflow', 'Not offered']) {
    await load(bobChoices, bobUrl);
    const answers = [{label:'How did you learn about this job opening?',answer:sourceValue,answerKey:'jobSource',alternatives:sourceValue==='ApplyOverflow'?['Other']:[]},
      {label:'Are you legally authorized to work in Canada?',answer:'No',answerKey:'authorizedCA'}];
    await inspect('autofill', {contact:{},commonAnswers:answers});
    assert.equal(await page.locator('#auth').textContent(), 'No', 'unmatched previous choices cannot block the next answer');
    assert.equal(await page.locator('#source').textContent(), sourceValue==='ApplyOverflow'?'Other':'');
    assert.equal(await page.evaluate(()=>window.searches.some(search=>search.id==='auth')), false, 'do not filter an already available Yes/No option');
    assert.equal(await page.evaluate(()=>window.submits), 0);
    await inspect('autofill', {contact:{},commonAnswers:answers.map(answer=>answer.answerKey==='authorizedCA'?{...answer,answer:'Yes'}:answer)});
    assert.equal(await page.locator('#auth').textContent(), 'No', 'never overwrite a selected answer');
  }
  console.log('PASS virtualized HiBob alternatives, asynchronous search, following Yes/No selection and preservation');

  const salaryPlan = {contact:{},commonAnswers:[
    {label:'Desired salary (amount)',answer:'80000',answerKey:'desiredPayAmount',dependsOn:{answerKey:'desiredPayCurrency',answer:'USD $'}},
    {label:'Desired salary (currency)',answer:'USD $',answerKey:'desiredPayCurrency'}]};
  for (const currency of ['USD $','CAD $']) {
    await load(bobForm.replace('</form>', `<b-currency-value-select required><label>Desired salary</label>
      <input id="amount" role="spinbutton" type="tel" required><b-single-select><div role="button" aria-haspopup="true" aria-labelledby="currency-label">${currency}</div></b-single-select></b-currency-value-select>
      <script>document.getElementById('amount').oninput=e=>{if(e.target.value==='80000')e.target.value='80,000'}</script></form>`), bobUrl);
    const filled = await inspect('autofill',salaryPlan);
    assert.equal(await page.locator('#amount').inputValue(), currency==='USD $'?'80,000':'');
    const amount = filled.fields.find(f=>f.label==='Desired salary (amount)');
    assert.equal(amount.state,currency==='USD $'?'filled':'needed');
    assert.equal(amount.required,true);
    assert.equal(filled.fields.find(f=>f.label==='Desired salary (currency)').state,'kept');
  }
  console.log('PASS salary amount detection, formatted readback and existing currency protection');

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

  for (const [type, placeholder, start, end, expectedStart, expectedEnd] of [
    ["date", "", "2024-02", "2024-02", "2024-02-01", "2024-02-29"],
    ["text", "dd-mm-yyyy", "2023-02", "2023-02", "01-02-2023", "28-02-2023"],
    ["text", "mm/dd/yyyy", "2024-04", "2024-04", "04/01/2024", "04/30/2024"],
    ["text", "dd/mm/yyyy", "2024-08-12", "2024-08-21", "12/08/2024", "21/08/2024"],
    ["month", "", "2024-02", "2024-03", "2024-02", "2024-03"],
    ["date", "", "2020", "2021", "", ""],
  ]) {
    await load(`${base}<fieldset><legend>Work experience</legend>${field('Title')}${field('Company')}${field('Start date', `type="${type}" placeholder="${placeholder}" required`)}${field('End date', `type="${type}" placeholder="${placeholder}"`)}</fieldset></form>`);
    await inspect("autofill", { contact, history: [{ kind: "experience", entry: { title: "Engineer", company: "Example", dates: { start, end, current: false } } }] });
    assert.equal(await page.getByLabel('Start date').inputValue(), expectedStart);
    assert.equal(await page.getByLabel('End date').inputValue(), expectedEnd);
  }
  console.log('PASS month boundaries, leap years, exact-day preservation, year-only exclusion and date formats');

  const bobHistory = `<style>careers-ui-experience-form-control,careers-ui-experience-edit-item{display:block}</style>
    <careers-ui-job-ad-application-form>${base}
    <careers-ui-experience-form-control data-testid="efc-education"><button type="button">Add</button></careers-ui-experience-form-control>
    <careers-ui-experience-form-control data-testid="efc-experiences"><button type="button">Add</button></careers-ui-experience-form-control>
    <button type="submit">Apply</button></form></careers-ui-job-ad-application-form>
    <script>
      window.savedRows=[]; window.submissions=0; window.failSave=false; window.changeDuringFill=false;
      document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submissions++};
      for(const section of document.querySelectorAll('careers-ui-experience-form-control')) {
        const add=section.querySelector('button');
        add.onclick=()=>{
          add.disabled=true;const row=document.createElement('careers-ui-experience-edit-item');
          const edu=section.dataset.testid==='efc-education';
          const labels=edu?['School','Field of study','Degree']:['Title','Company'];
          row.innerHTML=labels.map(l=>'<label>'+l+'<input required></label>').join('')+
            '<label>Start date<input required placeholder="dd-mm-yyyy"></label><label>End date<input placeholder="dd-mm-yyyy"></label>'+
            (edu?'':'<label>Is current<input type="checkbox"></label>')+
            '<button type="button" data-testid="save-btn">Save</button>';
          section.append(row);
          row.querySelectorAll('input')[labels.length].oninput=()=>{if(window.changeDuringFill) row.querySelector('input').value='User correction'};
          row.querySelector('button').onclick=()=>{
            if(window.failSave||[...row.querySelectorAll('input')].some(i=>!i.checkValidity()))return;
            const values=[...row.querySelectorAll('input')].map(i=>i.type==='checkbox'?i.checked:i.value);
            setTimeout(()=>{window.savedRows.push({kind:edu?'education':'experience',values});const summary=document.createElement('div');summary.textContent=values.join(' | ');section.append(summary);row.remove();add.disabled=false},30);
          };
        };
      }
    </script>`;
  const multiHistory = [
    { kind: 'experience', entry: { title: 'Engineer', company: 'Fixture One', dates: { start: '2020-01', end: '2020-08', current: false } } },
    { kind: 'experience', entry: { title: 'Analyst', company: 'Fixture Two', dates: { start: '2021-02', end: '2021-04', current: false } } },
    { kind: 'experience', entry: { title: 'Developer', company: 'Fixture Three', dates: { start: '2024-02', end: '', current: true } } },
    { kind: 'education', entry: { school: 'First University', degree: 'Bachelor of Computer Science', fieldOfStudy: 'Computer Science', dates: { start: '2016-09', end: '2020-06', current: false } } },
    { kind: 'education', entry: { school: 'Second University', degree: 'Master of Engineering', fieldOfStudy: 'Computer Engineering', dates: { start: '2025-09', end: '', current: true } } },
  ];
  await load(bobHistory, bobUrl);
  report = await inspect('autofill', { contact, history: multiHistory });
  assert.equal(report.historySaved, 5, JSON.stringify(report));
  assert.equal(report.historyDateAdjusted, 8);
  assert.equal(await page.locator('careers-ui-experience-edit-item').count(), 0);
  const records = await page.evaluate(()=>window.savedRows);
  assert.deepEqual(records[0].values, ['Engineer','Fixture One','01-01-2020','31-08-2020',false]);
  assert.deepEqual(records[2].values, ['Developer','Fixture Three','01-02-2024','',true]);
  assert.deepEqual(records[4].values, ['Second University','Computer Engineering','Master of Engineering','01-09-2025','']);
  await page.evaluate(code=>{window.inspect=(0,eval)(code)},source);
  await inspect('autofill', { contact, history: multiHistory });
  assert.equal(await page.evaluate(()=>window.savedRows.length),5,'reload/repeat does not duplicate saved rows');
  assert.equal(await page.evaluate(()=>window.submissions),0);

  await load(bobHistory, bobUrl);
  await page.locator('[data-testid="efc-education"] > button').click();
  await page.getByLabel('School', {exact:true}).fill('First University');
  await page.getByLabel('Degree', {exact:true}).fill('Bachelor of Computer Science');
  assert.equal((await inspect()).historyAvailable,true,'partially filled editor stays detectable');
  report=await inspect('autofill',{contact,history:multiHistory.slice(3)});
  assert.equal(report.historySaved,2,'finish a matching old editor then add next education');

  for(const failure of ['missing','year','conflict','change','save']) {
    await load(bobHistory,bobUrl);
    const entry=structuredClone(multiHistory[3]);
    if(failure==='missing') delete entry.entry.fieldOfStudy;
    if(failure==='year') entry.entry.dates.start='2016';
    if(failure==='change') await page.evaluate(()=>window.changeDuringFill=true);
    if(failure==='save') await page.evaluate(()=>window.failSave=true);
    if(failure==='conflict') {
      await page.locator('[data-testid="efc-education"] > button').click();
      await page.getByLabel('School',{exact:true}).fill('First University');
      await page.getByLabel('Degree',{exact:true}).fill('Bachelor of Computer Science');
      await page.getByLabel('Field of study',{exact:true}).fill('User chosen major');
    }
    await inspect('autofill',{contact,history:[entry,multiHistory[4]]});
    assert.equal(await page.evaluate(()=>window.savedRows.length),0,failure);
    assert.equal(await page.locator('careers-ui-experience-edit-item').count(),1,'blocked editor never creates additional rows');
    assert.equal(await page.evaluate(()=>window.submissions),0);
    if(failure==='conflict') assert.equal(await page.getByLabel('Field of study',{exact:true}).inputValue(),'User chosen major');
  }
  console.log('PASS five complete saved history records, partial-row recovery, reload idempotence, missing facts, user edits and failed Save guards');

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
      { kind: "experience", entry: { title: "Test Engineer", company: "Fixture One", description: "Synthetic offline test record", dates: { start: "2020-01", end: "2021-02", current: false } } },
      { kind: "experience", entry: { title: "Test Analyst", company: "Fixture Two", dates: { start: "2022-03", end: "2023-04", current: false } } },
      { kind: "education", entry: { school: "Fixture University", degree: "Bachelor of Science", fieldOfStudy: "Computer Science", dates: { start: "2016-09", end: "2020-06", current: false } } },
      { kind: "education", entry: { school: "Second University", degree: "Master of Engineering", fieldOfStudy: "Computer Engineering", dates: { start: "2025-09", end: "", current: true } } },
    ];
    const before = await scan();
    assert.equal(before.employmentCountry, "CA");
    assert.equal(before.manualResume, true, "detached upload button reports manual attachment");
    console.log("HiBob detected:", before.fields?.map(f => ({ label: f.label, key: f.profileKey, kind: f.kind })), before.error);
    const result = await scan("autofill", { contact, history, skills: ["Python", "TypeScript"] });
    console.log("HiBob report:", { historyFilled: result.historyFilled, warnings: result.historyWarnings, fields: result.fields?.filter(f => f.state === "needed").map(f => ({ label: f.label, reason: f.reason })) });
    assert.equal(await live.locator('input[name="/candidate/socialMediaLinkedIn"]').inputValue(), contact.linkedInUrl);
    assert.equal(await live.locator('input[name="/candidate/phone"]').inputValue(), contact.phone);
    assert.match(await live.locator('[id="/candidate/country"]').innerText(), /Canada/);
    assert.equal(await live.locator('b-chip-input b-chip').count(), 2, "profile skills accepted as chips");
    assert.equal(await live.locator('careers-ui-experience-edit-item').count(), 0, "all complete history editors saved");
    assert.equal(result.historyFilled, 18);
    assert.equal(result.historySaved, 4);
    assert.equal(result.historyDateAdjusted, 7);
    assert.match(await live.locator('[data-testid="efc-experiences"]').innerText(), /Fixture One/);
    assert.match(await live.locator('[data-testid="efc-experiences"]').innerText(), /Fixture Two/);
    assert.match(await live.locator('[data-testid="efc-education"]').innerText(), /Fixture University/);
    assert.match(await live.locator('[data-testid="efc-education"]').innerText(), /Second University/);
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
