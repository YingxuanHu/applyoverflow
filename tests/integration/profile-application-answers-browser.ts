import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { hashPassword } from "better-auth/crypto";
import { chromium } from "playwright";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { normalizeApplicationAnswers } from "../../src/lib/profile-application-answers";

async function main() {
  assert.ok(isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), "Local database required");
  const origin = process.env.ASSISTANT_TEST_ORIGIN || "http://127.0.0.1:3006";
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const email = `profile-browser-${randomBytes(8).toString("hex")}@example.test`;
  const password = randomBytes(24).toString("base64url");
  const user = await prisma.user.create({ data: { email, emailVerified: true, name: "Profile Browser Fixture",
    profile: { create: { email, name: "Profile Browser Fixture", contactJson: { email, fullName: "Jordan Example" } } },
  } });
  const browser = await chromium.launch();
  try {
    await prisma.account.create({ data: {
      userId: user.id, providerId: "credential", accountId: user.id, password: await hashPassword(password),
    } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const login = await context.request.post(`${origin}/api/auth/sign-in/email`, {
      headers: { Origin: origin }, data: { email, password },
    });
    assert.equal(login.status(), 200);
    const page = await context.newPage();
    await page.goto(`${origin}/profile`, { waitUntil: "networkidle" });
    const personal = page.getByRole("button", { name: /^Personal details/ });
    if (await personal.getAttribute("aria-expanded") !== "true") await personal.click();
    const answers = page.locator("#application-answers");
    await answers.locator(":scope > summary").click();
    await page.getByLabel("Use my saved answers when I click Autofill").check();
    for (const name of ["Availability and preferences", "Job source and communication", "Commute willingness by location"]) {
      await answers.locator("summary").filter({ hasText: new RegExp(`^${name}$`) }).click();
    }
    await page.getByLabel("Notice period (include units, for example 2 weeks)").fill("2 weeks");
    await page.getByLabel("Willing to travel for work (frequency and destinations unspecified)").selectOption("Yes");
    await page.getByLabel("Join an employer's talent community for future opportunities").selectOption("Yes");
    await page.getByLabel("Receive career newsletters about news, events and opportunities").selectOption("No");
    await page.getByLabel("Receive email job alerts about future opportunities").selectOption("No");
    await page.getByRole("button", { name: "Add commute location", exact: true }).click();
    const commute = page.getByLabel("Commute location (city, state or province, country)");
    await commute.fill("Toronto");
    await page.getByLabel("Willing and able to regularly commute and work in an office at this location").selectOption("Yes");
    assert.equal(await commute.getAttribute("aria-invalid"), "true");
    await page.getByRole("button", { name: "Save profile", exact: true }).click();
    await page.locator("#application-profile").getByText("Check your saved application answers.", { exact: true }).waitFor();
    assert.equal(await commute.inputValue(), "Toronto", "Rejected save preserves editable draft");
    await commute.fill("Toronto, Ontario, Canada");
    await page.getByRole("button", { name: "Save profile", exact: true }).click();
    await page.getByRole("button", { name: "Saved", exact: true }).waitFor();
    const saved = await prisma.userProfile.findUniqueOrThrow({ where: { authUserId: user.id } });
    const contact = saved.contactJson as { applicationAnswers?: unknown };
    const persisted = normalizeApplicationAnswers(contact.applicationAnswers);
    assert.equal(persisted.enabled, true);
    assert.equal(persisted.values.noticePeriod, "2 weeks");
    assert.equal(persisted.values.travel, "Yes");
    assert.equal(persisted.values.talentCommunity, "Yes");
    assert.equal(persisted.values.careerNewsletters, "No");
    assert.equal(persisted.values.jobAlerts, "No");
    assert.equal(persisted.values.authorizedUS, undefined, "Unset choices stay unset");
    assert.deepEqual(persisted.commutes, [{ location: "Toronto, Ontario, Canada", willingness: "Yes" }]);
    await page.reload({ waitUntil: "networkidle" });
    if (await personal.getAttribute("aria-expanded") !== "true") await personal.click();
    await answers.locator(":scope > summary").click();
    for (const name of ["Availability and preferences", "Job source and communication", "Commute willingness by location"]) {
      await answers.locator("summary").filter({ hasText: new RegExp(`^${name}$`) }).click();
    }
    assert.equal(await page.getByLabel("Notice period (include units, for example 2 weeks)").inputValue(), "2 weeks");
    assert.equal(await commute.inputValue(), "Toronto, Ontario, Canada");
    await mkdir("output/playwright/profile-answers", { recursive: true });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await answers.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "No horizontal page overflow");
      const clipped = await answers.locator("input,select,button").evaluateAll(nodes => nodes.filter(node => {
        if (!(node instanceof HTMLElement) || !node.getClientRects().length) return false;
        const rect = node.getBoundingClientRect();
        return rect.left < -1 || rect.right > innerWidth + 1;
      }).map(node => node.getAttribute("aria-label") || node.textContent));
      assert.deepEqual(clipped, [], "Profile controls stay inside the viewport");
      await page.screenshot({ path: `output/playwright/profile-answers/${viewport.width}.png`, fullPage: true });
    }
    console.log("PASS profile optional answers: invalid draft retained, database save/reload, independent consents, desktop/mobile controls");
  } finally {
    await browser.close();
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
