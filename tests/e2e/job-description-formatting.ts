import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";

const root = process.env.TEST_APP_URL ?? "http://127.0.0.1:3003";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(root).hostname));
assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL));
assert.ok(!process.env.DATABASE_URL_DO_PRIVATE);
assert.notEqual(process.env.NODE_ENV, "production");

async function main() {
  const id = `description${randomUUID().replaceAll("-", "")}`;
  const source = readFileSync(new URL("../fixtures/descriptions/career-page-with-navigation.txt", import.meta.url), "utf8");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const job = { title: "Construction Manager, Expert", company: "PG&E", location: "Brentwood, CA, US", region: "US" as const, workMode: "ONSITE" as const, employmentType: "FULL_TIME" as const, roleFamily: "Operations", status: "LIVE" as const, postedAt: new Date(), applyUrl: `https://example.test/jobs/${id}` };
    await prisma.jobCanonical.create({ data: { ...job, id, description: source, shortSummary: "Local description formatting fixture", lastSourceSeenAt: new Date(), availabilityScore: 100 } });
    await prisma.jobFeedIndex.create({ data: { ...job, title: `${id} ${job.title}`, canonicalJobId: id, searchText: `${id} ${job.title}`, rankingScore: 100 } });
    await page.goto(`${root}/sign-in`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('form button[type="submit"]')?.disabled === false);
    await page.getByLabel(/^Email/).fill("admin@applyoverflow.local");
    await page.getByLabel("Password", { exact: true }).fill("password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/jobs(?:\?|$)/, { waitUntil: "domcontentloaded" });
    await page.goto(`${root}/jobs?titleSearch=${id}`, { waitUntil: "domcontentloaded" });
    const description = page.locator("[data-job-description]");
    await description.getByRole("heading", { name: "Position Summary", exact: true }).waitFor();
    assert.doesNotMatch(await description.innerText(), /WORKING HERE|PowerPathway|Create Account/);
    for (const [heading, count] of [["Job Responsibilities", 12], ["Minimum", 2], ["Desired", 7]] as const) {
      const section = description.getByRole("heading", { name: heading, exact: true }).locator("..");
      assert.equal(await section.getByRole("listitem").count(), count);
    }
    assert.equal(await description.locator("dt", { hasText: /^Job Category$/ }).count(), 1);
    await mkdir("output/playwright", { recursive: true });
    await page.screenshot({ path: "output/playwright/description-clean-desktop.png", fullPage: true });
    const pageTop = await page.evaluate(() => window.scrollY);
    await description.getByRole("navigation", { name: "Description sections" }).getByRole("link", { name: "Job Responsibilities", exact: true }).click();
    assert.equal(await page.evaluate(() => window.scrollY), pageTop, "section links scroll the description, not the page");
    assert.equal(await description.getByRole("heading", { name: "Job Responsibilities", exact: true }).evaluate((element) => document.activeElement === element), true);
    await page.screenshot({ path: "output/playwright/description-responsibilities-desktop.png", fullPage: true });
    await page.goto(`${root}/jobs/${id}`, { waitUntil: "domcontentloaded" });
    await description.getByRole("heading", { name: "Desired", exact: true }).waitFor();
    assert.doesNotMatch(await description.innerText(), /WORKING HERE|PowerPathway/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await description.getByRole("heading", { name: "Minimum", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "output/playwright/description-qualifications-mobile.png" });
    assert.deepEqual(errors, []);
    console.log("PASS: actual messy source in feed and full page; 12 responsibilities, 2 minimum and 7 desired qualifications; metadata, keyboard focus, contained section scrolling, mobile overflow and no browser errors");
  } catch (error) {
    await page.screenshot({ path: "output/playwright/description-formatting-failure.png", fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    await prisma.jobCanonical.deleteMany({ where: { id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
