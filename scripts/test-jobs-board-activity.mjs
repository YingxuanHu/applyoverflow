import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { chromium } from "playwright";
const require = createRequire(import.meta.url);
const { prisma } = require("../src/lib/db.ts");
const { isLocalDevelopmentDatabaseUrl } = require("../src/lib/local-development-auth.ts");

const origin = process.env.TEST_APP_URL ?? "http://127.0.0.1:3004";
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL));
assert.ok(!process.env.DATABASE_URL_DO_PRIVATE);
assert.notEqual(process.env.NODE_ENV, "production");
const token = `activitytest${randomUUID().replaceAll("-", "")}`;
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(60_000);
page.setDefaultNavigationTimeout(120_000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  const now = new Date();
  const rows = Array.from({ length: 70 }, (_, index) => ({
    id: `${token}-${index}`, title: `${token} Software Engineer`, company: `Activity Fixture ${index}`,
    location: "Toronto, Ontario, Canada", region: "CA", status: "LIVE", workMode: "REMOTE",
    employmentType: "FULL_TIME", roleFamily: "Software Engineering", postedAt: now,
    applyUrl: `https://example.test/${token}/${index}`,
  }));
  await prisma.jobCanonical.createMany({ data: rows.map(row => ({
    ...row, lastSourceSeenAt: now, availabilityScore: 100,
    shortSummary: "Local board activity fixture",
    description: "Build reliable software services. Review code, write tests and maintain APIs.",
  })) });
  await prisma.jobFeedIndex.createMany({ data: rows.map(({ id, ...row }, index) => ({
    ...row, canonicalJobId: id, searchText: row.title, rankingScore: index,
  })) });
  await page.goto(`${origin}/sign-in?callbackUrl=%2Fjobs`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: /^Email/ }).fill("admin");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/jobs(?:\?|$)/, { timeout: 120_000, waitUntil: "domcontentloaded" });
  await page.goto(`${origin}/jobs?titleSearch=${token}`, { waitUntil: "domcontentloaded" });
  await page.getByText("70 matches", { exact: true }).waitFor();
  const activity = page.getByRole("region", { name: "Board activity", exact: true });
  await activity.waitFor();
  const search = page.getByRole("region", { name: "Job search", exact: true });
  const top = page.getByRole("navigation", { name: "Jobs top pagination" });
  assert.equal(await top.evaluate(el => getComputedStyle(el).borderTopWidth), "0px");
  assert.equal(await search.evaluate(el => getComputedStyle(el).borderBottomWidth), "1px");
  assert.equal(await activity.locator("dt").allTextContents().then(labels => labels.join(",")), "New today,Closed today");
  assert.equal(await activity.locator("details, summary").count(), 0);
  assert.equal(await activity.getByText(/Source details|active connectors/).count(), 0);
  const requests = [];
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url()); });
  await mkdir("output/playwright", { recursive: true });
  for (const [name, width, height, dark] of [
    ["desktop", 1440, 1000, false], ["desktop-dark", 1440, 1000, true],
    ["mobile", 390, 844, false], ["small-mobile-dark", 320, 844, true],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), dark);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name);
    const numbers = await activity.locator("dd").evaluateAll(elements => elements.map(el => ({
      size: parseFloat(getComputedStyle(el).fontSize), color: getComputedStyle(el).color, overflows: el.scrollWidth > el.clientWidth + 1,
    })));
    assert.ok(numbers.every(number => number.size >= 18 && !number.overflows), name);
    assert.equal(numbers[0].color, numbers[1].color, `${name} neutral activity counts`);
    const savedSearches = page.getByText("Saved searches", { exact: true });
    await savedSearches.focus();
    await savedSearches.press("Enter");
    await page.getByRole("textbox", { name: "Saved search name" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} saved search`);
    await savedSearches.press("Enter");
    await page.screenshot({ path: `output/playwright/jobs-activity-${name}.png`, animations: "disabled" });
  }
  assert.ok(requests.every(url => !url.includes("/api/jobs/count")), "Disclosure must not recalculate job totals");
  assert.deepEqual(errors, []);
  console.log("PASS: real authenticated board, neutral daily metrics, no source details, single separator, keyboard saved search expansion, 1440/390/320px light/dark and no horizontal overflow");
} catch (error) {
  await page.screenshot({ path: "output/playwright/jobs-activity-failure.png" }).catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
  await prisma.jobCanonical.deleteMany({ where: { id: { startsWith: `${token}-` } } });
  await prisma.$disconnect();
}
