import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createInspector } from '../extensions/chrome/adapter.mjs';
import { createHistoryInspector } from '../extensions/chrome/history.mjs';
import { createAutofillInspector } from '../extensions/chrome/autofill.mjs';
import { applicationContext } from '../extensions/chrome/sites.mjs';

// Sanitized control shapes observed on authenticated Workday. No credentials,
// personal data, application mutations, or employer traffic in these fixtures.
const source = `(${createInspector})(${applicationContext},(${createHistoryInspector})(),(${createAutofillInspector})())`;
const browser = await chromium.launch();
let passed = 0;
try {
  const page = await browser.newPage();
  let html;
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
  const load = async contents => {
    html = `<h3>My Experience</h3><div data-automation-id="applyFlowPage">${contents}
      <button type="button" onclick="window.steps++">Save and Continue</button>
      <button type="button" onclick="window.submissions++">Submit Application</button></div>
      <script>window.steps=0;window.submissions=0</script>`;
    await page.goto('https://fixture.wd3.myworkdayjobs.com/en-US/External/job/Toronto/Engineer_R1/apply/myExperience');
    await page.evaluate(code => window.inspect = (0, eval)(code), source);
    await scan();
  };
  const scan = (mode = 'inspect', payload = {}) => page.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
  const safe = async () => {
    assert.equal(await page.evaluate(() => window.steps), 0);
    assert.equal(await page.evaluate(() => window.submissions), 0);
    passed++;
  };
  const date = (part, value = '') => `<div role="group" aria-label="${part === 'start' ? 'From' : 'To'}">
    <label>${part === 'start' ? 'From' : 'To'}*</label><div><div role="group" aria-labelledby="${part}-value">
    <span id="${part}-value">current value is ${value || 'MM/YYYY'}</span>
    <input id="${part}-month" role="spinbutton" aria-label="Month" value="${value.split('-')[1] || ''}">
    <input id="${part}-year" role="spinbutton" aria-label="Year" value="${value.split('-')[0] || ''}"></div></div></div>`;
  const work = (prefilled = false) => `<div role="group" data-automation-id="workExperience-1"><h4>Work Experience 1</h4>
    <label>Job Title<input id="title" value="${prefilled ? 'Engineer' : ''}"></label>
    <label>Company<input id="company" value="${prefilled ? 'Example Systems' : ''}"></label>
    <label>Location<input id="location" value="${prefilled ? 'Old city' : ''}"></label>
    <label>I currently work here<input id="current" type="checkbox"></label>
    ${date('start', prefilled ? '2020-02' : '')}${date('end', prefilled ? '2022-03' : '')}
    <label>Role Description<textarea id="description">${prefilled ? 'Bad parsed summary from another job' : ''}</textarea></label></div>`;
  const entry = { kind: 'experience', entry: { title: 'Engineer', company: 'Example Systems', location: 'Toronto',
    description: 'Built reporting tools.', dates: { start: '2021-01', end: '2023-08', current: false } } };
  await load(work());
  let result = await scan('autofill', { history: [entry], reconcilePrefilled: true });
  assert.equal(result.historyFilled, 8, JSON.stringify(result.historyWarnings));
  assert.deepEqual(await page.locator('[role="spinbutton"]').evaluateAll(nodes => nodes.map(n => n.value)), ['01', '2021', '08', '2023']);
  await safe();

  await load(work(true));
  result = await scan('autofill', { history: [entry] });
  assert.equal(await page.locator('#description').inputValue(), 'Bad parsed summary from another job', 'legacy mode preserves prefills');
  assert.equal(result.historyFilled, 0);
  result = await scan('autofill', { history: [entry], reconcilePrefilled: true });
  assert.equal(result.historyUpdated, 6, JSON.stringify(result.historyWarnings));
  assert.equal(await page.locator('#description').inputValue(), entry.entry.description);
  assert.equal(await page.locator('#location').inputValue(), 'Toronto');
  assert.deepEqual(await page.locator('[role="spinbutton"]').evaluateAll(nodes => nodes.map(n => n.value)), ['01', '2021', '08', '2023']);
  await scan('autofill', { history: [entry], reconcilePrefilled: true });
  assert.equal(await page.locator('[data-automation-id="workExperience-1"]').count(), 1);
  await safe();

  await load(work(true));
  await page.locator('#description').fill('My tailored wording');
  result = await scan('autofill', { history: [entry], reconcilePrefilled: true });
  assert.equal(result.historyFilled, 0);
  assert.match(result.historyWarnings.join(' '), /You edited/);
  assert.equal(await page.locator('#description').inputValue(), 'My tailored wording');
  await safe();

  await load(work(true));
  result = await scan('autofill', { history: [entry, { ...entry, entry: { ...entry.entry, dates: { start: '2018-01', end: '2020-08' } } }], reconcilePrefilled: true });
  assert.equal(result.historyFilled, 0, 'same employer/title with different dates is ambiguous');
  assert.match(result.historyWarnings.join(' '), /Multiple history/);
  await safe();

  await load(work(true).replace('<input id="current" type="checkbox">', '<input id="current" type="checkbox" checked>') + `<script>
    for(const f of document.querySelectorAll('[id^="end-"]'))if(f.tagName==='INPUT')f.disabled=true;
    document.getElementById('current').onchange=e=>{for(const f of document.querySelectorAll('[id^="end-"]'))if(f.tagName==='INPUT')f.disabled=e.target.checked};</script>`);
  result = await scan('autofill', { history: [entry], reconcilePrefilled: true });
  assert.equal(await page.locator('#current').isChecked(), false);
  assert.equal(await page.locator('#end-month').inputValue(), '08');
  assert.equal(await page.locator('#end-year').inputValue(), '2023');
  assert.equal(result.historyUpdated, 7);
  await scan('undo-history');
  assert.equal(await page.locator('#current').isChecked(), true);
  assert.equal(await page.locator('#end-month').inputValue(), '03');
  assert.equal(await page.locator('#end-year').inputValue(), '2022');
  await safe();

  const prompt = (id, label, options) => `<label for="${id}">${label}</label><input id="${id}" enterkeyhint="search" data-uxi-widget-type="selectinput" data-uxi-multiselect-id="${id}-prompt">
    <ul data-automation-id="selectedItemList" data-uxi-multiselect-id="${id}-prompt" id="${id}-selected"></ul>
    <script>document.getElementById('${id}').onkeydown=e=>{if(e.key!=='Enter')return;e.preventDefault();
      document.getElementById('${id}-options')?.remove();const list=document.createElement('div');list.id='${id}-options';list.role='listbox';document.body.append(list);
      for(const text of ${JSON.stringify(options)}){if(!text.toLowerCase().includes(e.target.value.toLowerCase()))continue;
      const option=document.createElement('div');option.role='option';const item=document.createElement('div');item.dataset.uxiMultiselectId='${id}-prompt';item.dataset.uxiWidgetType='multiselectlistitem';item.textContent=text;option.append(item);
      item.onclick=()=>{const selected=document.createElement('span');selected.dataset.automationId='promptOption';selected.textContent=text;document.getElementById('${id}-selected').replaceChildren(selected);document.getElementById('${id}').value='';list.remove()};list.append(option)}};</script>`;
  await load(`<div role="group" data-automation-id="education-1"><h4>Education 1</h4>
    ${prompt('school', 'School or University', ['University of Toronto', 'University of Waterloo'])}
    <label>Degree<select id="degree"><option value="">Select One</option><option>Masters</option><option>Bachelors</option></select></label>
    ${prompt('major', 'Field of Study', ['Computer Science', 'Computer Engineering'])}</div>`);
  const education = { kind: 'education', entry: { school: 'University of Toronto', degree: 'Master of Engineering', fieldOfStudy: 'Computer Engineering' } };
  result = await scan('autofill', { history: [education], reconcilePrefilled: true });
  assert.equal(result.historyFilled, 3, JSON.stringify(result.historyWarnings));
  assert.equal(await page.locator('#school-selected').textContent(), 'University of Toronto');
  assert.equal(await page.locator('#major-selected').textContent(), 'Computer Engineering');
  assert.equal(await page.locator('#degree').inputValue(), 'Masters');
  await scan('autofill', { history: [education], reconcilePrefilled: true });
  assert.equal(await page.locator('#school-selected > *').count(), 1);
  await safe();

  await load(`<div role="group"><h4>Education 1</h4><label>School<input value="Example University"></label>
    <label>Field of Study<input id="major" enterkeyhint="search" data-uxi-widget-type="selectinput" data-uxi-multiselect-id="major-prompt"></label>
    <ul data-automation-id="selectedItemList" data-uxi-multiselect-id="major-prompt" id="selected"></ul></div><script>
    document.getElementById('major').onkeydown=e=>{if(e.key==='Enter' && e.target.value==='Computer Science'){
      const chip=document.createElement('span');chip.dataset.automationId='promptOption';chip.textContent=e.target.value;
      document.getElementById('selected').append(chip);e.target.value=''}};</script>`);
  result = await scan('autofill', { history: [{ kind: 'education', entry: { school: 'Example University', fieldOfStudy: 'Computer Science' } }], reconcilePrefilled: true });
  assert.equal(result.historyFilled, 1, 'search can commit a unique result without leaving a menu open');
  assert.deepEqual(result.historyWarnings, []);
  await safe();

  await load(`<label>First Name<input id="first" value="Old name"></label><label>City<input id="city" value="Old city"></label>
    <label>Province or Territory<select id="region"><option value="">Select One</option><option>Ontario</option><option selected>Alberta</option></select></label>
    <label>Why this role?<textarea id="narrative">My own answer</textarea></label>`);
  const contact = { givenName: 'Jordan', city: 'Toronto', region: 'ON' };
  await scan('autofill', { contact });
  assert.equal(await page.locator('#first').inputValue(), 'Old name');
  result = await scan('autofill', { contact, reconcilePrefilled: true, answers: [{ label: 'Why this role?', answer: 'Do not overwrite' }] });
  assert.equal(await page.locator('#first').inputValue(), 'Jordan');
  assert.equal(await page.locator('#city').inputValue(), 'Toronto');
  assert.equal(await page.locator('#region').inputValue(), 'Ontario');
  assert.equal(await page.locator('#narrative').inputValue(), 'My own answer');
  assert.equal(result.fields.filter(f => f.updated).length, 3);
  await scan('autofill-undo');
  assert.equal(await page.locator('#first').inputValue(), 'Old name');
  await page.locator('#city').fill('My chosen city');
  await scan('autofill', { contact, reconcilePrefilled: true });
  assert.equal(await page.locator('#city').inputValue(), 'My chosen city');
  await safe();
  console.log(`PASS ${passed} prefilled reconciliation/Workday control cases; no continuation or submission`);
} finally { await browser.close(); }
