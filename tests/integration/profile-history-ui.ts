import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { hashPassword } from "better-auth/crypto";
import { chromium } from "playwright";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";

async function main() {
  const origin = process.env.TEST_APP_URL;
  assert.match(origin || "", /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL));
  assert.ok(!process.env.DATABASE_URL_DO_PRIVATE);
  const email = `history-ui-${randomBytes(8).toString("hex")}@example.test`;
  const id = `history-ui-${randomBytes(16).toString("hex")}`;
  const password = randomBytes(20).toString("base64url");
  const user = await prisma.user.create({ data: {
    id, name: "History UI Test", email, emailVerified: true, status: "ACTIVE",
    accounts: { create: { providerId: "credential", accountId: id, password: await hashPassword(password) } },
    profile: { create: { name: "History UI Test", email,
      educationsJson: [{ school: "Fixture University", degree: "BSc", fieldOfStudy: "Mathematics", dates: { start: "2016-09", end: "2020-06", current: false } }],
    } },
  } });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(`${origin}/sign-in?callbackUrl=%2Fprofile`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("textbox", { name: /^Email/ }).fill(email);
    await page.getByRole("textbox", { name: "Password", exact: true }).fill(password);
    const loginResponse = page.waitForResponse(response => response.url().endsWith("/api/auth/sign-in/email"));
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const loggedIn = await loginResponse;
    assert.equal(loggedIn.request().postDataJSON().email, email);
    assert.equal(loggedIn.status(), 200, "The disposable test account should sign in");
    await page.waitForURL("**/profile");
    const expand = page.locator('[aria-controls="profile-section-education"]').first();
    await expand.click();
    const education = page.locator("#profile-section-education");
    const save = page.getByRole("button", { name: "Save profile", exact: true });
    await education.getByLabel("Field of study", { exact: true }).fill("Computer Science");
    await save.click();
    await page.getByText("Profile saved.", { exact: true }).waitFor();
    await page.reload(); await expand.click();
    assert.equal(await education.getByLabel("Field of study", { exact: true }).inputValue(), "Computer Science");
    assert.equal(await education.getByLabel("Start day (optional)", { exact: true }).inputValue(), "");
    await education.getByLabel("Start day (optional)", { exact: true }).selectOption("02");
    await education.getByLabel("End day (optional)", { exact: true }).selectOption("03");
    await save.click();
    await page.getByText("Profile saved.", { exact: true }).waitFor();
    await page.reload(); await expand.click();
    assert.equal(await education.getByLabel("Start day (optional)", { exact: true }).inputValue(), "02");
    assert.equal(await education.getByLabel("End day (optional)", { exact: true }).inputValue(), "03");
    const stored = await prisma.userProfile.findUniqueOrThrow({ where: { authUserId: user.id } });
    const history = stored.educationsJson as Array<{ fieldOfStudy: string; dates: { start: string; end: string } }>;
    assert.equal(history[0].fieldOfStudy, "Computer Science");
    assert.equal(history[0].dates.start, "2016-09-02");
    assert.equal(history[0].dates.end, "2020-06-03");
    await mkdir("output/playwright", { recursive: true });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await education.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `output/playwright/profile-history-${width}.png` });
    }
    assert.deepEqual(errors, []);
    console.log("PASS authenticated Profile UI: field-of-study-only save, optional exact dates, persistence, 1440/390/320px layout");
  } finally {
    await browser.close();
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}
void main().catch(async error => { console.error(error); await prisma.$disconnect(); process.exitCode = 1; });
