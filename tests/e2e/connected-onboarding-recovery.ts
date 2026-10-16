import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium, type BrowserContext, type Page } from "playwright";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../../src/lib/db";
import { buildProfileFormValues } from "../../src/lib/profile";
import { INITIAL_ONBOARDING, ONBOARDING_KEY, parseOnboardingState } from "../../src/lib/profile-setup";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";

const root = process.env.TEST_APP_URL ?? "http://127.0.0.1:3004";
async function main() {
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(root).hostname) && isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL), "Disposable local fixtures only");
  const browser = await chromium.launch({ headless: true });
  const users: string[] = [];
  const password = randomUUID();
  let activePage: Page | undefined;
  const login = async (context: BrowserContext, email: string) => {
    const response = await context.request.post(`${root}/api/auth/sign-in/email`, { headers: { Origin: root }, data: { email, password } });
    assert.equal(response.ok(), true, "fixture sign-in succeeds");
  };
  try {
    await mkdir("output/playwright", { recursive: true });
    const identities = [];
    for (const label of ["First", "Second"]) {
      const id = randomUUID(), email = `recovery-${id}@example.invalid`;
      const user = await prisma.user.create({ data: { id, email, name: `${label} Fixture`, emailVerified: true,
        accounts: { create: { accountId: id, providerId: "credential", password: await hashPassword(password) } },
        profile: { create: { name: `${label} Fixture`, email, summary: "Existing summary" } },
      }, include: { profile: true } });
      users.push(id); identities.push(user);
      await prisma.userPreference.create({ data: { userId: user.profile!.id, key: ONBOARDING_KEY, value: JSON.stringify({
        ...INITIAL_ONBOARDING, version: 2, step: 1, status: "deferred", profileUpdatedAt: user.profile!.updatedAt.toISOString(),
        draft: buildProfileFormValues(user.profile!, user),
      }) } });
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(90_000);
    const destination = `/extension/setup?context=${"x".repeat(43)}`;
    await page.goto(`${root}${destination}`);
    const signup = page.getByRole("button", { name: "Set up autofill", exact: true });
    await signup.waitFor();
    assert.equal(new URL(await signup.getAttribute("href") ?? "", root).searchParams.get("callbackUrl"), destination);
    await page.getByRole("link", { name: "Sign in", exact: true }).last().click();
    await page.getByRole("link", { name: /Forgot password/ }).click();
    assert.equal(new URL(page.url()).searchParams.get("callbackUrl"), destination, "password recovery retains setup context");

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(`${root}/extension/setup`);
    await mobilePage.getByText("Extension needs desktop Chrome", { exact: true }).waitFor();
    assert.equal(await mobilePage.getByRole("button", { name: "Browse jobs", exact: true }).isVisible(), true);
    assert.equal(await mobilePage.getByRole("button", { name: "Get the Chrome extension", exact: true }).count(), 0);
    await mobilePage.screenshot({ path: "output/playwright/extension-setup-unsupported.png", fullPage: true });
    await mobile.close();

    await login(context, identities[0].email);
    const setupUrl = `${root}/onboarding?from=%2Fextension%2Fsetup`;
    await page.goto(setupUrl);
    await page.getByLabel("Full name", { exact: true }).waitFor();
    const stale = await context.newPage();
    await stale.goto(setupUrl);
    await stale.getByLabel("Full name", { exact: true }).waitFor();
    await page.getByLabel("Full name", { exact: true }).fill("Reviewed Draft Name");
    await page.getByText("Draft saved. Changes await confirmation.", { exact: true }).waitFor();
    await stale.getByLabel("Full name", { exact: true }).fill("Stale tab name");
    await stale.getByRole("alert").filter({ hasText: "changed in another tab" }).waitFor();
    const stored = await prisma.userPreference.findUniqueOrThrow({ where: { userId_key: { userId: identities[0].profile!.id, key: ONBOARDING_KEY } } });
    assert.equal(parseOnboardingState(stored.value)?.draft?.contact.fullName, "Reviewed Draft Name");
    const canonical = await prisma.userProfile.findUniqueOrThrow({ where: { id: identities[0].profile!.id } });
    assert.notEqual((canonical.contactJson as { fullName?: string } | null)?.fullName, "Reviewed Draft Name", "autosave does not confirm");
    await stale.close({ runBeforeUnload: false });
    await prisma.userProfile.update({ where: { id: canonical.id }, data: { summary: "Newer saved summary",
      contactJson: { ...buildProfileFormValues(canonical, identities[0]).contact, fullName: "Newer Saved Name" } } });
    await page.reload();
    await page.getByRole("heading", { name: "Your saved profile changed" }).waitFor();
    const compare = page.getByRole("region", { name: "Compare profile changes" });
    await compare.getByRole("group", { name: "Contact details" }).getByRole("radio", { name: "Your draft" }).check();
    assert.equal(await compare.getByRole("group", { name: "Summary and skills" }).getByRole("radio", { name: "Saved profile" }).isChecked(), true);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await page.screenshot({ path: "output/playwright/onboarding-conflict-review.png", fullPage: true });
    await page.getByRole("button", { name: "Use selected sections" }).click();
    await page.getByRole("button", { name: "Use reviewed details" }).click();
    await page.waitForURL(`${root}/extension/setup`);
    const confirmed = await prisma.userProfile.findUniqueOrThrow({ where: { id: canonical.id } });
    assert.equal((confirmed.contactJson as { fullName: string }).fullName, "Reviewed Draft Name");
    assert.equal(confirmed.summary, "Newer saved summary", "section reconciliation preserves newer canonical facts");

    await page.goto(setupUrl);
    await page.getByLabel("Full name", { exact: true }).waitFor();
    await context.clearCookies();
    await page.getByLabel("Full name", { exact: true }).fill("Unsaved while expired");
    await page.getByRole("button", { name: "Finish later" }).click();
    await page.getByRole("alert").filter({ hasText: "session expired" }).waitFor();
    assert.equal(await page.getByLabel("Full name", { exact: true }).inputValue(), "Unsaved while expired");
    assert.equal(await page.getByRole("link", { name: "Sign in in a new tab, then retry here" }).getAttribute("target"), "_blank");
    await login(context, identities[1].email);
    await page.getByRole("button", { name: "Finish later" }).click();
    await page.getByRole("alert").filter({ hasText: "account changed" }).waitFor();
    const untouched = await prisma.userPreference.findUniqueOrThrow({ where: { userId_key: { userId: identities[1].profile!.id, key: ONBOARDING_KEY } } });
    assert.equal(parseOnboardingState(untouched.value)?.revision, 0, "account A draft cannot be saved into B");
    assert.equal(parseOnboardingState(untouched.value)?.draft?.contact.fullName, "Second Fixture");
    await page.close({ runBeforeUnload: false });
    await context.close();
    console.log("PASS: auth callback recovery, unsupported browser, acknowledged autosave, stale tabs, per-section reconciliation, expired session and account-switch isolation");
  } catch (error) {
    if (activePage && !activePage.isClosed()) {
      await activePage.screenshot({ path: "output/playwright/onboarding-recovery-failure.png", fullPage: true }).catch(() => {});
      console.error("Recovery failure page", new URL(activePage.url()).pathname, await activePage.locator("body").ariaSnapshot().catch(() => "unavailable"));
    }
    throw error;
  } finally {
    await browser.close();
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
