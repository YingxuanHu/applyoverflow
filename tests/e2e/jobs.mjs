import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = process.env.TEST_APP_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(root).hostname)) throw new Error('This fixture test only runs on localhost');

(async () => {
  await mkdir('output/playwright', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'Pacific/Honolulu' });
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  const api = (path, method = 'GET') => page.evaluate(async ({ path, method }) => {
    const response = await fetch(path, { method });
    return { status: response.status, ok: response.ok, body: await response.json() };
  }, { path, method });
  try {
    const unhydrated = await browser.newContext({ javaScriptEnabled: false });
    try {
      const screen = await unhydrated.newPage();
      const posts = [];
      await screen.route('**/*', (route) => {
        if (route.request().method() === 'POST') {
          posts.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      await screen.goto(`${root}/sign-in`, { waitUntil: 'networkidle' });
      assert.equal(await screen.getByRole('button', { name: 'Sign in', exact: true }).isDisabled(), true);
      await screen.getByLabel(/^Email/).fill('hydration-test@example.test');
      await screen.getByLabel('Password', { exact: true }).fill('not-a-real-password');
      await screen.getByLabel('Password', { exact: true }).press('Enter');
      assert.deepEqual(posts, [], 'credentials cannot POST to the page before hydration');
    } finally {
      await unhydrated.close();
    }
    await page.goto(`${root}/sign-in?callbackUrl=%2Fapplications`, { waitUntil: 'networkidle' });
    await page.getByLabel(/^Email/).fill('admin@applyoverflow.local');
    await page.getByLabel('Password', { exact: true }).fill('password');
    const signInDestinations = [];
    const recordSignInDestination = (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        const path = new URL(request.url()).pathname;
        if (path !== '/sign-in') signInDestinations.push(path);
      }
    };
    page.on('request', recordSignInDestination);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(`${root}/applications`);
    await page.getByRole('heading', { level: 1, name: 'Applications', exact: true }).waitFor();
    await page.waitForLoadState('networkidle');
    page.off('request', recordSignInDestination);
    assert.deepEqual(signInDestinations, ['/applications'], 'auth performs one navigation to the requested destination');
    await page.goto(`${root}/sign-in?callbackUrl=%2Fapplications`, { waitUntil: 'networkidle' });
    assert.equal(new URL(page.url()).pathname, '/applications', 'existing session retains the sign-in destination');
    await page.goto(`${root}/sign-in?callbackUrl=${encodeURIComponent('//example.test')}`, { waitUntil: 'networkidle' });
    assert.equal(page.url(), `${root}/jobs`, 'external callbacks are rejected');
    await page.goto(`${root}/settings`, { waitUntil: 'networkidle' });
    const sessionTime = page.locator('#security time:visible').first();
    await sessionTime.waitFor();
    const instant = await sessionTime.getAttribute('datetime');
    const expectedTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Pacific/Honolulu' }).format(new Date(instant));
    assert.equal(await sessionTime.innerText(), expectedTime, 'timestamps use the viewer timezone after hydration');
    assert.deepEqual(errors, [], 'security settings hydrate without replacing the page');
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${root}/documents`, { waitUntil: 'networkidle' });
      const clipping = await page.locator('header.page-header').evaluate((header) => Array.from(header.querySelectorAll('*')).filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && (rect.right > innerWidth + 1 || rect.left < -1);
      }).map((el) => el.textContent));
      assert.deepEqual(clipping, [], `documents header fits ${width}px viewport`);
    }
    await page.screenshot({ path: 'output/playwright/documents-header-regression.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${root}/jobs`, { waitUntil: 'networkidle' });
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
    await page.goto(`${root}/jobs?reset=1`, { waitUntil: 'networkidle' });
    const filtersButton = page.getByRole('button', { name: /^Filters/ });
    assert.equal((await filtersButton.innerText()).trim(), 'Filters', 'no phantom default filter');
    await filtersButton.click();
    const filterDialog = page.getByRole('dialog', { name: 'Refine jobs' });
    await filterDialog.getByLabel('Location', { exact: true }).fill('Toronto, ON');
    await filterDialog.getByText('Work mode', { exact: true }).click();
    await filterDialog.getByRole('checkbox', { name: 'Remote', exact: true }).check();
    await filterDialog.getByRole('checkbox', { name: 'Hybrid', exact: true }).check();
    await filterDialog.getByText('2 selected', { exact: true }).waitFor();
    await filterDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(new URL(page.url()).searchParams.has('workMode'), false, 'cancel does not apply draft');
    await filtersButton.click();
    assert.equal(await filterDialog.getByLabel('Location', { exact: true }).inputValue(), '', 'reopen discards draft');
    await page.keyboard.press('Escape');
    await filterDialog.waitFor({ state: 'hidden' });
    assert.equal(await filtersButton.evaluate((el) => el === document.activeElement), true, 'Escape returns focus');
    await page.goto(`${root}/jobs?titleSearch=Engineer&locationSearch=Toronto&page=1&sortBy=newest`, { waitUntil: 'networkidle' });
    await filtersButton.click();
    await filterDialog.getByLabel('Location', { exact: true }).fill('Seattle, WA');
    await filterDialog.getByText('Work mode', { exact: true }).click();
    await filterDialog.getByRole('checkbox', { name: 'Remote', exact: true }).check();
    await filterDialog.getByRole('checkbox', { name: 'Hybrid', exact: true }).check();
    await filterDialog.getByText('Posted', { exact: true }).click();
    await filterDialog.getByRole('radio', { name: 'Past week', exact: true }).check();
    await filterDialog.getByRole('radio', { name: 'Past 24 hours', exact: true }).check();
    assert.equal(await filterDialog.getByRole('radio', { checked: true }).count(), 1, 'date is single select');
    await filterDialog.getByText('Job function', { exact: true }).click();
    const optionSearch = filterDialog.getByLabel('Find job function options');
    await optionSearch.fill('zzzz-no-option');
    await filterDialog.getByRole('status').filter({ hasText: 'No matching options' }).waitFor();
    await optionSearch.fill('Software');
    await filterDialog.getByRole('checkbox', { name: 'Software Engineering', exact: true }).check();
    await optionSearch.fill('Legal');
    await filterDialog.getByLabel('Minimum annual salary').fill('100000');
    await filterDialog.getByLabel('Maximum annual salary').fill('50000');
    await filterDialog.getByRole('button', { name: 'Apply filters', exact: true }).click();
    assert.equal(await filterDialog.isVisible(), true, 'invalid salary cannot apply');
    assert.match(await filterDialog.getByLabel('Maximum annual salary').evaluate((el) => el.validationMessage), /at least/);
    await filterDialog.getByLabel('Maximum annual salary').fill('150000');
    await filterDialog.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await page.waitForURL((url) => url.searchParams.get('locationSearch') === 'Seattle, WA');
    const appliedFilters = new URL(page.url()).searchParams;
    assert.equal(appliedFilters.get('titleSearch'), 'Engineer', 'filter edit preserves keyword');
    assert.equal(appliedFilters.get('sortBy'), 'newest', 'filter edit preserves sort');
    assert.equal(appliedFilters.get('page'), null, 'filter edit resets pagination');
    assert.equal(appliedFilters.get('posted'), '1d');
    assert.equal(appliedFilters.get('workMode'), 'REMOTE,HYBRID', 'repeated controls retain both values');
    assert.equal(appliedFilters.get('jobFunction'), 'SOFTWARE_ENGINEERING', 'option search does not discard a selected hidden option');
    assert.equal(appliedFilters.getAll('locationSearch').length, 1, 'old location is replaced, never silently ORed');
    await page.getByRole('button', { name: /^Filters\s*5$/ }).waitFor();
    await page.goBack({ waitUntil: 'networkidle' });
    await page.waitForURL((url) => url.searchParams.get('locationSearch') === 'Toronto');
    await page.getByRole('button', { name: /^Filters\s*1$/ }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('locationSearch'), 'Toronto', 'Back restores the previous committed location');
    await page.goForward({ waitUntil: 'networkidle' });
    await page.waitForURL((url) => url.searchParams.get('locationSearch') === 'Seattle, WA');
    assert.equal(new URL(page.url()).searchParams.get('locationSearch'), 'Seattle, WA', 'Forward restores the edited filters');
    await page.reload({ waitUntil: 'networkidle' });
    await filtersButton.click();
    assert.equal(await filterDialog.getByLabel('Location', { exact: true }).inputValue(), 'Seattle, WA', 'reload restores committed filters');
    await page.setViewportSize({ width: 390, height: 844 });
    const dialogRect = await filterDialog.boundingBox();
    assert.ok(dialogRect.x >= 0 && dialogRect.x + dialogRect.width <= 391 && dialogRect.y >= 0 && dialogRect.y + dialogRect.height <= 845, 'mobile dialog fits viewport');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: 'output/playwright/search-filters-mobile.png', animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: 'output/playwright/search-filters-dialog-desktop.png', animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.goto(`${root}/jobs?reset=1`, { waitUntil: 'networkidle' });
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
    console.log(JSON.stringify({ passed: ['sign in', 'minimal feed payload', 'cached save/remove', 'default selection', 'lazy description', 'desktop and short-desktop geometry', 'mobile selection/back', 'filter draft cancel/reopen', 'Escape focus restoration', 'salary range validation', 'multi-select round trip', 'single posted window', 'location replacement', 'preserve keyword and sort', 'reset pagination', 'mobile filter dialog', 'AI edit/mode/clear races', 'AI successful navigation', 'resume landmark', 'Picks navigation'], desktopPanelHeights: heights }));
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
