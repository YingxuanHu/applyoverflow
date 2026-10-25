import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:https';
import { chromium } from 'playwright';
import { hashPassword } from 'better-auth/crypto';
import db from '../src/lib/db.ts';
import localAuth from '../src/lib/local-development-auth.ts';
import { workflowBenchmark } from './lib/workflow-benchmark.mjs';

// Real UI, authenticated APIs, database and MV3. Employer hosts resolve locally;
// no profile, file or application is ever sent to an external service.
const { prisma } = db;
const origin = process.env.TEST_APP_URL || 'http://127.0.0.1:3140';
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.ok(localAuth.isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL));
assert.match(new URL(process.env.DATABASE_URL).pathname, /test/i);
const store = JSON.parse(await readFile('extensions/chrome/store-release.json', 'utf8'));
assert.ok(process.env.APPLICATION_EXTENSION_IDS?.split(',').includes(store.id));
execFileSync(process.execPath, ['scripts/build-application-extension.mjs', `--local=${origin}`, '--test-output'], { stdio: 'pipe' });
const directory = resolve('output/extension/connected-workspace-test');
await mkdir(directory, { recursive: true });
await cp('output/extension/package-test/local', directory, { recursive: true });
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, 'utf8'));
manifest.key = store.publicKey;
manifest.host_permissions = [`${origin}/*`, 'https://careers.fixture.example/*', 'https://forms.fixture.example/*'];
await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest));

const tag = randomUUID(), password = `Fixture-${randomUUID()}`, token = randomBytes(32).toString('base64url');
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, emailVerified: true, name: 'Jordan Example',
  profile: { create: { name: 'Jordan Example', email: `${tag}@example.test`, location: 'Toronto, Canada', headline: 'Software Engineer', skillsText: 'TypeScript, React',
    contactJson: { fullName: 'Jordan Example', givenName: 'Jordan', familyName: 'Example', email: `${tag}@example.test`, city: 'Toronto', country: 'Canada' } } } }, include: { profile: true } });
const jobs = [];
let context, benchmark, failure, server, certDirectory, externalWrites = 0, plans = 0;
const responses = [];
const form = `<style>body{font:16px system-ui;margin:30px}label,input{display:block;margin:10px 0}</style>
<h1>Software Engineer Application</h1><form id="application">
<label>First Name<input name="givenName" required></label><label>Last Name<input name="familyName" required></label>
<label>Email<input name="email" type="email" required></label><label>Location<input name="city"></label>
<label>I certify my answers<input name="declaration" type="checkbox" required></label>
<button type="submit">Submit application</button></form>
<script>window.submitCount=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submitCount++;document.querySelector('form').remove();document.querySelector('h1').textContent='Application submitted successfully';}</script>`;
try {
  // Extension-created tabs can navigate before Playwright attaches interception.
  // Serve fixtures over loopback TLS instead of relying on first-request routing.
  certDirectory = await mkdtemp(resolve(tmpdir(), 'application-fixture-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${certDirectory}/key.pem`, '-out', `${certDirectory}/cert.pem`, '-days', '1', '-subj', '/CN=careers.fixture.example'], { stdio: 'pipe' });
  server = createServer({ key: await readFile(`${certDirectory}/key.pem`), cert: await readFile(`${certDirectory}/cert.pem`) }, (request, response) => {
    if (request.method !== 'GET') { externalWrites++; response.writeHead(405).end(); return; }
    const body = request.headers.host?.startsWith('forms.fixture.example') ? form : request.url.includes('/iframe/') ?
      '<h1>Apply for Software Engineer</h1><iframe title="Application" style="width:100%;height:900px" src="https://forms.fixture.example/jobs/iframe/apply"></iframe>' :
      request.url.includes('/delayed/') ? `<h1>Loading application</h1><script>setTimeout(()=>{document.open();document.write(${JSON.stringify(form).replace(/</g, '\\u003c')});document.close()},1500)</script>` : form;
    response.writeHead(200, { 'content-type': 'text/html' }).end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await prisma.account.create({ data: { userId: user.id, providerId: 'credential', accountId: user.id, password: await hashPassword(password) } });
  const session = await prisma.session.create({ data: { token: randomUUID(), userId: user.id, expiresAt: new Date(Date.now() + 3600000) } });
  await prisma.extensionConnection.create({ data: { userId: user.id, sessionId: session.id, clientId: store.id, challenge: 'synthetic', tokenHash: createHash('sha256').update(token).digest('base64url'), connectedAt: new Date(), expiresAt: session.expiresAt } });
  for (const mode of ['native', 'delayed', 'iframe']) {
    const job = await prisma.jobCanonical.create({ data: { title: `Software Engineer ${mode}`, company: 'Connected Workflow Fixture',
      location: 'Toronto, Canada', workMode: 'REMOTE', workModeConfidence: 1, workModeStatus: 'accepted', employmentType: 'FULL_TIME',
      description: 'Synthetic workflow test only', shortSummary: 'Synthetic', roleFamily: 'TECH', applyUrl: `https://careers.fixture.example/jobs/${mode}/apply`,
      postedAt: new Date(), lastConfirmedAliveAt: new Date(), status: 'LIVE', availabilityScore: 100 } });
    jobs.push(job);
    await prisma.jobFeedIndex.create({ data: { canonicalJobId: job.id, title: job.title, company: job.company, location: job.location,
      workMode: job.workMode, employmentType: job.employmentType, roleFamily: job.roleFamily, applyUrl: job.applyUrl,
      postedAt: job.postedAt, status: 'LIVE', searchText: job.title } });
  }
  context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`, '--ignore-certificate-errors', '--no-proxy-server', `--host-resolver-rules=MAP careers.fixture.example 127.0.0.1:${server.address().port}, MAP forms.fixture.example 127.0.0.1:${server.address().port}`] });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === origin) return route.continue();
    if (request.method() !== 'GET') { externalWrites++; return route.abort(); }
    if (['forms.fixture.example', 'careers.fixture.example'].includes(url.hostname) && !url.port) return route.continue();
    return route.abort();
  });
  context.on('request', request => { if (new URL(request.url()).pathname.endsWith('/autofill-plan')) plans++; });
  context.on('response', response => { const url = new URL(response.url()); if (url.origin === origin && url.pathname.startsWith('/api/extension/')) responses.push({ path: url.pathname, status: response.status() }); });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  assert.equal(new URL(worker.url()).host, store.id);
  await worker.evaluate(({ origin, token, email }) => chrome.storage.local.set({ connection: { origin, token, email, expiresAt: new Date(Date.now() + 3600000).toISOString() } }), { origin, token, email: user.email });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  await page.setViewportSize({ width: 1440, height: 950 });
  benchmark = await workflowBenchmark(page, 'output/playwright/auto-apply-connected', 'benchmark', 'Local Next UI/API/database and real MV3; three loopback HTTPS synthetic employer layouts; no external submissions');
  await page.route('**/api/jobs/top-picks/refresh', route => route.fulfill({ json: { status: 'queued' } }));
  await page.goto(`${origin}/sign-in?callbackUrl=%2Fapplications%2Fauto-apply`);
  await page.getByRole('textbox', { name: /^Email/ }).fill(user.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(url => url.pathname !== '/sign-in', { waitUntil: 'domcontentloaded', timeout: 90000 });
  for (const job of jobs) {
    await page.goto(`${origin}/jobs/${job.id}`);
    await page.getByRole('button', { name: 'Prepare application', exact: true }).click();
    await page.waitForURL(/\/applications\/auto-apply\?application=/);
    await page.getByText(/Extension .* connected/).waitFor();
    const before = plans;
    await page.getByRole('button', { name: 'Prepare application', exact: true }).click();
    assert.equal(plans, before, 'consent precedes profile access');
    await page.getByRole('button', { name: 'Prepare with my profile', exact: true }).click();
    await page.getByLabel('First Name *', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Check readiness', exact: true }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Check readiness' && !button.disabled));
    assert.equal(await page.getByLabel('First Name *', { exact: true }).inputValue(), 'Jordan');
    assert.equal(await page.getByLabel('Last Name *', { exact: true }).inputValue(), 'Example');
    assert.equal(await page.getByLabel('Email *', { exact: true }).inputValue(), user.email);
    const employer = context.pages().find(candidate => candidate.url() === job.applyUrl);
    assert.ok(employer, 'dedicated employer tab exists');
    const frame = job.applyUrl.includes('/iframe/') ? employer.frames().find(frame => frame.url().startsWith('https://forms.fixture.example/')) : employer.mainFrame();
    assert.ok(frame);
    assert.equal(await frame.locator('[name=givenName]').inputValue(), 'Jordan', 'actual employer DOM is filled');
    assert.equal(await frame.evaluate(() => window.submitCount), 0);
    await benchmark.checkpoint(`${job.title}: queue, consent, real extension fill and readback`);
    await page.getByLabel('I certify my answers *', { exact: true }).check();
    await page.getByRole('button', { name: 'Update field', exact: true }).click();
    await page.getByText('Answer updated on the employer form.', { exact: true }).waitFor();
    assert.equal(await frame.locator('[name=declaration]').isChecked(), true);
    await page.getByRole('button', { name: 'Check readiness', exact: true }).click();
    if (job.applyUrl.includes('/iframe/')) {
      await page.getByText('Embedded applications need manual submission in this preview.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Submit this application', exact: true }).count(), 0);
      assert.equal(await frame.evaluate(() => window.submitCount), 0);
      assert.equal(await prisma.trackedApplication.count({ where: { userId: user.id, canonicalJobId: job.id, status: 'APPLIED' } }), 0);
      await benchmark.checkpoint(`${job.title}: edited values retained; embedded submission safely gated`);
      continue;
    }
    await page.getByRole('button', { name: 'Submit this application', exact: true }).waitFor();
    await page.getByRole('checkbox', { name: /I reviewed the employer form/ }).check();
    await page.getByRole('button', { name: 'Submit this application', exact: true }).click();
    assert.equal(await frame.evaluate(() => window.submitCount), 0);
    await page.getByRole('button', { name: 'Approve and submit once', exact: true }).click();
    await page.getByText('Employer confirmation received.', { exact: true }).waitFor();
    assert.equal(await frame.evaluate(() => window.submitCount), 1);
    assert.equal(await prisma.trackedApplication.count({ where: { userId: user.id, canonicalJobId: job.id, status: 'APPLIED' } }), 1);
    await benchmark.checkpoint(`${job.title}: explicit approval, one synthetic submission, persisted confirmation`);
  }
  assert.equal(externalWrites, 0);
  assert.ok(responses.some(response => response.path.endsWith('/autofill-plan') && response.status === 200));
  assert.ok(responses.some(response => response.path.endsWith('/applied') && response.status === 200));
  assert.equal(responses.filter(response => response.status >= 500).length, 0);
  benchmark.assertHealthy();
  console.log('PASS connected Auto Apply: native/delayed submission and cross-origin iframe fill/manual-submission gate; actual UI + API + MV3 + DOM + persisted tracking. No external submissions.');
} catch (error) {
  failure = error;
  for (const [index, page] of (context?.pages() ?? []).entries()) {
    await page.screenshot({ path: `output/playwright/auto-apply-connected/failure-${index}.png`, fullPage: true }).catch(() => {});
    console.error('Failed page:', page.url(), (await page.locator('body').innerText().catch(() => '')).slice(0, 2500));
  }
  throw error;
}
finally {
  await benchmark?.finish(failure);
  await context?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  if (certDirectory) await rm(certDirectory, { recursive: true, force: true });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.jobCanonical.deleteMany({ where: { id: { in: jobs.map(job => job.id) } } });
  await prisma.$disconnect();
}
