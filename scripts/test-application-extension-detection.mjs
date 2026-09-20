import assert from "node:assert/strict";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { chromium } from "playwright";
import { SITE_ORIGINS } from "../extensions/chrome/sites.mjs";
import { fixtures, fixtureHtml } from "./fixtures/application-extension.mjs";

// Real MV3 worker, permissions, registered scripts and click-to-fill. All page
// and API traffic is synthetic here; identity/API integration has a separate test.
const extension = resolve("output/extension/local");
if (process.env.EXTENSION_TEST_PROFILE) {
  const profile = resolve(process.env.EXTENSION_TEST_PROFILE);
  assert.ok(profile.startsWith(`${resolve("output/playwright")}/`), "Use a disposable profile, never personal Chrome data");
  await rm(resolve(profile, "Default/Service Worker"), { recursive: true, force: true });
}
const context = await chromium.launchPersistentContext(
  process.env.EXTENSION_TEST_PROFILE ?? "",
  {
    channel: "chromium",
    headless: process.env.EXTENSION_HEADED !== "1",
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  },
);
context.setDefaultTimeout(
  process.env.EXTENSION_HEADED === "1" ? 120_000 : 15_000,
);
context.setDefaultNavigationTimeout(20_000);
const contact = {
  givenName: "Jordan",
  familyName: "Example",
  fullName: "Jordan Example",
  email: "jordan@example.test",
  phone: "+14165550100",
  linkedInUrl: "https://www.linkedin.com/in/example",
};
const captures = [],
  errors = [],
  timings = [];
let contactCalls = 0,
  responseDelay = 0;
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  worker.on("console", (message) => console.log("worker", message.text()));
  const id = new URL(worker.url()).host;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["https:", "http:"].includes(url.protocol)) return route.continue();
    if (url.pathname.startsWith("/api/extension/v1/")) {
      const action = url.pathname.split("/").pop();
      if (action === "contact") {
        contactCalls++;
        if (responseDelay)
          await new Promise((resolve) => setTimeout(resolve, responseDelay));
      }
      if (action === "capture") captures.push(route.request().postDataJSON());
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(
          action === "contact" ? contact : { id: "fixture-review" },
        ),
      });
    }
    const fixture =
      fixtures.find((item) => new URL(item.url).hostname === url.hostname) ??
      fixtures[0];
    return route.fulfill({
      contentType: "text/html",
      body: fixtureHtml(fixture, {
        delayed: url.searchParams.has("delayed"),
        empty: url.searchParams.has("unsupported"),
      }),
    });
  });
  await worker.evaluate(async () =>
    chrome.storage.session.set({
      connection: {
        token: "test-token",
        email: "fixture@example.test",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
    }),
  );
  await worker.evaluate(
    async (origins) => chrome.permissions.remove({ origins }),
    SITE_ORIGINS,
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(fixtures[0].url);
  await page.waitForTimeout(400);
  assert.equal(
    await page.locator("#applyoverflow-assistant").count(),
    0,
    "No automatic access before permission",
  );
  const popup = await context.newPage();
  popup.on("console", (message) => {
    if (message.type() === "error") console.log("popup", message.text());
  });
  popup.on("pageerror", (error) => console.log("popup error", error.message));
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup
    .getByText("Open an application form. Some fields need manual entry.")
    .waitFor();
  console.log("Requesting site access through the popup");
  await popup.getByLabel("Show autofill on supported sites").check();
  await popup.getByText("Autofill hints enabled on supported sites.").waitFor();
  console.log("Site access granted");
  await page.bringToFront();
  await page.getByRole("button", { name: "Autofill available" }).waitFor();
  assert.equal(contactCalls, 0, "Detection must not fetch the profile");
  for (const fixture of fixtures) {
    await page.goto(fixture.url + "?delayed=1");
    await page.getByRole("button", { name: "Autofill available" }).waitFor();
    const detectionMs = await page.evaluate(
      () => performance.now() - window.formReady,
    );
    assert.ok(
      detectionMs < 1000,
      `${fixture.provider} detection ${detectionMs}ms`,
    );
    await page.getByRole("button", { name: "Autofill available" }).focus();
    await page.keyboard.press("Enter");
    assert.equal(
      await page
        .getByRole("button", { name: "Fill contact details" })
        .evaluate((button) => button.getRootNode().activeElement === button),
      true,
    );
    const start = Date.now();
    await page.getByRole("button", { name: "Fill contact details" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: `${fixture.count} filled` })
      .waitFor();
    timings.push({
      provider: fixture.provider,
      detectionMs: Math.round(detectionMs),
      fillMs: Date.now() - start,
    });
    assert.equal(await page.locator('[name="reference"]').inputValue(), "");
    assert.equal(await page.locator('[type="file"]').inputValue(), "");
    assert.equal(await page.locator('[type="password"]').inputValue(), "");
    assert.equal(await page.locator('[name="consent"]').isChecked(), false);
    assert.equal(await page.locator('[name="visa"]').isChecked(), false);
    assert.deepEqual(
      await page.evaluate(() => [window.submissions, window.steps]),
      [0, 0],
    );
    assert.equal(
      await page.getByRole("button", { name: "Fill contact details" }).count(),
      0,
      "Completed contact actions are hidden while review stays available",
    );
    const firstField =
      fixture.provider === "greenhouse"
        ? "#first_name"
        : fixture.provider === "lever"
          ? '[name="name"]'
          : "#_systemfield_name";
    await page.locator(firstField).fill("");
    await page.getByRole("button", { name: "Fill contact details" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: `1 filled \u00b7 ${fixture.count - 1} kept` })
      .waitFor();
    const reviewButton = page.getByRole("button", { name: "Review questions" });
    const buttonHandle = await reviewButton.elementHandle();
    const box = await reviewButton.boundingBox();
    const keyboardReview = fixture.provider === "lever";
    if (keyboardReview) {
      await reviewButton.focus();
      await page.keyboard.down("Space");
    } else {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
    }
    // A real employer can mount another question while the user is pressing a button.
    await page.evaluate(() => {
      const label = document.createElement("label");
      label.textContent = "Additional context";
      label.append(document.createElement("textarea"));
      document.querySelector("#application-form").append(label);
    });
    await page.waitForTimeout(350);
    assert.equal(
      await buttonHandle.evaluate((button) => button.isConnected),
      true,
      "background scans must not replace the pressed review button",
    );
    const [review] = await Promise.all([
      context.waitForEvent("page", { timeout: 60_000 }),
      keyboardReview ? page.keyboard.up("Space") : page.mouse.up(),
    ]);
    await review.waitForLoadState();
    const reviewUrl = new URL(review.url());
    assert.equal(reviewUrl.origin, "http://127.0.0.1:3004");
    assert.equal(
      reviewUrl.searchParams.get("callbackUrl") ?? reviewUrl.pathname,
      "/applications/fixture-review/review",
    );
    await review.close();
    await page.bringToFront();
    await page
      .getByRole("status")
      .filter({ hasText: "Nothing submitted" })
      .waitFor();
    await page.getByRole("button", { name: "Dismiss for this page" }).click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator("#applyoverflow-assistant").count(), 0);
    // Route changes and new dynamically mounted forms are detected without reload.
    await page.evaluate(() => {
      history.pushState({}, "", location.pathname + "?another-step=1");
      document.querySelector("main").innerHTML = window.formHtml;
    });
    await page.getByRole("button", { name: "Autofill available" }).waitFor();
    await page.evaluate(() => {
      history.pushState({}, "", "/ao-fixture");
      document.querySelector("main").replaceChildren();
    });
    await page.waitForTimeout(650);
    assert.equal(
      await page.locator("#applyoverflow-assistant").count(),
      0,
      "No stale indicator after SPA exit",
    );
  }
  assert.equal(captures.length, 3);
  assert.equal(JSON.stringify(captures).includes("Already written"), false);
  assert.equal(JSON.stringify(captures).includes(contact.email), false);
  await page.goto(fixtures[1].url);
  await page.getByRole("button", { name: "Autofill available" }).click();
  await page.screenshot({
    path: "output/playwright/assistant-indicator-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "output/playwright/assistant-indicator-mobile.png",
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  // Synthetic page events cannot trigger privileged extension actions.
  const before = contactCalls;
  await page
    .getByRole("button", { name: "Fill contact details" })
    .evaluate((button) => button.click());
  await page.waitForTimeout(200);
  assert.equal(contactCalls, before);
  // Slow contact response must never fill a different job after SPA navigation.
  responseDelay = 600;
  await page.getByRole("button", { name: "Fill contact details" }).click();
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    history.pushState(
      {},
      "",
      "/ao-fixture/00000000-0000-4000-8000-000000000000/apply",
    );
    document.querySelector("main").innerHTML = window.formHtml;
  });
  await page.waitForTimeout(900);
  assert.equal(await page.locator('[name="email"]').inputValue(), "");
  responseDelay = 0;
  await popup.bringToFront();
  await popup.getByLabel("Show autofill on supported sites").uncheck();
  await popup
    .getByText("Automatic hints turned off. The toolbar still works.")
    .waitFor();
  await page.bringToFront();
  await page.waitForTimeout(400);
  assert.equal(
    await page.locator("#applyoverflow-assistant").count(),
    0,
    "Revocation removes the existing indicator",
  );
  await popup.bringToFront();
  await popup.getByLabel("Show autofill on supported sites").check();
  await popup.getByText("Autofill hints enabled on supported sites.").waitFor();
  await page.bringToFront();
  const beforeQuestions = contactCalls;
  await page.goto(fixtures[0].url + "?unsupported=1");
  await page.getByRole("button", { name: "Application help available" }).click();
  await page.getByRole("button", { name: "Review questions" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Fill contact details" }).isVisible(), false);
  assert.equal(contactCalls, beforeQuestions, "question-only detection must not fetch profile facts");
  await page.goto("https://unrelated.example/application");
  await page.waitForTimeout(400);
  assert.equal(await page.locator("#applyoverflow-assistant").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        timings,
        captures: captures.length,
        unsafeFills: 0,
        pageErrors: errors.length,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.log({ contactCalls, captures: captures.length, timings });
  for (const page of context.pages())
    console.log(
      page.url(),
      (
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      ).slice(-1400),
      await page
        .evaluate(() =>
          document
            .querySelector("#applyoverflow-assistant")
            ?.shadowRoot?.textContent?.slice(-1200),
        )
        .catch(() => ""),
    );
  throw error;
} finally {
  await context.close();
}
