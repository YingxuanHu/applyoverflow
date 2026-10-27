import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { GETTING_STARTED_KEY, parseGuideState } from "../../src/lib/getting-started";
import { AUTOFILL_ANNOUNCEMENT } from "../../src/lib/announcements/content";
import { initializeNewUserSetup } from "../../src/lib/new-user-setup";

const root = process.env.TEST_APP_URL ?? "http://127.0.0.1:3142";
assert.ok(process.env.NODE_ENV !== "production" &&
  ["localhost", "127.0.0.1"].includes(new URL(root).hostname) &&
  isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL) &&
  new URL(process.env.DATABASE_URL!).pathname.includes("_test"), "Use an isolated local test database");

async function main() {
  const password = randomUUID();
  const email = `getting-started-${randomUUID()}@example.invalid`;
  const legacyId = randomUUID();
  const legacyEmail = `getting-started-existing-${randomUUID()}@example.invalid`;
  const browser = await chromium.launch();
  // Distinct proxy client for this loopback-only suite; retain real auth limits.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", extraHTTPHeaders: { "X-Real-IP": "192.0.2.44" } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const popup = page.getByRole("dialog");
  const shot = async (name: string) => {
    if (name !== "failure") await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLImageElement>('[role="dialog"] img')).every((img) => img.complete && img.naturalWidth > 0));
    return page.screenshot({ path: `output/playwright/getting-started-${name}.png`, fullPage: true });
  };
  let accountId: string | undefined;
  try {
    await mkdir("output/playwright", { recursive: true });
    await page.goto(`${root}/sign-up`);
    // Exercise the real auth create hook without sending any verification email.
    const signup = await context.request.post(`${root}/api/auth/sign-up/email`, {
      headers: { Origin: root }, data: { name: "Jordan Setup", email, password },
    });
    assert.equal(signup.status(), 200, await signup.text());
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { profile: true } });
    accountId = user.id;
    assert.equal(user.productUpdatesEnabled, false);
    const profileId = user.profile!.id;
    const readState = async () => parseGuideState((await prisma.userPreference.findUniqueOrThrow({
      where: { userId_key: { userId: profileId, key: GETTING_STARTED_KEY } },
    })).value);
    assert.equal((await readState()).status, "new");
    const noticeWhere = { userId: user.id, actionPath: AUTOFILL_ANNOUNCEMENT.path };
    assert.equal(await prisma.notification.count({ where: noticeWhere }), 1);
    await initializeNewUserSetup(prisma, user.id, profileId);
    assert.equal(await prisma.notification.count({ where: noticeWhere }), 1);
    await prisma.notification.deleteMany({ where: noticeWhere });
    await initializeNewUserSetup(prisma, user.id, profileId);
    assert.equal(await prisma.notification.count({ where: noticeWhere }), 0, "dismissed announcements stay dismissed");
    const delivery = await prisma.announcementDelivery.findUniqueOrThrow({ where: { userId_campaignKey: { userId: user.id, campaignKey: AUTOFILL_ANNOUNCEMENT.key } } });
    assert.equal(delivery.emailStatus, "NOT_SENT");
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    await page.goto(`${root}/sign-in`);
    await page.getByLabel(/^Email/).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("heading", { name: "Start with your resume" }).waitFor();
    assert.equal(await popup.count(), 0, "no competing tour during profile onboarding");
    await page.getByRole("button", { name: "Finish later", exact: true }).click();
    await page.waitForURL(`${root}/jobs`);
    await popup.getByRole("heading", { name: "Review your profile", exact: true }).waitFor();
    await page.getByTestId("setup-spotlight").waitFor();
    await shot("desktop-profile");
    // Keyboard focus stays in the modal, not on the dimmed page.
    await page.keyboard.press("Tab");
    assert.equal(await popup.evaluate((element) => element.contains(document.activeElement)), true);
    await popup.getByRole("button", { name: "Next / skip", exact: true }).click();
    await popup.getByRole("heading", { name: "Choose your resume", exact: true }).waitFor();
    await popup.getByRole("button", { name: "Finish later", exact: true }).click();
    await popup.waitFor({ state: "hidden" });
    assert.equal((await readState()).step, 1);
    await page.reload();
    await page.getByRole("button", { name: "Getting started", exact: true }).waitFor();
    assert.equal(await popup.count(), 0, "a deferred guide stays closed after reload");
    await page.getByRole("button", { name: "Getting started", exact: true }).click();
    await popup.getByRole("heading", { name: "Choose your resume", exact: true }).waitFor();
    await popup.getByRole("button", { name: "Add or choose resume", exact: true }).click();
    await page.waitForURL(`${root}/documents`);
    assert.equal(await popup.count(), 0, "navigation releases the page for real setup");
    await page.getByRole("button", { name: "Getting started", exact: true }).click();
    await popup.getByRole("button", { name: "Step 3: Tell us what fits", exact: true }).click();
    await popup.getByRole("button", { name: "Set job preferences", exact: true }).click();
    await page.waitForURL(`${root}/profile#job-preferences`);
    await page.locator("#job-preferences").waitFor();
    await page.getByRole("button", { name: "Getting started", exact: true }).click();
    await popup.getByRole("button", { name: "Step 4: Install and connect", exact: true }).click();
    const install = popup.getByRole("link", { name: "Install from Chrome Web Store" });
    assert.match((await install.getAttribute("href"))!, /mhkkioknljkgnhgnhcamilkgbadjnmil/);
    await shot("desktop-connect");
    await popup.getByRole("button", { name: "Check my connection", exact: true }).click();
    await page.waitForURL(`${root}/extension/setup`);
    assert.equal(await popup.count(), 0);
    assert.equal(await prisma.extensionConnection.count({ where: { userId: user.id } }), 0);
    await page.getByRole("button", { name: "Getting started", exact: true }).click();
    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByTestId("setup-spotlight").waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("setup-spotlight").waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await shot("mobile-connect");
    await popup.getByRole("button", { name: "Step 5: Try autofill, then review", exact: true }).click();
    await popup.getByLabel("Practice full name").fill("My edited example");
    await popup.getByRole("button", { name: "Try Autofill", exact: true }).click();
    assert.equal(await popup.getByLabel("Practice full name").inputValue(), "My edited example");
    assert.equal(await popup.getByLabel("Practice city").inputValue(), "Toronto");
    await popup.getByLabel("Practice city").fill("Ottawa");
    await shot("mobile-demo");
    await popup.getByRole("button", { name: "Reset practice form", exact: true }).click();
    assert.equal(await popup.getByLabel("Practice city").inputValue(), "");
    await popup.getByRole("button", { name: "Finish guide", exact: true }).click();
    await popup.waitFor({ state: "hidden" });
    assert.equal((await readState()).status, "complete");
    assert.equal(await prisma.extensionConnection.count({ where: { userId: user.id } }), 0);
    const unchanged = await prisma.userProfile.findUniqueOrThrow({ where: { id: profileId } });
    assert.deepEqual(unchanged.contactJson, user.profile!.contactJson, "guide/demo does not modify the real profile");
    await page.reload();
    assert.equal(await popup.count(), 0);

    // An older account can opt into the guide without an unsolicited welcome.
    await prisma.user.create({ data: {
      id: legacyId, name: "Existing Fixture", email: legacyEmail, emailVerified: true,
      accounts: { create: { accountId: legacyId, providerId: "credential", password: await hashPassword(password) } },
      profile: { create: { name: "Existing Fixture", email: legacyEmail } },
    } });
    assert.equal((await context.request.post(`${root}/api/auth/sign-out`, { headers: { Origin: root }, data: {} })).status(), 200);
    assert.equal((await context.request.post(`${root}/api/auth/sign-in/email`, { headers: { Origin: root }, data: { email: legacyEmail, password } })).status(), 200);
    await page.goto(`${root}/jobs`);
    await page.getByRole("button", { name: "Getting started", exact: true }).waitFor();
    assert.equal(await popup.count(), 0);
    await page.getByRole("button", { name: "Getting started", exact: true }).click();
    await popup.getByRole("heading", { name: "Review your profile", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await popup.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Getting started", exact: true }).click();
    await page.route("**/*", (route) => route.request().headers()["next-action"]
      ? route.abort("internetdisconnected") : route.continue());
    await popup.getByRole("button", { name: "Next / skip", exact: true }).click();
    await popup.getByRole("alert").filter({ hasText: "Check your connection" }).waitFor();
    await popup.getByRole("button", { name: "Close without saving", exact: true }).click();
    await popup.waitFor({ state: "hidden" });
    await page.unroute("**/*");
    await page.getByRole("button", { name: "Getting started", exact: true }).click();
    // A session switch cannot write the old account's guide into the new account.
    assert.equal((await context.request.post(`${root}/api/auth/sign-out`, { headers: { Origin: root }, data: {} })).status(), 200);
    assert.equal((await context.request.post(`${root}/api/auth/sign-in/email`, { headers: { Origin: root }, data: { email, password } })).status(), 200);
    await popup.getByRole("button", { name: "Next / skip", exact: true }).click();
    await popup.getByRole("alert").filter({ hasText: "account changed" }).waitFor();
    assert.equal((await readState()).status, "complete");
    await popup.getByRole("button", { name: "Close without saving", exact: true }).click();
    await popup.waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
    console.log("PASS: actual signup hook, one-time notice/no email, old-account behavior, wizard isolation, highlights/focus, skip/resume, real setup destinations, small/mobile layouts, editable demo, guide-vs-connection separation, account switch, offline exit and Escape");
  } catch (error) {
    await shot("failure");
    console.error((await page.locator("body").innerText()).slice(0, 5000));
    throw error;
  } finally {
    await browser.close();
    await prisma.user.deleteMany({ where: { id: { in: [accountId, legacyId].filter((id): id is string => Boolean(id)) } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
