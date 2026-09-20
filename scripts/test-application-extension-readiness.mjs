import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { installIndicator } from "../extensions/chrome/indicator.mjs";

// Synthetic pages only. Exercise the shipped indicator and popup with explicit
// permission/session fixtures; never read a real profile or submit an application.
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.route("**/*", (route) => route.fulfill({
    contentType: "text/html", body: "<h1>Application questions</h1><label>Relevant project<textarea>My answer</textarea></label>",
  }));
  await page.goto("https://fixture.wd1.myworkdayjobs.com/External/job/Toronto/Analyst_R123/apply/questions");
  await page.evaluate(() => {
    window.messages = [];
    window.listeners = [];
    window.access = { enabled: true, connected: false };
    window.scan = {
      available: 0, resumeAvailable: false, undoAvailable: false,
      historyAvailable: false, historyUndoAvailable: false,
      questions: ["Relevant project"],
    };
    window.__applyOverflowInspect = async () => window.scan;
    window.chrome = { runtime: {
      sendMessage: async (message) => {
        window.messages.push(message.type);
        if (message.type === "availability") return window.access;
        return { connected: window.access.connected, message: "Questions opened." };
      },
      onMessage: { addListener: (fn) => window.listeners.push(fn), removeListener: () => {} },
    } };
  });
  await page.evaluate(`(${installIndicator.toString()})()`);
  await page.getByRole("button", { name: "Application help available" }).click();
  await page.getByRole("button", { name: "Connect to ApplyOverflow" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Autofill" }).isVisible(), false);
  await page.evaluate(() => {
    window.access.connected = true;
    window.listeners.forEach((fn) => fn({ type: "connection-changed" }));
  });
  await page.getByText("More actions", { exact: true }).click();
  await page.getByRole("button", { name: "Review questions" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Connect to ApplyOverflow" }).isVisible(), false);
  assert.deepEqual(await page.evaluate(() => window.messages), ["availability", "availability"]);
  await page.getByRole("button", { name: "Review questions" }).click();
  await page.getByRole("status").filter({ hasText: "Questions opened." }).waitFor();
  assert.equal(await page.locator("textarea").inputValue(), "My answer");

  await page.evaluate(() => {
    window.scan.questions = [];
    window.scan.historyAvailable = true;
    history.pushState({}, "", location.pathname + "?history=1");
  });
  await page.getByRole("button", { name: "Application help available" }).click();
  await page.getByText("Work and education fields detected.", { exact: false }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Review questions" }).isVisible(), false);
  await page.evaluate(() => {
    window.access.enabled = false;
    window.listeners.forEach((fn) => fn({ type: "permissions-changed" }));
  });
  await page.locator("#applyoverflow-assistant").waitFor({ state: "detached" });
  assert.ok((await page.evaluate(() => window.messages)).every((type) => ["availability", "review"].includes(type)));
  console.log("PASS: question/history-only hints, reconnect updates, permission revocation, no automatic profile fetch or writes");

  const popup = await browser.newPage({ viewport: { width: 320, height: 780 } });
  await popup.route("https://extension.fixture/*", async (route) => {
    const file = new URL(route.request().url()).pathname.slice(1);
    const body = file === "config.mjs"
      ? 'export const APP_ORIGIN = "https://applyoverflow.com";'
      : file === "icon.png"
        ? await readFile("public/brand/applyoverflow-favicon.png")
        : await readFile(`extensions/chrome/${file}`);
    await route.fulfill({ contentType: file.endsWith("mjs") ? "text/javascript" : file.endsWith("css") ? "text/css" : file.endsWith("png") ? "image/png" : "text/html", body });
  });
  await popup.addInitScript(() => {
    window.granted = [];
    window.calls = [];
    window.busy = location.search.includes("busy");
    window.chrome = {
      permissions: {
        getAll: async () => ({ origins: window.granted }),
        request: async ({ origins }) => { window.granted = origins; return true; },
        remove: async () => { window.granted = []; return true; },
      },
      runtime: { sendMessage: async ({ type }) => {
        window.calls.push(type);
        if (type === "status") return {
          connected: false,
          activeAction: window.busy ? "connect" : null,
          message: window.busy ? "Connection in progress. Complete or close the ApplyOverflow sign-in window to continue." : "Connect to your ApplyOverflow profile.",
          pageMessage: "6 empty contact fields · 4 questions",
          form: { contactFields: 6, questions: 4, historyAvailable: false },
        };
        return { connected: true, email: "fixture@example.test", message: "Connected." };
      } },
    };
  });
  await popup.goto("https://extension.fixture/popup.html");
  await popup.getByText("Not connected", { exact: true }).waitFor();
  await popup.getByText("Toolbar only", { exact: true }).waitFor();
  await popup.getByText("6 empty contact fields · 4 questions", { exact: true }).waitFor();
  assert.deepEqual(await popup.evaluate(() => window.calls), ["status"]);
  await popup.getByText("Connection & site access", { exact: true }).click();
  await popup.getByLabel("Show autofill on supported sites").check();
  await popup.getByText("Supported sites enabled", { exact: true }).waitFor();
  await popup.getByRole("button", { name: "Connect to ApplyOverflow" }).click();
  await popup.getByText("Connected", { exact: true }).waitFor();
  await popup.getByRole("button", { name: "Autofill" }).waitFor();
  assert.deepEqual(await popup.evaluate(() => window.calls), ["status", "detection-updated", "connect"]);
  await mkdir("output/playwright", { recursive: true });
  await popup.screenshot({ path: "output/playwright/extension-readiness.png" });
  assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  console.log("PASS: independent profile/site-access status, explicit consent only, compact 320px popup");
  await popup.goto("https://extension.fixture/popup.html?busy");
  await popup.getByText(/Connection in progress/).waitFor();
  assert.equal(await popup.getByRole("button", { name: "Connect to ApplyOverflow" }).isDisabled(), true);
  await popup.evaluate(() => { window.busy = false; });
  await popup.getByText("Connect to your ApplyOverflow profile.", { exact: true }).waitFor();
  assert.equal(await popup.getByRole("button", { name: "Connect to ApplyOverflow" }).isEnabled(), true);
  assert.ok((await popup.evaluate(() => window.calls)).every(type => type === "status"));
  console.log("PASS: reopened popup explains pending consent, blocks duplicate actions and recovers without reopening");
} finally {
  await browser.close();
}
