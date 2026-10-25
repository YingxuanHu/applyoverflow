import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { INITIAL_ONBOARDING, ONBOARDING_KEY } from "../../src/lib/profile-setup";
import { deliverAutofillAnnouncement } from "../../src/lib/announcements/delivery";
import { productUnsubscribeToken } from "../../src/lib/announcements/unsubscribe";
import { AUTOFILL_ANNOUNCEMENT, autofillAnnouncementEmail } from "../../src/lib/announcements/content";

const root = process.env.TEST_APP_URL || "http://127.0.0.1:3138";
assert.ok(process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(new URL(root).hostname) && isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), "Local fixture testing only");
assert.ok(new URL(process.env.DATABASE_URL!).pathname.includes("announcement_test") || (process.env.CI === "true" && new URL(process.env.DATABASE_URL!).pathname === "/applyoverflow_test"), "Use a dedicated announcement_test database");
const ids: string[] = [];
const assets = "public/images/autofill-guide";

async function main() {
  const password = randomUUID();
  const id = randomUUID();
  const email = `guide-${id}@example.invalid`;
  const user = await prisma.user.create({ data: {
    id, name: "Jordan Example", email, emailVerified: true, emailNotificationsEnabled: true,
    accounts: { create: { accountId: id, providerId: "credential", password: await hashPassword(password) } },
    profile: { create: {
      name: "Jordan Example", email, location: "Toronto, Ontario, Canada", headline: "Software developer",
      contactJson: { fullName: "Jordan Example", givenName: "Jordan", familyName: "Example", email: "jordan@example.com", phone: "4165550100", phoneCountry: "CA", location: "Toronto, Ontario, Canada", city: "Toronto", region: "Ontario", country: "CA", autofillResume: true },
      preferences: { create: { key: ONBOARDING_KEY, value: JSON.stringify({ ...INITIAL_ONBOARDING, status: "complete", confirmedAt: new Date().toISOString() }) } },
    } },
  }, include: { profile: true } });
  ids.push(user.id);
  assert.equal(user.productUpdatesEnabled, false, "new and migrated accounts must not silently opt in");
  await prisma.document.create({ data: { userId: user.profile!.id, type: "RESUME", title: "Jordan's resume", originalFileName: "Jordan-Example-Resume.pdf", filename: "demo.pdf", mimeType: "application/pdf", sizeBytes: 2400, storageKey: `test-only/${id}.pdf`, isPrimary: true, createdAt: new Date("2026-10-25T12:00:00Z") } });
  let sent = 0;
  const send = async (message: { headers: Record<string, string>; to: string }) => {
    assert.equal(message.to, email);
    assert.equal(message.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    sent++; return true;
  };
  const deliver = (userId: string = id, channel: "in-app" | "email" = "email", sender = send) => deliverAutofillAnnouncement({ db: prisma, userId, channel, origin: root, send: sender });
  assert.equal(await deliver(), "ineligible");
  const notices = await Promise.all([deliver(id, "in-app"), deliver(id, "in-app")]);
  assert.deepEqual(notices.sort(), ["already-notified", "notified"]);
  assert.equal(await prisma.notification.count({ where: { userId: id } }), 1);
  const notice = await prisma.notification.findFirstOrThrow({ where: { userId: id } });
  assert.equal(notice.actionPath, "/extension/guide");
  for (const data of [{ status: "DISABLED" as const, emailVerified: true }, { status: "DELETED" as const, emailVerified: true }, { status: "ACTIVE" as const, emailVerified: false }]) {
    const excluded = await prisma.user.create({ data: { name: "Excluded fixture", email: `${randomUUID()}@example.invalid`, productUpdatesEnabled: true, ...data } });
    ids.push(excluded.id);
    assert.equal(await deliver(excluded.id), "ineligible");
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(90000);
  try {
    await mkdir(assets, { recursive: true }); await mkdir("output/playwright", { recursive: true });
    await page.goto(`${root}/sign-in?callbackUrl=%2Fsettings`);
    await page.getByLabel(/^Email/).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${root}/settings`);
    await page.getByRole("checkbox", { name: /^Email product updates/ }).check();
    await page.getByRole("button", { name: "Save notifications" }).click();
    await page.getByText("Notification preferences saved.", { exact: true }).waitFor();
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id } })).productUpdatesEnabled, true);
    await page.reload();
    assert.equal(await page.getByRole("checkbox", { name: /^Email product updates/ }).isChecked(), true);
    const attempts = await Promise.all([deliver(), deliver()]);
    assert.equal(attempts.filter(value => value === "accepted").length, 1);
    assert.equal(sent, 1, "only one concurrent SMTP send");
    assert.equal(await deliver(), "not-claimed");

    const unknown = await prisma.user.create({ data: { name: "Unknown delivery", email: `${randomUUID()}@example.invalid`, emailVerified: true, productUpdatesEnabled: true } });
    ids.push(unknown.id);
    assert.equal(await deliver(unknown.id, "email", async () => { throw new Error("SMTP timeout"); }), "unknown");
    assert.equal(await deliver(unknown.id, "email", async () => { throw new Error("must not run"); }), "not-claimed");
    const token = productUnsubscribeToken(id);
    const anonymous = await browser.newContext();
    const unsub = await anonymous.newPage();
    await unsub.goto(`${root}/email/product-updates?token=${token}`);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id } })).productUpdatesEnabled, true, "scanner GET does not unsubscribe");
    await unsub.getByRole("button", { name: "Unsubscribe from product updates" }).click();
    await unsub.locator("p:visible").filter({ hasText: "You are unsubscribed" }).waitFor();
    const optedOut = await prisma.user.findUniqueOrThrow({ where: { id } });
    assert.equal(optedOut.productUpdatesEnabled, false);
    assert.equal(optedOut.emailNotificationsEnabled, true);
    assert.equal((await anonymous.request.post(`${root}/api/email/product-updates/unsubscribe?token=${token}`, { form: { "List-Unsubscribe": "One-Click" } })).status(), 200);
    assert.equal((await anonymous.request.post(`${root}/api/email/product-updates/unsubscribe?token=invalid`, { form: { "List-Unsubscribe": "One-Click" } })).status(), 400);
    assert.equal((await anonymous.request.post(`${root}/api/email/product-updates/unsubscribe`, { data: "x".repeat(5000) })).status(), 413);
    await anonymous.close();

    await page.goto(`${root}/notifications`);
    await page.getByRole("link").filter({ hasText: AUTOFILL_ANNOUNCEMENT.title }).click();
    await page.waitForURL(`${root}/extension/guide`);
    await prisma.notification.deleteMany({ where: { userId: id } });
    assert.equal(await deliver(id, "in-app"), "already-notified", "dismissed notices do not reappear");

    if (process.env.UPDATE_GUIDE_SCREENSHOTS === "1") {
    await page.goto(`${root}/profile`);
    const personalDetails = page.getByRole("button", { name: /^Personal details/ });
    if (await personalDetails.getAttribute("aria-expanded") !== "true") await personalDetails.click();
    await page.locator("#contact-full-name").waitFor();
    await page.locator("#profile-section-contact").locator("..").screenshot({ path: `${assets}/profile.png`, style: "main > header { visibility: hidden; } nextjs-portal { display: none; }" });
    await page.goto(`${root}/documents`);
    await page.getByText("Primary", { exact: true }).waitFor();
    await page.locator("#resume-files").screenshot({ path: `${assets}/documents.png`, style: "main > header { visibility: hidden; } nextjs-portal { display: none; }" });

    // Render the actual Store-release popup HTML/CSS with deterministic demo
    // state. No credentials, employer data, downloads or live submissions.
    const published = "96d0322";
    const source = (file: string) => execFileSync("git", ["show", `${published}:extensions/chrome/${file}`], { encoding: "utf8" });
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 600 });
    await popup.route("https://guide-fixture.invalid/**", async route => {
      const name = new URL(route.request().url()).pathname.slice(1);
      if (name === "popup.css") return route.fulfill({ contentType: "text/css", body: source("popup.css") });
      if (name === "icon.png") return route.fulfill({ contentType: "image/png", body: await readFile("output/extension/store/icon.png") });
      return route.fulfill({ contentType: "text/html", body: source("popup.html").replace(/<script[\s\S]*?<\/script>/g, "") });
    });
    await popup.goto("https://guide-fixture.invalid/popup.html");
    await popup.evaluate(() => {
      document.querySelector("#connection-state")!.textContent = "Not connected";
      document.querySelector("#access-state")!.textContent = "Toolbar only";
      document.querySelector("#status")!.textContent = "Connect your profile to get started.";
    });
    await popup.locator("body").screenshot({ path: `${assets}/connect.png` });
    await popup.evaluate(() => {
      (document.querySelector("#connect") as HTMLElement).hidden = true;
      for (const selector of ["#account", "#actions", "#fill-progress"]) (document.querySelector(selector) as HTMLElement).hidden = false;
      document.querySelector("#connection-state")!.textContent = "Connected";
      document.querySelector("#account")!.textContent = "jordan@example.com";
      document.querySelector("#access-state")!.textContent = "All application sites";
      document.querySelector("#status")!.textContent = "Autofill complete. Review the employer form.";
      document.querySelector("#remaining-fields")!.innerHTML = '<strong>8 filled · 1 left empty</strong><p>Availability</p><p class="question-hint">No saved answer. Complete this field on the form.</p>';
      document.querySelector("#completed-list")!.innerHTML = '<li>Name</li><li>Email</li><li>Phone</li><li>Location</li><li>Professional links</li><li>Resume</li><li>Work experience</li><li>Education</li>';
    });
    await popup.locator("body").screenshot({ path: `${assets}/fill.png` });
    await popup.close();
    }

    const publicContext = await browser.newContext();
    const guide = await publicContext.newPage();
    for (const width of [1280, 390]) {
      await guide.setViewportSize({ width, height: 900 });
      await guide.goto(`${root}/extension/guide`);
      await guide.getByRole("heading", { name: "Your first application with autofill" }).waitFor();
      await guide.locator("article img").evaluateAll(images => { for (const image of images) (image as HTMLImageElement).loading = "eager"; });
      await guide.waitForFunction(() => [...document.querySelectorAll("article img")].every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0), null, { timeout: 30000 });
      assert.equal(await guide.locator("article").evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `guide fits ${width}px`);
      assert.equal(await guide.locator("article img").count(), 4);
      assert.equal(await guide.locator('a[href*="chromewebstore.google.com"]').count(), 1);
      await guide.getByRole("link", { name: "5. Autofill", exact: true }).click();
      assert.ok(guide.url().endsWith("#fill"));
      await guide.getByRole("heading", { name: "Your first application with autofill" }).scrollIntoViewIfNeeded();
      await guide.screenshot({ path: `output/playwright/autofill-guide-${width}.png`, fullPage: true, style: "nextjs-portal { display: none; }" });
    }
    const mail = autofillAnnouncementEmail(root, `${root}/email/product-updates`);
    await guide.setViewportSize({ width: 390, height: 900 });
    await guide.setContent(mail.html);
    await guide.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0), null, { timeout: 30000 });
    assert.equal(await guide.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "email fits mobile");
    await guide.screenshot({ path: "output/playwright/autofill-email-mobile.png", fullPage: true });
    await publicContext.close();
    assert.deepEqual(errors, [], "no client errors");
    console.log("PASS: preferences, audience exclusions, concurrent deduplication, dismissed notices, uncertain SMTP, unsubscribe, notification link, demo screenshots, public guide and mobile email");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});
