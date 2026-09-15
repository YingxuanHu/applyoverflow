import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";

const root = process.env.TEST_APP_URL ?? "http://127.0.0.1:3001";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(root).hostname));
assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL));
assert.ok(!process.env.DATABASE_URL_DO_PRIVATE);
assert.notEqual(process.env.NODE_ENV, "production");

async function main() {
  const token = `decision${randomUUID().replaceAll("-", "")}`;
  const ids = [0, 1, 2].map((number) => `${token}-${number}`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mkdir("output/playwright", { recursive: true });
  try {
    for (const [index, id] of ids.entries()) {
      const data = { id, title: `${token} Software Engineer ${index}`, company: index === 0 ? "Stripe" : "GitHub", location: "Toronto, Ontario, Canada", region: "CA" as const, workMode: "REMOTE" as const, employmentType: "FULL_TIME" as const, roleFamily: "Engineering", applyUrl: `https://example.test/jobs/${id}`, postedAt: new Date(), status: "LIVE" as const };
      await prisma.jobCanonical.create({ data: { ...data, description: "Build reliable applications. Responsibilities include designing services, writing automated tests and reviewing code.", shortSummary: "Fixture posting", lastSourceSeenAt: new Date(), availabilityScore: 100, locationStatus: "confident", locationConfidence: 0.9, workModeStatus: "confident", workModeConfidence: 0.9, salaryStatus: "confident", salaryConfidence: index ? 0.1 : 0.9, salaryMin: 100000, salaryMax: 120000, salaryCurrency: "CAD", salaryPeriod: "year" } });
      const { id: canonicalJobId, ...rest } = data;
      await prisma.jobFeedIndex.create({ data: { canonicalJobId, ...rest, searchText: data.title, rankingScore: 100 - index } });
    }
    await prisma.userProfile.create({ data: { id: token, name: "Private fixture", email: `${token}@example.test`, savedJobs: { create: { canonicalJobId: ids[2] } } } });
    assert.equal((await context.request.post(`${root}/api/jobs/${ids[0]}/report`, { data: { category: "SALARY", details: "Fixture invalid currency" } })).status(), 401);
    await page.goto(`${root}/sign-in`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('form button[type="submit"]')?.disabled === false);
    await page.getByLabel(/^Email/).fill("admin@applyoverflow.local");
    await page.getByLabel("Password", { exact: true }).fill("password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/jobs(?:\?|$)/, { waitUntil: "domcontentloaded" });
    for (const id of ids.slice(0, 2)) {
      const saved = await page.evaluate(async (id) => {
        const response = await fetch(`/api/jobs/${id}/save`, { method: "POST", signal: AbortSignal.timeout(20_000) });
        return { status: response.status, body: await response.json() };
      }, id);
      assert.ok(saved.status === 200 || saved.status === 201, JSON.stringify(saved));
    }
    await page.goto(`${root}/jobs?titleSearch=${token}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Report incorrect details" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Issue", { exact: true }).selectOption("SALARY");
    await dialog.getByLabel("What looks incorrect?").fill("Fixture report: the salary currency differs from the posting.");
    await dialog.getByRole("button", { name: "Submit report" }).click();
    await dialog.getByText("Report received for review.").waitFor();
    assert.equal(await prisma.jobDataReport.count({ where: { canonicalJobId: ids[0] } }), 1);
    const responses = await page.evaluate((id) => Promise.all([
      { details: "Another copy of this issue", type: "application/json" },
      { details: "x".repeat(501), type: "application/json" },
      { details: "Invalid form origin", type: "text/plain" },
    ].map(async ({ details, type }) => {
      const response = await fetch(`/api/jobs/${id}/report`, { method: "POST", headers: { "Content-Type": type }, body: JSON.stringify({ category: "SALARY", details }), signal: AbortSignal.timeout(20_000) });
      return response.status;
    })), ids[0]);
    assert.deepEqual(responses, [200, 400, 415]);
    assert.equal(await prisma.jobDataReport.count({ where: { canonicalJobId: ids[0] } }), 1, "reports are deduplicated");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    if (process.env.TEST_OPS_ENABLED === "1") {
      await page.goto(`${root}/ops/job-reports`, { waitUntil: "domcontentloaded" });
      const report = page.getByRole("article").filter({ hasText: "Fixture report: the salary currency differs from the posting." });
      await report.getByRole("button", { name: "Resolve", exact: true }).click();
      assert.equal((await prisma.jobDataReport.findFirstOrThrow({ where: { canonicalJobId: ids[0] } })).status, "OPEN", "unverified reports cannot be resolved");
      await report.getByRole("checkbox").check();
      await report.getByRole("button", { name: "Resolve", exact: true }).click();
      await report.waitFor({ state: "detached" });
      assert.equal((await prisma.jobDataReport.findFirstOrThrow({ where: { canonicalJobId: ids[0] } })).status, "RESOLVED");
      const repeated = await page.evaluate(async (id) => {
        const response = await fetch(`/api/jobs/${id}/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category: "SALARY", details: "Repeating a resolved issue" }) });
        return response.json();
      }, ids[0]);
      assert.equal(repeated.status, "RESOLVED", "repeat reports do not reopen a moderator decision");
    }
    const compareUrl = `${root}/applications/compare?job=${ids[0]}&job=${ids[1]}`;
    await page.goto(compareUrl, { waitUntil: "domcontentloaded" });
    await page.getByRole("table").waitFor();
    assert.equal(await page.getByRole("columnheader").count(), 3);
    assert.ok(await page.getByText("Not confirmed by source", { exact: true }).count() > 0);
    await page.screenshot({ path: "output/playwright/job-comparison-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const region = page.getByRole("region", { name: "Job comparison", exact: true });
    assert.equal(await region.evaluate((element) => element.scrollWidth > element.clientWidth), true, "comparison scroll stays inside the table on mobile");
    await page.screenshot({ path: "output/playwright/job-comparison-mobile.png", fullPage: true });
    const label = page.getByRole("rowheader", { name: "Salary", exact: true });
    const beforeScroll = await label.boundingBox();
    await region.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    const afterScroll = await label.boundingBox();
    assert.ok(beforeScroll && afterScroll && Math.abs(beforeScroll.x - afterScroll.x) < 1, "fact labels remain visible while comparing later columns");
    await page.goto(`${root}/applications/compare?job=${ids[0]}&job=${ids[2]}`);
    await page.getByText("Some selected jobs are no longer in your wishlist.").waitFor();
    assert.equal(await page.getByRole("table").count(), 0, "a different user's wishlist is not exposed");
    assert.equal(await page.getByRole("option", { name: new RegExp(`${token} Software Engineer 2`) }).count(), 0);
    assert.deepEqual(errors, []);
    console.log("PASS: report dialog/API validation/deduplication, comparison, explicit unknowns, private wishlist isolation, desktop/mobile layout");
  } catch (error) {
    console.error("Browser errors:", errors);
    await page.screenshot({ path: "output/playwright/job-decision-tools-failure.png", fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await page.evaluate(async () => fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10_000) })).catch(() => {});
    await context.close();
    await browser.close();
    await prisma.trackedApplication.deleteMany({ where: { canonicalJobId: { in: ids } } });
    await prisma.userProfile.deleteMany({ where: { id: token } });
    await prisma.jobCanonical.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
