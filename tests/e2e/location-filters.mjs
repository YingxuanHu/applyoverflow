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
  const input = dialog.getByRole('textbox', { name: 'City, province, state or country', exact: true });
  const selected = dialog.getByRole('list', { name: 'Selected locations' });
  const apply = dialog.getByRole('button', { name: 'Apply filters', exact: true });
  const expectLocations = async (expected) => {
    await page.waitForURL((url) => (url.searchParams.get('locationSearch') ?? '') === expected);
    await page.waitForLoadState('networkidle');
  };

  await filters.click();
  await input.fill('Toronto, ON');
  await input.press('Enter');
  await input.fill('Seattle, WA');
  await dialog.getByRole('button', { name: 'Add location', exact: true }).click();
  await input.fill('toronto, ON');
  await input.press('Enter');
  assert.deepEqual(await selected.getByRole('listitem').allTextContents(), ['Toronto, ON', 'Seattle, WA']);
  assert.equal(await dialog.isVisible(), true, 'Enter adds, it does not submit');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await input.scrollIntoViewIfNeeded();
    const clipped = await dialog.evaluate((element) => [...element.querySelectorAll('input,button,li,label')].filter((child) => {
      const rect = child.getBoundingClientRect();
      return rect.width > 0 && (rect.left < 0 || rect.right > innerWidth + 1);
    }).map((child) => child.textContent));
    assert.deepEqual(clipped, [], `controls fit at ${width}px`);
    await page.screenshot({ path: `output/playwright/location-filter-${width}.png`, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await apply.click();
  await expectLocations('Toronto, ON;Seattle, WA');
  assert.equal(await page.getByRole('combobox', { name: 'Search type' }).inputValue(), 'title');
  assert.equal(await page.getByRole('textbox', { name: 'Search job titles by keyword' }).inputValue(), '');

  await page.reload({ waitUntil: 'networkidle' });
  await filters.click();
  assert.equal(await selected.getByRole('listitem').count(), 2, 'reload restores chips');
  await dialog.getByRole('button', { name: 'Remove Toronto, ON', exact: true }).click();
  await input.fill('Canada');
  await apply.click();
  await expectLocations('Seattle, WA;Canada');
  await filters.click();
  await dialog.getByRole('button', { name: 'Clear locations', exact: true }).click();
  await input.fill('Ottawa');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await filters.click();
  assert.deepEqual(await selected.getByRole('listitem').allTextContents(), ['Seattle, WA', 'Canada'], 'cancel discards draft changes');
  assert.equal(await input.inputValue(), '');

  await dialog.getByRole('button', { name: 'Clear locations', exact: true }).click();
  await input.fill('Canada');
  await input.press('Enter');
  await input.fill('United States');
  await input.press('Enter');
  await apply.click();
  await expectLocations('Canada;United States');
  await page.goBack({ waitUntil: 'networkidle' });
  await expectLocations('Seattle, WA;Canada');
  await page.goForward({ waitUntil: 'networkidle' });
  await expectLocations('Canada;United States');

  await filters.click();
  await dialog.getByRole('button', { name: 'Clear locations', exact: true }).click();
  for (const place of ['Toronto', 'Seattle', 'Vancouver', 'Ottawa', 'Montreal', 'Boston', 'Austin', 'Calgary', 'Winnipeg', 'Chicago']) {
    await input.fill(place);
    await input.press('Enter');
  }
  await input.fill('Edmonton');
  await apply.click();
  assert.equal(await dialog.isVisible(), true, 'overflow cannot silently drop a location');
  assert.match(await input.evaluate((element) => element.validationMessage), /up to 10/);
  await dialog.getByRole('button', { name: 'Remove Chicago', exact: true }).click();
  await apply.click();
  await expectLocations('Toronto;Seattle;Vancouver;Ottawa;Montreal;Boston;Austin;Calgary;Winnipeg;Edmonton');
  await filters.click();
  await dialog.getByRole('button', { name: 'Clear locations', exact: true }).click();
  await apply.click();
  await expectLocations('');

  await page.goto(`${root}/jobs/top-picks?locationSearch=Canada`, { waitUntil: 'networkidle' });
  await filters.click();
  await dialog.getByRole('button', { name: 'Remove Canada', exact: true }).waitFor();
  await input.fill('Seattle');
  await input.press('Enter');
  await apply.click();
  await expectLocations('Canada;Seattle');
  assert.equal(new URL(page.url()).pathname, '/jobs/top-picks');
  await filters.click();
  await dialog.getByRole('button', { name: 'Remove Canada', exact: true }).click();
  await apply.click();
  await expectLocations('Seattle');
  assert.deepEqual(errors, []);
  console.log('PASS: multi-location add/remove/deduplication, pending input, cancel, reload, history, limits, clearing, keyword separation, mobile layout and Picks');
} finally {
  await page.evaluate(async () => fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).catch(() => {});
  await browser.close();
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
}
