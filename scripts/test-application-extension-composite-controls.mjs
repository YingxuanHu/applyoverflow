import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createInspector } from '../extensions/chrome/adapter.mjs';
import { createHistoryInspector } from '../extensions/chrome/history.mjs';
import { createAutofillInspector } from '../extensions/chrome/autofill.mjs';
import { applicationContext } from '../extensions/chrome/sites.mjs';
import * as profileAnswers from '../src/lib/profile-application-answers.ts';
const { applicationAnswerPlan } = profileAnswers.default || profileAnswers;

const source = `(${createInspector})(${applicationContext},(${createHistoryInspector})(),(${createAutofillInspector})())`;
const contact = { givenName: 'Jordan', middleName: 'Taylor', familyName: 'Example', email: 'jordan@example.test',
  phone: '4165550123', phoneCountry: 'CA', currentCompany: 'Example Systems', pronouns: 'They/them',
  linkedInUrl: 'https://linkedin.com/in/example', portfolioUrl: 'https://example.test' };
const preferences = { enabled: true, values: { authorizedCA: 'Yes', sponsorshipCA: 'No', smsUpdates: 'No', jobSource: 'ApplyOverflow' } };
const skills = ['TypeScript', 'Python', 'SQL'];
const browser = await chromium.launch();
const output = 'output/playwright/composite-controls';
const reports = [];
try {
  const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1360, height: 1000 } });
  await page.routeWebSocket('**/*', socket => socket.close());
  const inject = () => page.evaluate(code => {
    window.inspect = (0, eval)(code);
    window.submissions = 0;
    document.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); window.submissions++; }, true);
  }, source);
  const scan = (mode = 'inspect', payload = {}) => page.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
  const plan = result => applicationAnswerPlan(preferences, result.fields.map(f => f.label)).answers;
  const assertField = (result, key, state = 'filled') => assert.equal(result.fields.find(f => f.profileKey === key)?.state, state, `${key}: ${JSON.stringify(result.fields)}`);
  await mkdir(output, { recursive: true });
  if (process.argv.includes('--live')) {
    for (const [name, url, ready] of [
      ['rippling', 'https://ats.rippling.com/infotrack-services-ltd/jobs/148aa4f5-68f2-4061-be3f-92fbcdc94b51/apply?step=application', '[data-testid="input-phone_number"]'],
      ['orangehrm', 'https://pinnacle.orangehrmlive.com/external/#/recruitment-apply/candidate/vacancy/704', '#apply-candidate-form_email'],
    ]) {
      await page.unrouteAll();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.locator(ready).waitFor({ timeout: 40_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 });
      // No applicant, upload, analytics or submit request may leave the page.
      // Public Google Maps GETs only support the synthetic Toronto lookup.
      let blocked = 0, lookups = 0;
      await page.route('**/*', route => {
        const request = route.request(), parsed = new URL(request.url());
        if (request.method() === 'GET' && ['maps.googleapis.com', 'maps.gstatic.com'].includes(parsed.hostname) && /^\/(?:maps|maps-api-v3)\//.test(parsed.pathname)) {
          lookups++; return route.continue();
        }
        blocked++; return route.abort();
      });
      await inject();
      const initial = await scan();
      assert.equal(initial.error, undefined);
      const commonAnswers = plan(initial);
      // Explicit synthetic fixture facts, not inferred personal declarations.
      for (const field of initial.fields) {
        if (/comfortable working in a hybrid model/.test(field.label)) commonAnswers.push({ label: field.label, answer: 'Yes', answerKey: 'fixtureHybridPreference' });
      }
      const payload = { contact: { ...contact, city: 'Toronto', region: 'ON', country: 'CA' }, skills, commonAnswers };
      let result = await scan('autofill', payload);
      assert.equal(result.error, undefined);
      for (const key of ['givenName', 'familyName', 'email', 'phone', 'linkedInUrl']) assertField(result, key);
      if (name === 'rippling') {
        for (const key of ['phoneCountry', 'pronouns', 'currentCompany', 'portfolioUrl']) assertField(result, key);
        assert.equal(await page.locator('[role="radio"][aria-checked="true"]').innerText(), 'No - I do not consent to receiving text messages');
        assert.equal(result.fields.filter(f => /sponsorship|hybrid/.test(f.label)).every(f => f.state === 'filled'), true);
        // Retry is allowed for a lazily loaded external location catalog.
        if (result.fields.find(f => f.profileKey === 'city')?.state !== 'filled') result = await scan('autofill', payload);
        assertField(result, 'city');
        assert.match(await page.locator('[data-testid="phone_number-code"] input').inputValue(), /CA/);
      } else {
        assertField(result, 'middleName');
        assertField(result, 'skills');
        const source = result.fields.find(f => f.label.startsWith('How did you hear about us?'));
        assert.equal(source?.state, 'filled');
        for (const id of ['97618', '97619']) assert.match(await page.locator(`[id="${id}"]`).locator('..').innerText(), id === '97618' ? /Yes/ : /No/);
        assert.equal(result.fields.filter(f => /legally entitled|require sponsorship/.test(f.label)).every(f => f.state === 'filled'), true);
        assert.equal(await page.locator('input[type="checkbox"]:checked').count(), 0, 'unknown availability and retention consent stay untouched');
        assert.equal(result.fields.some(f => /fill:currentColor/.test(f.label)), false);
      }
      assert.equal(result.resumeAvailable, true, 'approved resume target is recognized');
      assert.ok((await scan('prepare-resume')).resumeToken);
      assert.equal(await page.locator('input[type="file"]').evaluateAll(nodes => nodes.reduce((n, f) => n + f.files.length, 0)), 0);
      assert.equal(await page.evaluate(() => window.submissions), 0);
      const again = await scan('autofill', payload);
      assert.equal(again.fields.filter(f => f.state === 'needed').length, result.fields.filter(f => f.state === 'needed').length);
      await page.screenshot({ path: `${output}/${name}-filled.png`, fullPage: true });
      const report = { name, url, fields: again.fields.map(({ label, kind, state, reason }) => ({ label, kind, state, reason })), blocked, lookups, uploaded: false, submitted: false };
      reports.push(report);
      console.log(`PASS live ${name}: ${again.fields.filter(f => f.state === 'filled').length} retained fills; ${again.fields.filter(f => f.state === 'needed').length} missing synthetic facts/manual; no upload or submission`);
    }
    await writeFile(`${output}/live-report.json`, JSON.stringify(reports, null, 2));
  } else {
    let html, fixture = 0;
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
    const load = async (extra = '', script = '') => {
      html = `<style>input{display:block;margin:8px}label{display:block}input[type=radio]{display:none}[role=option]{padding:8px}[hidden]{display:none!important}</style>
        <form><h1>Job application</h1><label>First name<input id="first"></label><label>Last name<input id="last"></label><label>Email<input id="email" type="email"></label>${extra}<button>Submit application</button></form><script>${script}</script>`;
      await page.goto(`https://unlisted-employer.example/external/?fixture=${++fixture}#/recruitment-apply/candidate/vacancy/704`);
      await inject();
    };
    const dropdown = `<section><p>Are you legally entitled to work in Canada?</p><div class="owner"><div tabindex="0" class="trigger"><div><span class="display">Select</span><input id="eligibility" readonly tabindex="-1"></div></div></div></section>`;
    const dropdownScript = `const trigger=document.querySelector('.trigger');trigger.onclick=()=>{
      if(trigger.parentElement.querySelector('[role=listbox]')){trigger.parentElement.querySelector('[role=listbox]').remove();return}
      const list=document.createElement('div');list.setAttribute('role','listbox');
      for(const text of ['Yes','No']){const option=document.createElement('div');option.setAttribute('role','option');option.textContent=text;
        option.onmousedown=()=>{trigger.querySelector('.display').textContent=text;queueMicrotask(()=>list.remove())};list.append(option)}trigger.parentElement.append(list)};`;
    await load(dropdown, dropdownScript);
    let initial = await scan(), result = await scan('autofill', { contact, commonAnswers: plan(initial) });
    assert.equal(result.fields.find(f => f.kind === 'combobox')?.state, 'filled');
    assert.equal(await page.locator('.display').innerText(), 'Yes');
    assert.equal(await page.locator('#eligibility').inputValue(), '', 'selection is read from rendered display, not written to readonly input');
    await scan('autofill', { commonAnswers: [{ label: initial.fields.find(f => f.kind === 'combobox').label, answer: 'No', answerKey: 'authorizedCA' }] });
    assert.equal(await page.locator('.display').innerText(), 'Yes', 'do not overwrite a selection');
    console.log('PASS hash-routed application and pointer-activated readonly dropdown with retained selection');

    const radio = `<section><p>Check Yes or No to indicate your agreement to receive text message updates regarding your job application.</p><div role="radiogroup">${['Yes - I consent to receiving text messages', 'No - I do not consent to receiving text messages'].map(text => `<div tabindex="0" role="radio" aria-checked="false"><input name="sms" type="radio"><div><p>${text}</p></div></div>`).join('')}</div></section>`;
    const radioScript = `for(const radio of document.querySelectorAll('[role=radio]'))radio.onclick=()=>{for(const node of document.querySelectorAll('[role=radio]')){node.setAttribute('aria-checked',String(node===radio));node.querySelector('input').checked=node===radio}};`;
    await load(radio, radioScript);
    initial = await scan();
    assert.equal(initial.fields.filter(f => f.kind === 'radio').length, 1, `one question, not two options plus mirrors: ${JSON.stringify(initial)}`);
    await scan('autofill', { contact });
    assert.equal(await page.locator('[aria-checked=true]').count(), 0, 'never infer consent');
    result = await scan('autofill', { commonAnswers: plan(initial) });
    assert.equal(result.fields.find(f => f.kind === 'radio').state, 'filled');
    assert.match(await page.locator('[aria-checked=true]').innerText(), /^No/);
    await page.locator('[role=radio]').first().click();
    await scan('autofill', { commonAnswers: plan(initial) });
    assert.match(await page.locator('[aria-checked=true]').innerText(), /^Yes/, 'preserve subsequent user selection');
    console.log('PASS accessible non-button radio group, hidden native mirrors, explicit consent and user edits');

    const phone = `<div class="phone"><div><input id="country" role="combobox" aria-label="Search" aria-haspopup="listbox" aria-controls="countries" aria-expanded="false" value="+1 US"></div><label>Phone number<input id="number" inputmode="tel"></label></div>`;
    // Opening controlled menus can restore the old value in a later batch.
    // Options are search-filtered, so typing before that batch loses the match.
    const phoneScript = `const country=document.querySelector('#country');country.onclick=()=>{if(document.querySelector('#countries'))return;country.setAttribute('aria-expanded','true');
      const list=document.createElement('div');list.id='countries';list.setAttribute('role','listbox');document.body.append(list);
      const render=()=>{list.replaceChildren();for(const text of ['+1 CA - Canada','+1 US - United States']){
        if(!text.toLowerCase().includes(country.value.toLowerCase()))continue;
        const option=document.createElement('div');option.setAttribute('role','option');option.textContent=text;
        option.onclick=()=>{const replacement=country.cloneNode();replacement.id='new-country';replacement.value=text.includes('Canada')?'+1 CA':'+1 US';replacement.setAttribute('aria-expanded','false');country.replaceWith(replacement);list.remove()};list.append(option)}};
      country.oninput=()=>queueMicrotask(render);queueMicrotask(()=>{country.value='+1 US';render()})};`;
    await load(phone, phoneScript);
    result = await scan('autofill', { contact });
    assertField(result, 'phoneCountry');
    assertField(result, 'phone');
    assert.equal(await page.locator('#new-country').inputValue(), '+1 CA');
    result = await scan('autofill', { contact });
    assertField(result, 'phoneCountry');
    await load(phone, phoneScript);
    await scan();
    await page.locator('#number').fill('2025550199');
    result = await scan('autofill', { contact });
    assert.equal(await page.locator('#country').inputValue(), '+1 US', 'retain country once user enters their phone');
    assertField(result, 'phoneCountry', 'kept');
    console.log('PASS adjacent phone country, component replacement, completion tracking and edited number protection');

    await load('<label>Pronouns<select id="pronouns"><option value="">Select</option><option>They/them/theirs</option><option>She/they</option></select></label>');
    result = await scan('autofill', { contact });
    assertField(result, 'pronouns');
    assert.equal(await page.locator('#pronouns').inputValue(), 'They/them/theirs');
    await load('<label>Pronouns<select id="pronouns"><option value="">Select</option><option>She/they</option></select></label>');
    result = await scan('autofill', { contact });
    assertField(result, 'pronouns', 'needed');
    assert.equal(await page.locator('#pronouns').inputValue(), '', 'never substitute a different pronoun set');
    console.log('PASS equivalent pronoun forms and incompatible choices remain empty');

    await load('<label>Keywords<input id="skills" placeholder="Enter comma separated words about your suitability for this position (eg: skills)"></label><label>Keywords<input id="unrelated-keywords"></label>');
    result = await scan('autofill', { contact, skills });
    assertField(result, 'skills');
    assert.equal(await page.locator('#skills').inputValue(), 'TypeScript, Python, SQL');
    assert.equal(await page.locator('#unrelated-keywords').inputValue(), '', 'keywords alone do not identify applicant skills');
    console.log('PASS keywords use explicit skills hints, not the ambiguous label alone');

    await load(`${dropdown}<div role="listbox"><div role="option">Yes</div></div><label>Reference number<input readonly value="unchangeable"></label>`, `document.querySelector('.trigger').onclick=()=>{};`);
    initial = await scan();
    result = await scan('autofill', { contact, commonAnswers: plan(initial) });
    assert.equal(result.fields.find(f => f.kind === 'combobox').state, 'needed');
    assert.equal(await page.locator('.display').innerText(), 'Select', 'never use a foreign already-open menu');
    assert.equal(await page.locator('input[value=unchangeable]').inputValue(), 'unchangeable');
    await load(`<div><label for="resume">Upload Resume</label><div><input id="resume" type="file" accept="pdf,docx" style="width:0;height:0;opacity:0"><div>Browse</div><div>No file chosen</div></div></div><label><input type="checkbox"><svg><style>{fill:currentColor;}</style></svg>Keep my data for future consent</label>`);
    result = await scan();
    assert.equal(result.resumeAvailable, true);
    assert.equal(result.fields.some(f => /fill:/.test(f.label)), false);
    assert.equal(await page.locator('input[type=checkbox]').isChecked(), false);
    assert.equal(await page.evaluate(() => window.submissions), 0);
    console.log('PASS foreign-menu rejection, readonly protection, zero-sized resume picker, clean icon labels, no submission');
  }
} finally { await browser.close(); }
