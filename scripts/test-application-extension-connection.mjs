import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { fixtures, fixtureHtml } from "./fixtures/application-extension.mjs";

const origin = process.env.ASSISTANT_TEST_ORIGIN ?? "http://127.0.0.1:3004";
const login = process.env.ASSISTANT_TEST_EMAIL ?? "admin";
const password = process.env.ASSISTANT_TEST_PASSWORD ?? "password";
const embedded = process.env.EXTENSION_EMBEDDED_FIXTURE === "1";
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
const extension = resolve("output/extension/local");
const config = await readFile(`${extension}/config.mjs`, "utf8");
assert.ok(
  config.includes(JSON.stringify(origin)),
  "build the local preview for this origin first",
);
if (process.env.EXTENSION_TEST_PROFILE) {
  const profile = resolve(process.env.EXTENSION_TEST_PROFILE);
  assert.ok(
    profile.startsWith(`${resolve("output/playwright")}/`),
    "Use an isolated test profile, never a personal Chrome profile",
  );
  // Chrome otherwise retains the prior unpacked worker's imported config when
  // switching local ports. Keep permission grants, but load the current bundle.
  await rm(`${profile}/Default/Service Worker`, {
    recursive: true,
    force: true,
  });
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
context.setDefaultNavigationTimeout(90_000);
context.setDefaultTimeout(30_000);
let connection;
const api = context.request;
context.on("response", response => {
  const url = new URL(response.url());
  if (url.pathname.startsWith("/api/extension/v1/"))
    console.log("Extension API", url.pathname.split("/").pop(), response.status());
});
try {
  await api.post(`${origin}/api/auth/sign-out`, {
    timeout: 90_000,
    headers: { Origin: origin },
    data: {},
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  console.log(`Testing registered local extension ${id}`);
  const app = await context.newPage();
  await app.goto(`${origin}/sign-in?callbackUrl=%2Fsettings%2Fextension`, {
    waitUntil: "domcontentloaded",
  });
  await app
    .getByRole("textbox", { name: /^Email(?: or username)?$/ })
    .fill(login);
  await app
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(password);
  await app.getByRole("button", { name: "Sign in", exact: true }).click();
  await app.waitForURL("**/settings/extension", { timeout: 90_000, waitUntil: "domcontentloaded" });
  await app.getByRole("button", { name: "Download ZIP" }).waitFor();
  const downloaded = app.waitForEvent("download");
  await app.getByRole("button", { name: "Download ZIP" }).click();
  const zip = await downloaded;
  assert.equal(zip.suggestedFilename(), "applyoverflow-assistant.zip");
  assert.equal(await zip.failure(), null);
  const download = await api.get(
    `${origin}/downloads/applyoverflow-assistant.zip`,
  );
  assert.equal(download.status(), 200);
  assert.match(download.headers()["content-type"], /application\/zip/);
  await app.screenshot({
    path: "output/playwright/assistant-install-desktop.png",
    fullPage: true,
  });
  await app.setViewportSize({ width: 390, height: 844 });
  await app.getByText("Install the preview", { exact: true }).click();
  assert.equal(
    await app.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await app.screenshot({
    path: "output/playwright/assistant-install-mobile.png",
    fullPage: true,
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.getByText("Connect to your ApplyOverflow profile.").waitFor();
  if (process.env.EXTENSION_TEST_PROFILE && await popup.locator("#detection").isChecked()) {
    assert.ok((await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts())).some(script => script.id === "application-detection"),
      "Worker restart must restore detection registration without toggling permissions");
  }
  if (
    process.env.EXTENSION_HEADED === "1" &&
    !(await popup.locator("#detection").isChecked())
  ) {
    console.log(
      "Approve the supported-site permission prompt in the test Chrome window.",
    );
    await popup.locator("#detection").check();
    await popup
      .getByText("Autofill hints enabled on supported sites.")
      .waitFor({ timeout: 180_000 });
  }
  await popup.screenshot({
    path: "output/playwright/assistant-popup-disconnected.png",
  });
  const cancelledPagePromise = context.waitForEvent("page", { timeout: 60_000 });
  await popup.getByRole("button", { name: "Connect to ApplyOverflow" }).click();
  const cancelledPage = await cancelledPagePromise;
  await cancelledPage.getByRole("button", { name: "Allow connection" }).waitFor({ timeout: 60_000 });
  const reopenedPopup = await context.newPage();
  await reopenedPopup.goto(`chrome-extension://${id}/popup.html`);
  await reopenedPopup.getByText(/Connection in progress/).waitFor();
  assert.equal(await reopenedPopup.getByRole("button", { name: "Connect to ApplyOverflow" }).isDisabled(), true);
  await cancelledPage.getByRole("link", { name: "Cancel", exact: true }).click();
  await popup.getByText("Connection cancelled.", { exact: true }).waitFor();
  await reopenedPopup.getByText("Connect to your ApplyOverflow profile.", { exact: true }).waitFor();
  assert.equal(await reopenedPopup.getByRole("button", { name: "Connect to ApplyOverflow" }).isEnabled(), true);
  await reopenedPopup.close();
  console.log("PASS: real web cancellation closes Chrome identity, reopened popup recovers and reconnect remains available");
  const authPagePromise = context.waitForEvent("page", { timeout: 60_000 });
  await popup.getByRole("button", { name: "Connect to ApplyOverflow" }).click();
  const authPage = await authPagePromise;
  await authPage
    .getByRole("button", { name: "Allow connection" })
    .waitFor({ timeout: 60_000 });
  await authPage.screenshot({
    path: "output/playwright/assistant-consent.png",
    fullPage: true,
  });
  await authPage.getByRole("button", { name: "Allow connection" }).click();
  await popup
    .getByText("Connected. Open an employer application form.")
    .waitFor({ timeout: 60_000 });
  console.log("Connected through Chrome identity");
  connection = await popup.evaluate(
    async () => (await chrome.storage.session.get("connection")).connection,
  );
  assert.ok(connection.token);
  assert.equal(
    connection.email,
    process.env.ASSISTANT_TEST_EMAIL ?? "admin@applyoverflow.local",
  );
  await popup.bringToFront();
  await popup.screenshot({
    path: "output/playwright/assistant-popup-connected.png",
  });
  const contact = await api.post(`${origin}/api/extension/v1/contact`, {
    headers: { Authorization: `Bearer ${connection.token}` },
  });
  assert.equal(contact.status(), 200);
  assert.equal(contact.headers()["cache-control"], "no-store");
  const confirmed = await contact.json();
  console.log("Confirmed contact API response");
  assert.equal("workAuthorization" in confirmed, false);
  if (process.env.EXTENSION_TEST_PROFILE) {
    // Previously approved test-profile host permission; never submit a real form.
    const fixture = fixtures[0];
    const fixtureUrl = embedded
      ? "https://job-boards.greenhouse.io/embed/job_app?for=ao-fixture&token=123"
      : fixture.url;
    assert.ok(await worker.evaluate(async (origin) => chrome.permissions.contains({ origins: [origin] }), `${new URL(fixture.url).origin}/*`),
      "Approve supported-site access in this disposable profile with EXTENSION_HEADED=1 first");
    await context.route(
      embedded ? "https://job-boards.greenhouse.io/embed/job_app?**" : "https://job-boards.greenhouse.io/ao-fixture/**",
      (route) =>
        route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: fixtureHtml(fixture, { resume: true }),
        }),
    );
    if (embedded) await context.route("https://employer.example/application", route => route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Embedded fixture</title><label>Parent email<input id="parent-email" type="email"></label><iframe title="Application" style="width:95vw;height:900px" src="${fixtureUrl}"></iframe>`,
    }));
    const formPage = await context.newPage();
    formPage.on("pageerror", error => console.error("Synthetic form error", error.message));
    await formPage.goto(embedded ? "https://employer.example/application" : fixtureUrl);
    if (embedded) await formPage.frameLocator('iframe[title="Application"]').locator("#email").waitFor();
    const form = embedded ? formPage.frame({ url: fixtureUrl }) : formPage;
    assert.ok(form, "The expected embedded document must be loaded");
    await formPage.bringToFront();
    await form.getByRole("button", { name: "Autofill available" }).click();
    await form.getByRole("button", { name: "Fill contact details" }).click();
    await form.getByRole("status").filter({ hasText: "filled" }).waitFor();
    assert.ok(confirmed.email, "Local fixture profile needs a confirmed email");
    assert.equal(await form.locator("#email").inputValue(), confirmed.email);
    assert.equal(await form.locator('[name="consent"]').isChecked(), false);
    if (embedded) {
      assert.equal(await formPage.locator("#parent-email").inputValue(), "");
      assert.equal(await formPage.locator("#applyoverflow-assistant").count(), 0);
    }
    assert.equal(await form.evaluate(() => window.submissions), 0);
    console.log(
      "PASS: authenticated MV3 hint -> click -> real contact API -> isolated-world fill on a synthetic form",
    );
    await form.getByRole("button", { name: "Undo contact fill", exact: true }).click();
    await form.getByRole("status").filter({ hasText: "cleared" }).waitFor();
    assert.equal(await form.locator("#email").inputValue(), "");
    await form.getByRole("button", { name: "Fill contact details", exact: true }).click();
    await form.getByRole("status").filter({ hasText: "filled" }).waitFor();
    const reviewOpened = context.waitForEvent("page");
    await form.getByRole("button", { name: "Review questions", exact: true }).click();
    const review = await reviewOpened;
    await review.getByRole("heading", { name: "Review application", exact: true }).waitFor();
    await review.getByText("Profile reference", { exact: true }).click();
    await review.getByRole("tab", { name: "Work", exact: true }).click();
    await review.locator("summary").filter({ hasText: /^Analyst/ }).click();
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await review.getByRole("button", { name: "Copy start date", exact: true }).click();
    await review.getByRole("status").filter({ hasText: "Start date copied." }).waitFor();
    assert.equal(await review.evaluate(() => navigator.clipboard.readText()), "2020");
    const question = review.locator("textarea").first();
    await question.fill("Unsaved fixture answer");
    await review.getByRole("tab", { name: "Education", exact: true }).click();
    await review.locator("summary").filter({ hasText: /^Example University/ }).click();
    assert.equal(await question.inputValue(), "Unsaved fixture answer");
    await review.setViewportSize({ width: 1440, height: 1000 });
    await review.screenshot({ path: "output/playwright/assistant-reference-desktop.png", fullPage: true, animations: "disabled" });
    await review.setViewportSize({ width: 320, height: 844 });
    assert.equal(await review.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await review.screenshot({ path: "output/playwright/assistant-reference-mobile.png", fullPage: true, animations: "disabled" });
    await review.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error("Clipboard unavailable in fixture"); }; });
    await review.getByRole("button", { name: "Copy degree", exact: true }).click();
    await review.getByRole("status").filter({ hasText: "Could not copy degree" }).waitFor();
    assert.equal(await review.getByText("BA", { exact: true }).last().isVisible(), true);
    assert.equal(await question.inputValue(), "Unsaved fixture answer");
    await question.fill("");
    await review.getByRole("button", { name: "Save answers", exact: true }).click();
    await review.getByRole("status").filter({ hasText: "Answers saved" }).waitFor();
    await review.close();
    // The responsive review check resizes Chrome's shared native window. Restore
    // it before pointer actions in the other tab's out-of-process iframe.
    await formPage.setViewportSize({ width: 1280, height: 900 });
    await formPage.bringToFront();
    console.log("PASS: real Undo/refill, authenticated profile reference, exact year copy, draft preservation and 320px layout");
    const openResume = async () => {
      const next = context.waitForEvent("page", { timeout: 60_000 }).then(
        (page) => ({ page }),
        (error) => ({ error }),
      );
      await form
        .getByRole("button", { name: "Choose resume", exact: true })
        .click();
      await form.getByRole("status").filter({ hasText: "Choose and approve" }).waitFor({ timeout: 5000 });
      const result = await next;
      if (result.error) throw result.error;
      const chooser = result.page;
      await chooser
        .getByRole("heading", { name: "Attach your resume" })
        .waitFor({ timeout: 60_000 });
      return chooser;
    };
    const cancelled = await openResume();
    assert.equal(
      await cancelled
        .getByRole("button", { name: "Share and attach resume" })
        .isDisabled(),
      true,
    );
    await cancelled.getByRole("link", { name: "Cancel", exact: true }).click();
    await form.getByRole("status").filter({ hasText: "cancelled" }).waitFor();
    assert.equal(
      await form.locator("#resume").evaluate((field) => field.files.length),
      0,
    );
    const chooser = await openResume();
    await chooser.setViewportSize({ width: 1100, height: 850 });
    await chooser.getByRole("radio", { name: /Browser test resume/ }).check();
    await chooser.screenshot({
      path: "output/playwright/assistant-resume-desktop.png",
      fullPage: true,
    });
    await chooser.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await chooser.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await chooser.screenshot({
      path: "output/playwright/assistant-resume-mobile.png",
      fullPage: true,
    });
    await chooser
      .getByRole("button", { name: "Share and attach resume" })
      .click();
    await form
      .getByRole("status")
      .filter({ hasText: "Resume selected" })
      .waitFor({ timeout: 60_000 });
    assert.equal(
      await form.locator("#resume").evaluate((field) => field.files[0].name),
      "Jordan Resume.pdf",
    );
    assert.equal(
      await form
        .locator("#resume")
        .evaluate(async (field) => await field.files[0].text()),
      "%PDF-1.4\nSynthetic browser resume\n%%EOF",
    );
    assert.equal(
      await form.evaluate(() => window.submissions + window.steps),
      0,
    );
    console.log(
      "PASS: real per-file Chrome identity consent, cancel without upload, explicit radio choice, single-use bytes API and exact resume attached; no submit/next",
    );
    if (embedded) console.log("PASS: connection, contact fill, review and per-file resume consent target the embedded document; parent remains untouched");
    await formPage.close();
    await popup.bringToFront();
  }
  await popup.getByRole("button", { name: "Disconnect", exact: true }).click();
  await popup.getByText("Disconnected.", { exact: true }).waitFor();
  const revoked = await api.post(`${origin}/api/extension/v1/contact`, {
    headers: { Authorization: `Bearer ${connection.token}` },
  });
  assert.equal(revoked.status(), 401);
  console.log(
    "PASS: real Chrome identity flow, explicit web consent, PKCE exchange, trusted session token storage, minimal no-store contact API, disconnect revocation",
  );
} catch (error) {
  const worker = context.serviceWorkers()[0];
  if (worker) console.error("Detection diagnostics", JSON.stringify(await worker.evaluate(async () => {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    const tabs = await chrome.tabs.query({});
    const fixture = tabs.find(tab => tab.url?.includes("/ao-fixture/"));
    const state = fixture ? await chrome.scripting.executeScript({ target: { tabId: fixture.id }, func: async () => ({
      inspector: typeof globalThis.__applyOverflowInspect,
      indicator: Boolean(globalThis.__applyOverflowIndicator),
      hidden: document.hidden,
      scan: typeof globalThis.__applyOverflowInspect === "function" ? await globalThis.__applyOverflowInspect() : null,
    }) }).catch(error => ({ error: error.message })) : null;
    return { scripts: scripts.map(s => s.id), state };
  })));
  for (const [index, page] of context.pages().entries()) {
    if (page.isClosed()) continue;
    const url = new URL(page.url());
    console.error("Browser failure page", {
      origin: url.origin,
      pathname: url.pathname,
      status: await page
        .locator("#status")
        .textContent({ timeout: 1000 })
        .catch(() => null),
    });
    await page
      .screenshot({
        path: `output/playwright/assistant-connection-failure-${index}.png`,
      })
      .catch(() => {});
  }
  throw error;
} finally {
  if (connection?.token)
    await api
      .post(`${origin}/api/extension/v1/disconnect`, {
        headers: { Authorization: `Bearer ${connection.token}` },
      })
      .catch(() => {});
  await api
    .post(`${origin}/api/auth/sign-out`, {
      headers: { Origin: origin },
      data: {},
    })
    .catch(() => {});
  await context.close();
}
