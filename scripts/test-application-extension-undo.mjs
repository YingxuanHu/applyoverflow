import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createInspector } from "../extensions/chrome/adapter.mjs";
import { applicationContext } from "../extensions/chrome/sites.mjs";
import { fixtures, fixtureHtml } from "./fixtures/application-extension.mjs";

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  let fixture = fixtures[0];
  await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: fixtureHtml(fixture) }));
  const source = `(${createInspector.toString()})(${applicationContext.toString()})`;
  const contact = { fullName: "Jordan Example", givenName: "Jordan", familyName: "Example", email: "jordan@example.test", phone: "+14165550100", linkedInUrl: "https://www.linkedin.com/in/example" };
  const reset = async () => {
    await page.goto(fixture.url);
    await page.evaluate(source => { window.inspect = (0, eval)(source); }, source);
  };
  const inspect = mode => page.evaluate(({ mode, contact }) => window.inspect(mode, mode === "fill" ? contact : {}, location.href), { mode, contact });
  for (fixture of fixtures) {
    await reset();
    assert.equal((await inspect("inspect")).undoAvailable, false);
    const filled = await inspect("fill");
    assert.ok(filled.filled > 0);
    assert.equal(filled.undoAvailable, true);
    const cleared = await inspect("undo");
    assert.equal(cleared.undone, filled.filled);
    assert.equal(cleared.unverified, 0);
    assert.equal((await inspect("inspect")).undoAvailable, false);
    assert.equal((await inspect("undo")).undone, 0);
    assert.deepEqual(await page.evaluate(() => [window.submissions, window.steps]), [0, 0]);
    console.log(`PASS: ${fixture.provider} contact undo, repeat undo, no Next/Submit`);
  }
  fixture = fixtures[0];
  await reset();
  const first = await inspect("fill");
  // A user's edit remains protected even if they change it back to our value.
  await page.locator("#first_name").fill("Changed");
  await page.locator("#first_name").fill(contact.givenName);
  await page.locator("#email").fill("other@example.test");
  const edited = await inspect("undo");
  assert.equal(edited.undone, first.filled - 2);
  assert.equal(edited.kept, 2);
  assert.equal(await page.locator("#first_name").inputValue(), contact.givenName);
  assert.equal(await page.locator("#email").inputValue(), "other@example.test");
  for (const change of ["replace", "disabled", "readonly", "hidden", "ambiguous"]) {
    await reset();
    const filled = await inspect("fill");
    await page.evaluate(change => {
      const field = document.querySelector("#first_name");
      if (change === "replace") field.replaceWith(field.cloneNode(true));
      else if (change === "ambiguous") field.parentElement.after(field.parentElement.cloneNode(true));
      else field.setAttribute(change, "");
    }, change);
    const result = await inspect("undo");
    assert.equal(result.undone, filled.filled - 1, change);
    assert.equal(await page.locator("#first_name").first().inputValue(), contact.givenName, change);
  }
  await reset();
  await inspect("fill");
  await page.evaluate(() => history.pushState({}, "", "/ao-fixture/jobs/999"));
  assert.equal((await inspect("undo")).undone, 0);
  assert.equal(await page.locator("#first_name").inputValue(), contact.givenName);
  await reset();
  await page.clock.install();
  await inspect("fill");
  await page.clock.fastForward(10 * 60_000 + 1);
  assert.equal((await inspect("undo")).undone, 0);
  assert.equal(await page.locator("#first_name").inputValue(), contact.givenName);
  console.log("PASS: edits, replaced/disabled/readonly/hidden/ambiguous fields, navigation and expiry never cleared");
} finally {
  await browser.close();
}
