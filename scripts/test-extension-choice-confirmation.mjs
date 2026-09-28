import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { createHistoryInspector } from "../extensions/chrome/history.mjs";
import { createAutofillInspector } from "../extensions/chrome/autofill.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";

const source = `(${createInspector})(${applicationContext},(${createHistoryInspector})(),(${createAutofillInspector})())`;
const url = "https://careers.choice-fixture.example/jobs/42/apply";

function mount(scenario) {
  const input = document.getElementById("country");
  const list = document.getElementById("country-options");
  const selectedId = document.getElementById("country-id");
  const state = window.fixture = {
    optionClicks: 0, committed: "", searches: [], deliveries: [], finalBatch: false,
    submissions: 0, continuations: 0,
  };
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); };
  input.onclick = () => {
    list.hidden = false; input.setAttribute("aria-expanded", "true");
  };
  input.onkeydown = event => { if (event.key === "Escape") close(); };
  const commit = option => {
    state.committed = "ca";
    selectedId.value = "ca";
    option.setAttribute("aria-selected", "true");
    if (scenario === "selected-token") {
      const token = document.createElement("div"); token.className = "select__single-value";
      token.textContent = "Canada"; input.before(token); input.value = "";
    } else input.value = "Canada";
    close();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const option = id => {
    const node = document.createElement("div");
    node.id = id; node.setAttribute("role", "option"); node.setAttribute("aria-selected", "false");
    node.textContent = "Canada";
    node.onclick = () => {
      state.optionClicks++;
      if (scenario === "ignored-click") return;
      if (scenario === "close-only") { close(); return; }
      commit(node);
    };
    return node;
  };
  input.oninput = () => {
    if (state.committed) return;
    list.replaceChildren();
    if (input.value.toLowerCase() !== "canada") return;
    state.searches.push(input.value);
    const ambiguous = scenario.includes("ambiguity");
    if (scenario === "busy-delayed-ambiguity") list.setAttribute("aria-busy", "true");
    setTimeout(() => {
      list.replaceChildren(option("country-ca-1"));
      state.deliveries.push(1);
      if (!ambiguous) state.finalBatch = true;
    }, 40);
    if (ambiguous) setTimeout(() => {
      // A second server batch makes the initially unique visible label unsafe.
      // Deliver even after an early click so the regression exposes that race.
      list.replaceChildren(option("country-ca-1"), option("country-ca-2"));
      list.removeAttribute("aria-busy");
      state.deliveries.push(2); state.finalBatch = true;
    }, 120);
  };
  document.querySelector("form").onsubmit = event => { event.preventDefault(); state.submissions++; };
  document.getElementById("continue").onclick = () => state.continuations++;
}

const html = scenario => `<!doctype html><html><head><title>Analyst application</title></head><body>
  <h1>Analyst application</h1><form>
  <label for="first">First name</label><input id="first" autocomplete="given-name">
  <label for="email">Email</label><input id="email" type="email" autocomplete="email">
  <label for="country">Country</label><div class="select__value-container">
    <input id="country" role="combobox" aria-autocomplete="list" aria-haspopup="listbox"
      aria-controls="country-options" aria-expanded="false" aria-required="true">
  </div><input id="country-id" type="hidden" name="countryId">
  <label><input id="consent" type="checkbox">I certify these answers are accurate</label>
  <button type="button" id="continue">Continue</button><button type="submit">Submit application</button>
  </form><div id="country-options" role="listbox" hidden></div>
  <script>(${mount})(${JSON.stringify(scenario)})</script></body></html>`;

const cases = [
  ["ignored-click", "ignored option clicks are not filled and clear transient search", false],
  ["close-only", "closing a popup without committing is not a selected value", false],
  ["selected-text", "a committed generic option is filled even when its label equals the search", true],
  ["selected-token", "a committed display token is filled with an empty search input", true],
  ["delayed-ambiguity", "a delayed duplicate label prevents an early option click", false],
  ["busy-delayed-ambiguity", "busy asynchronous results settle before uniqueness is decided", false],
];

function mountPronouns({ widget, initial = "" }) {
  const state = window.fixture = { optionClicks: 0, changes: 0, submissions: 0, continuations: 0 };
  const host = document.getElementById("pronouns-control");
  const labels = ["She/her/hers", "He/him/his", "They/them/theirs", "Prefer not to say"];
  if (initial && !labels.includes(initial)) labels.push(initial);
  const field = document.createElement(widget === "native" ? "select" : "input");
  field.id = "pronouns";
  host.append(field);
  field.onchange = () => state.changes++;
  if (widget === "native") {
    field.add(new Option("Choose", ""));
    for (const label of labels) field.add(new Option(label, label));
  } else {
    field.setAttribute("role", "combobox");
    field.setAttribute("aria-autocomplete", "list");
    field.setAttribute("aria-controls", "pronouns-options");
    field.setAttribute("aria-expanded", "false");
    const list = document.createElement("div");
    list.id = "pronouns-options"; list.setAttribute("role", "listbox"); list.hidden = true;
    document.body.append(list);
    const close = () => { list.hidden = true; field.setAttribute("aria-expanded", "false"); };
    field.onclick = () => { list.hidden = false; field.setAttribute("aria-expanded", "true"); };
    field.onkeydown = event => { if (event.key === "Escape") close(); };
    for (const label of labels) {
      const option = document.createElement("div"); option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(label === initial)); option.textContent = label;
      option.onclick = () => {
        state.optionClicks++; field.value = label; option.setAttribute("aria-selected", "true"); close();
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      };
      list.append(option);
    }
  }
  field.value = initial;
  document.querySelector("form").onsubmit = event => { event.preventDefault(); state.submissions++; };
  document.getElementById("continue").onclick = () => state.continuations++;
}

const pronounsHtml = config => `<!doctype html><html><head><title>Analyst application</title></head><body>
  <h1>Analyst application</h1><form>
  <label for="first">First name</label><input id="first" autocomplete="given-name">
  <label for="email">Email</label><input id="email" type="email" autocomplete="email">
  <label for="pronouns">Pronouns</label><div id="pronouns-control"></div>
  <label><input id="consent" type="checkbox">I certify these answers are accurate</label>
  <button type="button" id="continue">Continue</button><button type="submit">Submit application</button>
  </form><script>(${mountPronouns})(${JSON.stringify(config)})</script></body></html>`;

const pronounCases = [
  { name: "she / her explicitly matches She/her/hers", saved: "she / her", selected: "She/her/hers" },
  { name: "they/them explicitly matches They/them/theirs", saved: "they/them", selected: "They/them/theirs" },
  { name: "he / him explicitly matches He/him/his", saved: "he / him", selected: "He/him/his" },
  { name: "unknown pronouns do not choose a standard set", saved: "xe/xem" },
  { name: "an unknown sentinel does not become Prefer not to say", saved: "unknown" },
  { name: "combined she/they does not choose either standard set", saved: "she/they" },
  { name: "combined sets are not reduced to their first match", saved: "she/her or they/them" },
  { name: "missing pronouns do not infer a selection" },
  { name: "an existing combined selection is preserved", saved: "she / her", initial: "She/they" },
  { name: "an existing unknown selection is preserved", saved: "they/them", initial: "Xe/xem" },
];

const browser = await chromium.launch();
try {
  for (const [scenario, name, selected] of cases) await test(name, async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: html(scenario) }));
      await page.goto(url);
      await page.evaluate(code => { window.inspect = (0, eval)(code); }, source);
      const inspect = (mode, payload = {}) => page.evaluate(
        ({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload },
      );
      const report = await inspect("autofill", { contact: { country: "CA" } });
      await page.waitForFunction(() => window.fixture.finalBatch);
      const readState = () => page.evaluate(() => ({
        ...window.fixture,
        input: document.getElementById("country").value,
        selectedId: document.getElementById("country-id").value,
        display: document.querySelector(".select__single-value")?.textContent || "",
        consent: document.getElementById("consent").checked,
      }));
      const state = await readState();
      const field = report.fields.find(item => item.profileKey === "country");
      assert.ok(field, "the generic Country combobox must be detected");
      assert.equal(field.kind, "combobox");
      assert.deepEqual(state.searches, ["Canada"], "the fixture must exercise asynchronous search");
      const ambiguous = scenario.includes("ambiguity");
      assert.deepEqual(state.deliveries, ambiguous ? [1, 2] : [1]);
      assert.deepEqual({
        clicks: state.optionClicks, committed: state.committed, selectedId: state.selectedId,
        input: state.input, display: state.display, reportState: field.state,
        filledChoices: report.fields.filter(item => item.profileKey === "country" && item.state === "filled").length,
        submissions: state.submissions, continuations: state.continuations, consent: state.consent,
      }, {
        clicks: ambiguous ? 0 : 1, committed: selected ? "ca" : "", selectedId: selected ? "ca" : "",
        input: scenario === "selected-text" ? "Canada" : "", display: scenario === "selected-token" ? "Canada" : "",
        reportState: selected ? "filled" : "needed", filledChoices: selected ? 1 : 0,
        submissions: 0, continuations: 0, consent: false,
      }, `${scenario}: a typed query or an option click alone is not a committed selection`);
      const rescanned = await inspect("inspect");
      assert.equal(rescanned.fields.find(item => item.profileKey === "country")?.state, selected ? "filled" : "needed",
        "fresh inspection must not resurrect a failed search as filled or preserved");
      if (selected) {
        await inspect("autofill", { contact: { country: "US" } });
        const preserved = await readState();
        assert.equal(preserved.committed, "ca", "a later autofill must preserve the committed choice");
        assert.equal(preserved.optionClicks, 1, "preserving a choice must not click another option");
      }
    } finally {
      await context.close();
    }
  });
  for (const widget of ["native", "custom"]) for (const scenario of pronounCases) await test(`${widget}: ${scenario.name}`, async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: pronounsHtml({ widget, initial: scenario.initial }) }));
      await page.goto(url);
      await page.evaluate(code => { window.inspect = (0, eval)(code); }, source);
      const inspect = (mode, payload = {}) => page.evaluate(
        ({ mode, payload }) => window.inspect(mode, payload, location.href), { mode, payload },
      );
      const report = await inspect("autofill", { contact: scenario.saved ? { pronouns: scenario.saved } : {} });
      const field = report.fields.find(item => item.profileKey === "pronouns");
      assert.ok(field, "the Pronouns control must be detected as an explicit profile field");
      assert.equal(field.kind, widget === "native" ? "select" : "combobox");
      const expected = scenario.initial || scenario.selected || "";
      const expectedState = scenario.initial ? "kept" : scenario.selected ? "filled" : "needed";
      assert.equal(field.state, expectedState);
      assert.equal(await page.getByLabel("Pronouns", { exact: true }).inputValue(), expected,
        "only an explicit grammar equivalent may be selected; unmatched queries must be cleared");
      const state = await page.evaluate(() => ({ ...window.fixture, consent: document.getElementById("consent").checked }));
      assert.equal(state.optionClicks, scenario.selected && widget === "custom" ? 1 : 0);
      // Search cleanup may emit change events, but must not commit an option.
      if (widget === "native" || scenario.initial || scenario.selected) assert.equal(state.changes, scenario.selected ? 1 : 0);
      assert.equal(state.submissions, 0); assert.equal(state.continuations, 0); assert.equal(state.consent, false);
      assert.equal((await inspect("inspect")).fields.find(item => item.profileKey === "pronouns")?.state, expectedState);
      if (scenario.selected || scenario.initial) {
        await inspect("autofill", { contact: { pronouns: expected === "He/him/his" ? "she/her" : "he/him" } });
        assert.equal(await page.getByLabel("Pronouns", { exact: true }).inputValue(), expected,
          "later fills must preserve an existing choice, including unknown or combined pronouns");
        assert.deepEqual(await page.evaluate(() => window.fixture), {
          optionClicks: state.optionClicks, changes: state.changes, submissions: 0, continuations: 0,
        });
      }
    } finally {
      await context.close();
    }
  });
} finally {
  await browser.close();
}
