import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { hashPassword } from 'better-auth/crypto';
const require = createRequire(import.meta.url);
const { prisma } = require('../../src/lib/db.ts');
const { isLocalDevelopmentDatabaseUrl } = require('../../src/lib/local-development-auth.ts');

const root = process.env.TEST_APP_URL || 'http://localhost:3004';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(root).hostname), 'local test only');
assert.notEqual(process.env.NODE_ENV, 'production');
assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), 'local database required');
assert.ok(!process.env.DATABASE_URL_DO_PRIVATE, 'no remote override');
const userId = `location-ui-${randomUUID()}`;
const email = `${userId}@example.test`;
const password = randomUUID();
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
  await page.goto(`${root}/sign-in?callbackUrl=%2Fjobs`, { waitUntil: 'networkidle' });
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(`${root}/jobs`);
  await page.goto(`${root}/jobs?reset=1`, { waitUntil: 'networkidle' });
  const filters = page.getByRole('button', { name: /^Filters/ });
  const dialog = page.getByRole('dialog');
  const scope = page.getByRole('combobox', { name: 'Search type' });
  const input = page.getByRole('textbox', { name: /^(Search|Add) a city, province, state or country$/ });
  const apply = dialog.getByRole('button', { name: 'Apply filters', exact: true });
  const expectLocations = async (expected) => {
    await page.waitForURL((url) => (url.searchParams.get('locationSearch') ?? '') === expected);
    await page.waitForLoadState('networkidle');
  };

  // Search scopes must never carry a title into the geographic query.
  const title = page.getByRole('textbox', { name: 'Search job titles by keyword' });
  await title.fill('engineer');
  await scope.selectOption('location');
  assert.equal(await input.inputValue(), '');
  await input.fill('Toronto, ON');
  await scope.selectOption('title');
  assert.equal(await title.inputValue(), 'engineer');
  await scope.selectOption('location');
  assert.equal(await input.inputValue(), 'Toronto, ON');
  await input.press('Enter');
  await expectLocations('Toronto, ON');
  assert.equal(await input.inputValue(), '', 'applied locations are chips, not an editable semicolon list');
  assert.equal(new URL(page.url()).searchParams.has('titleSearch'), false, 'unsubmitted title is not applied implicitly');

  await scope.selectOption('title');
  await title.fill('engineer');
  await title.press('Enter');
  await expectLocations('Toronto, ON');
  assert.equal(new URL(page.url()).searchParams.get('titleSearch'), 'engineer');
  await scope.selectOption('location');
  assert.equal(await input.inputValue(), '');
  await input.fill('Seattle, WA');
  await input.press('Enter');
  await expectLocations('Toronto, ON;Seattle, WA');
  assert.equal(new URL(page.url()).searchParams.get('titleSearch'), 'engineer');
  await input.fill('toronto, ON');
  await input.press('Enter');
  await expectLocations('Toronto, ON;Seattle, WA');
  assert.equal(await page.getByRole('link', { name: 'Remove Location: Toronto, ON', exact: true }).count(), 1);

  await filters.click();
  assert.equal(await dialog.getByRole('textbox', { name: /city|location/i }).count(), 0, 'no duplicate location editor');
  assert.equal(await dialog.getByText('0 selected', { exact: true }).count(), 1, 'location is a search, not a hidden dialog refinement');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `no overflow at ${width}px`);
    await page.screenshot({ path: `output/playwright/location-search-${width}.png`, animations: 'disabled' });
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
  await scope.selectOption('location');
  await input.fill('Canada');
  await input.press('Enter');
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
  await input.fill('Edmonton');
  await input.press('Enter');
  await page.getByRole('alert').filter({ hasText: /up to 10/ }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('locationSearch'), ten);
  await page.getByRole('link', { name: 'Remove Location: Chicago', exact: true }).click();
  await expectLocations(ten.replace(';Chicago', ''));
  await input.fill('Edmonton');
  await input.press('Enter');
  await expectLocations(ten.replace('Chicago', 'Edmonton'));

  await page.goto(`${root}/jobs?location=Canada&searchScope=location`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Remove Location: Canada', exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get('reset') === '1' && !url.searchParams.has('location'));
  await expectLocations('');
  assert.equal(new URL(page.url()).searchParams.get('reset'), '1', 'legacy/saved filters cannot resurrect a removed location');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.getByRole('link', { name: 'Remove Location: Canada', exact: true }).count(), 0);

  await page.goto(`${root}/jobs/top-picks?searchScope=location&locationSearch=Canada`, { waitUntil: 'networkidle' });
  await input.fill('Seattle');
  await input.press('Enter');
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
  console.log('PASS: single location search, isolated scope drafts, OR additions, deduplication, chip removal, filter preservation, reload/history, limits, legacy clearing, mobile layout and Picks');
} catch (error) {
  await page.screenshot({ path: 'output/playwright/location-search-failure.png', fullPage: true });
  throw error;
} finally {
  await page.evaluate(async () => fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).catch(() => {});
  await browser.close();
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
}
