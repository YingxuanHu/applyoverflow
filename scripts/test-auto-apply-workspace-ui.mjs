import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import db from '../src/lib/db.ts';
import localAuth from '../src/lib/local-development-auth.ts';
import { workflowBenchmark } from './lib/workflow-benchmark.mjs';
const { prisma } = db;
const { isLocalDevelopmentDatabaseUrl } = localAuth;

// Actual Next UI and database, synthetic account. Extension transport is a UI
// fixture; test-auto-apply-workspace.mjs separately exercises real MV3/DOM writes.
const origin = process.env.TEST_APP_URL || 'http://127.0.0.1:3004';
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL));
const tag = randomUUID(), sessionToken = randomUUID();
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, name: 'Jordan Example', profile: { create: { email: `${tag}@example.test`, name: 'Jordan Example', location: 'Toronto, Ontario, Canada', headline: 'Software Engineer', skillsText: 'TypeScript, React', contactJson: { applicationAnswers: { enabled: false, values: {} } } } } }, include: { profile: true } });
const password = `Fixture-${randomUUID()}`;
await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
await prisma.account.create({ data: { userId: user.id, providerId: 'credential', accountId: user.id, password: await hashPassword(password) } });
const session = await prisma.session.create({ data: { token: sessionToken, userId: user.id, expiresAt: new Date(Date.now() + 3600000) } });
const clientId = process.env.APPLICATION_EXTENSION_IDS.split(',')[0].trim();
await prisma.extensionConnection.create({ data: { userId: user.id, sessionId: session.id, clientId, challenge: 'fixture', connectedAt: new Date(), expiresAt: session.expiresAt } });
const job = await prisma.jobCanonical.create({ data: { title: 'Software Engineer, Application Systems', company: 'Workspace UI Fixture', location: 'Toronto, Canada', workMode: 'REMOTE', employmentType: 'FULL_TIME', description: 'Synthetic frontend test only', shortSummary: 'Synthetic', roleFamily: 'TECH', applyUrl: `https://careers.example.test/jobs/${tag}/apply`, postedAt: new Date(), lastConfirmedAliveAt: new Date(), status: 'LIVE', availabilityScore: 100 } });
await prisma.jobCanonical.update({ where: { id: job.id }, data: { workModeConfidence: 1, workModeStatus: 'accepted' } });
await prisma.jobFeedIndex.create({ data: { canonicalJobId: job.id, title: job.title, company: job.company, location: job.location,
  workMode: job.workMode, employmentType: job.employmentType, roleFamily: job.roleFamily, applyUrl: job.applyUrl,
  postedAt: job.postedAt, status: 'LIVE', searchText: job.title } });
const browser = await chromium.launch();
const context = await browser.newContext();
const output = 'output/playwright/auto-apply';
await mkdir(output, { recursive: true });
await context.tracing.start({ screenshots: true, snapshots: true });
await context.addInitScript(() => {
  const fields = [
    { id: 'first-name', label: 'First name', value: 'Jordan', type: 'text', required: true },
    { id: 'answer', label: 'Describe a technical decision and the trade-offs you considered.', value: 'I used indexed queries to reduce repeated database scans.', type: 'textarea', required: true },
    { id: 'arrangement', label: 'Preferred work arrangement', value: 'remote', type: 'select-one', required: false, options: [{ value: 'remote', label: 'Remote' }, { value: 'hybrid', label: 'Hybrid' }] },
    { id: 'resume', label: 'Resume', value: 'Example-Resume.pdf', type: 'file', readOnly: true, required: true },
  ].map(field => ({ readOnly: false, section: '', options: [], maxLength: 500, ...field }));
  let revision = 0;
  window.fixtureCommands = [];
  window.fixtureState = { errors: {}, disconnected: false, approvalLifetime: 90000, delay: 50, outcome: 'unverified' };
  window.chrome = window.chrome || {};
  window.chrome.runtime = { sendMessage(id, message, callback) {
    window.fixtureCommands.push(message.action);
    let response = {};
    const review = () => ({ fields: structuredClone(fields), revision: String(++revision), url: 'https://careers.example.test/apply', notice: 'Review uploaded documents on the employer form.' });
    if (message.action === 'ping') response = { protocol: 1, version: '0.15.0' };
    if (message.action === 'open') response = { opened: true, message: 'Employer tab opened.' };
    if (['fill', 'snapshot'].includes(message.action)) response = { review: review(), message: 'Preparation complete. Nothing submitted.' };
    if (message.action === 'edit') { fields.find(field => field.id === message.id).value = message.value; response = { review: review(), message: 'Answer updated on the employer form.' }; }
    if (message.action === 'check') response = { submissionReview: { ready: true, token: 'fixture-approval', expires: Date.now() + window.fixtureState.approvalLifetime, blockers: [], files: 1 } };
    if (message.action === 'submit') response = { submissionResult: { outcome: window.fixtureState.outcome, message: 'Submission acceptance could not be verified. Do not retry.' } };
    if (window.fixtureState.errors[message.action]) response = { error: window.fixtureState.errors[message.action] };
    setTimeout(() => callback(window.fixtureState.disconnected ? undefined : response), window.fixtureState.delay);
  } };
});
const page = await context.newPage();
// Keep the seeded recommendation stable while exercising queue recovery. The
// ranking worker is tested separately and would correctly reject this fake job.
await page.route('**/api/jobs/top-picks/refresh', route => route.fulfill({ json: { status: 'queued' } }));
const benchmark = await workflowBenchmark(page, output, 'ui-benchmark');
let failure;
page.setDefaultTimeout(45000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
async function capture(name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll('.app-scroll-root')].some(element => element.scrollWidth > element.clientWidth + 1)), false, `${name}: no horizontal overflow`);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true, animations: 'disabled' });
}
try {
  await page.goto(`${origin}/sign-in?callbackUrl=%2Fapplications%2Fauto-apply`);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Sign in' && !button.disabled));
  await page.getByRole('textbox', { name: /^Email/ }).fill(user.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/applications\/auto-apply/);
  await page.goto(`${origin}/applications/auto-apply`);
  await page.getByRole('heading', { name: 'Jobs', exact: true }).waitFor();
  const jobsNavigation = page.getByRole('navigation', { name: 'Jobs workspace', exact: true });
  assert.deepEqual(await jobsNavigation.getByRole('link').allTextContents(), ['Jobs', 'Picks for you', 'Auto Apply']);
  assert.equal(await jobsNavigation.getByRole('link', { name: 'Auto Apply', exact: true }).getAttribute('aria-current'), 'page');
  await page.setViewportSize({ width: 1440, height: 950 });
  assert.equal(await page.locator('aside').getByRole('link', { name: 'Auto Apply', exact: true }).getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('aside').getByRole('link', { name: 'Applications', exact: true }).getAttribute('aria-current'), null);
  await page.getByRole('button', { name: 'Submitted', exact: true }).click();
  await page.getByRole('heading', { name: 'Applications', exact: true }).waitFor();
  assert.equal(await jobsNavigation.count(), 0, 'Applications is tracking only, without workspace tabs');
  await page.getByRole('button', { name: 'Expand Jobs', exact: true }).click();
  await page.locator('aside').getByRole('link', { name: 'Auto Apply', exact: true }).click();
  await page.getByRole('heading', { name: 'Jobs', exact: true }).waitFor();
  await benchmark.checkpoint('Auto Apply is a Jobs view; Submitted opens tracking; Jobs navigation returns to review');
  const matchProfile = await prisma.userMatchProfile.findUniqueOrThrow({ where: { userId: user.profile.id } });
  await prisma.userTopPick.create({ data: { userId: user.profile.id, jobId: job.id, score: 90, rank: 1,
    scoreBreakdown: {}, matchReasons: ['Strong role match: software engineering.', 'Remote work matches your preferences.'], concerns: [],
    profileVersion: matchProfile.profileVersion, expiresAt: new Date(Date.now() + 3600000) } });
  await page.reload();
  await page.getByText('Extension 0.15.0 connected').waitFor();
  await page.getByRole('button', { name: 'Add to review', exact: true }).waitFor();
  for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: 950 }); await capture(`matches-${width}`); }
  await benchmark.checkpoint('Authenticated matches; desktop, phone and narrow-phone layout');
  await page.getByRole('button', { name: 'Add to review', exact: true }).click();
  await page.getByText('Added to review queue. Nothing submitted.', { exact: true }).waitFor();
  assert.equal(await prisma.trackedApplication.count({ where: { userId: user.id, canonicalJobId: job.id, status: 'PREPARING' } }), 1);
  await benchmark.checkpoint('Match queued through UI and persisted exactly once');
  await page.getByRole('button', { name: 'Remove from review queue', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await prisma.trackedApplication.count({ where: { userId: user.id, canonicalJobId: job.id, status: 'PREPARING' } }), 1);
  await page.getByRole('button', { name: 'Remove from review queue', exact: true }).click();
  await page.getByRole('button', { name: 'Remove from queue', exact: true }).click();
  await page.getByText('Removed from review queue. Kept in Wishlist.', { exact: true }).waitFor();
  assert.equal(await prisma.trackedApplication.count({ where: { userId: user.id, canonicalJobId: job.id, status: 'WISHLIST' } }), 1);
  await benchmark.checkpoint('Removal can be cancelled; confirmed removal preserves Wishlist');
  // A ranking outage must not prevent preparation of a job the user found.
  await prisma.userTopPick.deleteMany({ where: { userId: user.profile.id } });
  await page.goto(`${origin}/jobs/${job.id}`);
  await page.getByRole('button', { name: 'Prepare application', exact: true }).click();
  await page.waitForURL(/\/applications\/auto-apply\?application=/);
  await page.getByText('Extension 0.15.0 connected').waitFor();
  assert.equal(await prisma.trackedApplication.count({ where: { userId: user.id, canonicalJobId: job.id } }), 1);
  await benchmark.checkpoint('Jobs detail queues and selects an application even with no recommendations');
  assert.equal(await page.getByRole('button', { name: 'Prepare application', exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: 'Prepare application', exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixtureCommands.includes('fill')), false, 'no profile export before consent');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.evaluate(() => window.fixtureCommands.includes('fill')), false, 'cancelling consent exports nothing');
  assert.equal(await page.evaluate(() => window.fixtureCommands.includes('open')), false, 'cancelled consent does not open an employer tab');
  await benchmark.checkpoint('One-step preparation is available; cancelling consent neither opens nor exports');
  await page.evaluate(() => { window.fixtureState.errors.fill = 'Site access is needed. Open the employer tab, click the extension, and enable it on this site.'; });
  await page.getByRole('button', { name: 'Prepare application', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare with my profile', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /Site access is needed/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Prepare application', exact: true }).isEnabled(), true);
  await benchmark.checkpoint('Permission failure explains recovery and permits preparation retry');
  await page.evaluate(() => { delete window.fixtureState.errors.fill; });
  await page.getByRole('button', { name: 'Prepare application', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare with my profile', exact: true }).click();
  await page.getByLabel('First name *', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Submit this application', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Submit this application', exact: true }).isDisabled(), true, 'automatic readiness is not submission approval');
  assert.equal(await page.evaluate(() => window.fixtureCommands.filter(action => action === 'open').length), 1, 'retry reuses the dedicated tab');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (width === 1440) assert.equal(await page.getByRole('complementary', { name: 'Preparation queue' }).evaluate(element => getComputedStyle(element.parentElement).gridTemplateColumns.split(' ').length), 2, 'desktop queue and editor use separate columns');
    await capture(`review-${width}`);
  }
  await benchmark.checkpoint('Preparation recovery; current fields and documents render at three sizes');
  const name = page.getByLabel('First name *', { exact: true });
  const answer = page.getByLabel(/Describe a technical decision/);
  await name.fill('Jordan Updated');
  await answer.fill('A second unsaved edit.');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Matches', exact: true }).click();
  assert.equal(await name.inputValue(), 'Jordan Updated', 'cancelled navigation keeps pending edits');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('link', { name: 'Documents & timeline', exact: true }).click();
  assert.match(page.url(), /\/applications\/auto-apply(?:\?|$)/);
  assert.equal(await answer.inputValue(), 'A second unsaved edit.', 'cancelled link navigation retains answer edits');
  page.once('dialog', dialog => dialog.dismiss());
  await jobsNavigation.getByRole('link', { name: 'Jobs', exact: true }).click();
  assert.match(page.url(), /\/applications\/auto-apply(?:\?|$)/);
  assert.equal(await name.inputValue(), 'Jordan Updated', 'Jobs navigation also protects edits');
  const previousChecks = await page.evaluate(() => window.fixtureCommands.filter(action => action === 'check').length);
  await page.getByRole('button', { name: 'Check readiness' }).click();
  await page.getByRole('alert').filter({ hasText: /Save or discard/ }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureCommands.filter(action => action === 'check').length), previousChecks);
  await benchmark.checkpoint('Independent pending edits; workspace and Jobs navigation protected');
  await page.getByRole('button', { name: 'Update field', exact: true }).first().click();
  await page.getByText('Answer updated on the employer form.', { exact: true }).waitFor();
  assert.equal(await answer.inputValue(), 'A second unsaved edit.', 'saving one field retains other pending edits');
  await page.getByRole('button', { name: 'Update field', exact: true }).click();
  await page.getByRole('button', { name: 'Update field', exact: true }).waitFor({ state: 'hidden' });
  await name.fill('Discard this edit');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Matches', exact: true }).click();
  await page.getByRole('button', { name: /Prepare & review/ }).click();
  assert.equal(await name.inputValue(), 'Jordan Updated', 'confirmed navigation discards only unsaved edits');
  await benchmark.checkpoint('Edits saved independently; explicit discard restores employer values');
  await page.getByRole('button', { name: 'Check readiness' }).click();
  await page.getByRole('button', { name: 'Submit this application', exact: true }).waitFor();
  await name.fill('Approval must become stale');
  await page.getByRole('button', { name: 'Submit this application', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Discard edit', exact: true }).click();
  await page.evaluate(() => { window.fixtureState.errors.check = 'Reconnect the extension to this ApplyOverflow account in Settings, then retry.'; });
  await page.getByRole('button', { name: 'Check readiness' }).click();
  await page.getByRole('alert').filter({ hasText: /Reconnect the extension/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Submit this application', exact: true }).count(), 0);
  await benchmark.checkpoint('Editing invalidates approval; failed readiness does not retain an old approval');
  await page.evaluate(() => { delete window.fixtureState.errors.check; window.fixtureState.approvalLifetime = 2000; });
  await page.getByRole('button', { name: 'Check readiness' }).click();
  await page.getByRole('checkbox', { name: /I reviewed the employer form/ }).check();
  await page.getByRole('button', { name: 'Submit this application', exact: true }).click();
  await page.getByText('Approval expired. Check the form again before submitting.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Approve and submit once', exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.fixtureCommands.includes('submit')), false);
  await benchmark.checkpoint('Approval expiry closes pending confirmation without submitting');
  await page.evaluate(() => { window.fixtureState.approvalLifetime = 90000; });
  await page.getByRole('button', { name: 'Check readiness' }).click();
  const submit = page.getByRole('button', { name: 'Submit this application', exact: true });
  await submit.waitFor();
  assert.equal(await submit.isDisabled(), true);
  await page.getByRole('checkbox', { name: /I reviewed the employer form/ }).check();
  await submit.click();
  assert.equal(await page.evaluate(() => window.fixtureCommands.includes('submit')), false, 'second confirmation required');
  await capture('approval-320');
  await benchmark.checkpoint('Document review and explicit final approval required');
  await page.getByRole('button', { name: 'Approve and submit once', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /Submission attempted; acceptance is unknown/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Prepare application', exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.fixtureCommands.filter(action => action === 'submit').length), 1);
  await capture('unknown-outcome-320');
  await benchmark.checkpoint('Ambiguous submission reports uncertainty and disables retry');
  // Profile preferences save through the real UI/API and preserve opt-in sharing.
  await page.getByRole('button', { name: 'Matching settings', exact: true }).click();
  await page.getByLabel('Open to relocation', { exact: true }).selectOption('YES');
  await page.getByLabel('Relocation destinations (optional)', { exact: true }).fill('Seattle');
  await page.getByRole('button', { name: 'Add relocation destination', exact: true }).click();
  await page.getByRole('checkbox', { name: 'remote', exact: true }).check();
  await capture('preferences-320');
  await page.getByRole('button', { name: 'Save requirements', exact: true }).click();
  await page.getByRole('status').filter({ hasText: /Requirements saved/ }).waitFor();
  const saved = await prisma.userProfile.findUniqueOrThrow({ where: { id: user.profile.id } });
  assert.equal(saved.contactJson.applicationAnswers.values.relocation, 'Yes');
  assert.equal(saved.contactJson.applicationAnswers.enabled, false, 'matching does not opt in to sharing personal answers');
  await benchmark.checkpoint('Relocation and remote-only settings persist without enabling answer sharing');
  await page.evaluate(() => { window.fixtureState.disconnected = true; });
  await page.getByRole('button', { name: 'Recheck', exact: true }).click();
  await page.getByText('ApplyOverflow is not responding in this browser. Check that the extension is installed and enabled, then reconnect it.', { exact: true }).waitFor();
  await benchmark.checkpoint('Disconnected extension reports actionable connection state');
  await page.evaluate(() => { window.fixtureState.disconnected = false; });
  await page.getByRole('button', { name: 'Recheck', exact: true }).click();
  await page.getByText('Extension 0.15.0 connected', { exact: true }).waitFor();
  await benchmark.checkpoint('Connection recovers through Recheck without signing out');
  await page.route('**/api/applications/auto-apply?page=*', route => route.fulfill({ status: 401, json: { error: 'Authentication required' } }));
  await page.getByRole('button', { name: 'Recheck', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /Sign in to ApplyOverflow/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Recheck', exact: true }).isEnabled(), true);
  await benchmark.checkpoint('Expired web session explains sign-in recovery without losing review');
  await page.unroute('**/api/applications/auto-apply?page=*');
  await page.getByRole('button', { name: 'Recheck', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /Sign in to ApplyOverflow/ }).waitFor({ state: 'hidden' });
  await page.getByRole('alert').filter({ hasText: /Submission attempted; acceptance is unknown/ }).waitFor();
  await benchmark.checkpoint('Recovered API session retains the submission retry lock');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const mobileNavigation = page.getByRole('navigation', { name: 'Mobile navigation', exact: true });
  assert.equal(await mobileNavigation.locator('[aria-current="page"]').count(), 1);
  assert.equal(await mobileNavigation.getByRole('link', { name: 'Auto Apply', exact: true }).getAttribute('aria-current'), 'page');
  await capture('jobs-navigation-320');
  await mobileNavigation.getByRole('link', { name: 'Auto Apply', exact: true }).click();
  await mobileNavigation.waitFor({ state: 'hidden' });
  await benchmark.checkpoint('Narrow-phone navigation identifies Auto Apply within Jobs without selecting Applications');
  await prisma.topPickRefreshTask.upsert({ where: { userId: user.profile.id },
    create: { userId: user.profile.id, status: 'FAILED', lastError: 'Synthetic matching failure' },
    update: { status: 'FAILED', lastError: 'Synthetic matching failure' } });
  await page.goto(`${origin}/applications/auto-apply`);
  await page.getByRole('alert').filter({ hasText: /Matching failed/ }).waitFor();
  await page.getByRole('button', { name: 'Continue queued applications', exact: true }).waitFor();
  await benchmark.checkpoint('Failed matching is explicit and does not block the queue');
  await prisma.topPickRefreshTask.update({ where: { userId: user.profile.id }, data: {
    status: 'RUNNING', startedAt: new Date(Date.now() - 180000), leaseExpiresAt: new Date(Date.now() + 600000) } });
  await page.reload();
  await page.getByRole('status').filter({ hasText: /Matching is taking longer/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Check match progress', exact: true }).isEnabled(), true);
  await benchmark.checkpoint('Old running task shows a recovery action instead of indefinite finding-matches state');
  assert.deepEqual(errors, []);
  console.log('PASS actual workspace UI/API: authenticated queue, desktop/mobile layouts, consent, edits retained independently, unsaved-edit gate, explicit approval, unknown-outcome retry block, synchronized relocation; synthetic extension transport');
} catch (error) { failure = error; await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {}); throw error; }
finally { await benchmark.finish(failure); await context.tracing.stop({ path: `${output}/ui-demo-trace.zip` }); await browser.close(); await prisma.user.delete({ where: { id: user.id } }); await prisma.jobCanonical.delete({ where: { id: job.id } }); await prisma.$disconnect(); }
