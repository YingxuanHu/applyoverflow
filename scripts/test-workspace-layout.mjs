import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.TEST_APP_URL ?? "http://127.0.0.1:3004";
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(60_000);
page.setDefaultNavigationTimeout(120_000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const output = "output/playwright";
await mkdir(output, { recursive: true });

async function checkOverflow(label) {
  assert.equal(await page.evaluate(() => {
    const main = document.querySelector(".app-scroll-root");
    return document.documentElement.scrollWidth > innerWidth + 1 ||
      (main && main.scrollWidth > main.clientWidth + 1);
  }), false, `${label}: no page-level horizontal overflow`);
}

try {
  await page.goto(`${origin}/sign-in?callbackUrl=%2Fjobs`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: /^Email/ }).fill("admin");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/jobs(?:[?#]|$)/, { waitUntil: "domcontentloaded" });
  await page.locator("[data-job-entry]").first().waitFor();
  const firstJobId = await page.locator("[data-job-entry]").first().getAttribute("data-job-entry");

  const routes = [
    ["jobs", "/jobs", 1800],
    ["picks", "/jobs/top-picks", 1800],
    ["applications", "/applications", 1800],
    ["application-history", "/applications/history", 1800],
    ["compare", "/applications/compare", 1800],
    ["documents", "/documents", 1440],
    ["document-comparison", "/documents/compare", 1800],
    ["resume-builder", "/documents/resume-builder", 1800],
    ["profile", "/profile", 1200],
    ["settings", "/settings", 1200],
    ["notifications", "/notifications", 1200],
    ["job-detail", `/jobs/${firstJobId}`, 1200, "24px"],
    ["application-preparation", `/jobs/${firstJobId}/apply`, 1200],
  ];
  for (const [name, route, maxWidth, headingSize = "32px"] of routes) {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded" });
    await page.locator(".app-page h1").first().waitFor();
    await page.locator(".app-page.animate-pulse").waitFor({ state: "hidden" });
    const box = await page.locator(".app-page").boundingBox();
    assert.ok(Math.abs(box.width - maxWidth) < 2, `${name}: intended workspace width (${box.width})`);
    for (const [width, height, dark] of [[2560, 1440, false], [1280, 900, false], [390, 844, false], [320, 844, true]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), dark);
      await checkOverflow(`${name} ${width}`);
      assert.equal(await page.locator(".app-page h1").first().evaluate((el) => getComputedStyle(el).fontSize), headingSize, `${name}: consistent heading size`);
      await page.screenshot({ path: `${output}/workspace-${name}-${width}.png`, animations: "disabled" });
    }
    console.log(`PASS: ${name} layout at 2560/1280/390/320px`);
  }

  await page.goto(`${origin}/jobs`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-job-entry]").first().waitFor();
  for (const [width, height] of [[2560, 1440], [1920, 1080], [1440, 900], [1024, 768]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    const list = await page.getByRole("region", { name: "Jobs on this page", exact: true }).boundingBox();
    const detail = await page.getByRole("complementary", { name: /^Details for/ }).boundingBox();
    assert.ok(Math.abs(list.height - detail.height) < 2, `${width}: matching panel heights`);
    assert.ok(list.x + list.width <= detail.x, `${width}: non-overlapping panels`);
    assert.ok(detail.width > list.width, `${width}: reading panel has more width`);
    const title = page.locator("[data-job-entry] .line-clamp-2").first();
    assert.equal(await title.evaluate((el) => getComputedStyle(el).fontSize), "18px");
    const first = page.locator("[data-job-entry]").first();
    await first.click();
    await page.waitForURL(/#job-/, { waitUntil: "domcontentloaded" });
    await first.press("ArrowDown");
    await page.waitForFunction(() => document.querySelectorAll("[data-job-entry]")[1]?.getAttribute("aria-current") === "true");
    await page.locator("[data-job-entry]").nth(1).press("Home");
    await page.locator("[data-job-description]").waitFor();
    assert.equal(await page.locator("[data-job-description]").evaluate((el) => getComputedStyle(el).fontSize), "16px");
    await checkOverflow(`Jobs panels ${width}`);
    assert.equal(await page.getByRole("textbox", { name: "Search job titles by keyword" }).evaluate((el) => getComputedStyle(el).fontSize), "16px");
    await page.screenshot({ path: `${output}/workspace-jobs-panels-${width}.png`, animations: "disabled" });
  }
  for (const width of [2560, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: /^Filters/ }).click();
    const dialog = page.getByRole("dialog", { name: "Refine jobs" });
    await dialog.waitFor();
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1, `${width}: filter dialog fits`);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const saved = page.getByText("Saved searches", { exact: true });
    await saved.focus();
    await saved.press("Enter");
    await page.getByRole("textbox", { name: "Saved search name" }).waitFor();
    await checkOverflow(`Saved searches ${width}`);
    await saved.press("Enter");
  }
  assert.deepEqual(errors, [], "No browser runtime errors");
  console.log("PASS: equal-height panels, readable text, keyboard job selection and no runtime errors");
} catch (error) {
  await page.screenshot({ path: `${output}/workspace-layout-failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
