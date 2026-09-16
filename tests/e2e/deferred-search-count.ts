import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium, type Route } from "playwright";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";

const root = process.env.TEST_APP_URL ?? "http://127.0.0.1:3001";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(root).hostname));
assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL));
assert.ok(!process.env.DATABASE_URL_DO_PRIVATE);
assert.notEqual(process.env.NODE_ENV, "production");

async function main() {
  const token = `counttest${randomUUID().replaceAll("-", "")}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const now = new Date();
    const rows = Array.from({ length: 70 }, (_, index) => ({
      id: `${token}-${index}`, title: `${token} Software Engineer`, company: `Count Fixture Labs ${index}`,
      location: "Toronto, Ontario, Canada", region: "CA" as const,
      status: "LIVE" as const, workMode: "REMOTE" as const,
      employmentType: "FULL_TIME" as const, roleFamily: "Software Engineering",
      applyUrl: `https://example.test/${token}/${index}`, postedAt: now,
    }));
    await prisma.jobCanonical.createMany({ data: rows.map((row) => ({
      ...row, lastSourceSeenAt: now, availabilityScore: 100,
      shortSummary: "Local search count fixture",
      description: "Build reliable backend services. Responsibilities include writing tests, reviewing code, and maintaining APIs.",
    })) });
    await prisma.jobFeedIndex.createMany({ data: rows.map(({ id, ...row }, index) => ({
      ...row, canonicalJobId: id, searchText: row.title, rankingScore: index,
    })) });

    const anonymous = await context.request.get(`${root}/api/jobs/count?titleSearch=${token}`);
    assert.equal(anonymous.status(), 401);
    await page.goto(`${root}/sign-in`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/^Email/).fill("admin@applyoverflow.local");
    await page.getByLabel("Password", { exact: true }).fill("password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/jobs(?:\?|$)/);

    const held: Route[] = [];
    let onHeld: (() => void) | undefined;
    const waitForHeld = () => held.length ? Promise.resolve() : new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Count request did not start")), 20_000);
      onHeld = () => { clearTimeout(timer); resolve(); };
    });
    let mode: "hold" | "fail" | "success" = "hold";
    await page.route("**/api/jobs/count?*", async (route) => {
      if (mode === "hold") { held.push(route); onHeld?.(); onHeld = undefined; return; }
      await route.fulfill({ status: mode === "fail" ? 503 : 200, json: mode === "fail" ? { error: "Busy" } : { total: 70 } });
    });
    await page.goto(`${root}/jobs?titleSearch=${token}`, { waitUntil: "domcontentloaded" });
    const list = page.getByRole("region", { name: "Jobs on this page" });
    await list.waitFor();
    await page.getByRole("heading", { name: "Search results", exact: true }).waitFor();
    assert.equal(await page.getByText("Counting matches...", { exact: true }).count(), 0);
    await waitForHeld();
    assert.equal(await list.getByRole("button").count(), 50, "rows render before count responds");
    await list.getByRole("button").nth(1).click();
    await page.locator('aside[aria-label^="Details for"]').waitFor();
    assert.ok(held.length >= 1 && held.length <= 2, "one shared count fetch; development StrictMode may abort and replay it");
    assert.equal(await page.getByRole("navigation", { name: "Jobs top pagination" }).getByRole("link", { name: "Next" }).count(), 1);
    await mkdir("output/playwright", { recursive: true });
    await page.screenshot({ path: "output/playwright/search-count-pending.png", fullPage: true });
    mode = "fail";
    for (const route of held.splice(0)) await route.fulfill({ status: 503, json: { error: "Busy" } }).catch(() => {});
    await page.getByText("Count unavailable", { exact: true }).waitFor();
    mode = "success";
    await page.getByRole("button", { name: "Retry matching total" }).click();
    await page.getByText("70 matches", { exact: true }).waitFor();
    const top = page.getByRole("navigation", { name: "Jobs top pagination" });
    assert.equal(await top.getByRole("spinbutton", { name: "Jump to page" }).getAttribute("max"), "2");

    // Change queries while the previous total is pending. Late results must
    // never replace the current query's headline or redirect its pagination.
    mode = "hold";
    await page.goto(`${root}/jobs?titleSearch=${token}%20Software`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Search results", exact: true }).waitFor();
    await waitForHeld();
    const old = held.splice(0);
    mode = "success";
    const search = page.getByRole("textbox", { name: "Search job titles by keyword" });
    await search.fill(`${token} Engineer`);
    await search.press("Enter");
    await page.waitForURL(/Engineer/);
    await page.getByText("70 matches", { exact: true }).waitFor();
    for (const route of old) await route.fulfill({ json: { total: 0 } }).catch(() => {});
    assert.equal(await page.getByText("70 matches", { exact: true }).count(), 1);

    await page.unroute("**/api/jobs/count?*");
    const countResponse = await page.evaluate(async (query) => {
      const response = await fetch(`/api/jobs/count?titleSearch=${query}`);
      return { status: response.status, body: await response.json(), cacheControl: response.headers.get("cache-control") };
    }, token);
    assert.equal(countResponse.status, 200);
    assert.equal(countResponse.body.total, 70);
    assert.equal(countResponse.cacheControl, "private, no-store");
    await top.getByRole("link", { name: "Next" }).click();
    await page.waitForURL(/page=2/);
    await list.waitFor();
    assert.equal(await list.getByRole("button").count(), 20);
    assert.equal(await top.getByRole("link", { name: "Next" }).count(), 0);
    await top.getByRole("spinbutton", { name: "Jump to page" }).fill("1");
    await top.getByRole("spinbutton", { name: "Jump to page" }).press("Enter");
    await page.waitForURL((url) => url.searchParams.get("page") === "1");
    await list.waitFor();
    assert.equal(await list.getByRole("button").count(), 50, "keyboard page jump preserves the current filters");
    await top.getByRole("spinbutton", { name: "Jump to page" }).fill("2");
    await top.getByRole("button", { name: "Go to page" }).click();
    await page.waitForURL(/page=2/);
    await list.waitFor();
    assert.equal(await list.getByRole("button").count(), 20, "submit arrow uses the same page-jump flow");
    mode = "hold";
    await page.route("**/api/jobs/count?*", (route) => { held.push(route); onHeld?.(); onHeld = undefined; });
    await page.goto(`${root}/jobs?titleSearch=${token}%20Software%20Engineer&page=9`, { waitUntil: "domcontentloaded" });
    await waitForHeld();
    await page.getByText("No jobs on this page", { exact: true }).waitFor();
    for (const route of held.splice(0)) await route.fulfill({ json: { total: 70 } }).catch(() => {});
    await page.waitForURL(/page=2/);
    await list.waitFor();
    assert.equal(await list.getByRole("button").count(), 20, "out-of-range navigation retains the original search");
    await page.getByText("70 matches", { exact: true }).waitFor();
    assert.equal(held.length, 0, "page correction reuses the resolved count");
    await page.unroute("**/api/jobs/count?*");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('aside h2').waitFor();
    assert.equal(await page.locator('aside h2').evaluate((heading) => heading.scrollWidth > heading.clientWidth + 1), false, "long titles wrap inside the mobile detail header");
    await page.screenshot({ path: "output/playwright/search-count-mobile.png", fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log("PASS: count-independent rows/detail/Next, failure/retry, late-response isolation, exact pagination, authenticated counts, mobile layout");
  } catch (error) {
    console.error("Browser errors", errors);
    await page.screenshot({ path: "output/playwright/search-count-failure.png", fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await page.evaluate(async () => fetch("/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).catch(() => {});
    await context.close();
    await browser.close();
    await prisma.jobCanonical.deleteMany({ where: { id: { startsWith: `${token}-` } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
