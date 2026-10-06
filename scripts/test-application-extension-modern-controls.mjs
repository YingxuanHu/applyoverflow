import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";

const source = `(${createInspector})(${applicationContext},(${createHistoryInspector})(),(${createAutofillInspector})())`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  let html;
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
  const load = async url => { await page.goto(url); await page.evaluate(code => { window.inspect = (0, eval)(code); }, source); };
  const scan = (mode = "inspect", payload = {}) => page.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
  html = `<h1>My Information</h1><div data-automation-id="applyFlowPage">
    <label for="source">How Did You Hear About Us?</label><input id="source" data-uxi-widget-type="selectinput" data-uxi-multiselect-id="source-prompt">
    <label for="phone-type">Phone Device Type</label><button id="phone-type" type="button" aria-haspopup="listbox">Select One</button>
    <label for="phone-country">Country Phone Code</label><input id="phone-country" data-uxi-widget-type="selectinput" data-uxi-multiselect-id="country-prompt">
    <ul role="listbox" data-automation-id="selectedItemList" data-uxi-multiselect-id="country-prompt"><li data-automation-id="promptOption">Canada (+1)</li></ul>
    <button id="continue" type="button">Save and Continue</button></div>
    <script>window.steps=0;document.querySelector('#continue').onclick=()=>window.steps++;
    const source=document.querySelector('#source');let popup;
    function menu(children=false){popup?.remove();popup=document.createElement('div');popup.setAttribute('role','listbox');popup.style='height:100px;overflow:auto';
      const spacer=document.createElement('div');spacer.style.height=children?'900px':'100px';popup.append(spacer);document.body.append(popup);
      const render=text=>{spacer.replaceChildren();const option=document.createElement('div');option.setAttribute('role','option');const target=document.createElement('div');
        target.dataset.uxiWidgetType='multiselectlistitem';target.dataset.uxiMultiselectId='source-prompt';target.textContent=text;option.append(target);spacer.append(option);
        target.onclick=()=>{if(text==='Job Board')setTimeout(()=>menu(true),80);else{const chips=document.createElement('ul');chips.setAttribute('role','listbox');chips.dataset.automationId='selectedItemList';chips.dataset.uxiMultiselectId='source-prompt';
          const label=document.createElement('li');label.dataset.automationId='promptOption';label.textContent=text;chips.append(label);source.after(chips);source.value='';popup.remove();}};};
      render(children?'Example Board':'Job Board');if(children)popup.onscroll=()=>render('Other');}
    source.onclick=()=>{if(!popup?.isConnected)menu();};
    const type=document.querySelector('#phone-type');type.onclick=()=>{const list=document.createElement('div');list.setAttribute('role','listbox');
      const option=document.createElement('div');option.setAttribute('role','option');option.textContent='Mobile';option.onclick=()=>{type.textContent='Mobile';list.remove();};list.append(option);document.body.append(list);};</script>`;
  await load('https://fixture.wd1.myworkdayjobs.com/en-US/External/job/Toronto-ON-CAN/Engineer_R123/apply/applyManually');
  assert.equal((await scan()).employmentCountry, 'CA');
  const plan = { contact: { phoneType: 'Mobile', phoneCountry: 'US' }, commonAnswers: [
    { label: 'How Did You Hear About Us?', answer: 'ApplyOverflow', answerKey: 'jobSource', alternatives: ['Other', 'Job Board'] },
  ] };
  const result = await scan('autofill', plan);
  assert.equal(result.fields.find(f => f.label.startsWith('How Did')).state, 'filled', JSON.stringify(result.fields));
  assert.equal(await page.locator('#phone-type').textContent(), 'Mobile');
  assert.equal(await page.locator('[data-uxi-multiselect-id="country-prompt"] [data-automation-id="promptOption"]').textContent(), 'Canada (+1)', 'preselected country is preserved despite an empty query');
  assert.equal(await page.evaluate(() => window.steps), 0);
  console.log('PASS modern Workday nested/virtualized prompts, owned menus, chip readback and no continuation');

  html = `<h1>My Experience</h1><div data-automation-id="applyFlowPage"><div role="group" aria-labelledby="work-title"><h4 id="work-title">Work Experience</h4><div id="rows"></div><button id="add">Add Another</button></div><button id="continue">Save and Continue</button></div>
    <script>let count=0;window.steps=0;document.querySelector('#continue').onclick=()=>window.steps++;
    document.querySelector('#add').onclick=()=>{count++;const row=document.createElement('div');row.setAttribute('role','group');row.setAttribute('aria-labelledby','row-'+count);
      row.innerHTML='<h4 id="row-'+count+'">Work Experience '+count+'</h4><label>Job Title<input></label><label>Company<input></label><fieldset><legend>From*</legend><div role="group"><input aria-label="Month" role="spinbutton"><input aria-label="Year" role="spinbutton"></div></fieldset><fieldset><legend>To*</legend><div role="group"><input aria-label="Month" role="spinbutton"><input aria-label="Year" role="spinbutton"></div></fieldset>';
      for(const group of row.querySelectorAll('fieldset [role=group]'))for(const input of group.querySelectorAll('input')){
        input.onclick=()=>input.dataset.selected='true';input.oninput=()=>setTimeout(()=>{
          const size=input.getAttribute('aria-label')==='Month'?2:4;input.dataset.pending=input.value.length===size?String(Number(input.value)):'';},0);
        input.onblur=()=>{if(input.dataset.selected==='true')input.dataset.accepted=input.dataset.pending;
          const parts=[...group.querySelectorAll('input')].map(e=>e.dataset.accepted);group.dataset.committed=parts.every(Boolean)?parts.join('/'):' ';};}
      document.querySelector('#rows').append(row);};document.querySelector('#add').click();</script>`;
  await load('https://fixture.wd1.myworkdayjobs.com/en-US/External/job/Toronto-ON-CAN/Engineer_R123/apply/applyManually');
  const history = [
    { kind: 'experience', entry: { title: 'Engineer', company: 'First Company', dates: { start: '2025-01', end: '2025-08', current: false } } },
    { kind: 'experience', entry: { title: 'Analyst', company: 'Second Company', dates: { start: '2023-09', end: '2023-12', current: false } } },
  ];
  const filled = await scan('autofill', { history });
  assert.equal(filled.historyFilled, 12);
  assert.deepEqual(await page.locator('#rows input[aria-label="Month"]').evaluateAll(nodes => nodes.map(n => n.value)), ['01', '08', '09', '12']);
  assert.deepEqual(await page.locator('#rows fieldset [role="group"]').evaluateAll(nodes => nodes.map(n => n.dataset.committed)), ['1/2025', '8/2025', '9/2023', '12/2023'], 'segmented dates must commit, not merely display text');
  await scan('autofill', { history });
  assert.equal(await page.locator('#rows > [role="group"]').count(), 2, 'reruns do not duplicate rows');
  assert.equal(await page.evaluate(() => window.steps), 0);
  console.log('PASS accessible repeated history sections, safe Add, split dates and duplicate protection');

  html = `<h1>Software Engineer</h1><form id="job-application-form"><label>First name<span class="sr-only">Required</span><input autocomplete="given-name"></label>
    <label>Last name<span class="sr-only">Required</span><input autocomplete="family-name"></label><label>Email<span class="sr-only">Required</span><input type="email" pattern="[a-z|]+" autocomplete="email"></label>
    <label>Location (City, Province or State)<input></label><label>Please provide a link to your LinkedIn Profile.<input></label><label>Phone<input autocomplete="tel"></label>
    <label>Portfolio, GitHub, or Personal Site<input id="portfolio"></label>
    <fieldset><legend>Gender</legend><label><input type="radio" name="gender" value="male">Male</label><label><input id="decline" type="radio" name="gender" value="decline">Decline to self-identify</label></fieldset>
    <label>By selecting YES, I consent to receive recruiting SMS messages at the phone number provided on my job application.<select id="sms"><option value="">Select</option><option>Yes</option><option>No</option></select></label>
    <fieldset><legend>Reference details</legend><label>Email<input type="email"></label></fieldset><button>Submit application</button></form><script>window.submissions=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submissions++};</script>`;
  await load('https://careers.fixture.example/job/application');
  const warnings = [];
  page.on('console', message => { if (/invalid regular expression|Invalid character in character class/.test(message.text())) warnings.push(message.text()); });
  const generic = await scan('autofill', { contact: { givenName: 'Jordan', familyName: 'Example', email: 'jordan@example.test', cityRegion: 'Toronto, ON', linkedInUrl: 'https://www.linkedin.com/in/example', portfolioGithubUrl: 'https://github.com/example', phone: '4165550100' },
    commonAnswers: [{ label: 'By selecting YES, I consent to receive recruiting SMS messages at the phone number provided on my job application.', answer: 'No', answerKey: 'smsUpdates' },
      { label: 'Gender', answer: 'Prefer not to answer', answerKey: 'gender', alternatives: ['Decline to self-identify'] }] });
  assert.equal(generic.fields.filter(f => f.state === 'filled').length, 9);
  assert.equal(await page.locator('#decline').isChecked(), true);
  assert.equal(await page.locator('#portfolio').inputValue(), 'https://github.com/example');
  assert.equal(await page.locator('#sms').inputValue(), 'No');
  assert.equal(await page.locator('fieldset input[type="email"]').inputValue(), '');
  assert.equal(await page.locator('input[type="email"]').first().getAttribute('pattern'), '[a-z|]+', 'employer validation is not modified');
  assert.equal(warnings.length, 0, 'invalid employer patterns do not throw or log from autofill');
  assert.equal(await page.evaluate(() => window.submissions), 0);
  console.log('PASS unknown-platform application detection, accessibility labels, combined location, invalid patterns and foreign-contact exclusion');

  const question = 'Will you require sponsorship for employment now or in the future?';
  html = `<h1>Application</h1><form id="job-application-form"><label>First name<input></label><label>Email<input type="email"></label>
    <label>Phone<input id="phone" type="tel" pattern="\\+1[0-9]{10}"></label><div><p>${question}</p>${'<div>'.repeat(6)}
    <div id="choice" role="combobox" aria-label="Select" aria-haspopup="listbox" tabindex="0">Select</div>${'</div>'.repeat(6)}</div>
    <button>Submit application</button></form><script>window.submissions=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submissions++};
    const choice=document.querySelector('#choice');choice.onclick=()=>{const list=document.createElement('ul');list.setAttribute('role','listbox');
      for(const text of ['Yes','No']){const option=document.createElement('li');option.setAttribute('role','option');option.textContent=text;
        option.onclick=()=>{choice.textContent=text;list.remove()};list.append(option)}document.body.append(list)};</script>`;
  await load('https://careers.fixture.example/application');
  const nested = await scan('autofill', { contact: { givenName: 'Jordan', email: 'jordan@example.test', phone: '4165550100', phoneCountry: 'CA' },
    commonAnswers: [{ label: question, answer: 'No', answerKey: 'sponsorshipCA' }] });
  assert.equal(nested.fields.find(f => f.label === question)?.state, 'filled', JSON.stringify(nested.fields));
  assert.equal(await page.locator('#choice').textContent(), 'No');
  assert.equal(await page.locator('#phone').inputValue(), '+14165550100');
  assert.equal(await page.evaluate(() => window.submissions), 0);
  console.log('PASS nested visible question labels, owned unnamed dropdowns and explicit international phone formatting');

  for (const acceptsCountry of [true, false]) {
    html = `<h1>Application</h1><form id="job-application-form"><label>First name<input></label><label>Email<input type="email"></label>
      <label>Phone<input id="phone" type="tel" aria-label="Phone number with country code"></label></form><script>
      const phone=document.querySelector('#phone');phone.oninput=()=>{if(phone.value)phone.value=${acceptsCountry}&&phone.value.startsWith('+1')?'+1 202 555 0148':'+44 20 2555 0148'};</script>`;
    await load('https://careers.fixture.example/application');
    const result = await scan('autofill', { contact: { phone: '2025550148', phoneCountry: 'US' } });
    assert.equal(await page.locator('#phone').inputValue(), acceptsCountry ? '+1 202 555 0148' : '');
    assert.equal(result.fields.find(f => f.label === 'Phone').state, acceptsCountry ? 'filled' : 'needed');
  }
  console.log('PASS international widget country initialization and rollback of rejected country-code formatting');

  html = `<h1>My Experience</h1><div data-automation-id="applyFlowPage"><div role="group" aria-labelledby="resume-title"><h4 id="resume-title">Resume/CV</h4>
    <input type="file" multiple style="position:absolute;opacity:0;width:1px;height:1px"></div>
    <div role="group" aria-labelledby="cover-title"><h4 id="cover-title">Cover Letter</h4><input type="file" multiple></div>
    <button type="button">Save and Continue</button></div>`;
  await load('https://fixture.wd1.myworkdayjobs.com/en-US/External/job/Toronto-ON-CAN/Engineer_R123/apply/applyManually');
  assert.equal((await scan()).resumeAvailable, true);
  const prepared = await scan('prepare-resume');
  const bytes = Buffer.from('%PDF-1.4\nsynthetic fixture\n%%EOF');
  assert.equal((await scan('attach-resume', { name: 'Fixture.pdf', mimeType: 'application/pdf', size: bytes.length,
    base64: bytes.toString('base64'), resumeToken: prepared.resumeToken })).resumeSelected, true);
  assert.deepEqual(await page.locator('input[type="file"]').evaluateAll(ns => ns.map(n => n.files.length)), [1, 0]);
  await page.locator('[aria-labelledby="resume-title"]').evaluate(group => {
    group.querySelector('input').replaceWith(group.querySelector('input').cloneNode());
    const existing = document.createElement('span');existing.dataset.automationId='fileName';existing.textContent='Already uploaded.pdf';group.append(existing);
  });
  assert.equal((await scan()).resumeAvailable, false, 'existing attachments survive input replacement');
  console.log('PASS scoped multi-file resume widgets, single-file attachment and existing-upload preservation');
} finally { await browser.close(); }
