import assert from "node:assert/strict";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { fixtures, fixtureHtml } from "./fixtures/application-extension.mjs";

// Interactive smoke test: open Extensions > ApplyOverflow > Fill contact details.
// No ATS host permission is granted: this specifically verifies activeTab.
const extension = resolve("output/extension/local");
const context = await chromium.launchPersistentContext("", {
  channel: "chromium",
  headless: false,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
try {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (!["https:", "http:"].includes(url.protocol)) return route.continue();
    if (url.pathname === "/api/extension/v1/contact")
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          givenName: "Jordan",
          familyName: "Example",
          email: "jordan@example.test",
          phone: "+14165550100",
        }),
      });
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: fixtureHtml(fixtures[0]),
    });
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(async () =>
    chrome.storage.session.set({
      connection: {
        token: "fixture",
        email: "fixture@example.test",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
    }),
  );
  const page = await context.newPage();
  await page.goto(fixtures[0].url);
  console.log(
    "Ready: use the native Chrome Extensions menu to open ApplyOverflow, then click Fill contact details.",
  );
  await page.waitForFunction(
    () => document.getElementById("first_name")?.value === "Jordan",
    undefined,
    { timeout: 180_000 },
  );
  assert.equal(
    await page.locator("#email").inputValue(),
    "jordan@example.test",
  );
  assert.deepEqual(
    await page.evaluate(() => [window.submissions, window.steps]),
    [0, 0],
  );
  console.log(
    "PASS: native toolbar gesture grants activeTab and fills without automatic site permissions",
  );
} finally {
  await context.close();
}
