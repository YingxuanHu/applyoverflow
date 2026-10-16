import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

// Real packaged MV3 worker and content scripts, synthetic pages/accounts only.
// The disposable manifest pregrants HTTPS to exercise post-consent behavior;
// package tests separately require this permission to remain optional in shipping builds.
execFileSync(process.execPath, ["scripts/build-application-extension.mjs", "--test-output"], { stdio: "pipe" });
const directory = resolve("output/extension/origin-access-test");
await mkdir(directory, { recursive: true });
await cp(resolve("output/extension/package-test/production"), directory, { recursive: true });
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, "utf8"));
manifest.host_permissions = ["https://*/*"];
await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest));
const context = await chromium.launchPersistentContext("", { channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`] });
const facts = { givenName: "Jordan", familyName: "Example", email: "jordan@example.test", phone: "4165550100" };
let apiCalls = 0, submissions = 0;
const form = (kind = "form", label = "First Name") => `<h1>Job application</h1><${kind} ${kind === "div" ? 'role="form"' : ""}>
  <label>${label}<input></label><label>Email<input type="email"></label><label>Phone<input type="tel"></label>
  <button type="button">Submit application</button></${kind}>`;
await context.route("**/*", async route => {
  const url = new URL(route.request().url());
  if (!['http:', 'https:'].includes(url.protocol)) return route.continue();
  if (url.hostname === "applyoverflow.com") {
    if (!url.pathname.startsWith('/api/extension/v1/')) return route.fulfill({ contentType: 'text/html', body: '<h1>Fixture setup</h1>' });
    const action = url.pathname.split("/").at(-1);
    if (action === "connection-status") return route.fulfill({ json: { connected: true } });
    if (action === "onboarding-event") return route.fulfill({ json: { ok: true } });
    if (action === "autofill-plan") { apiCalls++; return route.fulfill({ json: { contact: facts, answers: [], history: [], revision: "2026-10-12T00:00:00Z", includeResume: false } }); }
    throw new Error(`Unexpected API ${action}`);
  }
  if (route.request().method() !== "GET") { submissions++; return route.abort(); }
  if (url.hostname === "parent.example") return route.fulfill({ contentType: "text/html", body:
    '<h1>Careers</h1><iframe title="Application" src="https://embedded.example/jobs/1/apply"></iframe><iframe title="Newsletter" src="https://newsletter.example/subscribe"></iframe>' });
  if (url.hostname === "newsletter.example") return route.fulfill({ contentType: "text/html", body: '<h1>Newsletter</h1><form><label>Email<input type="email"></label></form>' });
  const index = Number(url.searchParams.get("variant") || 0);
  const unlabelled = `<form><div><p>Full Name *</p><input placeholder="First name"><input placeholder="Last name"></div>
    <div><p>Email</p><input type="email" placeholder="Email address"></div><input type="tel" placeholder="Enter phone number"><button>Submit application</button></form>`;
  return route.fulfill({ contentType: "text/html", body: `<style>body{font:16px system-ui}label,input{display:block;margin:8px}</style>${index % 4 === 3 ? unlabelled : form(index % 2 ? "div" : "form", ["First Name", "Legal First Name", "Given name"][index % 3])}` });
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => chrome.storage.local.set({ connection: { token: "synthetic-fixture", origin: "https://applyoverflow.com",
    email: "synthetic@example.test", expiresAt: new Date(Date.now() + 3600000).toISOString() } }));
  const page = await context.newPage();
  await worker.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      if ((await chrome.scripting.getRegisteredContentScripts()).some(script => script.id === 'application-detection')) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Application detection was not registered');
  });
  const count = Number(process.env.EXTENSION_ORIGIN_CASES || 30);
  for (let i = 0; i < count; i++) {
    await page.goto(`https://employer-${i}.example/careers/apply?variant=${i}#applynow`);
    const hint = page.getByRole("button", { name: /^(?:Autofill|Application help) available$/ });
    try { await hint.waitFor({ timeout: 15000 }); }
    catch (error) {
      const diagnostics = await worker.evaluate(async () => ({
        permissions: await chrome.permissions.getAll(), scripts: await chrome.scripting.getRegisteredContentScripts(),
        frames: await chrome.scripting.executeScript({ target: { tabId: (await chrome.tabs.query({active:true}))[0].id },
          func: async () => ({ scan: await globalThis.__applyOverflowInspect?.(), indicator: !!globalThis.__applyOverflowIndicator,
            hidden: document.hidden, assistant: document.querySelector('#applyoverflow-assistant')?.shadowRoot?.textContent }) }),
      }));
      console.log(JSON.stringify(diagnostics, null, 2));
      throw error;
    }
    const before = apiCalls;
    await hint.click();
    assert.equal(apiCalls, before, "detection never fetches profile data");
    await page.locator('#applyoverflow-assistant').getByRole('button', { name: 'Autofill', exact: true }).click();
    try { await page.waitForFunction(() => document.querySelector('input[type="email"]').value === "jordan@example.test", null, {timeout:10000}); }
    catch (error) {
      console.log({ apiCalls, progress: await page.locator('#applyoverflow-assistant .content').innerText() });
      throw error;
    }
    try { await page.locator('#applyoverflow-assistant .fill-counts').filter({ hasText: `${i % 4 === 3 ? 4 : 3} filled` }).waitFor({timeout:10000}); }
    catch (error) { console.log({ apiCalls, progress: await page.locator('#applyoverflow-assistant .content').innerText() }); throw error; }
    assert.equal(await page.locator('input').first().inputValue(), facts.givenName);
    if (i % 4 === 3) assert.equal(await page.getByPlaceholder('Last name').inputValue(), facts.familyName);
    assert.equal(await page.locator('input[type="tel"]').inputValue(), facts.phone);
  }
  assert.equal(submissions, 0);
  console.log(`PASS ${count} unlisted synthetic domains: real MV3 detection, consented scope, toolbar-independent fill, 3-4 values read back per form, including grouped placeholders`);
  await page.goto("https://parent.example/careers");
  const child = page.frameLocator('iframe[title="Application"]');
  await child.getByRole("button", { name: /^(?:Autofill|Application help) available$/ }).waitFor();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await page.bringToFront();
  const result = await popup.evaluate(async () => {
    const { BUILD_ID } = await import(chrome.runtime.getURL("config.mjs"));
    return chrome.runtime.sendMessage({ type: "autofill", buildId: BUILD_ID });
  });
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(await child.locator('input[type="email"]').inputValue(), facts.email);
  assert.equal(await page.frameLocator('iframe[title="Newsletter"]').locator('input').inputValue(), "");
  assert.equal(submissions, 0);
  console.log("PASS toolbar discovers one accessible custom embedded form and never fills neighbouring newsletter frame");
} finally { await context.close(); }
