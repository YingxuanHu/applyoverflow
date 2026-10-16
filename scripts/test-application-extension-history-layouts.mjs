import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createInspector } from '../extensions/chrome/adapter.mjs';
import { createHistoryInspector } from '../extensions/chrome/history.mjs';
import { createAutofillInspector } from '../extensions/chrome/autofill.mjs';
import { applicationContext } from '../extensions/chrome/sites.mjs';

const source = `(${createInspector})(${applicationContext},(${createHistoryInspector})(),(${createAutofillInspector})())`;
const contact = { givenName: 'Jordan', familyName: 'Example', email: 'jordan@example.test' };
const history = [
  { kind: 'experience', entry: { company: 'Example Systems', title: 'Software Engineer', dates: { start: '2023-09', current: true } } },
  { kind: 'experience', entry: { company: 'Sample Labs', title: 'Developer', dates: { start: '2021-01', end: '2023-08' } } },
  { kind: 'education', entry: { school: 'University of Toronto', degree: 'Master of Science', fieldOfStudy: 'Computer Science' } },
  { kind: 'education', entry: { school: 'University of Waterloo, School of Computer Science', degree: 'Bachelor of Computer Science', fieldOfStudy: 'Computer Science' } },
];
const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 1000 } });
await context.routeWebSocket('**/*', socket => socket.close());
try {
  const page = await context.newPage();
  const inject = async frame => frame.evaluate(code => {
    window.inspect = (0, eval)(code);
    window.submissions = 0;
    document.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); window.submissions++; }, true);
  }, source);
  const scan = (frame, mode = 'inspect', payload = {}) => frame.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
  if (process.argv.includes('--live')) {
    await page.goto('https://app.careerpuck.com/job-board/lyft/job/8888403002?gh_jid=8888403002', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const embedded = page.frameLocator('#grnhse_iframe');
    await embedded.getByLabel('Company name', { exact: true }).waitFor({ timeout: 45_000 });
    const frame = page.frames().find(frame => frame.url().includes('/embed/job_app?'));
    assert.ok(frame, 'real embedded application loaded');
    // Only the public school/degree/discipline catalog can reach the network
    // once synthetic applicant data is present. No telemetry, uploads or saves.
    const allowedRequests = [];
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === 'GET' && url.hostname === 'boards.greenhouse.io' &&
          /^\/v1\/boards\/lyft\/education\/(schools|degrees|disciplines)$/.test(url.pathname)) {
        allowedRequests.push(url.pathname);
        return route.continue();
      }
      return route.abort();
    });
    await inject(frame);
    const result = await scan(frame, 'autofill', { contact, history });
    console.log(JSON.stringify({ historyFilled: result.historyFilled, historyWarnings: result.historyWarnings }));
    assert.equal(result.historyFilled, 17);
    assert.deepEqual(result.historyWarnings, []);
    const values = await frame.evaluate(() => ({
      work: [...document.querySelectorAll('.employment-form')].map(row => ({
        company: row.querySelector('[aria-label="Company name"]')?.value,
        title: row.querySelector('[aria-label="Title"]')?.value,
        months: [...row.querySelectorAll('.select__single-value')].map(node => node.textContent),
        years: [...row.querySelectorAll('input[aria-label$="year"]')].map(node => node.value),
        current: row.querySelector('input[type="checkbox"]')?.checked,
      })),
      education: [...document.querySelectorAll('.education--form')].map(row => [...row.querySelectorAll('.select__single-value')].map(node => node.textContent)),
    }));
    console.log(JSON.stringify(values));
    assert.deepEqual(values.work.map(row => row.company), ['Example Systems', 'Sample Labs']);
    assert.deepEqual(values.work.map(row => row.title), ['Software Engineer', 'Developer']);
    assert.deepEqual(values.work[0].months, ['September']);
    assert.equal(values.work[0].years[0], '2023');
    assert.equal(values.work[0].current, true);
    assert.deepEqual(values.work[1].months, ['January', 'August']);
    assert.deepEqual(values.work[1].years, ['2021', '2023']);
    assert.equal(values.work[1].current, false);
    assert.deepEqual(values.education, [
      ['University of Toronto', "Master's Degree", 'Computer Science'],
      ['University of Waterloo', "Bachelor's Degree", 'Computer Science'],
    ]);
    const repeated = await scan(frame, 'autofill', { contact, history });
    assert.equal(repeated.historyFilled, 0, 'second fill must not duplicate history');
    assert.equal(await frame.locator('.employment-form').count(), 2);
    assert.equal(await frame.locator('.education--form').count(), 2);
    assert.equal(await frame.evaluate(() => window.submissions), 0);
    assert.equal(await frame.locator('input[type="file"]').evaluateAll(fields => fields.reduce((n, field) => n + field.files.length, 0)), 0);
    await mkdir('output/playwright/history-layouts', { recursive: true });
    await frame.locator('.employment--container').screenshot({ path: 'output/playwright/history-layouts/live-employment.png' });
    await frame.locator('.education--container').screenshot({ path: 'output/playwright/history-layouts/live-education.png' });
    console.log(`PASS live embedded application: two employment + two education rows, dropdowns, dates, current role, no duplicates; ${allowedRequests.length} public catalog lookups, no upload/submission`);
  } else {
    let html;
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
    const input = label => `<label>${label}<input aria-label="${label}"></label>`;
    const combo = (label, options) => `<div class="select__value-container"><label>${label}<input role="combobox" aria-label="${label}" aria-expanded="false" data-options='${JSON.stringify(options).replaceAll("'", '&#39;')}'></label></div>`;
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const work = `<div class="record">${input('Company name')}${input('Title')}${combo('Start date month', months)}${input('Start date year')}${combo('End date month', months)}${input('End date year')}<label><input type="checkbox">Current role</label></div>`;
    const education = `<div class="record">${combo('School', ['University of Toronto', 'University of Waterloo', 'University of Waterloo - Stratford Campus'])}${combo('Degree', ["Master's Degree", "Bachelor's Degree"])}${input('Field of study')}</div>`;
    const script = `<script>
      let id=0;
      function setup(root) {
        for(const field of root.querySelectorAll('[role="combobox"]')) {
          if(field.dataset.ready)continue;field.dataset.ready='true';
          const list=document.createElement('div');list.id='options-'+(++id);list.role='listbox';list.hidden=true;
          field.parentElement.parentElement.append(list);field.setAttribute('aria-controls',list.id);
          const render=()=>{list.replaceChildren();for(const text of JSON.parse(field.dataset.options).filter(text=>text.toLowerCase().includes(field.value.toLowerCase()))) {
            const option=document.createElement('div');option.role='option';option.textContent=text;
            option.onclick=()=>{field.parentElement.parentElement.querySelector('.select__single-value')?.remove();const selected=document.createElement('span');selected.className='select__single-value';selected.textContent=text;field.parentElement.parentElement.append(selected);field.value='';list.hidden=true;field.setAttribute('aria-expanded','false')};list.append(option);
          }};
          field.onclick=()=>{list.hidden=false;field.setAttribute('aria-expanded','true');render()};
          field.oninput=()=>setTimeout(render,40);
          field.onkeydown=e=>{if(e.key==='Escape')queueMicrotask(()=>{list.hidden=true;field.setAttribute('aria-expanded','false')})};
        }
      }
      setup(document);
      for(const button of document.querySelectorAll('[data-add]'))button.onclick=()=>{button.insertAdjacentHTML('beforebegin',button.dataset.add==='work'?${JSON.stringify(work)}:${JSON.stringify(education)});setup(button.parentElement)};
      </script>`;
    const load = async (header, embedded = false) => {
      const section = (kind, body, add) => `<div data-section="${add}">${header(kind)}${body}<button type="button" data-add="${add}">Add another</button></div>`;
      html = `<style>input{display:block}input[type=checkbox]{display:inline}[hidden]{display:none!important}</style><form>
        <h2>Apply for this job</h2>${input('First name')}${input('Last name')}<label>Email<input type="email"></label><input type="file" aria-label="Resume">
        ${section('Employment', work, 'work')}${section('Education', education, 'education')}<button>Submit application</button></form>${script}`;
      await page.goto('https://unlisted-employer.example/jobs/apply');
      let frame = page;
      if (embedded) {
        const child = html;
        await page.setContent('<iframe src="https://independent-ats.example/jobs/apply"></iframe>');
        html = child;
        await page.frameLocator('iframe').getByLabel('Company name', { exact: true }).waitFor();
        frame = page.frames()[1];
      }
      await inject(frame);
      return frame;
    };
    for (const [name, header, embedded] of [
      ['nested paragraph', kind => `<div><p>${kind}</p></div>`, false],
      ['wrapped heading', kind => `<header><div><h3>${kind}</h3></div></header>`, false],
      ['embedded unfamiliar ATS', kind => `<div><p>${kind}</p></div>`, true],
    ]) {
      const frame = await load(header, embedded);
      const result = await scan(frame, 'autofill', { contact, history });
      assert.equal(result.error, undefined, name);
      assert.equal(result.historyFilled, 17, JSON.stringify(result));
      assert.deepEqual(await frame.getByLabel('Company name', { exact: true }).evaluateAll(fields => fields.map(field => field.value)), ['Example Systems', 'Sample Labs']);
      assert.deepEqual(await frame.locator('[data-section="education"] .select__single-value').allTextContents(), ['University of Toronto', "Master's Degree", 'University of Waterloo', "Bachelor's Degree"]);
      assert.deepEqual(await frame.locator('[data-section="work"] .select__single-value').allTextContents(), ['September', 'January', 'August']);
      assert.deepEqual(await frame.getByLabel('Start date year').evaluateAll(fields => fields.map(field => field.value)), ['2023', '2021']);
      assert.equal(await frame.getByLabel('Current role').first().isChecked(), true);
      await scan(frame, 'autofill', { contact, history });
      assert.equal(await frame.locator('.record').count(), 4, name + ': repeated run');
      await frame.getByLabel('Title', { exact: true }).first().fill('My edited title');
      await scan(frame, 'autofill', { contact, history });
      assert.equal(await frame.getByLabel('Title', { exact: true }).first().inputValue(), 'My edited title');
      assert.equal(await frame.locator('.record').count(), 4, name + ': manual edits');
      assert.equal(await frame.evaluate(() => window.submissions), 0);
      console.log('PASS ' + name + ': multi-record work/education, catalogs, dates, current role, no duplicate or overwritten edits');
    }
    const frame = await load(kind => `<div><p>${kind}</p></div>`);
    await frame.getByRole('combobox', { name: 'School', exact: true }).evaluate(field => { field.dataset.options = '[]'; });
    let result = await scan(frame, 'autofill', { contact, history: [history[2]] });
    assert.equal(result.historyFilled, 2);
    assert.ok(result.historyWarnings.some(warning => warning.startsWith('School:')));
    assert.equal(await frame.getByRole('combobox', { name: 'School', exact: true }).inputValue(), '', 'failed search cannot look filled');
    await frame.getByRole('combobox', { name: 'School', exact: true }).evaluate(field => { field.dataset.options = '["University of Toronto"]'; });
    result = await scan(frame, 'autofill', { contact, history: [history[2]] });
    assert.equal(result.historyFilled, 1, 'retry completes the original partially filled education');
    assert.equal(await frame.locator('[data-section="education"] .record').count(), 1);

    // A conflicting degree, multiple identical catalog options or a different
    // campus must not be silently substituted, even when a search is close.
    const ambiguous = await load(kind => `<div><p>${kind}</p></div>`);
    await ambiguous.getByRole('combobox', { name: 'School', exact: true }).evaluate(field => { field.dataset.options = '["University of Toronto","University of Toronto"]'; });
    result = await scan(ambiguous, 'autofill', { contact, history: [history[2]] });
    assert.ok(result.historyWarnings.some(warning => warning.startsWith('School:')));
    assert.equal(await ambiguous.locator('[data-section="education"] .select__single-value').count(), 1, 'only degree is selected when school is ambiguous');
    await ambiguous.getByLabel('Field of study').fill('My manual correction');
    await ambiguous.getByRole('combobox', { name: 'School', exact: true }).evaluate(field => { field.dataset.options = '["University of Toronto"]'; });
    await scan(ambiguous, 'autofill', { contact, history: [history[2]] });
    assert.equal(await ambiguous.getByLabel('Field of study').inputValue(), 'My manual correction');
    assert.equal(await ambiguous.locator('[data-section="education"] .record').count(), 1);
    console.log('PASS catalog outage retry completes original row; ambiguous schools and manual corrections remain protected');

    const campus = await load(kind => `<div><p>${kind}</p></div>`);
    await campus.getByRole('combobox', { name: 'School', exact: true }).evaluate(field => { field.dataset.options = '["University of Waterloo - Stratford Campus"]'; });
    result = await scan(campus, 'autofill', { contact, history: [history[3]] });
    assert.ok(result.historyWarnings.some(warning => warning.startsWith('School:')));
    assert.deepEqual(await campus.locator('[data-section="education"] .select__single-value').allTextContents(), ["Bachelor's Degree"], 'a different campus is not an institution alias');
    console.log('PASS campus qualifiers are preserved, not fuzzy-matched away');

    const ownership = await load(kind => `<header><div><h3>${kind}</h3></div></header>`);
    await ownership.locator('[data-section="work"] .record').evaluate(row => row.insertAdjacentHTML('beforeend', '<label>Location<input aria-label="Location"></label>'));
    await scan(ownership, 'autofill', { contact: { ...contact, city: 'Toronto' }, history: [history[0]] });
    assert.equal(await ownership.getByLabel('Location', { exact: true }).inputValue(), '', 'home city is not a past employer location');
    console.log('PASS nested history ownership prevents contact facts leaking into employment fields');
  }
} finally {
  await context.close();
  await browser.close();
}
