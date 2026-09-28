import assert from "node:assert/strict";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.ASSISTANT_TEST_ORIGIN || "http://127.0.0.1:3004";
const id = process.env.APPLICATION_EXTENSION_IDS?.split(",")[0];
const profile = resolve(process.env.EXTENSION_TEST_PROFILE || "");
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.match(process.env.ASSISTANT_TEST_EMAIL || "", /^extension-browser-.*@example\.test$/);
assert.ok(profile.startsWith(resolve("output/playwright") + "/"));
assert.match(id, /^[a-p]{32}$/);
const extension = resolve("output/extension/local");
// Keep native permission grants but do not test an imported module cached from
// a prior build of this disposable unpacked package.
await rm(resolve(profile, "Default/Service Worker"), { recursive: true, force: true });
const launch = () => chromium.launchPersistentContext(profile, { channel: "chromium", headless: process.env.EXTENSION_HEADED !== "1",
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
let context = await launch();
let connection;
try {
  context.setDefaultTimeout(30_000);
  let popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.evaluate(async () => { await chrome.storage.local.remove("connection"); await chrome.storage.session.clear(); });
  await context.request.post(`${origin}/api/auth/sign-in/email`, { headers: { Origin: origin }, data: { email: process.env.ASSISTANT_TEST_EMAIL, password: process.env.ASSISTANT_TEST_PASSWORD } });
  await popup.reload();
  await popup.waitForTimeout(500);
  if (await popup.getByRole("button", { name: "Reload extension", exact: true }).isVisible()) {
    await popup.getByRole("button", { name: "Reload extension", exact: true }).click();
    await new Promise(resolve => setTimeout(resolve, 800));
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
  }
  const authPagePromise = context.waitForEvent("page");
  await popup.getByRole("button", { name: "Connect to ApplyOverflow" }).click();
  const auth = await authPagePromise;
  await auth.getByRole("button", { name: "Allow connection" }).waitFor(); await auth.waitForTimeout(800);
  await auth.getByRole("button", { name: "Allow connection" }).click();
  await popup.getByText("Connected. Open an employer application form.").waitFor();
  connection = await popup.evaluate(async () => (await chrome.storage.local.get("connection")).connection);
  assert.equal(connection.email, process.env.ASSISTANT_TEST_EMAIL);
  assert.equal(await popup.evaluate(async () => (await chrome.storage.session.get("connection")).connection), undefined);
  assert.ok(await popup.evaluate(() => chrome.permissions.contains({ origins: ["https://job-boards.greenhouse.io/*"] })), "Approve supported sites in this disposable test profile first");
  const url = "https://job-boards.greenhouse.io/flow-fixture/jobs/123";
  await context.route(url, route => route.fulfill({ contentType: "text/html", body: `
    <h1>Analyst application</h1><div class="job__description">Review reports and build reliable reporting workflows.</div>
    <form><label>First name<input id="first_name"></label><label>Last name<input id="last_name"></label><label>Email<input id="email" type="email"></label>
    <label>Why this role?<textarea id="why"></textarea></label>
    <label>Are you available on Saturdays?<textarea id="availability"></textarea></label><button>Submit</button></form>
    <script>window.submits=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++}</script>` }));
  const form = await context.newPage(); await form.goto(url);
  await form.getByRole("button", { name: "Autofill available" }).click();
  await form.getByRole("button", { name: "Autofill", exact: true }).click();
  await form.waitForFunction(() => document.querySelector('#first_name').value === "Jordan");
  assert.equal(await form.locator("#email").inputValue(), process.env.ASSISTANT_TEST_EMAIL);
  assert.equal(await form.locator("#first_name").inputValue(), "Jordan");
  const assistant = form.locator("#applyoverflow-assistant");
  assert.equal(await assistant.locator("textarea,input,select,form").count(), 0, "Assistant is progress only");
  await assistant.getByRole("button", { name: "Dismiss for this page" }).click();
  await form.waitForFunction(() => document.querySelector('#why').value.length > 10, null, { timeout: 40_000 });
  await form.locator("#why").fill("I would like to apply my report-review experience to this role.");
  assert.equal(await form.locator("#why").inputValue(), "I would like to apply my report-review experience to this role.");
  assert.equal(await form.locator("#availability").inputValue(), "", "Personal availability is not inferred");
  assert.equal(await form.evaluate(() => window.submits), 0);
  await form.screenshot({ path: "output/playwright/extension-profile-backed-flow.png" });
  console.log("PASS MV3 -> authenticated API -> contact and real AI answer inserted directly after closing assistant; edit on form, progress-only assistant, no submission");
  if (process.env.EXTENSION_LIVE_COVERAGE === "1") {
    const live = await context.newPage();
    await live.goto("https://job-boards.greenhouse.io/missionlane/jobs/8848599002", { waitUntil: "load" });
    await live.locator("#first_name").waitFor();
    await live.waitForTimeout(1000);
    // Employer traffic is isolated before any test profile values are inserted.
    // The extension's authenticated localhost API calls remain available.
    await live.route("**/*", route => route.abort());
    await live.routeWebSocket("**/*", socket => socket.close());
    await live.evaluate(() => {
      window.submits = 0;
      document.addEventListener("submit", event => { event.preventDefault(); event.stopImmediatePropagation(); window.submits++; }, true);
    });
    await live.getByRole("button", { name: "Autofill available", exact: true }).click();
    const ui = live.locator("#applyoverflow-assistant");
    await ui.getByRole("button", { name: "Autofill", exact: true }).click();
    await live.waitForFunction(() => document.querySelector('#first_name')?.value === "Jordan");
    const nativeValues = () => live.locator('input,textarea').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).map(n => ({
      label: n.labels?.[0]?.textContent || n.getAttribute('aria-label') || '',
      value: n.closest('.select__value-container')?.querySelector('.select__single-value')?.textContent || n.value,
    })));
    await ui.getByRole('status').filter({ hasText: /Nothing submitted/ }).waitFor({ timeout: 50000 });
    const values = await nativeValues();
    assert.equal(values.find(f => /How did you hear/.test(f.label))?.value, 'Other');
    assert.equal(values.find(f => /Please provide a link/.test(f.label))?.value, 'https://www.linkedin.com/in/example');
    assert.equal(values.find(f => /Are you related/.test(f.label))?.value, 'No');
    assert.equal(values.find(f => /require Mission Lane/.test(f.label))?.value, 'Yes');
    assert.equal(values.find(f => /In which US state/.test(f.label))?.value, '', 'Canadian province must not map to a US state');
    assert.equal(values.find(f => /at least 3 years/.test(f.label))?.value, '', 'Unsupported leadership qualifications must not be inferred');
    const question = live.getByRole('textbox', { name: /^\(Optional\) Is there anything about your experience/ });
    assert.ok((await question.inputValue()).length > 15, 'Non-generic answer inserted automatically from database profile');
    assert.equal(await ui.locator('textarea,input,select,form').count(), 0);
    assert.equal(await live.evaluate(() => window.submits), 0);
    assert.equal(await live.locator('input[type=file]').evaluateAll(nodes => nodes.reduce((sum, n) => sum + n.files.length, 0)), 0);
    await question.scrollIntoViewIfNeeded();
    await live.screenshot({ path: 'output/playwright/coverage/native-mission-lane.png' });
    console.log('PASS live Mission Lane: native MV3, authenticated profile, real dropdowns and direct AI answer; Canadian address preserved, no upload/submission');
  }
  if (process.env.EXTENSION_LIVE_NARRATIVE_URL) {
    const liveUrl = process.env.EXTENSION_LIVE_NARRATIVE_URL;
    assert.match(liveUrl, /^https:\/\/job-boards\.greenhouse\.io\/figma\/jobs\/\d+$/);
    const live = await context.newPage(); await live.goto(liveUrl);
    await live.locator("#first_name").waitFor(); await live.waitForLoadState("load"); await live.waitForTimeout(800);
    await live.evaluate(() => {
      window.submits = 0;
      document.addEventListener("submit", event => { event.preventDefault(); event.stopImmediatePropagation(); window.submits++; }, true);
    });
    await live.bringToFront();
    await live.getByRole("button", { name: "Autofill available" }).click();
    await live.getByRole("button", { name: "Autofill", exact: true }).click();
    const liveAssistant = live.locator("#applyoverflow-assistant");
    assert.equal(await live.locator("#first_name").inputValue(), "Jordan");
    const question = live.getByRole("textbox", { name: /^Why do you want to join Figma/ });
    await live.waitForFunction(() => [...document.querySelectorAll('textarea')].some(field => field.value.length > 10), null, { timeout: 40_000 });
    assert.ok((await question.inputValue()).length > 10);
    assert.equal(await liveAssistant.locator('textarea,input,select,form').count(), 0);
    await question.scrollIntoViewIfNeeded();
    assert.equal(await live.evaluate(() => window.submits), 0);
    assert.equal(await live.locator('input[type="file"]').evaluateAll(fields => fields.reduce((n, field) => n + field.files.length, 0)), 0);
    await live.screenshot({ path: "output/playwright/extension-live-figma-draft.png" });
    console.log("PASS live Figma: profile-backed contact and direct job-context answer; no file upload or submission");
  }
  await context.close();
  context = await launch();
  context.setDefaultTimeout(30_000);
  const reopened = await context.newPage(); await reopened.goto(`chrome-extension://${id}/popup.html`);
  await reopened.getByText("Connected", { exact: true }).waitFor();
  assert.equal(await reopened.evaluate(async () => (await chrome.storage.local.get("connection")).connection.token), connection.token);
  const response = await context.request.post(`${origin}/api/extension/v1/contact`, { headers: { Authorization: `Bearer ${connection.token}` } });
  assert.equal(response.status(), 200);
  await reopened.getByRole("button", { name: "Disconnect", exact: true }).click();
  await reopened.getByText("Not connected", { exact: true }).waitFor();
  assert.equal(await reopened.evaluate(async () => (await chrome.storage.local.get("connection")).connection), undefined);
  assert.equal((await context.request.post(`${origin}/api/extension/v1/contact`, { headers: { Authorization: `Bearer ${connection.token}` } })).status(), 401);
  console.log("PASS actual browser restart retains grant; explicit disconnect clears storage and revokes server access");
} catch (error) {
  for (const page of context.pages()) {
    if (page.url().startsWith("chrome-extension:")) console.log("Popup diagnostic", await page.locator("#status").textContent().catch(() => ""));
    if (page.url().startsWith("https://job-boards.greenhouse.io/"))
      console.log("Flow diagnostic", await page.locator("#applyoverflow-assistant .content").innerText().catch(() => ""));
  }
  throw error;
} finally {
  if (connection) await context.request.post(`${origin}/api/extension/v1/disconnect`, { headers: { Authorization: `Bearer ${connection.token}` } }).catch(() => {});
  await context.close();
}
