import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { hashPassword } from 'better-auth/crypto';
const require = createRequire(import.meta.url);
const { prisma } = require('../../src/lib/db.ts');
const { isLocalDevelopmentDatabaseUrl } = require('../../src/lib/local-development-auth.ts');
const { upsertJobFeedIndex } = require('../../src/lib/ingestion/search-index.ts');

const root = process.env.TEST_APP_URL || 'http://localhost:3004';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(root).hostname), 'local test only');
assert.notEqual(process.env.NODE_ENV, 'production');
assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), 'local database required');
assert.ok(!process.env.DATABASE_URL_DO_PRIVATE, 'no remote override');
const userId = `location-ui-${randomUUID()}`;
const email = `${userId}@example.test`;
const password = randomUUID();
const jobIds = [];
const rawIds = [];
await mkdir('output/playwright', { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.setDefaultTimeout(15000);
try {
  await prisma.user.create({ data: {
    id: userId, email, name: 'Location Fixture', emailVerified: true, emailNotificationsEnabled: false,
    accounts: { create: { accountId: userId, providerId: 'credential', password: await hashPassword(password) } },
    profile: { create: {
      id: userId, email, name: 'Location Fixture', headline: 'Software Engineer',
      summary: 'Builds web applications and reliable backend services.', location: 'Toronto, ON, Canada',
      skillsJson: ['TypeScript', 'SQL', 'React'], skillsText: 'TypeScript, SQL, React', experienceLevel: 'MID',
    } },
  } });
  for (const [city, location, region, workMode] of [
    ['Toronto', 'Toronto, Ontario, Canada', 'CA', 'HYBRID'],
    ['Seattle', 'Seattle, WA', 'US', 'ONSITE'],
    ['Vancouver WA', 'Vancouver, Washington', 'US', 'ONSITE'],
    ['Canada remote', 'Remote - Canada', 'CA', 'REMOTE'],
  ]) {
    const job = await prisma.jobCanonical.create({ data: {
      title: `Location QA Engineer ${city}`, company: userId, location, region, workMode,
      workModeConfidence: 1, employmentType: 'FULL_TIME', roleFamily: 'Software Engineering',
      description: 'Synthetic local browser fixture for geographical filtering and search result verification.',
      shortSummary: 'Local browser test', applyUrl: `https://example.test/${randomUUID()}`,
      postedAt: new Date(), status: 'LIVE', lastSourceSeenAt: new Date(), availabilityScore: 100,
    } });
    jobIds.push(job.id);
    const sourceName = `OfficialCompany:${userId}`;
    const raw = await prisma.jobRaw.create({ data: { sourceId: job.id, sourceName, sourceTier: 'TIER_1', rawPayload: {}, fetchedAt: new Date() } });
    rawIds.push(raw.id);
    await prisma.jobSourceMapping.create({ data: {
      canonicalJobId: job.id, rawJobId: raw.id, sourceName, sourceUrl: job.applyUrl,
      isPrimary: true, sourceQualityKind: 'DIRECT_COMPANY', sourceQualityRank: 100, sourceType: 'COMPANY_SITE', sourceReliability: 1,
    } });
    await upsertJobFeedIndex(job.id);
  }
  await page.goto(`${root}/sign-in?callbackUrl=%2Fjobs`, { waitUntil: 'networkidle' });
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(`${root}/jobs`);
  await page.goto(`${root}/jobs?reset=1`, { waitUntil: 'networkidle' });
  const filters = page.getByRole('button', { name: /^Filters/ });
  const dialog = page.getByRole('dialog');
  const scope = page.getByRole('combobox', { name: 'Search type' });
  const locations = page.getByRole('button', { name: /^Locations/ });
  const input = dialog.getByRole('textbox', { name: 'City, province, state or country' });
  const applyLocations = dialog.getByRole('button', { name: 'Apply locations', exact: true });
  const apply = dialog.getByRole('button', { name: 'Apply filters', exact: true });
  const expectLocations = async (expected) => {
    await page.waitForURL((url) => (url.searchParams.get('locationSearch') ?? '') === expected);
    await page.waitForLoadState('networkidle');
  };

  await page.evaluate(() => { window.locationTestMarker = 'client-navigation'; });
  // Keyword and locations form a single search; a place is never a keyword.
  const title = page.getByRole('textbox', { name: 'Search job titles by keyword' });
  await title.fill('engineer');
  assert.equal(await scope.locator('option[value="location"]').count(), 0);
  await locations.click();
  assert.equal(await input.inputValue(), '');
  await input.fill('Toronto');
  await dialog.getByRole('checkbox', { name: 'Toronto, ON Canada', exact: true }).click();
  await input.fill('Seattle');
  await dialog.getByRole('checkbox', { name: 'Seattle, WA United States', exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.has('locationSearch'), false, 'selections wait for Apply');
  await applyLocations.click();
  await expectLocations('Toronto, ON;Seattle, WA');
  await page.getByText('Location QA Engineer Toronto', { exact: true }).first().waitFor();
  await page.getByText('Location QA Engineer Seattle', { exact: true }).first().waitFor();
  assert.equal(await page.getByText('Location QA Engineer Vancouver WA', { exact: true }).count(), 0);
  assert.equal(new URL(page.url()).searchParams.get('titleSearch'), 'engineer');
  assert.equal(await page.evaluate(() => window.locationTestMarker), 'client-navigation');

  await locations.click();
  await input.fill('toronto, ON');
  await input.press('Enter');
  assert.equal(await dialog.getByRole('list', { name: 'Selected locations' }).getByRole('listitem').count(), 2);
  await applyLocations.click();
  await expectLocations('Toronto, ON;Seattle, WA');
  assert.equal(await page.getByRole('link', { name: 'Remove Location: Toronto, ON', exact: true }).count(), 1);
  await locations.click();
  await dialog.getByRole('button', { name: 'Clear locations' }).click();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expectLocations('Toronto, ON;Seattle, WA');
  await title.fill('developer');
  await title.press('Enter');
  await page.waitForURL((url) => url.searchParams.get('titleSearch') === 'developer');
  await expectLocations('Toronto, ON;Seattle, WA');
  assert.equal(await page.evaluate(() => window.locationTestMarker), 'client-navigation');
  await title.fill('engineer');
  await title.press('Enter');
  await page.waitForURL((url) => url.searchParams.get('titleSearch') === 'engineer');

  await filters.click();
  assert.equal(await dialog.getByRole('textbox', { name: /city|location/i }).count(), 0, 'no duplicate location editor');
  assert.equal(await dialog.getByText('0 selected', { exact: true }).count(), 1, 'location is a search, not a hidden dialog refinement');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `no overflow at ${width}px`);
    await page.screenshot({ path: `output/playwright/location-search-${width}.png`, animations: 'disabled' });
    await locations.click();
    await input.fill('British');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `dialog fits at ${width}px`);
    await page.screenshot({ path: `output/playwright/location-picker-${width}.png`, animations: 'disabled' });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  await filters.click();
  await dialog.getByText('Work mode', { exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Remote', exact: true }).check();
  await apply.click();
  await page.waitForURL((url) => url.searchParams.get('workMode') === 'REMOTE');
  await expectLocations('Toronto, ON;Seattle, WA');
  assert.equal(new URL(page.url()).searchParams.get('workMode'), 'REMOTE');
  assert.equal(new URL(page.url()).searchParams.get('titleSearch'), 'engineer');
  await page.getByRole('link', { name: 'Remove Location: Toronto, ON', exact: true }).click();
  await expectLocations('Seattle, WA');
  await page.goBack({ waitUntil: 'networkidle' });
  await expectLocations('Toronto, ON;Seattle, WA');
  await page.goForward({ waitUntil: 'networkidle' });
  await expectLocations('Seattle, WA');
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Remove Location: Seattle, WA', exact: true }).waitFor();
  await locations.click();
  await input.fill('Canada');
  await dialog.getByRole('checkbox', { name: 'Canada Country', exact: true }).check();
  await applyLocations.click();
  await expectLocations('Seattle, WA;Canada');
  await page.getByRole('link', { name: 'Remove Location: Seattle, WA', exact: true }).click();
  await expectLocations('Canada');
  await page.getByRole('link', { name: 'Remove Location: Canada', exact: true }).click();
  await expectLocations('');
  await filters.click();
  await apply.click();
  await expectLocations('');
  assert.equal(new URL(page.url()).searchParams.get('titleSearch'), 'engineer', 'other refinements survive removing the final place');

  // Invalid additions must not silently truncate the applied locations.
  const ten = ['Toronto', 'Seattle', 'Vancouver', 'Ottawa', 'Montreal', 'Boston', 'Austin', 'Calgary', 'Winnipeg', 'Chicago'].join(';');
  await page.goto(`${root}/jobs?searchScope=location&locationSearch=${encodeURIComponent(ten)}`, { waitUntil: 'networkidle' });
  await locations.click();
  await input.fill('Edmonton');
  await input.press('Enter');
  await page.getByRole('alert').filter({ hasText: /up to 10/ }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('locationSearch'), ten);
  await dialog.getByRole('button', { name: 'Remove Chicago', exact: true }).click();
  await input.fill('Edmonton');
  await input.press('Enter');
  await applyLocations.click();
  await expectLocations(ten.replace('Chicago', 'Edmonton'));

  await page.goto(`${root}/jobs?location=Canada&searchScope=location`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Remove Location: Canada', exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get('reset') === '1' && !url.searchParams.has('location'));
  await expectLocations('');
  assert.equal(new URL(page.url()).searchParams.get('reset'), '1', 'legacy/saved filters cannot resurrect a removed location');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.getByRole('link', { name: 'Remove Location: Canada', exact: true }).count(), 0);

  await locations.click();
  await dialog.getByRole('checkbox', { name: 'Canada Country', exact: true }).check();
  await applyLocations.click();
  await expectLocations('Canada');
  await page.getByText('Location QA Engineer Toronto', { exact: true }).first().waitFor();
  await page.getByText('Location QA Engineer Canada remote', { exact: true }).first().waitFor();
  assert.equal(await page.getByText('Location QA Engineer Vancouver WA', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Location QA Engineer Seattle', { exact: true }).count(), 0);

  await page.goto(`${root}/jobs/top-picks?searchScope=location&locationSearch=Canada`, { waitUntil: 'networkidle' });
  await locations.click();
  await input.fill('Seattle');
  await input.press('Enter');
  await applyLocations.click();
  await expectLocations('Canada;Seattle');
  assert.equal(new URL(page.url()).pathname, '/jobs/top-picks');
  await filters.click();
  assert.equal(await dialog.getByRole('textbox', { name: /city|location/i }).count(), 0);
  await dialog.getByText('Work mode', { exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Remote', exact: true }).check();
  await apply.click();
  await page.waitForURL((url) => url.searchParams.get('workMode') === 'REMOTE');
  await expectLocations('Canada;Seattle');
  assert.equal(new URL(page.url()).searchParams.get('workMode'), 'REMOTE');
  await page.getByRole('link', { name: 'Remove Location: Canada', exact: true }).click();
  await expectLocations('Seattle');
  assert.deepEqual(errors, []);
  await scope.selectOption('ai');
  await page.getByRole('button', { name: 'Run AI job search' }).click();
  await page.getByRole('alert').filter({ hasText: 'Type or speak the jobs you want.' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: multi-location picker, keyword combination, client navigation, Apply/Cancel, deduplication, chip removal, filter preservation, reload/history, limits, legacy clearing, desktop/mobile layout, AI validation and Picks');
} catch (error) {
  await page.screenshot({ path: 'output/playwright/location-search-failure.png', fullPage: true });
  throw error;
} finally {
  await page.evaluate(async () => fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).catch(() => {});
  await browser.close();
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.jobCanonical.deleteMany({ where: { id: { in: jobIds } } });
  await prisma.jobRaw.deleteMany({ where: { id: { in: rawIds } } });
  await prisma.$disconnect();
}
