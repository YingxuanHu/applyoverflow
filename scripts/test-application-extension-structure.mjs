import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";

const source = `(${createInspector})(${applicationContext},(${createHistoryInspector})(),(${createAutofillInspector})())`;
const browser = await chromium.launch();
const page = await browser.newPage();
let html;
await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
const field = (label, attrs = "") => `<label>${label}<input ${attrs}></label>`;
const contact = { givenName: "Jordan", familyName: "Example", email: "jordan@example.test", phone: "4165550123", phoneCountry: "CA", country: "CA", city: "Toronto" };
const load = async (body, path = "/jobs/123/apply#application") => {
  html = `<meta charset="utf-8"><style>label,input{display:block}div{min-height:1px}</style>${body}<script>window.submits=0;document.addEventListener('submit',e=>{e.preventDefault();window.submits++})</script>`;
  await page.goto("about:blank");
  await page.goto(`https://unlisted-employer.example${path}`);
  await page.evaluate(code => { window.inspect = (0, eval)(code); }, source);
};
const inspect = (mode = "inspect", plan = {}) => page.evaluate(({ mode, plan }) => window.inspect(mode, plan, location.href), { mode, plan });
try {
  // Custom career pages with an anchor, search and newsletter forms, plus the
  // applicant form. No hostname, CSS class or autocomplete hints are required.
  await load(`<h2>Apply now</h2><form><label>Search jobs<input></label></form>
    <form aria-label="Newsletter">${field("Email")}</form><form>${field("Legal First Name")}${field("Legal Last Name")}${field("Email")}${field("Confirm Email Address")}</form>`);
  let result = await inspect("autofill", { contact });
  assert.equal(result.error, undefined);
  assert.equal(await page.getByLabel("Legal First Name").inputValue(), "Jordan");
  assert.equal(await page.getByLabel("Confirm Email Address").inputValue(), contact.email);
  assert.equal(await page.locator('form[aria-label="Newsletter"] input').inputValue(), "");
  await load(`<h1>Candidate Info</h1><form>${field("First Name")}${field("Last Name")}${field("Email Address")}</form>`);
  assert.equal((await inspect("autofill", { contact })).fields.filter(f => f.state === "filled").length, 3);
  console.log("PASS unlisted domains, fragment navigation, multiple unrelated forms and candidate-info headings");
  await load(`<style>.internal-id{display:none}.sr-label{position:absolute;width:1px;height:1px;overflow:hidden}</style><h1>Apply now</h1><form>
    <label class="sr-label" for="first"><span>Legal First Name <small>(required)</small></span><span class="internal-id">c0ffee12</span></label><input id="first">
    <label for="mail">Email<span hidden>Internal identifier</span><span aria-hidden="true">Icon</span></label><input id="mail" type="email"></form>`);
  result = await inspect('autofill', { contact });
  assert.equal(result.error, undefined);
  assert.equal(await page.locator('#first').inputValue(), contact.givenName);
  assert.equal(await page.locator('#mail').inputValue(), contact.email);
  console.log('PASS hidden label IDs are excluded without discarding screen-reader labels');
  await load(`<h1>Application</h1><form>${field('First Name')}${field('Email')}
    <label>Previous answer<input id="previous" value="Yes"></label>
    <label for="delayed">Do you require sponsorship?</label><input id="delayed" role="combobox" aria-controls="owned" aria-expanded="false">
    </form><script>const delayed=document.querySelector('#delayed');delayed.onclick=()=>{
      delayed.setAttribute('aria-expanded','true');
      setTimeout(()=>{document.body.insertAdjacentHTML('beforeend','<div id="foreign" role="listbox"><div role="option">No</div></div>');
        document.querySelector('#foreign [role=option]').onclick=()=>{document.querySelector('#previous').value='No'};},30);
      setTimeout(()=>{document.body.insertAdjacentHTML('beforeend','<div id="owned" role="listbox"><div role="option">No</div></div>');
        document.querySelector('#owned [role=option]').onclick=()=>{delayed.value='No';delayed.setAttribute('aria-expanded','false');document.querySelector('#owned').remove()};},180);
    };</script>`);
  await inspect('autofill', { commonAnswers: [{label:'Do you require sponsorship?',answer:'No',answerKey:'sponsorshipCA'}] });
  assert.equal(await page.locator('#delayed').inputValue(), 'No');
  assert.equal(await page.locator('#previous').inputValue(), 'Yes');
  console.log('PASS delayed owned dropdown never falls back to another question\'s newly opened options');

  const work = Array.from({ length: 3 }, (_, i) => ({ kind: "experience", entry: {
    title: `Engineer ${i}`, company: `Employer ${i}`, description: `Built product ${i}`,
    location: "Montreal", dates: { start: `202${i}-01`, end: `202${i}-08` },
  } }));
  const row = `<div class="editor">${field("Position title", 'required')}${field("Employer name", 'required')}${field("Location")}
    ${field("Start date", 'type="date" required')}${field("End date", 'type="date"')}<label>Summary<textarea></textarea></label>
    <button type="button" class="save">Save</button><button type="button">Cancel</button></div>`;
  await load(`<h1>Application: My Experience</h1><form><div id="employment"><h3>Employment History</h3><div id="records"></div><button type="button" id="add">Add another job</button></div>
    <button type="button" id="next">Save and Continue</button><button>Submit</button></form>
    <script>window.next=0;document.querySelector('#next').onclick=()=>window.next++;
    const owner=document.querySelector('#employment'), add=document.querySelector('#add');
    add.onclick=()=>{add.disabled=true;owner.insertAdjacentHTML('beforeend',${JSON.stringify(row)});const editor=owner.querySelector('.editor');
      editor.querySelector('.save').onclick=()=>{if([...editor.querySelectorAll('input')].some(f=>!f.checkValidity()))return;
        const record=document.createElement('p');record.className='record';record.textContent=[...editor.querySelectorAll('input,textarea')].map(f=>f.value).join(' | ');
        document.querySelector('#records').append(record);editor.remove();add.disabled=false;};};</script>`);
  assert.equal((await inspect()).historyAvailable, true);
  result = await inspect("autofill", { contact, history: work });
  assert.equal(result.historySaved, 3, JSON.stringify(result.historyWarnings));
  assert.equal(await page.locator('.editor').count(), 0);
  const records = await page.locator('.record').allTextContents();
  assert.equal(records.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.match(records[i], new RegExp(`Engineer ${i} \\| Employer ${i} \\| Montreal \\| 202${i}-01-01 \\| 202${i}-08-31`));
  }
  await inspect("autofill", { contact, history: work });
  assert.equal(await page.locator('.record').count(), 3, "repeat fill cannot create duplicate jobs");
  assert.equal(await page.evaluate(() => window.next + window.submits), 0);
  console.log("PASS generic div history editors: 3 complete jobs, bounded Add/Save, month-boundary dates, no duplicates or continuation");

  await load(`<h1>Application</h1><form><div><h3>Work Experience</h3>${row}</div></form>`);
  await page.getByLabel("Employer name").fill("User employer");
  await inspect("autofill", { contact, history: work });
  assert.equal(await page.getByLabel("Employer name").inputValue(), "User employer");
  assert.equal(await page.getByLabel("Position title").inputValue(), "");
  assert.equal(await page.getByLabel("Location").inputValue(), "", "applicant city must not leak into a history record");

  await load(`<h1>Application</h1><form><div><h3>Work Experience</h3>${row.replace('</div>',field('Reason for leaving', 'required')+'</div>')}</div></form>`);
  await page.locator('.save').evaluate(b => b.onclick = () => { window.submits++; });
  await inspect("autofill", { contact, history: work.slice(0, 1) });
  assert.equal(await page.evaluate(() => window.submits), 0, "missing required facts must prevent Save");
  console.log("PASS preserve partial user history and block Save with unknown required fields");

  // Ant Design uses a readonly query input and a virtualized visual option
  // beside its ARIA list. This is a reusable widget contract, not an ATS host.
  await load(`<h1>Application</h1><form>${field("First Name")}${field("Email")}
    <label for="source">How did you hear about this job?</label><div class="ant-select-selector">
    <input id="source" type="search" role="combobox" readonly aria-haspopup="listbox" aria-controls="source-list" aria-expanded="false"></div>
    <button>Submit</button></form><script>const input=document.querySelector('#source');input.onclick=()=>{
      if(document.querySelector('.ant-select-dropdown'))return;input.setAttribute('aria-expanded','true');
      document.body.insertAdjacentHTML('beforeend','<div class="ant-select-dropdown"><div id="source-list" role="listbox"><div role="option" style="height:1px">Other</div></div><div class="ant-select-item-option">Other</div></div>');
      document.querySelector('.ant-select-item-option').onclick=()=>{const span=document.createElement('span');span.className='ant-select-selection-item';span.textContent='Other';input.parentElement.append(span);input.setAttribute('aria-expanded','false');document.querySelector('.ant-select-dropdown').remove();};};</script>`);
  result = await inspect("autofill", { contact, commonAnswers: [{ label: "How did you hear about this job?", answer: "Other", answerKey: "jobSource" }] });
  assert.equal(await page.locator('.ant-select-selection-item').innerText(), "Other");
  assert.equal(result.fields.find(f => f.label.startsWith('How did')).state, "filled");
  await page.screenshot({ path: "output/playwright/structure-custom-controls.png" });
  console.log("PASS readonly combobox selection, virtualized owned options and selected-value readback");

  await load(`<h1>Application</h1><form>${field('First Name')}${field('Email')}
    <label>Country dialing code<select><option value="">Select</option>
    <option value="us">\u{1f1fa}\u{1f1f8} +1 United States of America</option><option value="ca">\u{1f1e8}\u{1f1e6} +1 Canada</option></select></label></form>`);
  result = await inspect('autofill', { contact });
  assert.equal(await page.locator('select').inputValue(), 'ca', JSON.stringify(result.fields));
  console.log('PASS decorated dial-code options retain country identity instead of matching ambiguous +1');

  const uploadWidget = `<span><input type="file" accept=".pdf" style="display:none"><span>.pdf, .doc, .docx</span><button type="button" aria-label="Select file - Upload resume">Upload resume</button></span>`;
  await load(`<h1>Application</h1><form>${field('First Name')}${field('Email')}${uploadWidget}</form>`);
  let prepared = await inspect('prepare-resume');
  assert.ok(prepared.resumeToken);
  const bytes = Buffer.from('%PDF-1.4\nsynthetic fixture\n%%EOF');
  const attachment = { resumeToken: prepared.resumeToken, name: 'fixture.pdf', mimeType: 'application/pdf', size: bytes.length, base64: bytes.toString('base64') };
  assert.equal((await inspect('attach-resume', attachment)).resumeSelected, true);
  assert.equal(await page.locator('input[type=file]').evaluate(f => f.files[0].name), 'fixture.pdf');
  assert.ok((await inspect('attach-resume', attachment)).error, 'do not upload twice');
  await load(`<h1>Application</h1><form>${field('First Name')}${field('Email')}${uploadWidget}${uploadWidget}</form>`);
  assert.ok((await inspect('prepare-resume')).error, 'ambiguous resume widgets stay manual');
  await load(`<h1>Application</h1><form>${field('First Name')}${field('Email')}${uploadWidget.replace('</span><button', '</span><span>existing.pdf</span><button')}</form>`);
  assert.ok((await inspect('prepare-resume')).error, 'already uploaded documents stay unchanged');
  await load(`<h1>Application</h1><form>${field('First Name')}${field('Email')}<button type="button">Import Resume</button></form>`);
  assert.equal((await inspect()).manualResume, true);
  console.log('PASS local hidden resume widget attachment, duplicate protection, ambiguity and manual import guidance');

  await load(`<h1>Application</h1><form>${field('First Name')}${field('Email')}
    <label>Country<select id="country"><option value="">Select</option><option value="CA">Canada</option></select></label>
    <label>Province<select id="province" disabled><option value="">Select</option><option value="ON">Ontario</option></select></label></form>
    <script>document.querySelector('#country').onchange=()=>setTimeout(()=>{document.querySelector('#province').disabled=false},50)</script>`);
  result = await inspect('autofill', { contact: { ...contact, region: 'ON' } });
  assert.equal(await page.locator('#country').inputValue(), 'CA');
  assert.equal(await page.locator('#province').inputValue(), 'ON');
  console.log('PASS dependent fields discovered and filled after country selection');

  const metadataForm = `<h1>Application</h1><form>${field('First Name')}${field('Email')}</form>`;
  const posting = countries => JSON.stringify({ '@type': 'JobPosting', description: '<p>Build reliable distributed services.</p>',
    jobLocation: countries.map(name => ({ address: { addressCountry: {name} } })) });
  await load(`${metadataForm}<script type="application/ld+json">${posting(['CA','CA'])}</script>`);
  result = await inspect('autofill-context');
  assert.equal(result.employmentCountry, 'CA');
  assert.equal(result.jobDescription, 'Build reliable distributed services.');
  await load(`${metadataForm}<script type="application/ld+json">${posting(['CA','US'])}</script>`);
  assert.equal((await inspect('autofill-context')).employmentCountry, undefined);
  await load(`${metadataForm}<script type="application/ld+json">${posting(['CA'])}</script><script type="application/ld+json">${posting(['US'])}</script>`);
  assert.equal((await inspect('autofill-context')).employmentCountry, undefined);
  console.log('PASS structured posting context; ambiguous countries/postings are not guessed');

  await load(`${metadataForm}<div role="dialog"><h2>Privacy agreement</h2><button>Accept</button></div>`);
  result = await inspect('autofill', { contact });
  assert.match(result.error, /Complete or close the dialog/);
  assert.equal(await page.getByLabel('First Name').inputValue(), '');
  assert.equal(await page.evaluate(() => window.submits), 0);
  console.log('PASS blocking employer consent dialog produces actionable guidance without filling behind it');
} finally { await browser.close(); }
