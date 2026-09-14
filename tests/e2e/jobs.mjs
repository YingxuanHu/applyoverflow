import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = process.env.TEST_APP_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(root).hostname)) throw new Error('This fixture test only runs on localhost');

(async () => {
  await mkdir('output/playwright', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  const api = (path, method = 'GET') => page.evaluate(async ({ path, method }) => {
    const response = await fetch(path, { method });
    return { status: response.status, ok: response.ok, body: await response.json() };
  }, { path, method });
  try {
    await page.goto(`${root}/sign-in`, { waitUntil: 'networkidle' });
    await page.getByLabel(/^Email/).fill('admin@applyoverflow.local');
    await page.getByLabel('Password', { exact: true }).fill('password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(`${root}/jobs`);
    await page.getByRole('heading', { level: 1, name: 'Jobs', exact: true }).waitFor();
    await page.waitForLoadState('networkidle');
    const feed = (await api('/api/jobs')).body;
    assert.ok(feed.data.length >= 2, 'seed local jobs before running');
    assert.ok(feed.data.slice(1).every((job) => !job.description), 'only first description in list payload');
    const job = feed.data.find((entry) => !entry.isSaved);
    assert.ok(job, 'needs an unsaved fixture');
    try {
      const saved = await api(`/api/jobs/${job.id}/save`, 'POST');
      assert.equal(saved.status, 201, `save returned ${saved.status}`);
      const afterSave = (await api('/api/jobs')).body;
      assert.equal(afterSave.data.find((entry) => entry.id === job.id).isSaved, true, 'warm feed reflects save');
    } finally {
      const removed = await api(`/api/jobs/${job.id}/save`, 'DELETE');
      assert.ok(removed.ok, `remove returned ${removed.status}`);
    }
    const afterRemove = (await api('/api/jobs')).body;
    assert.equal(afterRemove.data.find((entry) => entry.id === job.id).isSaved, false);
    await page.goto(`${root}/jobs`, { waitUntil: 'networkidle' });
    const list = page.getByRole('region', { name: 'Jobs on this page' });
    const detail = page.locator('aside[aria-label^="Details for"]');
    const rows = list.getByRole('button');
    const selectedTitle = await detail.getByRole('heading', { level: 2 }).innerText();
    assert.ok((await rows.first().innerText()).includes(selectedTitle));
    const detailRequest = page.waitForResponse((response) => /\/api\/jobs\/[^/]+$/.test(response.url()));
    await rows.nth(1).click();
    assert.ok((await detailRequest).ok(), 'lazy description request');
    await page.getByRole('status').filter({ hasText: 'Loading description' }).waitFor({ state: 'hidden' });
    const rememberedTitle = await detail.getByRole('heading', { level: 2 }).innerText();
    const selectionLink = page.url();
    assert.ok(new URL(selectionLink).hash.startsWith('#job-'));
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await detail.getByRole('heading', { level: 2 }).innerText(), rememberedTitle, 'reload restores selection');
    await rows.nth(1).focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await rows.nth(2).getAttribute('aria-current'), 'true', 'arrow keys select adjacent jobs');
    await page.goto(selectionLink, { waitUntil: 'networkidle' });
    assert.equal(await detail.getByRole('heading', { level: 2 }).innerText(), rememberedTitle, 'shared selection link wins');
    const feedbackResult = await page.evaluate(async (jobId) => {
      const endpoint = '/api/jobs/top-picks/feedback';
      const create = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId, feedbackType: 'WRONG_LOCATION' }) });
      const hidden = await (await fetch(endpoint)).json();
      const remove = await fetch(endpoint, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId }) });
      const after = await (await fetch(endpoint)).json();
      return { created: create.ok, hidden: hidden.data.some((row) => row.jobId === jobId), restored: remove.ok, remaining: after.data.some((row) => row.jobId === jobId) };
    }, job.id);
    assert.deepEqual(feedbackResult, { created: true, hidden: true, restored: true, remaining: false });
    const heights = await page.evaluate(() => {
      const left = document.querySelector('section[aria-label="Jobs on this page"]').getBoundingClientRect();
      const right = document.querySelector('aside[aria-label^="Details for"]').getBoundingClientRect();
      return [left.height, right.height];
    });
    assert.ok(Math.abs(heights[0] - heights[1]) < 2, 'equal desktop panels');
    for (const viewport of [{ width: 1440, height: 720 }, { width: 1024, height: 600 }]) {
      await page.setViewportSize(viewport);
      const geometry = await list.evaluate((left) => {
        const right = document.querySelector('aside[aria-label^="Details for"]');
        return [left.getBoundingClientRect().height, right.getBoundingClientRect().height, left.parentElement.getBoundingClientRect().height];
      });
      assert.ok(Math.max(...geometry) - Math.min(...geometry) < 2, `short desktop frames fit their grid: ${geometry}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await page.setViewportSize({ width: 1440, height: 720 });
    await page.screenshot({ path: 'output/playwright/jobs-regression-short-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const clippedDetailValues = await detail.locator('p').evaluateAll((elements) => elements
      .filter((element) => getComputedStyle(element).textOverflow === 'ellipsis' && element.scrollWidth > element.clientWidth)
      .map((element) => element.textContent));
    assert.deepEqual(clippedDetailValues, [], 'critical detail values must remain readable');
    await page.screenshot({ path: 'output/playwright/jobs-regression-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await rows.nth(2).click();
    await page.waitForFunction(() => {
      const r = document.querySelector('aside[aria-label^="Details for"]').getBoundingClientRect();
      return r.top >= 0 && r.top < innerHeight / 2;
    });
    await page.screenshot({ path: 'output/playwright/jobs-regression-mobile.png', fullPage: true });
    await detail.getByRole('button', { name: 'Back to jobs' }).click();
    assert.equal(await rows.nth(2).evaluate((element) => document.activeElement === element), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${root}/jobs`, { waitUntil: 'networkidle' });
    const scope = page.locator('#jobs-search-scope');
    const searchInput = page.locator('form input[placeholder^="Describe"], form input[placeholder^="Search job"]');
    // Deliberately ignore AbortSignal in this fixture to prove stale responses
    // cannot navigate even when cancellation arrives after the server finishes.
    const holdAi = async () => page.evaluate(() => {
      const original = window.fetch;
      window.fetch = (...args) => String(args[0]).includes('/api/jobs/natural-language-search')
        ? new Promise((resolve) => { window.__releaseAi = (payload) => { resolve(Response.json(payload)); window.fetch = original; }; })
        : original(...args);
    });
    const startAi = async () => {
      await scope.selectOption('ai');
      await searchInput.fill('software jobs in Toronto');
      await holdAi();
      await page.getByRole('button', { name: 'Run AI job search' }).click();
      await page.waitForFunction(() => typeof window.__releaseAi === 'function');
    };
    const releaseAi = async () => page.evaluate(() => {
      window.__releaseAi({ params: { titleSearch: 'software', searchScope: 'title' }, confidence: 'high', exclusions: [], hardFilters: [], softPreferences: [], warnings: [], href: '/jobs?titleSearch=software', originalText: 'software jobs in Toronto' });
      delete window.__releaseAi;
    });
    await startAi();
    await searchInput.fill('accountant');
    await releaseAi();
    await page.waitForTimeout(200);
    assert.equal(await searchInput.inputValue(), 'accountant', 'late AI response preserves newer draft');
    assert.equal(new URL(page.url()).search, '', 'editing cancels AI navigation');
    await startAi();
    await scope.selectOption('title');
    await searchInput.fill('designer');
    await releaseAi();
    await page.waitForTimeout(200);
    assert.equal(await searchInput.inputValue(), 'designer');
    assert.equal(new URL(page.url()).search, '', 'mode change cancels AI navigation');
    await startAi();
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    await releaseAi();
    await page.waitForTimeout(200);
    assert.equal(await searchInput.inputValue(), '');
    assert.equal(new URL(page.url()).search, '', 'clear cancels AI navigation');
    await startAi();
    await releaseAi();
    await page.waitForURL((url) => url.searchParams.get('titleSearch') === 'software');
    await page.goto(`${root}/documents/resume-builder`, { waitUntil: 'networkidle' });
    assert.equal(await page.getByRole('main').count(), 1);
    await page.goto(`${root}/jobs/top-picks`, { waitUntil: 'networkidle' });
    assert.ok(!(await page.locator('body').innerText()).includes('Application error'));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: ['sign in', 'minimal feed payload', 'cached save/remove', 'default selection', 'lazy description', 'desktop and short-desktop geometry', 'mobile selection/back', 'AI edit/mode/clear races', 'AI successful navigation', 'resume landmark', 'Picks navigation'], desktopPanelHeights: heights }));
  } finally {
    try {
      const signedOut = await page.evaluate(async () => (await fetch('/api/auth/sign-out', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })).status);
      assert.equal(signedOut, 200, 'test session revoked');
    } finally {
      await browser.close();
    }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
