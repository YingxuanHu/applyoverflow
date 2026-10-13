import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

// All HTTP is intercepted. Submission here is only a synthetic DOM event.
execFileSync(process.execPath, ["scripts/build-application-extension.mjs", "--test-output"], { stdio: "pipe" });
const directory = resolve("output/extension/workspace-test");
await mkdir(directory, { recursive: true });
await cp(resolve("output/extension/package-test/production"), directory, { recursive: true });
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, "utf8"));
manifest.host_permissions = ["https://*/*"];
await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest));
const context = await chromium.launchPersistentContext("", { channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`] });
const origin = "https://applyoverflow.com";
const employer = "https://careers.fixture.example/jobs/engineer/apply";
let plans = 0, recorded = 0, unexpectedWrites = 0;
const form = `<style>body{font:16px system-ui;padding:25px}label,input,textarea,select{display:block;margin:8px}</style>
  <h1>Software Engineer Application</h1><form id="application">
  <label>First Name<input name="givenName" required></label><label>Last Name<input name="familyName" required></label>
  <label>Email<input name="email" type="email" required></label><label>Phone<input name="phone" type="tel"></label>
  <label>Location<input name="city"></label><label>LinkedIn<input name="linkedinUrl" type="url"></label>
  <label>Why this role?<textarea name="motivation" maxlength="500"></textarea></label>
  <label>Work arrangement<select name="arrangement"><option value="">Choose</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option></select></label>
  <label>Read-only note<input name="readOnlyNote" readonly value="Employer-controlled"></label>
  <label>Social Security Number<input name="ssn" value="synthetic-sensitive"></label>
  <input type="hidden" name="hidden" value="synthetic-sensitive">
  <label>I certify my answers<input name="declaration" type="checkbox" required></label>
  <button type="submit">Submit application</button></form><label>Additional note<input form="application" name="outside"></label>
  <script>window.submitCount=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submitCount++;document.querySelector('form').remove();document.querySelector('input[name=outside]').remove();document.querySelector('h1').textContent='Application submitted successfully';}</script>`;
await context.route("**/*", async route => {
  const request = route.request(), url = new URL(request.url());
  if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
  if (url.origin === origin && url.pathname.startsWith('/api/')) {
    const action = url.pathname.split('/').at(-1);
    if (action === 'connection-status') return route.fulfill({ json: { connected: true } });
    if (action === 'workspace-target') {
      if (request.postDataJSON()?.token !== 'same-account-capability') return route.fulfill({ status: 403, json: { error: 'Wrong account or expired workspace connection.' } });
      return route.fulfill({ json: { id: 'fixture-application', url: employer, status: 'PREPARING', nonce: 'fixture-nonce' } });
    }
    if (action === 'autofill-plan') { plans++; return route.fulfill({ json: { contact: { givenName: 'Jordan', familyName: 'Example', email: 'jordan@example.test', phone: '4165550100', city: 'Toronto', linkedinUrl: 'https://linkedin.com/in/example' }, answers: [], history: [], includeResume: false, revision: 'fixture' } }); }
    if (action === 'autofill-suggest') return route.fulfill({ json: { answer: 'I build and test software systems.', canFill: true } });
    if (action === 'submission-check') return route.fulfill({ json: { alreadyApplied: false } });
    if (action === 'applied') { recorded++; return route.fulfill({ json: { id: 'fixture-application' } }); }
    throw new Error(`Unexpected API: ${action}`);
  }
  if (request.method() !== 'GET') { unexpectedWrites++; return route.abort(); }
  return route.fulfill({ contentType: 'text/html', body: url.origin === origin ? '<h1>Auto Apply test workspace</h1>' : form });
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => chrome.storage.local.set({ connection: { token: 'synthetic-fixture', email: 'synthetic@example.test', origin: 'https://applyoverflow.com', expiresAt: new Date(Date.now() + 3600000).toISOString() } }));
  const workspace = await context.newPage();
  await workspace.goto(`${origin}/applications/auto-apply`);
  const send = (action, extra = {}, page = workspace) => page.evaluate(({ id, action, extra }) => new Promise(resolve => chrome.runtime.sendMessage(id, { token: 'same-account-capability', action, ...extra }, result => resolve(result || { error: chrome.runtime.lastError?.message }))), { id, action, extra });
  assert.equal((await send('ping')).protocol, 1);
  assert.match((await send('open', { token: 'wrong-account' })).error, /account|expired/i);
  const next = context.waitForEvent('page');
  assert.equal((await send('open')).opened, true);
  const application = await next;
  // Attach Playwright's route before navigating the extension-created target.
  await application.goto(employer);
  assert.equal(plans, 0, 'opening is not consent to export profile');
  const otherWorkspace = await context.newPage();
  await otherWorkspace.goto(`${origin}/applications/auto-apply`);
  assert.match((await send('snapshot', {}, otherWorkspace)).error, /Reopen/);
  await otherWorkspace.goto(`${origin}/profile`);
  assert.match((await send('ping', {}, otherWorkspace)).error, /workspace|Auto Apply|closed/i);
  await workspace.bringToFront();
  let result = await send('fill');
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.ok(result.review.fields.length >= 10);
  assert.equal(await application.locator('[name=givenName]').inputValue(), 'Jordan');
  assert.equal(await application.locator('[name=email]').inputValue(), 'jordan@example.test');
  assert.equal(await application.evaluate(() => window.submitCount), 0);
  assert.equal(result.review.fields.find(field => field.label === 'Additional note').value, '', 'form-associated controls included');
  let review = result.review;
  assert.equal(review.fields.some(field => /Social Security|Password|hidden/.test(field.label)), false, 'sensitive and hidden values never enter workspace review');
  const readOnly = review.fields.find(field => field.label === 'Read-only note');
  assert.equal(readOnly.readOnly, true);
  assert.match((await send('edit', { id: readOnly.id, value: 'Overwrite', revision: review.revision })).error, /changed|Refresh/i);
  assert.equal(await application.locator('[name=readOnlyNote]').inputValue(), 'Employer-controlled');
  const motivation = review.fields.find(field => field.label === 'Why this role?');
  assert.match((await send('edit', { id: motivation.id, value: 'x'.repeat(501), revision: review.revision })).error, /limit/i);
  assert.equal(await application.locator('textarea').inputValue(), '');
  const edit = async (label, value) => {
    const field = review.fields.find(field => field.label === label);
    assert.ok(field, label);
    const response = await send('edit', { id: field.id, value, revision: review.revision });
    assert.equal(response.error, undefined, JSON.stringify(response));
    review = response.review;
  };
  await edit('Why this role?', 'Reviewed answer from the workspace.');
  assert.equal(await application.locator('textarea').inputValue(), 'Reviewed answer from the workspace.');
  await edit('Work arrangement', 'remote');
  assert.equal(await application.locator('select').inputValue(), 'remote');
  const arrangement = review.fields.find(field => field.label === 'Work arrangement');
  assert.match((await send('edit', { id: arrangement.id, value: 'invented-option', revision: review.revision })).error, /available/i);
  assert.equal(await application.locator('select').inputValue(), 'remote');
  review = (await send('snapshot')).review;
  let readiness = await send('check');
  assert.equal(readiness.submissionReview.ready, false, 'unchecked declaration blocks approval');
  await edit('I certify my answers', 'Yes');
  assert.equal(await application.locator('[name=declaration]').isChecked(), true);
  await application.locator('[name=givenName]').fill('Employer-side edit');
  assert.match((await send('edit', { id: review.fields.find(field => field.label === 'First Name').id, value: 'Overwrite', revision: review.revision })).error, /changed|Refresh/i);
  assert.equal(await application.locator('[name=givenName]').inputValue(), 'Employer-side edit');
  review = (await send('snapshot')).review;
  await edit('First Name', 'Jordan');
  readiness = await send('check');
  assert.equal(readiness.submissionReview.ready, true, JSON.stringify(readiness));
  assert.match((await send('submit', { approvalToken: readiness.submissionReview.token, confirmed: false, documentsReviewed: true })).error, /review|approv/i);
  assert.equal(await application.evaluate(() => window.submitCount), 0);
  // A DOM change invalidates the previously reviewed approval.
  await application.locator('[name=phone]').fill('4165550200');
  result = await send('submit', { approvalToken: readiness.submissionReview.token, confirmed: true, documentsReviewed: true });
  assert.equal(result.submissionResult?.outcome, 'blocked', JSON.stringify(result));
  assert.equal(await application.evaluate(() => window.submitCount), 0);
  readiness = await send('check');
  assert.equal(readiness.submissionReview.ready, true, JSON.stringify(readiness));
  result = await send('submit', { approvalToken: readiness.submissionReview.token, confirmed: true, documentsReviewed: true });
  assert.equal(result.submissionResult?.outcome, 'confirmed', JSON.stringify(result));
  assert.equal(await application.evaluate(() => window.submitCount), 1);
  assert.equal(recorded, 1);
  await application.goto(employer);
  assert.match((await send('check')).error, /already attempted/);
  assert.equal(unexpectedWrites, 0);
  console.log('PASS real MV3 workspace: scoped account handoff, separate employer tab, actual autofill/readback, native answer edits, stale edits, declaration gate, stale approval, one synthetic submission, confirmation and duplicate lock');
} finally { await context.close(); }
