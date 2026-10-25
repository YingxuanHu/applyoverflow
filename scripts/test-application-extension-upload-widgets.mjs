import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createInspector } from '../extensions/chrome/adapter.mjs';
import { createAutofillInspector } from '../extensions/chrome/autofill.mjs';
import { applicationContext } from '../extensions/chrome/sites.mjs';

const source = `(${createInspector})(${applicationContext},undefined,(${createAutofillInspector})())`;
const bytes = Buffer.from('%PDF-1.4\nsynthetic upload regression\n%%EOF');
const file = { name: 'Fixture Resume.pdf', mimeType: 'application/pdf', size: bytes.length, base64: bytes.toString('base64') };
// Retains the observed BambooHR structure, not its CSS classes or vendor IDs.
const bamboo = `<div><p>Resume*</p><div><div><div><div>
  <button type="button"><span>Choose File*</span></button><div><p>No file selected</p></div>
  </div></div><input accept=".pdf,.doc,.docx,.txt" aria-invalid="false" aria-label="file-input" required tabindex="-1" type="file" style="opacity:0;width:1px;height:1px"></div>
  <input name="resumeFileId" type="hidden"></div></div>`;
const widgets = [
  ['idless-native', '<label>Resume<input type="file" accept=".pdf"></label>'],
  ['separate-heading', bamboo],
  ['aria-group', '<section aria-labelledby="doc-title"><h3 id="doc-title">Resume / CV</h3><button type="button">Browse files</button><input hidden type="file"></section>'],
  ['multi-picker', '<div><span>Resume</span><input type="file" multiple style="opacity:0"><button type="button">Choose File</button></div>'],
  ['dropzone', '<section><p>R\u00e9sum\u00e9</p><div>Drag and drop or browse</div><input type="file" style="display:none"></section>'],
  ['labelled-picker', '<div><input type="file" aria-label="Upload your resume" style="display:none"><button type="button">Choose File</button></div>'],
  ['role-button', '<div><p>Curriculum vitae</p><div role="button" tabindex="0">Browse</div><input type="file" style="display:none"></div>'],
  ['upload-action', '<div><button type="button">Upload resume</button><input type="file" style="display:none"></div>'],
];
const browser = await chromium.launch();
let assertions = 0;
try {
  const page = await browser.newPage();
  let html;
  let requests = 0;
  await page.route('**/*', route => {
    requests++;
    assert.equal(route.request().isNavigationRequest(), true, 'no upload or submission may reach a real employer');
    return route.fulfill({ contentType: 'text/html', body: html });
  });
  const load = async (widget, code = '', url = 'https://unlisted-employer.example/careers/application') => {
    html = `<!doctype html><meta charset="utf-8"><h1>Job application</h1><form id="job-application-form">
      <label>First name<input></label><label>Email<input type="email"></label>${widget}
      <button>Submit application</button></form><script>window.submissions=0;window.uploads=0;
      document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submissions++};
      for(const input of document.querySelectorAll('input[type=file]'))input.addEventListener('change',()=>window.uploads++);
      ${code}</script>`;
    await page.goto(url);
    await page.evaluate(source => { window.inspect = (0, eval)(source); }, source);
  };
  const scan = (mode = 'inspect', payload = {}) => page.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
  const attach = async () => {
    const ready = await scan('prepare-resume');
    assert.ok(ready.resumeToken, JSON.stringify(ready));
    return scan('attach-resume', { ...file, resumeToken: ready.resumeToken });
  };
  for (const [name, widget] of widgets) {
    // Same controls on unrelated origins: no host or generated CSS selector is needed.
    for (const host of ['unlisted-employer.example', 'other-ats.example', 'custom-careers.example']) {
      await load(widget, '', `https://${host}/careers/application`);
      assert.equal((await scan()).resumeAvailable, true, `${name} on ${host}`);
      const result = await attach();
      assert.equal(result.resumeSelected, true, `${name}: ${JSON.stringify(result)}`);
      assert.equal(result.resumeStatus, 'selected');
      assert.equal(await page.locator('input[type=file]').evaluate(input => input.files[0].size), file.size);
      assert.equal(await page.locator('input[type=file]').evaluate(input => input.files[0].text()), bytes.toString());
      assert.equal((await scan()).resumeAvailable, false);
      assert.ok((await scan('prepare-resume')).error, 'rerun must not upload twice');
      assert.equal(await page.evaluate(() => window.uploads), 1);
      assert.equal(await page.evaluate(() => window.submissions), 0);
      assertions++;
    }
  }
  console.log(`PASS ${assertions} labelled native/hidden/dropzone/multi-file resume widgets on unlisted origins`);

  const hintedWidget = (hint, action = 'Upload resume', attachment = '') => `<span><input type="file" accept=".pdf" style="display:none"><span>${hint}</span><button type="button" aria-label="${action}">Upload resume</button>${attachment}</span>`;
  const formatHints = [
    '', '.pdf', '.pdf, .doc, .docx', '.pdf or .docx', '*.pdf; *.docx', '.PDF / .DOCX',
    'Accepted file types: .pdf, .docx', 'Supported formats: *.pdf; *.docx',
    'Allowed extensions: .pdf, .docx', '<span>.pdf</span>, <span>.docx</span>',
  ];
  for (const action of ['Upload resume', 'Select file - Upload resume', 'Select file: Attach CV']) {
    for (const hint of formatHints) {
      await load(hintedWidget(hint, action));
      const ready = await scan();
      assert.equal(ready.resumeAvailable, true, `${action}: ${hint}: ${JSON.stringify(ready)}`);
      assert.equal(ready.resumeStatus, 'available');
      assert.equal((await attach()).resumeSelected, true);
      assert.equal(await page.locator('input[type=file]').evaluate(input => input.files[0].text()), bytes.toString());
      assert.ok((await scan('prepare-resume')).error, 'format hints never permit a second upload');
      assert.equal(await page.evaluate(() => window.uploads), 1);
      assert.equal(await page.evaluate(() => window.submissions), 0);
    }
  }
  console.log(`PASS ${formatHints.length * 3} accepted-format hints and prefixed resume actions with exact bytes and single-upload guards`);

  for (const filename of ['Existing.pdf', 'Candidate, final.pdf', 'PDF.docx', '.pdf.docx', 'Supported formats.pdf']) {
    await load(hintedWidget('.pdf, .docx', 'Select file - Upload resume', `<span>${filename}</span>`));
    assert.equal((await scan()).resumeStatus, 'existing', filename);
    assert.ok((await scan('prepare-resume')).error, filename);
    assert.equal(await page.evaluate(() => window.uploads), 0);
  }
  for (const attachment of [
    '<button type="button" aria-label="Remove file">X</button>',
    '<span data-automation-id="fileName">.pdf</span>',
    '<span class="filename">.docx</span>',
  ]) {
    await load(hintedWidget('.pdf, .docx', 'Select file - Upload resume', attachment));
    assert.equal((await scan()).resumeStatus, 'existing');
    assert.ok((await scan('prepare-resume')).error);
    assert.equal(await page.evaluate(() => window.uploads), 0);
  }
  await load(hintedWidget('.pdf, .docx', 'Select file - Upload resume').repeat(2));
  assert.ok((await scan('prepare-resume')).error, 'prefixed actions cannot choose between two resume pickers');
  await load(hintedWidget('.pdf, .docx', 'Select file - Upload photo'));
  assert.ok((await scan('prepare-resume')).error, 'an explicit unrelated accessible name is not a resume action');
  console.log('PASS real filenames, existing attachment indicators, ambiguous pickers and unrelated prefixed actions remain protected');

  for (const [name, widget] of [
    ['photo', '<label>Photo<input type="file"></label>'],
    ['cover letter', '<div><p>Cover letter</p><button type="button">Choose File</button><input type="file"></div>'],
    ['unlabelled', '<div><button type="button">Choose File</button><input type="file"></div>'],
    ['page-wide prompt', '<p>Resume</p><label>Other document<input type="file"></label>'],
    ['ambiguous', `${widgets[0][1]}${widgets[0][1]}`],
    ['multiple documents', '<div><p>Resume</p><input type="file"><input type="file"></div>'],
    ['disabled', '<label>Resume<input type="file" disabled></label>'],
    ['disabled fieldset', '<fieldset disabled><label>Resume<input type="file"></label></fieldset>'],
    ['duplicate ID', '<input id="duplicate" type="hidden"><label>Resume<input id="duplicate" type="file"></label>'],
    ['invisible section', '<div hidden><label>Resume<input type="file"></label></div>'],
    ['import-only', '<section aria-label="Autofill from resume"><p>Resume</p><input type="file"></section>'],
    ['already uploaded', '<div><p>Resume</p><button type="button">Choose File</button><input type="file"><p>Existing.pdf</p></div>'],
    ['existing removal', '<div><p>Resume</p><input type="file"><button type="button" aria-label="Remove file">X</button></div>'],
  ]) {
    await load(widget);
    assert.equal((await scan()).resumeAvailable, false, name);
    assert.ok((await scan('prepare-resume')).error, name);
    assert.equal(await page.evaluate(() => window.uploads + window.submissions), 0);
  }
  console.log('PASS 13 ambiguous, existing, disabled, hidden and unrelated-document safeguards');

  await load(`${bamboo}<label>Photo<input type="file" id="photo"></label><label>Cover letter<input type="file" id="cover"></label>`);
  assert.equal((await attach()).resumeSelected, true);
  assert.equal(await page.locator('#photo').evaluate(input => input.files.length), 0);
  assert.equal(await page.locator('#cover').evaluate(input => input.files.length), 0);
  console.log('PASS resume selected independently of separate photo and cover-letter inputs');

  const uploadWidget = `<section aria-label="Resume"><p>Resume</p><button type="button">Choose File</button><input type="file"><span id="filename"></span><span id="status" role="status"></span><p role="alert"></p></section>`;
  await load(uploadWidget, `document.querySelector('input[type=file]').onchange=e=>{
    const field=e.target, group=field.closest('section'), name=field.files[0].name;
    group.setAttribute('aria-busy','true');field.value='';
    setTimeout(()=>{field.replaceWith(field.cloneNode());document.querySelector('#filename').textContent=name;group.removeAttribute('aria-busy');},300);};`);
  const complete = await attach();
  assert.equal(complete.resumeStatus, 'attached');
  assert.equal(complete.resumeSelected, true);
  assert.equal((await scan()).resumeAvailable, false, 'input remount must not cause a duplicate upload');
  assert.equal((await scan()).resumeStatus, 'attached');
  assert.equal(await page.evaluate(() => window.uploads), 1);

  await load(uploadWidget, `document.querySelector('input[type=file]').onchange=e=>{
    const widget=e.target.closest('section');widget.replaceWith(widget.cloneNode(true));};`);
  assert.equal((await attach()).resumeStatus, 'unverified');
  assert.equal((await scan()).resumeAvailable, false, 'whole-widget remount also must not repeat an upload');
  assert.ok((await scan('prepare-resume')).error);
  assert.equal(await page.evaluate(() => window.uploads), 1);

  await load(uploadWidget, `document.querySelector('input[type=file]').onchange=e=>{
    document.querySelector('#filename').textContent=e.target.files[0].name;
    const progress=document.createElement('progress');progress.value=100;progress.max=100;e.target.after(progress);};`);
  assert.equal((await attach()).resumeStatus, 'attached', 'completed native progress bars do not stay pending');

  await load(uploadWidget, `document.querySelector('input[type=file]').onchange=e=>{
    e.target.closest('section').setAttribute('aria-busy','true');
    setTimeout(()=>{document.querySelector('[role=alert]').textContent='File is too large';e.target.setAttribute('aria-invalid','true');e.target.closest('section').removeAttribute('aria-busy');},200);};`);
  const rejected = await attach();
  assert.equal(rejected.resumeSelected, false, 'holding FileList bytes does not override employer rejection');
  assert.equal(rejected.resumeStatus, 'failed');
  assert.match(rejected.resumeMessage, /rejected/);

  await load(uploadWidget, `document.querySelector('input[type=file]').onchange=e=>e.target.setCustomValidity('Unsupported document');`);
  assert.equal((await attach()).resumeStatus, 'failed');

  await load(`${widgets[0][1]}${widgets[0][1]}`);
  assert.equal((await scan()).manualResume, true);
  assert.match((await scan()).resumeMessage, /ambiguous/);

  await load(uploadWidget, `document.querySelector('input[type=file]').onchange=e=>e.target.closest('section').setAttribute('aria-busy','true');`);
  assert.equal((await attach()).resumeStatus, 'pending');
  assert.equal((await scan()).resumeAvailable, false);
  await page.locator('section').evaluate(node => node.removeAttribute('aria-busy'));
  assert.equal((await scan()).resumeStatus, 'selected', 'later inspection observes upload progress rather than stale status');

  await load(bamboo);
  const prepare = await scan('prepare-resume');
  await page.locator('input[type=file]').setInputFiles({ name: 'User Choice.pdf', mimeType: 'application/pdf', buffer: bytes });
  assert.ok((await scan('attach-resume', { ...file, resumeToken: prepare.resumeToken })).error);
  assert.equal(await page.locator('input[type=file]').evaluate(input => input.files[0].name), 'User Choice.pdf');

  await load(bamboo);
  const malformed = await scan('prepare-resume');
  assert.match((await scan('attach-resume', { ...file, base64: '%%%invalid', resumeToken: malformed.resumeToken })).error, /incomplete/);
  assert.equal(await page.evaluate(() => window.uploads), 0);
  console.log('PASS async acceptance/rejection/pending, input remount, user choice and malformed download checks');

  await load('<div id="conditional"></div>', `document.querySelector('input').oninput=()=>document.querySelector('#conditional').innerHTML=${JSON.stringify(bamboo)};`);
  assert.equal((await scan()).resumeAvailable, false);
  await scan('autofill', { contact: { givenName: 'Jordan' } });
  assert.equal((await scan()).resumeAvailable, true, 'picker revealed by contact filling is found on rescan');
  assert.equal((await attach()).resumeSelected, true);
  assert.equal(await page.evaluate(() => window.submissions), 0);
  console.log(`PASS conditional picker reinspection; all ${requests} navigations intercepted, no real employer requests`);
} finally { await browser.close(); }
