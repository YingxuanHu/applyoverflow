import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { zipSync, strToU8 } from "fflate";
import { fixtures, fixtureHtml } from "./fixtures/application-extension.mjs";

const browser = await chromium.launch();
const runtime = await readFile(
  "output/extension/local/adapter-runtime.js",
  "utf8",
);
const payload = {
  name: "Jordan Resume.pdf",
  mimeType: "application/pdf",
  base64: Buffer.from("%PDF-1.4\nsynthetic resume\n%%EOF").toString("base64"),
  size: 30,
};
payload.size = Buffer.from(payload.base64, "base64").length;
const outcomes = [];
try {
  for (const fixture of fixtures) {
    const page = await browser.newPage();
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: fixtureHtml(fixture, { resume: true }),
      }),
    );
    const reset = async () => {
      await page.goto(fixture.url);
      await page.addScriptTag({ content: runtime });
    };
    const run = (mode = "inspect", values = {}, url = fixture.url) =>
      page.evaluate(
        ([mode, values, url]) =>
          globalThis.__applyOverflowInspect(mode, values, url),
        [mode, values, url],
      );
    const selector =
      fixture.provider === "ashby"
        ? "#_systemfield_resume"
        : fixture.provider === "lever"
          ? "#resume-upload-input"
          : "#resume";
    await reset();
    assert.equal((await run()).resumeAvailable, true);
    const prepared = await run("prepare-resume");
    await page.addScriptTag({ content: runtime }); // reinjection must preserve exact field binding
    assert.equal(
      (
        await run("attach-resume", {
          ...payload,
          resumeToken: prepared.resumeToken,
        })
      ).resumeSelected,
      true,
    );
    assert.equal(
      await page
        .locator(selector)
        .evaluate(async (field) => await field.files[0].text()),
      Buffer.from(payload.base64, "base64").toString(),
    );
    assert.equal((await run()).resumeAvailable, false);
    assert.ok(
      (
        await run("attach-resume", {
          ...payload,
          resumeToken: prepared.resumeToken,
        })
      ).error,
    );
    assert.equal(await page.locator('[name="consent"]').isChecked(), false);
    assert.equal(
      await page.locator('[name="story"]').inputValue(),
      "Already written; never upload this answer",
    );
    assert.equal(
      await page.evaluate(() => window.submissions + window.steps),
      0,
    );
    if (fixture.provider === "ashby")
      assert.equal(
        await page
          .locator(".ashby-application-form-autofill-input-root input")
          .evaluate((field) => field.files.length),
        0,
      );
    await reset();
    const docxBytes = zipSync({
      "[Content_Types].xml": strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      ),
      "word/document.xml": strToU8(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
      ),
    });
    const docx = await run("prepare-resume");
    assert.equal(
      (
        await run("attach-resume", {
          resumeToken: docx.resumeToken,
          name: "Resume.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          size: docxBytes.length,
          base64: Buffer.from(docxBytes).toString("base64"),
        })
      ).resumeSelected,
      true,
    );
    await reset();
    const changed = await run("prepare-resume");
    await page
      .locator(selector)
      .evaluate((field) => field.replaceWith(field.cloneNode()));
    assert.ok(
      (
        await run("attach-resume", {
          ...payload,
          resumeToken: changed.resumeToken,
        })
      ).error,
    );
    await reset();
    const prefilled = await run("prepare-resume");
    await page.locator(selector).setInputFiles({
      name: "Existing.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("existing"),
    });
    assert.ok(
      (
        await run("attach-resume", {
          ...payload,
          resumeToken: prefilled.resumeToken,
        })
      ).error,
    );
    assert.equal(
      await page.locator(selector).evaluate((field) => field.files[0].name),
      "Existing.pdf",
    );
    await reset();
    await page.locator(selector).evaluate((field) => {
      field.accept = ".docx";
    });
    const incompatible = await run("prepare-resume");
    assert.match(
      (
        await run("attach-resume", {
          ...payload,
          resumeToken: incompatible.resumeToken,
        })
      ).error,
      /not accepted/,
    );
    await reset();
    const navigation = await run("prepare-resume");
    await page.evaluate(() => history.pushState({}, "", "?different-step"));
    assert.ok(
      (
        await run("attach-resume", {
          ...payload,
          resumeToken: navigation.resumeToken,
        })
      ).error,
    );
    await reset();
    const rejected = await run("prepare-resume");
    await page.locator(selector).evaluate((field) =>
      field.addEventListener("change", () => {
        field.value = "";
      }),
    );
    assert.equal(
      (
        await run("attach-resume", {
          ...payload,
          resumeToken: rejected.resumeToken,
        })
      ).resumeSelected,
      false,
    );
    assert.equal(
      (await run()).resumeAvailable,
      false,
      "do not repeat an upload if the widget reset the input",
    );
    await reset();
    await page
      .locator(selector)
      .evaluate((field) => field.parentElement.append(field.cloneNode()));
    assert.equal(
      (await run()).resumeAvailable,
      false,
      "ambiguous resume fields stay manual",
    );
    await reset();
    await page.locator(selector).evaluate((field) => {
      field.disabled = true;
    });
    assert.equal((await run()).resumeAvailable, false);
    outcomes.push({
      provider: fixture.provider,
      attachment: "exact bytes",
      overwrite: 0,
      submission: 0,
    });
    await page.close();
  }
  console.log(
    JSON.stringify({
      pass: true,
      outcomes,
      cases: [
        "exact field binding",
        "single attempt",
        "existing file",
        "accept mismatch",
        "navigation",
        "rejected/reset widget",
        "ambiguity",
        "disabled",
        "no ATS autofill widget",
      ],
    }),
  );
} finally {
  await browser.close();
}
