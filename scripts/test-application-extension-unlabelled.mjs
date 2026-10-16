import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createInspector } from '../extensions/chrome/adapter.mjs';
import { createHistoryInspector } from '../extensions/chrome/history.mjs';
import { createAutofillInspector } from '../extensions/chrome/autofill.mjs';
import { applicationContext } from '../extensions/chrome/sites.mjs';

const source = `(${createInspector})(${applicationContext},(${createHistoryInspector})(),(${createAutofillInspector})())`;
const contact = { givenName: 'Jordan', familyName: 'Example', email: 'jordan@example.test', phone: '4165550123', phoneCountry: 'CA' };
const history = [
  { kind: 'experience', entry: { company: 'Example Systems', title: 'Software Engineer', dates: { start: '2023-09', current: true } } },
  { kind: 'experience', entry: { company: 'Sample Labs', title: 'Developer', dates: { start: '2021-01', end: '2023-08' } } },
];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ serviceWorkers: 'block', viewport: { width: 1280, height: 1000 } });
  await page.routeWebSocket('**/*', socket => socket.close());
  const inject = () => page.evaluate(code => {
    window.inspect = (0, eval)(code);
    window.submissions = 0;
    document.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); window.submissions++; }, true);
  }, source);
  const scan = (mode = 'inspect', payload = {}) => page.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
  const assertContact = async result => {
    assert.equal(result.error, undefined);
    for (const [placeholder, value] of [['First name', contact.givenName], ['Last name', contact.familyName], ['Email address', contact.email]])
      assert.equal((await page.getByPlaceholder(placeholder, { exact: true }).inputValue()).replace(/[^\w@.]/g, ''), value.replace(/[^\w@.]/g, ''), placeholder);
    assert.equal((await page.getByPlaceholder('Enter phone number').inputValue()).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''), contact.phone);
    assert.match(await page.locator('.iti__selected-country').innerText(), /Canada/);
    assert.equal(result.fields.find(field => field.profileKey === 'phoneCountry')?.state, 'filled', JSON.stringify(result.fields));
  };
  if (process.argv.includes('--live')) {
    await page.goto('https://recruiterflow.com/Plus10/jobs/114', { waitUntil: 'networkidle', timeout: 45_000 });
    await page.getByPlaceholder('First name', { exact: true }).waitFor();
    // Exercise the real React controls, but no synthetic applicant values,
    // uploads, analytics or application writes can leave this browser.
    await page.route('**/*', route => route.abort());
    await inject();
    assert.equal((await scan()).error, undefined);
    const result = await scan('autofill', { contact, history });
    console.log(JSON.stringify({ historyFilled: result.historyFilled, historyWarnings: result.historyWarnings, fields: result.fields.map(({ label, state }) => ({ label, state })) }));
    await assertContact(result);
    assert.deepEqual(await page.getByPlaceholder('Company Name', { exact: true }).evaluateAll(fields => fields.map(field => field.value)), history.map(row => row.entry.company));
    assert.deepEqual(await page.getByPlaceholder('Title', { exact: true }).evaluateAll(fields => fields.map(field => field.value)), history.map(row => row.entry.title));
    assert.deepEqual(await page.getByPlaceholder('Start Date', { exact: true }).evaluateAll(fields => fields.map(field => field.value)), ['Sep 2023', 'Jan 2021']);
    assert.deepEqual(await page.getByPlaceholder('End Date', { exact: true }).evaluateAll(fields => fields.map(field => field.value)), ['Aug 2023'], 'current roles remove their end-date control');
    assert.equal(await page.getByPlaceholder('Company Name').first().evaluate(field => field.parentElement.querySelector('[placeholder="End Date"]')), null);
    assert.equal(await page.locator('input[type="checkbox"]').isChecked(), false, 'the past role stays unchecked');
    await scan('autofill', { contact, history });
    assert.equal(await page.getByPlaceholder('Company Name', { exact: true }).count(), 2, 'repeat runs cannot add duplicates');
    assert.ok((await scan('prepare-resume')).resumeToken, 'the correct dropzone is available for an approved resume');
    assert.equal(await page.locator('input[type="file"]').evaluate(field => field.files.length), 0);
    assert.equal(await page.evaluate(() => window.submissions), 0);
    await page.getByPlaceholder('First name', { exact: true }).scrollIntoViewIfNeeded();
    await mkdir('output/playwright/recruiterflow', { recursive: true });
    await page.screenshot({ path: 'output/playwright/recruiterflow/live-filled.png', fullPage: true });
    await page.screenshot({ path: 'output/playwright/recruiterflow/live-contact.png' });
    await page.getByPlaceholder('Company Name').last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'output/playwright/recruiterflow/live-history.png' });
    console.log('PASS live Recruiterflow React form: contact, phone country, two complete experience rows, current role, month pickers, repeat-run deduplication; resume target detected, no upload/submission, all outbound traffic blocked before filling');
  } else {
    let html;
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
    const load = async body => {
      html = `<style>input{display:block}p{margin:4px} [hidden]{display:none!important}</style>${body}`;
      await page.goto('https://unknown-employer.example/opportunities/114');
      await inject();
    };
    const names = `<div><p>Full Name *</p><div><input placeholder="First name"><input placeholder="Last name"></div></div>
      <div><p>Email *</p><input type="email" placeholder="Email address"></div>`;
    const row = `<div><p>Experience *</p><div><input placeholder="Company Name"><input placeholder="Title">
      <div><input type="checkbox" readonly><label>I am currently working in this role</label></div>
      <input type="date" placeholder="Start Date"><input type="date" placeholder="End Date"></div></div>`;
    const phone = `<div class="iti"><button type="button" class="iti__selected-country" aria-label="Selected country" aria-haspopup="listbox" aria-controls="countries" aria-expanded="false"><span class="iti__a11y-text">United States +1</span><span>+1</span></button>
      <div id="countries" role="listbox" hidden><div role="option">United States +1</div><div role="option">Canada +1</div></div><input type="tel" placeholder="Enter phone number"></div>`;
    const upload = `<div><p>Upload Resume *</p><div><div>Drag &amp; drop resume/CV or Upload</div><input type="file" accept=".pdf" style="display:none"></div></div>`;
    const body = `<form>${names}${phone}${upload}<div id="history">${row}<div><button type="button" id="add">+Add Experience</button></div></div><button>Submit application</button></form>
      <script>
      const button=document.querySelector('.iti__selected-country'), list=document.querySelector('#countries');
      button.onclick=()=>{list.hidden=!list.hidden;button.setAttribute('aria-expanded',String(!list.hidden))};
      for(const option of list.children)option.onclick=()=>{button.querySelector('span').textContent=option.textContent;list.hidden=true;button.setAttribute('aria-expanded','false')};
      document.querySelector('#add').onclick=()=>document.querySelector('#add').parentElement.insertAdjacentHTML('beforebegin',${JSON.stringify(row.replace('<p>Experience *</p>', ''))});
      </script>`;
    await load(body);
    let result = await scan();
    assert.equal(result.error, undefined);
    assert.equal(result.historyAvailable, true);
    assert.equal(result.resumeAvailable, true);
    result = await scan('autofill', { contact, history });
    await assertContact(result);
    assert.equal(result.historyFilled, 8, JSON.stringify(result));
    assert.deepEqual(await page.getByPlaceholder('Start Date').evaluateAll(nodes => nodes.map(n => n.value)), ['2023-09-01', '2021-01-01']);
    assert.deepEqual(await page.getByPlaceholder('End Date').evaluateAll(nodes => nodes.map(n => n.value)), ['', '2023-08-31']);
    await scan('autofill', { contact, history });
    assert.equal(await page.getByPlaceholder('Company Name').count(), 2);
    const prepared = await scan('prepare-resume');
    const bytes = Buffer.from('%PDF-1.4\nsynthetic fixture\n%%EOF');
    assert.equal((await scan('attach-resume', { resumeToken: prepared.resumeToken, name: 'sample.pdf', mimeType: 'application/pdf', size: bytes.length, base64: bytes.toString('base64') })).resumeSelected, true);
    assert.equal(await page.evaluate(() => window.submissions), 0);
    console.log('PASS unlisted-domain grouped placeholders, dropzone, phone control and sibling Add history; no submit or duplicates');

    const monthRow = row.replace(/<input type="date" placeholder="(Start Date|End Date)">/g,
      '<div><div class="react-datepicker-wrapper"><input placeholder="$1"></div></div>');
    const calendarScript = `<script>
      const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
      for(const input of document.querySelectorAll('.react-datepicker-wrapper input')) {
        let year=2026, selected='';const owner=input.parentElement.parentElement;
        const render=()=>{
          owner.querySelector('.react-datepicker')?.remove();
          const calendar=document.createElement('div');calendar.className='react-datepicker';
          calendar.innerHTML='<div class="react-datepicker-year-header">'+year+'</div><button type="button" aria-label="Previous Year">Previous</button><button type="button" aria-label="Next Year">Next</button><div class="react-datepicker__monthPicker" role="listbox"></div>';
          calendar.querySelector('[aria-label="Previous Year"]').onclick=()=>{year--;render()};
          calendar.querySelector('[aria-label="Next Year"]').onclick=()=>{year++;render()};
          months.forEach((name,index)=>{
            const option=document.createElement('div');option.setAttribute('role','option');option.setAttribute('aria-label','Choose '+name+' '+year);
            option.setAttribute('aria-selected',String(selected===year+'-'+index));option.textContent=name.slice(0,3);
            if(input.dataset.disabledMonth===year+'-'+index)option.setAttribute('aria-disabled','true');
            option.onclick=()=>{selected=year+'-'+index;input.value=name.slice(0,3)+' '+year;calendar.remove()};
            calendar.querySelector('[role="listbox"]').append(option);
          });owner.append(calendar);
        };
        input.onclick=render;input.onkeydown=e=>{if(e.key==='Escape')owner.querySelector('.react-datepicker')?.remove()};
      }
      </script>`;
    await load(`<form>${names}<div>${monthRow}</div><button>Submit application</button></form>${calendarScript}`);
    result = await scan('autofill', { contact, history: history.slice(1) });
    assert.equal(result.historyFilled, 4);
    assert.equal(await page.getByPlaceholder('Start Date').inputValue(), 'Jan 2021');
    assert.equal(await page.getByPlaceholder('End Date').inputValue(), 'Aug 2023');
    assert.equal(await page.locator('.react-datepicker').count(), 0, 'close only the owned calendar');
    await scan('autofill', { contact, history: history.slice(1) });
    assert.equal(await page.getByPlaceholder('Start Date').inputValue(), 'Jan 2021');
    await load(`<form>${names}<div>${monthRow}</div><button>Submit application</button></form>${calendarScript}`);
    await page.getByPlaceholder('Start Date').evaluate(field => field.dataset.disabledMonth = '2021-0');
    result = await scan('autofill', { contact, history: history.slice(1) });
    assert.equal(await page.getByPlaceholder('Start Date').inputValue(), '', 'never select a disabled month');
    assert.ok(result.historyWarnings.some(warning => warning.includes('date selection could not be verified')));
    assert.equal(await page.evaluate(() => window.submissions), 0);
    console.log('PASS unformatted month picker: bounded year navigation, selected-state readback, disabled month refusal, no duplicate or submit');

    await load(body);
    await scan();
    await page.locator('.iti__selected-country').click();
    await page.getByRole('option', { name: 'United States +1', exact: true }).click();
    await scan('autofill', { contact });
    assert.match(await page.locator('.iti__selected-country').innerText(), /United States/, 'preserve an explicit phone-country choice');
    await load(`<form>${names}<div><p>Reference</p><input placeholder="First name"><input placeholder="Email"></div><label>Emergency contact<input placeholder="First name"></label><button>Submit application</button></form>`);
    await scan('autofill', { contact });
    assert.equal(await page.getByPlaceholder('Email', { exact: true }).inputValue(), '');
    assert.equal(await page.getByLabel('Emergency contact').inputValue(), '');
    await load(`<h1>Contact us</h1><form>${names}<button>Send</button></form>`);
    assert.ok((await scan()).error, 'placeholder names alone cannot turn an unrelated contact form into an application');
    await load(`<form><input placeholder="Type here"><input placeholder="jane@example.com"><button>Submit application</button></form>`);
    assert.ok((await scan()).error, 'examples and generic hints are not field identities');
    console.log('PASS unrelated forms, example placeholders, reference ownership and user choices remain protected');
  }
} finally {
  await browser.close();
}
