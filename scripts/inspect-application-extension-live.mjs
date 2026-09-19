import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { applicationContext } from "../extensions/chrome/sites.mjs";

// Read-only smoke check. Never press Fill, Review, or any employer controls.
const urls = process.argv.slice(2);
assert.ok(
  urls.length && urls.every(applicationContext),
  "Supply supported direct application URLs",
);
assert.ok(
  process.env.EXTENSION_TEST_PROFILE,
  "Use the dedicated profile with supported-site access approved",
);
const extension = resolve("output/extension/local");
const context = await chromium.launchPersistentContext(
  process.env.EXTENSION_TEST_PROFILE,
  {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  },
);
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const popup = await context.newPage();
  await popup.goto(
    `chrome-extension://${new URL(worker.url()).host}/popup.html`,
  );
  const page = await context.newPage();
  for (const url of urls) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page
      .getByRole("button", { name: "Autofill available" })
      .waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "Autofill available" }).click();
    const panel = page.locator("#applyoverflow-assistant");
    const provider = applicationContext(url).provider;
    const capabilities = await popup.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url === url);
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async () => {
          const scan = await globalThis.__applyOverflowInspect();
          return {
            available: scan.available,
            resumeAvailable: scan.resumeAvailable,
            error: scan.error,
          };
        },
      });
      return result.result;
    }, page.url());
    console.log(provider, capabilities);
    await panel.screenshot({
      path: `output/playwright/assistant-live-${provider}.png`,
    });
  }
} finally {
  await context.close();
}
