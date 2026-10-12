import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

// Invoked by extension:test:progress in CI. All employer pages and accounts are synthetic.
export async function testExtensionRecovery(browser) {
  execFileSync(process.execPath, ["scripts/build-application-extension.mjs", "--test-output"], { stdio: "pipe" });
  const directory = resolve("output/extension/package-test/production");
  const { BUILD_ID } = await import(pathToFileURL(`${directory}/config.mjs`).href);
  const runtime = await readFile(`${directory}/adapter-runtime.js`, "utf8");
  const page = await browser.newPage();
  const url = "https://job-boards.greenhouse.io/fixture/jobs/123";
  const form = `<h1>Software Engineer application</h1><form>
    <label>First name<input id="first_name" autocomplete="given-name"></label>
    <label>Email<input id="email" type="email" autocomplete="email"></label>
    <label>Describe a relevant project<textarea id="project"></textarea></label>
    <label>${"Long qualification ".repeat(35)}<textarea id="long"></textarea></label>
    <button>Submit application</button></form><script>window.submitted=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submitted++}</script>`;
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: form }));
  let local = {}, session = {}, listener, docId = "fixture-1", mode = "ok";
  const events = [], calls = [], opened = [];
  const event = { addListener() {} };
  const storage = name => ({
    get: async key => { const state = name === "local" ? local : session; return structuredClone(key === null ? state :
      Object.fromEntries((Array.isArray(key) ? key : [key]).filter(k => k in state).map(k => [k, state[k]]))); },
    set: async values => Object.assign(name === "local" ? local : session, structuredClone(values)),
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete (name === "local" ? local : session)[key]; },
    setAccessLevel: async () => {},
  });
  const originalChrome = globalThis.chrome, originalFetch = globalThis.fetch;
  const tab = { id: 42, url };
  globalThis.chrome = {
    runtime: { id: "fixture", getURL: path => `chrome-extension://fixture/${path}`, getManifest: () => ({ version: "test" }),
      onInstalled: event, onStartup: event, onMessage: { addListener: fn => { listener = fn; } },
      sendMessage: async value => { events.push(value); } },
    permissions: { getAll: async () => ({ origins: [] }), contains: async () => true, onAdded: event, onRemoved: event },
    storage: { local: storage("local"), session: storage("session") },
    tabs: { query: async () => [tab], get: async () => tab, onRemoved: event,
      sendMessage: async () => {}, create: async data => { opened.push(data.url); } },
    scripting: { getRegisteredContentScripts: async () => [], executeScript: async args => {
      if (args.target.documentIds && args.target.documentIds[0] !== docId) throw new Error("Document replaced");
      if (args.files) { await page.evaluate(runtime); return [{ documentId: docId, frameId: 0 }]; }
      const result = await page.evaluate(({ code, values }) => (0, eval)(`(${code})`)(...values), { code: args.func.toString(), values: args.args });
      return [{ result, documentId: docId, frameId: 0 }];
    } },
  };
  globalThis.fetch = async (endpoint, init) => {
    const action = endpoint.split("/").at(-1), body = JSON.parse(init.body);
    calls.push({ action, body });
    if (mode === "network") throw new TypeError("Failed to fetch");
    if (mode === "timeout") throw new DOMException("Timed out", "TimeoutError");
    if (mode === "html") return new Response("<h1>Bad Gateway</h1>", { status: 502 });
    if (mode === "revoked" || (mode === "mid-auth" && action === "autofill-suggest")) return Response.json({ error: "Revoked" }, { status: 401 });
    if (mode === "invalid" && action === "autofill-plan") return Response.json({ error: "Invalid extension request.", code: "EXTENSION_REQUEST_INVALID", fields: ["questions.0"], requestId: "request-12345" }, { status: 400 });
    if (mode === "rate") return Response.json({ error: "Too many requests" }, { status: 429, headers: { "Retry-After": "30" } });
    if (action === "connection-status") return Response.json({ connected: true });
    if (action === "autofill-plan") return Response.json({ revision: "fixture", contact: { givenName: "Jordan", email: "jordan@example.test" }, answers: [], includeResume: false });
    if (action === "autofill-suggest") return Response.json({ suggestion: { answer: "I built a test harness for form controls." } });
    throw new Error(`Unexpected request ${action}`);
  };
  try {
    await import(pathToFileURL(`${directory}/background.mjs`).href);
    const sender = { id: "fixture", url: "chrome-extension://fixture/popup.html" };
    const send = (type, data = {}) => new Promise(resolveResult => {
      let replied = false;
      const accepted = listener({ type, buildId: BUILD_ID, ...data }, sender, value => { replied = true; setImmediate(() => resolveResult(value)); });
      if (!accepted && !replied) resolveResult(null);
    });
    const reset = async nextMode => {
      await page.goto(url); mode = nextMode; session = {}; docId += "x"; calls.length = events.length = 0;
      local = { connection: { token: `synthetic-${docId}`, origin: "https://applyoverflow.com", email: "fixture@example.test", expiresAt: new Date(Date.now() + 60_000).toISOString() } };
    };
    await reset("invalid");
    const invalid = await send("autofill");
    assert.equal(invalid.recovery.code, "EXTENSION_REQUEST_INVALID");
    assert.ok(invalid.fields.every(field => field.state !== "needed" || field.blocked));
    assert.equal(await page.locator("#first_name").inputValue(), "");
    assert.ok(local.connection, "bad requests must not revoke sign-in");
    assert.match(invalid.recovery.detail, /questions.0/);
    assert.equal((await send("status")).recovery.code, "EXTENSION_REQUEST_INVALID", "reopening popup retains failed run");
    await send("extension-help");
    assert.equal(opened.at(-1), "https://applyoverflow.com/settings/extension");
    await send("chrome-extensions", { buildId: "older-build" });
    assert.equal(opened.at(-1), "chrome://extensions/?id=fixture", "stale pages can still open fixed recovery destinations");
    mode = "ok";
    const filled = await send("autofill");
    assert.equal(filled.recovery, undefined);
    assert.equal(await page.locator("#first_name").inputValue(), "Jordan");
    assert.equal(await page.locator("#project").inputValue(), "I built a test harness for form controls.");
    assert.equal(await page.locator("#long").inputValue(), "");
    assert.ok(calls.filter(call => call.action === "autofill-plan").every(call => call.body.questions.every(label => label.length <= 500)));
    assert.ok(!filled.fields.some(field => field.blocked));
    await page.locator("#first_name").fill("Manual edit");
    await send("autofill");
    assert.equal(await page.locator("#first_name").inputValue(), "Manual edit");
    console.log("PASS packaged worker: invalid request recovery, long-label isolation, saved failure, help and retry preserve edits");
    for (const [nextMode, code] of [["network", "NETWORK_ERROR"], ["timeout", "REQUEST_TIMEOUT"], ["html", "SERVICE_UNAVAILABLE"], ["rate", "RATE_LIMITED"], ["revoked", "SIGN_IN_REQUIRED"]]) {
      await reset(nextMode);
      const result = await send("autofill");
      assert.equal(result.recovery.code, code);
      assert.equal(Boolean(local.connection), nextMode !== "revoked");
      assert.ok(result.fields.every(field => field.state !== "needed" || field.blocked));
      assert.doesNotMatch(JSON.stringify(result), /<h1>/);
    }
    await reset("revoked");
    assert.equal((await send("status")).connected, false, "cached credentials are not presented as verified");
    await reset("ok"); local.connection.expiresAt = "invalid-date";
    assert.equal((await send("status")).recovery.code, "SIGN_IN_REQUIRED");
    await reset("mid-auth");
    const partial = await send("autofill");
    assert.equal(partial.recovery.code, "SIGN_IN_REQUIRED");
    assert.equal(await page.locator("#first_name").inputValue(), "Jordan");
    assert.ok(partial.fields.some(field => field.state === "filled"));
    assert.ok(partial.fields.some(field => field.blocked));
    assert.equal(await page.evaluate(() => window.submitted), 0);
    console.log("PASS worker: revoked/expired credentials, HTML 502, network, timeout, rate limits and partial fill preservation");

    const popup = await browser.newPage({ viewport: { width: 320, height: 850 } });
    await popup.route("https://extension.fixture/*", async route => {
      const file = new URL(route.request().url()).pathname.slice(1);
      await route.fulfill({ contentType: file.endsWith("mjs") ? "text/javascript" : file.endsWith("css") ? "text/css" : file.endsWith("png") ? "image/png" : "text/html", body: await readFile(`${directory}/${file}`) });
    });
    await popup.addInitScript(({ buildId, invalid, filled }) => {
      window.calls = [];
      window.nextResult = invalid;
      window.chrome = { permissions: { getAll: async () => ({ origins: [] }) }, runtime: { id: "fixture", onMessage: { addListener(fn) { window.popupProgress = fn; } },
        sendMessage: async message => {
          window.calls.push(message.type);
          if (message.type === "autofill") { window.nextResult = filled; return { ...filled, buildId }; }
          return message.type === "status" ? { ...window.nextResult, error: undefined, tabId: 42, connected: !window.nextResult.reconnect, buildId } : { connected: true, buildId };
        } } };
    }, { buildId: BUILD_ID, invalid, filled });
    await popup.goto("https://extension.fixture/popup.html");
    await popup.getByText("Autofill request rejected", { exact: true }).waitFor();
    assert.ok(await popup.getByText(/not processed$/, { exact: false }).first().isVisible());
    assert.equal(await popup.getByText("Left empty", { exact: true }).count(), 0);
    await popup.getByText("Technical details", { exact: true }).click();
    assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await popup.screenshot({ path: "output/playwright/extension-recovery-320.png", fullPage: true });
    await popup.getByRole("button", { name: "Check extension update" }).click();
    assert.ok(await popup.getByText("Autofill request rejected", { exact: true }).isVisible());
    await popup.getByRole("button", { name: "Retry Autofill", exact: true }).click();
    await popup.locator("#recovery").waitFor({ state: "hidden" });
    await popup.getByText(/3 filled/).first().waitFor();
    await popup.evaluate(({ partial, buildId }) => {
      window.popupProgress({ ...partial, type: "autofill-progress", tabId: 42, buildId }, { id: "fixture" });
    }, { partial, buildId: BUILD_ID });
    await popup.getByRole("button", { name: "Sign in to ApplyOverflow", exact: true }).click();
    assert.equal(await popup.evaluate(() => window.calls.at(-1)), "connect");
    // Render the same recovery component inside the actual serialized on-page assistant.
    await page.addScriptTag({ content: `window.chrome={runtime:{id:"fixture",onMessage:{addListener(fn){window.progressListener=fn},removeListener(){}},sendMessage:async(message)=>{window.indicatorCalls=(window.indicatorCalls||[]).concat(message.type);return message.type==="availability"?{enabled:true,connected:true}:window.indicatorResult}}};` });
    await page.evaluate(partial => { window.indicatorResult = partial; }, partial);
    await page.addScriptTag({ content: await readFile(`${directory}/indicator.js`, "utf8") });
    await page.getByRole("button", { name: /help available|Autofill available/ }).click();
    await page.getByRole("button", { name: "Autofill", exact: true }).click();
    await page.getByRole("button", { name: "Sign in to ApplyOverflow", exact: true }).waitFor();
    assert.ok(await page.getByText("Reconnect your profile", { exact: true }).isVisible());
    assert.equal(await page.getByRole("button", { name: "Autofill", exact: true }).isVisible(), false);
    await page.getByRole("button", { name: "Sign in to ApplyOverflow", exact: true }).click();
    assert.equal(await page.evaluate(() => window.indicatorCalls.at(-1)), "connect");
    await page.screenshot({ path: "output/playwright/extension-recovery-on-page.png", fullPage: true });
    console.log("PASS packaged popup/on-page assistant: actionable alerts, technical details, retry and sign-in, 320px layout");
    await popup.close();
  } finally {
    globalThis.chrome = originalChrome; globalThis.fetch = originalFetch;
    await page.close();
  }
}
