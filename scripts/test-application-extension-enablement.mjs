import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

execFileSync(process.execPath, ["scripts/build-application-extension.mjs", "--test-output"], { stdio: "pipe" });
const packaged = resolve("output/extension/package-test/production");
const { BUILD_ID } = await import(pathToFileURL(`${packaged}/config.mjs`).href);
await mkdir("output/playwright", { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const popup = await browser.newPage({ viewport: { width: 320, height: 950 } });
  const errors = [];
  popup.on("pageerror", error => errors.push(error.message));
  await popup.route("https://extension.fixture/*", async route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    await route.fulfill({ contentType: file.endsWith("mjs") ? "text/javascript" : file.endsWith("css") ? "text/css" : file.endsWith("png") ? "image/png" : "text/html", body: await readFile(`${packaged}/${file}`) });
  });
  await popup.addInitScript(buildId => {
    window.requests = [];
    window.messages = [];
    window.acceptPermission = true;
    // Start with a per-site grant, precisely the old prominent button's behavior.
    const read = () => JSON.parse(localStorage.getItem("grants") || '["https://employer.example/*"]');
    window.chrome = {
      runtime: { getManifest: () => ({ name: "ApplyOverflow" }), onMessage: { addListener() {} },
        sendMessage: async message => { window.messages.push(message.type); return { buildId, connected: false, message: "Connect your account." }; } },
      permissions: {
        getAll: async () => ({ origins: read() }),
        contains: async ({ origins }) => origins.every(origin => read().includes(origin) || read().includes("https://*/*")),
        request: async ({ origins }) => {
          window.requests.push({ origins, gesture: navigator.userActivation.isActive });
          if (!window.acceptPermission) return false;
          localStorage.setItem("grants", JSON.stringify([...new Set([...read(), ...origins])]));
          return true;
        },
        remove: async ({ origins }) => { localStorage.setItem("grants", JSON.stringify(read().filter(origin => !origins.includes(origin)))); return true; },
      },
      tabs: { query: async () => [{ url: "https://employer.example/jobs/1" }] },
      storage: { local: { get: async () => JSON.parse(localStorage.getItem("preferences") || "{}"),
        set: async value => localStorage.setItem("preferences", JSON.stringify(value)) } },
    };
  }, BUILD_ID);
  await popup.goto("https://extension.fixture/popup.html");
  const enable = popup.getByRole("button", { name: "Enable on all application sites", exact: true });
  await enable.waitFor();
  assert.equal(await popup.locator("#access-state").textContent(), "This site enabled");
  assert.deepEqual(await popup.evaluate(() => window.requests), [], "no silent permission requests");
  await popup.screenshot({ path: "output/playwright/one-time-enablement-before.png" });
  await popup.evaluate(() => { window.acceptPermission = false; });
  await enable.click();
  await popup.getByText("Site access was not granted. You can still use the toolbar.").waitFor();
  assert.equal(await enable.isVisible(), true);
  await popup.evaluate(() => { window.acceptPermission = true; });
  await enable.click();
  await popup.getByText("Enabled on all application sites. This choice is saved; no need to enable each site.").waitFor();
  assert.equal(await enable.isVisible(), false);
  assert.deepEqual(await popup.evaluate(() => window.requests), [
    { origins: ["https://*/*"], gesture: true }, { origins: ["https://*/*"], gesture: true },
  ]);
  assert.equal(await popup.evaluate(() => window.messages.includes("autofill")), false);
  await popup.reload();
  await popup.getByText("All application sites", { exact: true }).waitFor();
  assert.equal(await enable.isVisible(), false);
  assert.deepEqual(await popup.evaluate(() => window.requests), [], "reopening does not request again");
  await popup.getByText("Connection & site access", { exact: true }).click();
  assert.equal(await popup.locator("#all-detection").isChecked(), true);
  await popup.screenshot({ path: "output/playwright/one-time-enablement-after.png" });
  assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await popup.locator("#all-detection").uncheck();
  await popup.getByText("Site access updated. The toolbar still works.").waitFor();
  await enable.waitFor();
  await popup.getByRole("button", { name: "Not now", exact: true }).click();
  await popup.reload();
  await popup.getByText("This site enabled", { exact: true }).waitFor();
  assert.equal(await enable.isVisible(), false, "declining the offer is remembered");
  assert.deepEqual(errors, []);
  console.log("PASS popup: explicit all-site gesture, denial/retry, persisted enablement, revocation and dismissed offer; zero implicit fills");
} finally { await browser.close(); }

// Actual MV3 registrations and browser restart. Only this disposable test manifest
// pregrants access; shipping builds retain optional permissions and Chrome consent.
const directory = resolve("output/extension/enablement-test");
await mkdir(directory, { recursive: true });
await cp(packaged, directory, { recursive: true });
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, "utf8"));
manifest.host_permissions = ["https://*/*"];
await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest));
const profile = await mkdtemp(resolve("output/playwright/enablement-profile-"));
let context;
let apiCalls = 0;
try {
  for (let boot = 0; boot < 2; boot++) {
    context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true,
      args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`] });
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (!["http:", "https:"].includes(url.protocol)) return route.continue();
      if (url.pathname.startsWith("/api/extension/")) { apiCalls++; return route.abort(); }
      return route.fulfill({ contentType: "text/html", body: url.hostname === "ordinary.example"
        ? '<h1>Newsletter</h1><label>Email<input type="email"></label>'
        : '<h1>Job application</h1><form><label>First name<input></label><label>Email<input type="email"></label><label>Phone<input type="tel"></label><button>Submit application</button></form>' });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      for (let n = 0; n < 100; n++) {
        if ((await chrome.scripting.getRegisteredContentScripts()).length) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error("Detection registration missing");
    });
    const script = (await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts()))[0];
    assert.equal(script.persistAcrossSessions, true);
    assert.equal(script.allFrames, true);
    assert.deepEqual(script.matches, ["https://*/*"]);
    const page = await context.newPage();
    for (const domain of ["employer-a.example", "employer-b.example"]) {
      await page.goto(`https://${domain}/careers/apply?boot=${boot}`);
      await page.getByRole("button", { name: /^(Autofill|Application help) available$/ }).waitFor();
      assert.equal(await page.locator("input").first().inputValue(), "");
      assert.equal(await page.locator("#applyoverflow-assistant").count(), 1);
    }
    await page.goto("https://ordinary.example/newsletter");
    await page.waitForTimeout(750);
    assert.equal(await page.locator("#applyoverflow-assistant").count(), 0, "no assistant on non-application pages");
    await context.close();
    context = null;
  }
  assert.equal(apiCalls, 0, "detection never requests profile data");
  console.log("PASS packaged MV3: two employer domains, full browser restart, persistent all-frame registration, no profile fetch or automatic fill, no newsletter indicator");
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
