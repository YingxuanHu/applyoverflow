import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { fixtures, fixtureHtml } from "./fixtures/application-extension.mjs";

// Real MV3 scripts in cross-origin frames; every HTTP request is intercepted.
// The parent has no extension host grant. Only a trusted click in the chosen
// supported frame can transfer contact facts to that frame's exact document.
const extension = resolve("output/extension/local");
const { APP_ORIGIN } = await import(
  pathToFileURL(`${extension}/config.mjs`).href
);
assert.match(APP_ORIGIN, /^http:\/\/127\.0\.0\.1:\d+$/);
const profile = process.env.EXTENSION_TEST_PROFILE ?? "";
if (profile)
  assert.ok(resolve(profile).startsWith(`${resolve("output/playwright")}/`));
if (profile)
  await rm(resolve(profile, "Default/Service Worker"), {
    recursive: true,
    force: true,
  });
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: process.env.EXTENSION_HEADED !== "1",
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
context.setDefaultTimeout(
  process.env.EXTENSION_HEADED === "1" ? 120000 : 15000,
);
context.setDefaultNavigationTimeout(20000);
const embed =
  "https://job-boards.greenhouse.io/embed/job_app?for=ao-fixture&token=123";
const frameUrls = [embed, fixtures[1].url, fixtures[2].url];
const contact = {
  givenName: "Jordan",
  familyName: "Example",
  fullName: "Jordan Example",
  email: "jordan@example.test",
  phone: "+14165550100",
  linkedInUrl: "https://www.linkedin.com/in/example",
};
let calls = 0,
  delay = 0;
const captures = [],
  errors = [];
try {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["http:", "https:"].includes(url.protocol)) return route.continue();
    if (url.pathname.startsWith("/api/extension/v1/")) {
      const action = url.pathname.split("/").pop();
      if (action === "autofill-plan") {
        calls++;
        if (delay) await new Promise((r) => setTimeout(r, delay));
      }
      if (action === "capture") captures.push(route.request().postDataJSON());
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          action === "autofill-plan" ? { contact, answers: [], history: [], revision: "2026-09-20T00:00:00.000Z", includeResume: false } : { id: "frame-review" },
        ),
      });
    }
    if (url.hostname === "employer.example")
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Embedded application fixture</title><style>body{font:16px system-ui;margin:8px}iframe{display:block;border:1px solid #ddd;width:100%;height:760px;box-sizing:border-box}</style><h1>Employer careers</h1><label>Parent email<input type="email" id="parent-email"></label>${frameUrls.map((src, i) => `<iframe title="Application ${i}" src="${src}"></iframe>`).join("")}<iframe title="Unrelated" src="https://unrelated.example/form"></iframe></html>`,
      });
    const fixture =
      fixtures.find((f) => new URL(f.url).hostname === url.hostname) ??
      fixtures[0];
    return route.fulfill({
      contentType: "text/html",
      body: fixtureHtml(fixture, { resume: true }),
    });
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await worker.evaluate(async () =>
    chrome.storage.session.set({
      connection: {
        token: "frame-test-token",
        email: "synthetic@example.test",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
    }),
  );
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.getByText("Connection & site access", { exact: true }).click();
  if (
    !(await popup.getByLabel("Show autofill on supported sites").isChecked())
  ) {
    console.log(
      "Approve the supported-site permission prompt in the isolated test Chrome.",
    );
    await popup.getByLabel("Show autofill on supported sites").check();
    await popup
      .getByText("Autofill hints enabled on supported sites.")
      .waitFor();
  }
  await worker.evaluate(async () =>
    chrome.scripting.updateContentScripts([
      { id: "application-detection", allFrames: false },
    ]),
  );
  await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: "detection-updated" }),
  );
  assert.ok(
    (
      await worker.evaluate(() =>
        chrome.scripting.getRegisteredContentScripts(),
      )
    ).find((s) => s.id === "application-detection").allFrames,
    "Upgrade reconciles old top-frame-only registration",
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("https://employer.example/careers");
  assert.equal(await page.locator("#applyoverflow-assistant").count(), 0);
  const frame = page.frameLocator('iframe[title="Application 0"]');
  // Auto-sized embeds commonly exceed the parent viewport. The hint must be
  // reachable on arrival, not pinned below the entire application form.
  await page.locator('iframe[title="Application 0"]').evaluate((el) => {
    el.style.height = "2400px";
  });
  await frame
    .getByRole("button", { name: "Autofill available", exact: true })
    .waitFor();
  const initialHint = await frame
    .getByRole("button", { name: "Autofill available", exact: true })
    .boundingBox();
  assert.ok(
    initialHint &&
      initialHint.y >= 0 &&
      initialHint.y + initialHint.height < page.viewportSize().height,
  );
  assert.equal(await page.evaluate(() => scrollY), 0);
  await page.locator('iframe[title="Application 0"]').evaluate((el) => {
    el.style.height = "760px";
  });
  await frame
    .getByRole("button", { name: "Autofill available", exact: true })
    .click();
  assert.equal(calls, 0, "Detection does not fetch profile facts");
  await frame
    .getByRole("button", { name: "Autofill", exact: true })
    .evaluate((b) => b.click());
  await page.waitForTimeout(250);
  assert.equal(calls, 0, "Untrusted frame click must not fetch profile facts");
  await frame
    .getByRole("button", { name: "Autofill", exact: true })
    .click();
  await frame.getByRole("status").filter({ hasText: "4 filled" }).waitFor();
  assert.equal(await frame.locator("#email").inputValue(), contact.email);
  assert.equal(await page.locator("#parent-email").inputValue(), "");
  for (let i = 1; i < 3; i++) {
    const other = page.frameLocator(`iframe[title="Application ${i}"]`);
    await other
      .getByRole("button", { name: "Autofill available", exact: true })
      .waitFor();
    assert.equal(
      await other.locator('input[type="email"]').first().inputValue(),
      "",
    );
  }
  assert.equal(
    await page
      .frameLocator('iframe[title="Unrelated"]')
      .locator("#applyoverflow-assistant")
      .count(),
    0,
  );
  for (const field of [
    '[name="reference"]',
    '[type="file"]',
    '[type="password"]',
  ])
    assert.equal(await frame.locator(field).first().inputValue(), "");
  assert.equal(await frame.locator('[name="consent"]').isChecked(), false);
  assert.equal(await frame.locator('[name="visa"]').isChecked(), false);
  await frame.getByText("More actions", { exact: true }).click();
  await frame
    .getByRole("button", { name: "Undo Autofill", exact: true })
    .click();
  await frame.getByRole("status").filter({ hasText: "4 fields cleared" }).waitFor();
  assert.equal(await frame.locator("#email").inputValue(), "");
  const opened = context.waitForEvent("page").then(
    (page) => ({ page }),
    (error) => ({ error }),
  );
  await frame
    .getByRole("button", { name: "Review questions", exact: true })
    .click();
  const openedResult = await opened;
  if (openedResult.error)
    throw new Error(
      `Review failed: ${await frame.getByRole("status").textContent()}; captured=${captures.length}`,
      { cause: openedResult.error },
    );
  const review = openedResult.page;
  await review.waitForURL(
    (url) =>
      (url.searchParams.get("callbackUrl") ?? url.pathname) ===
      "/applications/frame-review/review",
  );
  await review.waitForLoadState();
  assert.equal(new URL(review.url()).origin, APP_ORIGIN);
  await review.close();
  assert.equal(captures.length, 1);
  assert.equal(captures[0].url, embed);
  assert.equal(JSON.stringify(captures).includes(contact.email), false);
  assert.equal(JSON.stringify(captures).includes("Already written"), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await frame
    .getByRole("button", { name: "Autofill", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "output/playwright/assistant-embedded-mobile.png",
  });
  assert.equal(
    await frame.locator("html").evaluate((el) => el.scrollWidth > innerWidth),
    false,
  );
  // The same iframe URL in a replacement document must not receive a late fill.
  // Feedback expires after 15 seconds and can disappear while taking a mobile
  // screenshot. Wait for the stable action state, not an expired toast.
  await page.waitForFunction(() => {
    const doc = document.querySelector('iframe[title="Application 0"]');
    return !!doc;
  });
  assert.equal(await frame.getByRole("button", { name: "Autofill", exact: true }).isEnabled(), true);
  delay = 700;
  await frame
    .getByRole("button", { name: "Autofill", exact: true })
    .click();
  await page.waitForTimeout(150);
  await page
    .locator('iframe[title="Application 0"]')
    .evaluate((el) => el.replaceWith(el.cloneNode(true)));
  await frame
    .getByRole("button", { name: "Autofill available", exact: true })
    .waitFor();
  await page.waitForTimeout(900);
  assert.equal(await frame.locator("#email").inputValue(), "");
  delay = 0;
  // Permission changes reach already-injected frames even without parent access.
  await popup.bringToFront();
  await popup.getByLabel("Show autofill on supported sites").uncheck();
  await popup
    .getByText("Automatic hints turned off. The toolbar still works.")
    .waitFor();
  await page.bringToFront();
  await page.waitForTimeout(300);
  assert.equal(await frame.locator("#applyoverflow-assistant").count(), 0);
  await popup.bringToFront();
  await popup.getByLabel("Show autofill on supported sites").check();
  await popup.getByText("Autofill hints enabled on supported sites.").waitFor();
  await page.bringToFront();
  await frame
    .getByRole("button", { name: "Autofill available", exact: true })
    .waitFor();
  for (const f of page.frames().filter((f) => frameUrls.includes(f.url())))
    assert.deepEqual(
      await f.evaluate(() => [window.submissions, window.steps]),
      [0, 0],
    );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: supported cross-origin frames, registration upgrade, trusted clicks, document isolation, Undo, review privacy, 390px layout and permission revocation/re-enable; no submissions",
  );
} finally {
  await context
    .serviceWorkers()[0]
    ?.evaluate(() => chrome.storage.session.clear())
    .catch(() => {});
  await context.close();
}
