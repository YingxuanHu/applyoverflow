import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createInspector } from '../extensions/chrome/adapter.mjs';
import { createHistoryInspector } from '../extensions/chrome/history.mjs';
import { createAutofillInspector } from '../extensions/chrome/autofill.mjs';
import { applicationContext } from '../extensions/chrome/sites.mjs';

const source = `(${createInspector})(${applicationContext},(${createHistoryInspector})(),(${createAutofillInspector})())`;
const contact = { givenName: 'Jordan', familyName: 'Example', email: 'jordan@example.test', city: 'Toronto', region: 'Ontario' };
const history = [
  { kind: 'experience', entry: { company: 'Example Systems', title: 'Developer', location: 'Ottawa', dates: { start: '2023-01', end: '2024-02' } } },
  { kind: 'education', entry: { school: 'Example University', degree: 'Master of Science', fieldOfStudy: 'Computer Science', dates: { start: '2021-09', end: '2022-08' } } },
];
const input = label => `<label>${label}<input aria-label="${label}"></label>`;
const date = label => `<label>${label}<input aria-label="${label}" placeholder="MM/DD/YYYY"></label>`;
const section = (title, contents) => `<div><div><h2><button type="button">${title} (complete or remove this section)</button></h2></div><div role="region" aria-label="${title} (complete or remove this section)"><div class="record">${contents}</div><button type="button" data-add="${title}" aria-label="Add ${title} (complete or remove this section)">Add ${title} (complete or remove this section)</button></div></div>`;
const contents = `<h1>Software Engineer (12345)</h1><div><h2>Profile Information</h2>${input('FIRST NAME')}${input('LAST NAME')}${input('EMAIL')}${input('CITY/TOWN')}${input('STATE/ PROVINCE OR LOCAL EQUIVALENT')}</div>
  ${section('WORK EXPERIENCE', input('POSITION') + input('COMPANY NAME') + input('LOCATION') + date('START DATE') + date('END DATE'))}
  ${section('EDUCATION', input('INSTITUTION') + '<label>EDUCATION LEVEL<select aria-label="EDUCATION LEVEL"><option value="">No Selection</option><option>Master\'s Degree</option></select></label>' + input('FIELD OF STUDY') + date('START DATE') + date('END DATE'))}
  <div><h2>Job-Specific Information</h2>${input('Why this role?')}</div><button type="button">Save</button><button type="button">Apply</button>`;
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  let html;
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  const load = async body => {
    html = `<style>input,select{display:block;margin:3px}button{display:inline-block}</style>${body}`;
    await page.goto('https://unlisted-employer.example/careers/12345');
    await page.evaluate(code => {
      window.inspect = (0, eval)(code); window.actions = 0;
      document.addEventListener('submit', event => { event.preventDefault(); window.actions++; }, true);
      document.querySelectorAll('button').forEach(button => button.addEventListener('click', () => { if (/^(Save|Apply)$/.test(button.textContent)) window.actions++; }));
      document.querySelectorAll('[data-add]').forEach(button => {
        const template = button.parentElement.querySelector('.record').outerHTML;
        button.onclick = () => button.insertAdjacentHTML('beforebegin', template);
      });
    }, source);
  };
  const scan = (mode = 'inspect', payload = {}) => page.evaluate(({mode,payload}) => window.inspect(mode,payload,location.href), {mode,payload});
  for (const attr of ['aria-label="Job Application Form"', 'aria-labelledby="application-name"']) {
    await load(`<span id="application-name">Job Application Form</span><div ${attr}>${contents}</div>`);
    const result = await scan('autofill', { contact, history });
    assert.equal(result.error, undefined);
    assert.equal(await page.getByLabel('CITY/TOWN', { exact: true }).inputValue(), 'Toronto');
    assert.equal(await page.getByLabel('STATE/ PROVINCE OR LOCAL EQUIVALENT', { exact: true }).inputValue(), 'Ontario');
    assert.equal(await page.getByLabel('POSITION', { exact: true }).inputValue(), 'Developer');
    assert.equal(await page.getByLabel('LOCATION', { exact: true }).inputValue(), 'Ottawa', 'past employment must not use current residence');
    assert.equal(await page.getByLabel('INSTITUTION', { exact: true }).inputValue(), 'Example University');
    assert.equal(await page.getByLabel('EDUCATION LEVEL', { exact: true }).inputValue(), "Master's Degree");
    assert.deepEqual(await page.getByLabel('START DATE', { exact: true }).evaluateAll(fields => fields.map(field => field.value)), ['01/01/2023', '09/01/2021']);
    assert.deepEqual(await page.getByLabel('END DATE', { exact: true }).evaluateAll(fields => fields.map(field => field.value)), ['02/29/2024', '08/31/2022']);
    assert.equal(await page.getByLabel('Why this role?', { exact: true }).inputValue(), '');
    await scan('autofill', { contact, history });
    assert.equal(await page.locator('.record').count(), 2);
    assert.equal(await page.evaluate(() => window.actions), 0);
    console.log(`PASS ${attr}: entire application scope, contact and history, dates, no submission`);
    const multiple = [...history,
      { kind: 'experience', entry: { company: 'Second Employer', title: 'Analyst', dates: { start: '2020-04', end: '2021-01' } } },
      { kind: 'education', entry: { school: 'Second University', degree: 'Master of Science', fieldOfStudy: 'Physics', dates: { start: '2018-09', end: '2020-06' } } },
    ];
    await scan('autofill', {contact, history: multiple});
    assert.deepEqual(await page.getByLabel('COMPANY NAME', {exact: true}).evaluateAll(fields => fields.map(field => field.value)), ['Example Systems', 'Second Employer']);
    assert.deepEqual(await page.getByLabel('INSTITUTION', {exact: true}).evaluateAll(fields => fields.map(field => field.value)), ['Example University', 'Second University']);
    await page.getByLabel('POSITION', {exact: true}).first().fill('My manual correction');
    await scan('autofill', {contact, history: multiple});
    assert.equal(await page.getByLabel('POSITION', {exact: true}).first().inputValue(), 'My manual correction');
    assert.equal(await page.locator('.record').count(), 4, 'rerun preserves edited history and never duplicates records');
    assert.equal(await page.evaluate(() => window.actions), 0);
    console.log('PASS scoped Add controls, multiple history records, idempotency and manual edit protection');
  }
  for (const [name, body] of [
    ['two applications', `<div aria-label="Job Application Form">${contents}</div><div aria-label="Job Application Form">${contents}</div>`],
    ['login', `<div aria-label="Job Application Form">${contents}<input type="password"></div>`],
    ['unrelated named container', `<div aria-label="Newsletter">${contents}</div>`],
    ['no applicant identity', `<div aria-label="Job Application Form">${input('CITY/TOWN')}${input('LOCATION')}</div>`],
    ['unrelated form beside empty application shell', `<div aria-label="Job Application Form"></div><form>${input('FIRST NAME')}${input('EMAIL')}</form>`],
  ]) {
    await load(body);
    assert.ok((await scan('autofill', {contact,history})).error, name);
    assert.equal(await page.locator('input:not([type="password"])').evaluateAll(fields => fields.some(field => field.value)), false, name);
    console.log(`PASS rejects ${name}`);
  }
} finally { await browser.close(); }
