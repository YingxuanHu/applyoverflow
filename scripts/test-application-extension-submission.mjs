import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { createSubmissionInspector } from "../extensions/chrome/submission.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";

// Every URL is intercepted; submit events only change synthetic DOM. No user
// profile, employer request, resume upload or real application is involved.
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const url = "https://careers.fixture.example/jobs/engineer/application";
  let html;
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html }));
  const source = `window.submission=(${createSubmissionInspector})();window.inspect=(${createInspector})(${applicationContext},(${createHistoryInspector})(),(${createAutofillInspector})(),window.submission)`;
  const form = (extra = "", action = "", title = "Submit application") => `<h1>Engineer application</h1>
    <form id="job-application-form"><label>Name<input id="name" required value="Jordan Example"></label>
    <label>Email<input id="email" required type="email" value="jordan@example.test"></label>${extra}
    <button id="submit">${title}</button></form><script>window.submits=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++;${action}};</script>`;
  const success = "document.querySelector('form').replaceWith(Object.assign(document.createElement('h2'),{textContent:'Application submitted'}))";
  const load = async (body = form(), destination = url) => { html = body; await page.goto(destination); await page.evaluate(source); };
  const inspect = (mode = "submission-preview", payload = { token: "test-token" }) =>
    page.evaluate(({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload });
  const commit = (extra = {}) => inspect("submission-commit", { token: "test-token", confirmed: true, ...extra });

  await load(form("", success));
  const ready = await inspect();
  assert.equal(ready.ready, true, JSON.stringify(ready));
  assert.equal(await page.evaluate(() => window.submits), 0);
  assert.equal((await commit()).clicked, true);
  assert.equal(await page.evaluate(() => window.submits), 1);
  assert.equal((await page.evaluate(() => window.submission("outcome"))).outcome, "confirmed");
  console.log("PASS prepare never submits; explicit one-use approval submits once and detects new employer confirmation");

  const blockers = [
    ["missing text", '<label>City<input required></label>'],
    ["missing select", '<label>Authorization<select required><option value="">Select</option><option>Yes</option></select></label>'],
    ["missing radio", '<fieldset><legend>Available</legend><label><input required type="radio" name="a" value="yes">Yes</label></fieldset>'],
    ["legal agreement", '<label><input type="checkbox" required>I certify the information is accurate</label>'],
    ["hidden required text", '<label hidden>Required ID<input required></label>'],
    ["invalid number", '<label>Years<input required type="number" min="2" value="1"></label>'],
    ["invalid email", '<label>Alternate email<input type="email" value="bad"></label>'],
    ["bad employer pattern", '<label>Reference<input pattern="[a|]+" value="aaa"></label>'],
    ["custom required dropdown", '<div role="combobox" aria-label="School" aria-required="true">Example University</div>'],
    ["native search is not committed selection", '<input role="combobox" aria-label="School" required value="Example University">'],
    ["custom button dropdown", '<button type="button" aria-label="Degree" aria-haspopup="listbox" aria-required="true">Bachelor</button>'],
    ["choice group", '<div><label>Legally entitled to work in Canada?</label><button type="button" aria-pressed="true">Yes</button><button type="button" aria-pressed="false">No</button></div>'],
    ["missing file", '<label>Resume<input type="file" required></label>'],
    ["pending upload", '<div aria-busy="true">Uploading</div>'],
    ["employer error", '<p role="alert">Please correct your answer</p>'],
    ["invalid custom field", '<input aria-label="Zip" aria-invalid="true" value="123">'],
    ["captcha", '<div class="g-recaptcha" data-sitekey="fixture"></div>'],
    ["embedded controls", '<iframe src="about:blank"></iframe>'],
    ["multi-step", '<button type="button">Save and Continue</button>'],
    ["duplicate submit", '<button type="button">Submit application</button>'],
    ["password", '<label>Password<input type="password" value="fixture"></label>'],
    ["preexisting success", '<h2>Application submitted</h2>'],
    ["unsaved history editor", '<section><h2>Education</h2><button type="button">Save</button></section>'],
    ["application fee", '<p>Application fee: $5</p>'],
    ["payment control", '<label>Credit card<input autocomplete="cc-number" value="fixture"></label>'],
    ["oversized answer", '<label>Reason<textarea maxlength="5">Too long to send</textarea></label>'],
    ["undersized answer", '<label>Reason<textarea minlength="20">Short</textarea></label>'],
    ["step indicator", '<ol><li aria-current="step">Experience</li></ol>'],
    ["verification cap", '<label>Detail<input></label>'.repeat(501)],
  ];
  for (const [name, extra] of blockers) {
    await load(form(extra));
    const checked = await inspect();
    assert.ok(checked.ready === false || checked.error, name);
    assert.ok(checked.blockers?.length || checked.error, name);
    const stopped = await commit();
    assert.ok(stopped.clicked === false || stopped.error, name);
    assert.equal(await page.evaluate(() => window.submits), 0, name);
  }
  await load(form());
  await page.locator("form").evaluate(root => root.append(document.createElement("custom-field")));
  await page.locator("custom-field").evaluate(node => node.attachShadow({ mode: "open" }).innerHTML = '<input required>');
  assert.equal((await inspect()).ready, false);
  await load();
  await page.locator("form").evaluate(root => {
    const label = document.createElement("label"); label.textContent = "Outside detail";
    const input = document.createElement("input"); input.required = true; input.setAttribute("form", root.id);
    label.append(input); root.after(label);
  });
  assert.equal((await inspect()).ready, false, "form-associated controls outside the DOM subtree are verified too");
  console.log(`PASS ${blockers.length + 2} required-field, validation, upload, CAPTCHA, multi-step and ambiguity gates`);

  const mutations = [
    ["answer", () => { document.querySelector("#name").value = "Changed"; }],
    ["same-value replacement", () => { const n = document.querySelector("#name"); n.replaceWith(n.cloneNode()); }],
    ["declaration", () => { document.querySelector("form").prepend(Object.assign(document.createElement("p"), { textContent: "New certification" })); }],
    ["destination", () => { document.querySelector("form").action = "/different"; }],
    ["button", () => { const n = document.querySelector("#submit"); n.replaceWith(n.cloneNode(true)); }],
    ["URL", () => { history.pushState({}, "", "?different=1"); }],
    ["expiry", () => { const now = Date.now(); Date.now = () => now + 91_000; }],
  ];
  for (const [name, change] of mutations) {
    await load();
    assert.equal((await inspect()).ready, true);
    await page.evaluate(change);
    assert.equal((await commit()).clicked, false, name);
    assert.equal(await page.evaluate(() => window.submits), 0, name);
  }
  await load();
  await inspect();
  assert.equal((await inspect("submission-commit", { token: "wrong", confirmed: true })).clicked, false);
  assert.equal((await commit()).clicked, false, "wrong tokens consume approval too");
  await inspect();
  assert.equal((await inspect("submission-commit", { token: "test-token" })).clicked, false, "approval must be explicit");
  console.log("PASS stale values, replaced controls, changed declarations/destinations/URL, expiry, bad tokens and missing consent never submit");

  await load(form('<label>Resume<input id="resume" type="file" required></label>', success));
  await page.locator("#resume").setInputFiles({ name: "Fixture.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic test document") });
  assert.equal((await inspect()).files, 1);
  assert.equal((await commit()).clicked, false, "native file selection requires separate upload inspection approval");
  await inspect();
  assert.equal((await commit({ documentsReviewed: true })).clicked, true);
  assert.equal(await page.evaluate(() => window.submits), 1);
  await load(form('<label>Resume<input id="resume" type="file" required></label>'));
  await page.evaluate(() => {
    const data = new DataTransfer(); data.items.add(new File(["original"], "Fixture.txt", { lastModified: 1 }));
    document.querySelector("#resume").files = data.files;
  });
  await inspect();
  await page.evaluate(() => {
    const data = new DataTransfer(); data.items.add(new File(["modified"], "Fixture.txt", { lastModified: 1 }));
    document.querySelector("#resume").files = data.files;
  });
  assert.equal((await commit({ documentsReviewed: true })).clicked, false, "replaced file bytes with identical metadata invalidate approval");

  await load(form('<label>Availability<select required><option selected>Today</option></select></label><label><input type="checkbox" required checked>I certify accuracy</label>', success));
  assert.equal((await inspect()).ready, true);
  assert.equal((await commit()).clicked, true);
  const replay = await commit();
  assert.ok(replay.clicked === false || replay.error);
  assert.equal(await page.evaluate(() => window.submits), 1);
  await load();
  await inspect();
  await page.locator("#submit").click();
  assert.equal((await commit()).clicked, false, "a user's direct submission invalidates pending extension approval");
  assert.equal(await page.evaluate(() => window.submits), 1);
  await load(form("", "document.querySelector('form').remove()"));
  await inspect(); await commit();
  assert.equal((await page.evaluate(() => window.submission("outcome"))).outcome, "unverified", "form disappearance alone is not acceptance");
  console.log("PASS explicit document inspection, completed legal choices, replay prevention and click-only uncertainty");

  // Exercise the shipped worker with mocked Chrome transport and real browser
  // DOM inspection. This verifies orchestration, not native MV3 permissions.
  execFileSync(process.execPath, ["scripts/build-application-extension.mjs", "--test-output"], { stdio: "pipe" });
  const directory = "output/extension/package-test/production";
  const runtime = await readFile(`${directory}/adapter-runtime.js`, "utf8");
  const { BUILD_ID } = await import(pathToFileURL(resolve(`${directory}/config.mjs`)).href);
  let local = {}, session = {}, listener, docId = "doc-1", failClickResponse = false, serverApplied = false, apiUnavailable = false, trackingUnavailable = false;
  const apiCalls = [];
  const storage = name => ({
    get: async key => { const state = name === "local" ? local : session; return structuredClone(key === null ? state :
      Object.fromEntries((Array.isArray(key) ? key : [key]).filter(k => k in state).map(k => [k, state[k]]))); },
    set: async values => Object.assign(name === "local" ? local : session, structuredClone(values)),
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete (name === "local" ? local : session)[key]; },
    setAccessLevel: async () => {},
  });
  const event = { addListener() {} };
  const tab = () => ({ id: 7, url: page.url() });
  globalThis.chrome = {
    runtime: { id: "fixture", getURL: path => `chrome-extension://fixture/${path}`, onInstalled: event, onStartup: event,
      onMessage: { addListener: fn => { listener = fn; } }, sendMessage: async () => {} },
    permissions: { getAll: async () => ({ origins: [] }), contains: async () => false, onAdded: event, onRemoved: event },
    storage: { local: storage("local"), session: storage("session") },
    tabs: { query: async () => [tab()], get: async () => tab(), onRemoved: event, sendMessage: async () => {}, create: async () => {} },
    scripting: {
      getRegisteredContentScripts: async () => [],
      executeScript: async args => {
        if (args.target.documentIds && args.target.documentIds[0] !== docId) throw new Error("Document replaced");
        if (args.files) { await page.evaluate(runtime); return [{ documentId: docId, frameId: 0 }]; }
        const result = await page.evaluate(({ code, values }) => (0, eval)(`(${code})`)(...values), { code: args.func.toString(), values: args.args });
        if (failClickResponse && args.args?.[1] === "submission-commit") { failClickResponse = false; throw new Error("Response lost after click"); }
        return [{ result, documentId: docId, frameId: 0 }];
      },
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (endpoint, init) => {
    const action = endpoint.split("/").at(-1);
    apiCalls.push({ action, body: JSON.parse(init.body) });
    if (apiUnavailable) return Response.json({ error: "Matching backend unavailable" }, { status: 404 });
    if (action === "connection-status") return Response.json({ connected: true });
    if (action === "submission-check") return Response.json({ alreadyApplied: serverApplied });
    if (action === "applied") return trackingUnavailable ? Response.json({ error: "Tracker unavailable" }, { status: 503 }) : Response.json({ id: "tracked-fixture" });
    throw new Error(`Unexpected API call ${action}`);
  };
  await import(pathToFileURL(resolve(`${directory}/background.mjs`)).href);
  const sender = { id: "fixture", url: "chrome-extension://fixture/popup.html" };
  const send = (type, data = {}, from = sender) => new Promise(resolveResult => {
    let replied = false;
    const accepted = listener({ type, buildId: BUILD_ID, ...data }, from, value => { replied = true; setImmediate(() => resolveResult(value)); });
    if (!accepted && !replied) resolveResult(null);
  });
  const reset = async (body = form("", success)) => {
    await load(body); docId = `doc-${Math.random()}`; session = {};
    local = { connection: { token: "synthetic-token", origin: "https://applyoverflow.com", email: "fixture@example.test", expiresAt: new Date(Date.now() + 60_000).toISOString() } };
    apiCalls.length = 0; serverApplied = apiUnavailable = trackingUnavailable = false;
  };
  await reset();
  assert.equal(await send("submission-preview", {}, { id: "fixture", url, tab: tab(), frameId: 0, documentId: docId }), null, "content scripts cannot approve submissions");
  assert.match((await send("submission-preview", { buildId: "old" })).error, /updat|Reopen/);
  let reviewed = await send("submission-preview");
  assert.equal(reviewed.submissionReview.ready, true, JSON.stringify(reviewed));
  assert.equal(await page.evaluate(() => window.submits), 0);
  let result = await send("submission-commit", { token: reviewed.submissionReview.token, confirmed: true });
  assert.equal(result.submissionResult.outcome, "confirmed", JSON.stringify(result));
  assert.equal(await page.evaluate(() => window.submits), 1);
  assert.equal(apiCalls.filter(call => call.action === "applied").length, 1);
  assert.ok(Object.keys(local).some(key => key.startsWith("submission-attempt:")));
  assert.ok(!JSON.stringify(local).includes("Jordan Example"), "no answers persist in attempt history");
  await load(form("", success), url.replace("engineer", "analyst"));
  assert.equal((await send("status")).submissionResult, null, "old results do not appear on another job in the same tab");
  await load(form("", success));
  assert.match((await send("submission-preview")).error, /already attempted/);
  console.log("PASS worker origin/build gates, authenticated checks, confirmation-only tracking and persistent duplicate-attempt lock");

  await reset(); serverApplied = true;
  assert.match((await send("submission-preview")).error, /already records/);
  serverApplied = false; apiUnavailable = true;
  assert.equal((await send("submission-preview")).recovery.code, "SERVICE_UNAVAILABLE");
  assert.equal(await page.evaluate(() => window.submits), 0);
  await reset(); reviewed = await send("submission-preview");
  local.connection.token = "different-account-token";
  assert.match((await send("submission-commit", { token: reviewed.submissionReview.token, confirmed: true })).error, /expired|changed/);
  await reset(); reviewed = await send("submission-preview");
  await page.locator("#name").fill("Changed by user");
  result = await send("submission-commit", { token: reviewed.submissionReview.token, confirmed: true });
  assert.equal(result.submissionResult.outcome, "blocked");
  assert.equal(Object.keys(local).filter(key => key.startsWith("submission-attempt:")).length, 0, "verified no-click failures do not lock the job");
  assert.equal(await page.evaluate(() => window.submits), 0);
  await reset(); reviewed = await send("submission-preview"); failClickResponse = true;
  result = await send("submission-commit", { token: reviewed.submissionReview.token, confirmed: true });
  assert.equal(result.submissionResult.outcome, "confirmed");
  assert.equal(await page.evaluate(() => window.submits), 1, "lost responses never replay a click");
  await reset(); reviewed = await send("submission-preview"); trackingUnavailable = true;
  result = await send("submission-commit", { token: reviewed.submissionReview.token, confirmed: true });
  assert.equal(result.submissionResult.outcome, "confirmed", "tracking failure does not erase employer acceptance");
  assert.match(result.message, /Tracking could not be saved/);
  assert.equal(await page.evaluate(() => window.submits), 1);
  await reset(form()); reviewed = await send("submission-preview");
  const pending = send("submission-commit", { token: reviewed.submissionReview.token, confirmed: true });
  await page.waitForFunction(() => window.submits === 1);
  assert.match((await send("submission-commit", { token: reviewed.submissionReview.token, confirmed: true })).error, /Submitting once/);
  result = await pending;
  assert.equal(result.submissionResult.outcome, "unverified");
  assert.equal(apiCalls.filter(call => call.action === "applied").length, 0);
  assert.equal(await page.evaluate(() => window.submits), 1);
  console.log("PASS server duplicates, missing backend, changed account/values, lost click response, concurrent clicks and uncertain acceptance");
  globalThis.fetch = originalFetch;

  const popup = await browser.newPage({ viewport: { width: 320, height: 900 } });
  await popup.route("https://extension.fixture/*", async route => {
    const file = new URL(route.request().url()).pathname.slice(1);
    const body = file === "config.mjs" ? 'export const APP_ORIGIN="https://applyoverflow.com";export const BUILD_ID="fixture";' :
      file === "icon.png" ? await readFile("public/brand/applyoverflow-favicon.png") : await readFile(`extensions/chrome/${file}`);
    await route.fulfill({ contentType: file.endsWith("mjs") ? "text/javascript" : file.endsWith("css") ? "text/css" : file.endsWith("png") ? "image/png" : "text/html", body });
  });
  await popup.addInitScript(() => {
    window.calls = [];
    window.chrome = { permissions: { getAll: async () => ({ origins: [] }) }, runtime: {
      id: "fixture", onMessage: { addListener() {} }, sendMessage: async message => {
        window.calls.push(message);
        return { buildId: "fixture", connected: true, message: "Ready", ...(message.type === "submission-preview" ? {
          submissionReview: { ready: true, fields: 8, required: 5, files: 1, blockerCount: 0, blockers: [], token: "fixture-approval", expires: Date.now() + 90_000,
            title: "Engineer", company: "Fixture", url: "https://careers.fixture.example/jobs/engineer/application" },
        } : message.type === "submission-commit" ? { submissionResult: { outcome: "confirmed", message: "Application submitted. Added to your applications." } } : {}) };
      },
    } };
  });
  await popup.goto("https://extension.fixture/popup.html");
  await popup.getByRole("button", { name: "Review & submit", exact: true }).click();
  const submitButton = popup.getByRole("button", { name: "Submit application", exact: true });
  assert.equal(await submitButton.isDisabled(), true);
  await popup.locator("#submission-approved").check();
  assert.equal(await submitButton.isDisabled(), true, "documents require separate review");
  await popup.locator("#submission-documents").check();
  assert.equal(await submitButton.isEnabled(), true);
  assert.equal(await popup.evaluate(() => document.documentElement.scrollWidth <= 320), true);
  await mkdir("output/playwright/submission", { recursive: true });
  await popup.screenshot({ path: "output/playwright/submission/review-320.png", fullPage: true });
  await submitButton.click();
  await popup.getByText("Application submitted. Added to your applications.", { exact: true }).waitFor();
  const submitted = await popup.evaluate(() => window.calls.filter(message => message.type === "submission-commit"));
  assert.deepEqual(submitted, [{ type: "submission-commit", token: "fixture-approval", confirmed: true, documentsReviewed: true, buildId: "fixture" }]);
  console.log("PASS 320px popup: separate per-application and upload approvals, explicit submit, no duplicated answer editor");
} finally {
  await browser.close();
}
