import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const extension = resolve("output/extension/local");
const profile = process.env.EXTENSION_TEST_PROFILE;
assert.ok(
  profile && resolve(profile).startsWith(`${resolve("output/playwright")}/`),
  "Use a disposable profile with approved optional ATS access",
);
await rm(resolve(profile, "Default/Service Worker"), {
  recursive: true,
  force: true,
});
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
context.setDefaultTimeout(15000);
const calls = [];
const revision = "2026-09-19T00:00:00.000Z";
const fixture = `<!doctype html><title>Analyst application</title><h1>Analyst application</h1><form>
  <fieldset><legend>Work experience 1</legend><label>Job title<input id="title"></label><label>Company<input id="company"></label>
  <label>Start date<input id="start" type="month"></label></fieldset><button>Submit</button></form>`;
try {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!["http:", "https:"].includes(url.protocol)) return route.continue();
    if (url.pathname.startsWith("/api/extension/v1/")) {
      const action = url.pathname.split("/").pop();
      const body = route.request().postDataJSON();
      calls.push({ action, body });
      const data =
        action === "history"
          ? {
              revision,
              entries: [
                { kind: "experience", index: 0, label: "Analyst - Example" },
              ],
            }
          : action === "history-entry"
            ? {
                kind: "experience",
                entry: {
                  title: "Analyst",
                  company: "Example",
                  dates: { start: "2021-06" },
                },
              }
            : { id: "confirmed-fixture" };
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    }
    return route.fulfill({ contentType: "text/html", body: fixture });
  });
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const popup = await context.newPage();
  await worker.evaluate(() =>
    chrome.storage.session.set({
      connection: {
        token: "fixture",
        email: "synthetic@example.test",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
    }),
  );
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const send = (type, data = {}) =>
    popup.evaluate(async (message) => {
      const { BUILD_ID } = await import(chrome.runtime.getURL("config.mjs"));
      return chrome.runtime.sendMessage({ ...message, buildId: BUILD_ID });
    }, {
      type,
      ...data,
    });
  await worker.evaluate(() => {
    globalThis.originalAuth = chrome.identity.launchWebAuthFlow;
    chrome.identity.launchWebAuthFlow = () => new Promise((resolve) => { globalThis.finishAuth = resolve; });
  });
  const pendingConnection = send("connect");
  await popup.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: "status" })).activeAction === "connect");
  const duplicate = await send("connect");
  assert.equal(duplicate.activeAction, "connect");
  assert.match(duplicate.error, /Complete or close/);
  await worker.evaluate(async () => {
    const { authorization } = await chrome.storage.session.get("authorization");
    globalThis.finishAuth(`${chrome.identity.getRedirectURL("callback")}?error=access_denied&state=${authorization.state}`);
  });
  assert.match((await pendingConnection).error, /cancelled/);
  assert.equal((await send("status")).activeAction, null);
  assert.equal((await send("status")).connected, true, "cancelled reconnect must preserve the previous connection");
  await worker.evaluate(() => {
    globalThis.originalTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) => globalThis.originalTimeout(fn, ms === 300000 ? 50 : ms, ...args);
  });
  assert.match((await send("connect")).error, /Approval timed out/);
  assert.equal((await send("status")).activeAction, null);
  assert.equal(await worker.evaluate(async () => Boolean((await chrome.storage.session.get("authorization")).authorization)), false);
  await worker.evaluate(() => {
    globalThis.finishAuth(`${chrome.identity.getRedirectURL("callback")}?code=late&state=late`);
    globalThis.setTimeout = globalThis.originalTimeout;
    chrome.identity.launchWebAuthFlow = globalThis.originalAuth;
  });
  assert.equal((await send("status")).connected, true);
  assert.equal(calls.filter(c => c.action === "token").length, 0, "late identity results must never exchange a token");
  console.log("PASS: real worker pending-action state, duplicate suppression, cancellation recovery and ignored late authorization");
  // A suspended employer tab must not hold the popup or a reconnect hostage.
  await worker.evaluate(() => {
    globalThis.originalTabSend = chrome.tabs.sendMessage;
    chrome.tabs.sendMessage = () => new Promise(() => {});
  });
  const readinessStarted = Date.now();
  assert.equal((await send("detection-updated")).connected, true);
  assert.ok(Date.now() - readinessStarted < 3000, "unresponsive tabs must not block setup");
  await worker.evaluate(() => {
    chrome.tabs.sendMessage = globalThis.originalTabSend;
    delete globalThis.originalTabSend;
  });
  const page = await context.newPage();
  for (const url of [
    "https://fixture.wd1.myworkdayjobs.com/en-US/External/job/Analyst_R123/apply/myExperience",
    "https://careers-fixture.icims.com/jobs/123/analyst/application",
  ]) {
    await page.goto(url);
    await page.bringToFront();
    await worker.evaluate(() => {
      globalThis.originalExecuteScript = chrome.scripting.executeScript;
      chrome.scripting.executeScript = () => new Promise(() => {});
    });
    const slowPage = await send("status");
    assert.equal(slowPage.connected, true, "page responsiveness is not account connectivity");
    assert.match(slowPage.pageMessage, /taking too long/);
    await worker.evaluate(() => {
      chrome.scripting.executeScript = globalThis.originalExecuteScript;
      delete globalThis.originalExecuteScript;
    });
    const status = await send("status");
    assert.equal(status.connected, true);
    assert.equal(
      calls.filter((c) => c.action === "history").length,
      0,
      "passive status never exports history",
    );
    const history = await send("history");
    assert.equal(history.history.entries.length, 1);
    const filled = await send("fill-history", {
      selection: { kind: "experience", index: 0, revision },
    });
    assert.match(filled.message, /3 history fields filled/);
    assert.equal(await page.locator("#company").inputValue(), "Example");
    await page.locator("#company").fill("User edit");
    const undo = await send("undo-history");
    assert.match(undo.message, /2 history fields cleared/);
    assert.equal(await page.locator("#company").inputValue(), "User edit");
    // Filling never records an application. Confirmation can survive the site's
    // success navigation but remains tied to this tab and short-lived preview.
    assert.equal(calls.filter((c) => c.action === "applied").length, 0);
    await page.goto(`${new URL(url).origin}/submitted`);
    const preview = await send("applied-preview");
    assert.ok(preview.preview, JSON.stringify(preview));
    assert.match(
      (
        await send("applied", {
          token: preview.preview.token,
          title: "Analyst",
          company: "Example",
          confirmed: false,
        })
      ).error,
      /expired/,
    );
    const created = context.waitForEvent("page", { timeout: 60_000 });
    const result = await send("applied", {
      token: preview.preview.token,
      title: "Analyst",
      company: "Example",
      confirmed: true,
    });
    assert.match(result.message, /Application recorded/);
    await (await created).close();
    const applied = calls.find((c) => c.action === "applied");
    assert.equal(applied.body.url, preview.preview.url);
    assert.equal(applied.body.confirmed, true);
    assert.match(
      (
        await send("applied", {
          token: preview.preview.token,
          title: "Analyst",
          company: "Example",
          confirmed: true,
        })
      ).error,
      /expired/,
    );
    calls.length = 0;
  }
  await page.goto(
    "https://careers-fixture.icims.com/jobs/123/analyst/application",
  );
  await page.bringToFront();
  await send("status");
  await send("applied-preview");
  await send("disconnect");
  const state = await worker.evaluate(() => chrome.storage.session.get(null));
  assert.ok(
    !state.connection &&
      !state.appliedPreview &&
      !Object.keys(state).some((key) => key.startsWith("application:")),
  );
  await popup.bringToFront();
  await popup.setViewportSize({ width: 320, height: 600 });
  await popup.evaluate(() => {
    document.querySelector("#actions").hidden = false;
    document.querySelector("#connect").hidden = true;
    document.querySelector("#more-actions").open = true;
    document.querySelector("#status").textContent = "Preview";
  });
  await popup.screenshot({
    path: "output/playwright/assistant-expanded-popup.png",
  });
  console.log(
    "PASS: real MV3 Workday/iCIMS history, selected-entry export, safe Undo, submission navigation, explicit tracking, replay prevention and account cleanup; APIs mocked, zero employer submission",
  );
} finally {
  await context.close();
}
