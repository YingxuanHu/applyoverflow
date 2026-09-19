import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import {
  INITIAL_ONBOARDING,
  ONBOARDING_KEY,
  parseOnboardingState,
} from "../../src/lib/profile-setup";
import {
  mergeCapturedQuestions,
  parseAssistantState,
} from "../../src/lib/application-assistant";

const root = process.env.TEST_APP_URL ?? "http://127.0.0.1:3004";
assert.ok(
  process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1"].includes(new URL(root).hostname) &&
    isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL),
  "Local fixtures only",
);

async function main() {
  const password = randomUUID();
  const id = randomUUID();
  const email = `profile-browser-${randomUUID()}@example.invalid`;
  const user = await prisma.user.create({
    data: {
      id,
      name: "History Fixture",
      email,
      emailVerified: true,
      emailNotificationsEnabled: false,
      accounts: {
        create: {
          accountId: id,
          providerId: "credential",
          password: await hashPassword(password),
        },
      },
      profile: {
        create: {
          name: "History Fixture",
          email,
          preferences: {
            create: {
              key: ONBOARDING_KEY,
              value: JSON.stringify(INITIAL_ONBOARDING),
            },
          },
        },
      },
    },
    include: { profile: true },
  });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(90000);
  const setupUrl = `${root}/onboarding?from=%2Fprofile`;
  try {
    await mkdir("output/playwright", { recursive: true });
    await page.goto(`${root}/sign-in?callbackUrl=%2Fprofile`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByLabel(/^Email/).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("heading", { name: "Start with your resume" })
      .waitFor({ timeout: 90000 });
    await page.getByRole("button", { name: "Enter manually" }).click();
    await page
      .getByRole("heading", { name: "Make these details yours" })
      .waitFor();
    await page.getByLabel("Full name", { exact: true }).fill("Jordan History");
    await page
      .locator("summary")
      .filter({ hasText: "Work experience" })
      .click();
    await page.getByRole("button", { name: "Add work experience" }).click();
    const work = page.getByRole("group", {
      name: "Work experience 1",
      exact: true,
    });
    await work.getByLabel("Job title", { exact: true }).fill("Analyst");
    await work.getByLabel("Company", { exact: true }).fill("Example Company");
    await work.getByRole("button", { name: "Set dates" }).click();
    await work.getByLabel("Start year", { exact: true }).fill("2021");
    await work.getByLabel("End year", { exact: true }).fill("2020");
    await page.getByRole("button", { name: "Confirm details" }).click();
    await page.getByRole("alert").filter({ hasText: "Entry 1" }).waitFor();
    await work.getByLabel("I currently work here").check();
    assert.equal(
      await work.getByLabel("End year", { exact: true }).isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "Finish later" }).click();
    await page.waitForURL(`${root}/profile`);
    const deferred = await prisma.userPreference.findUniqueOrThrow({
      where: { userId_key: { userId: user.profile!.id, key: ONBOARDING_KEY } },
    });
    assert.equal(parseOnboardingState(deferred.value)?.status, "deferred");
    assert.equal(
      (
        await prisma.userProfile.findUniqueOrThrow({
          where: { id: user.profile!.id },
        })
      ).experiencesJson,
      null,
      "draft is not confirmed profile data",
    );
    await page.goto(setupUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() =>
      document.querySelector("form > fieldset")?.matches(":enabled"),
    );
    await page
      .locator("summary")
      .filter({ hasText: "Work experience" })
      .click();
    assert.equal(
      await work.getByLabel("Start year", { exact: true }).inputValue(),
      "2021",
    );
    assert.equal(
      await work.getByLabel("Start month", { exact: true }).inputValue(),
      "",
      "unknown month stays unknown after reload",
    );
    await work.getByLabel("Start month", { exact: true }).selectOption("09");
    await page.locator("summary").filter({ hasText: "Education" }).click();
    await page
      .getByRole("button", { name: "Add education", exact: true })
      .click();
    const education = page.getByRole("group", {
      name: "Education 1",
      exact: true,
    });
    await education
      .getByLabel("School", { exact: true })
      .fill("Example University");
    await education
      .getByLabel("Dates", { exact: true })
      .fill("Fall 2016 - Spring 2020");
    await page.screenshot({
      path: "output/playwright/profile-history-onboarding.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Confirm details" }).click();
    await page.getByRole("heading", { name: "What comes next?" }).waitFor();
    await page
      .getByLabel("Roles you are interested in")
      .fill("Financial analyst");
    await page.getByLabel("Preferred country").selectOption("CA");
    await page.getByRole("button", { name: "Finish setup" }).click();
    await page.waitForURL(`${root}/profile`);
    let profile = await prisma.userProfile.findUniqueOrThrow({
      where: { id: user.profile!.id },
    });
    assert.deepEqual(
      (profile.experiencesJson as { dates: unknown }[])[0].dates,
      { start: "2021-09", end: "", current: true },
    );
    assert.match(profile.experienceText!, /Sep 2021 - Present/);
    assert.match(profile.educationText!, /Fall 2016 - Spring 2020/);
    await page.goto(setupUrl, { waitUntil: "domcontentloaded" });
    await page.waitForURL(`${root}/profile`, { timeout: 30000 });
    await page.goto(`${root}/profile`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /^Experience \d/ }).click();
    await page.getByLabel("I currently work here").uncheck();
    await page.getByLabel("End year", { exact: true }).fill("2024");
    await page.getByLabel("End month", { exact: true }).selectOption("06");
    await page.screenshot({
      path: "output/playwright/profile-history-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: "output/playwright/profile-history-mobile.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await page.getByText("Profile saved.", { exact: true }).first().waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: /^Experience \d/ })
        .getAttribute("aria-expanded"),
      "true",
      "saving keeps the current profile section open",
    );
    profile = await prisma.userProfile.findUniqueOrThrow({
      where: { id: user.profile!.id },
    });
    assert.match(profile.experienceText!, /Sep 2021 - Jun 2024/);
    assert.equal(
      (profile.educationsJson as { time: string }[])[0].time,
      "Fall 2016 - Spring 2020",
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /^Experience \d/ }).click();
    assert.equal(
      await page.getByLabel("End year", { exact: true }).inputValue(),
      "2024",
    );

    const tracked = await prisma.trackedApplication.create({
      data: {
        userId: user.id,
        company: "Example Company",
        roleTitle: "Fixture Analyst",
        status: "PREPARING",
        assistantState: mergeCapturedQuestions(null, {
          url: "https://job-boards.greenhouse.io/example/jobs/12345",
          title: "Fixture Analyst",
          questions: [
            "Describe your reporting experience",
            "Will you need visa sponsorship?",
          ],
        }),
      },
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`${root}/applications/${tracked.id}/review`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("heading", { name: "Review application", exact: true })
      .waitFor();
    assert.equal(
      await page.getByRole("textbox").count(),
      1,
      "authorization answer stays on employer form",
    );
    const answer = page.getByLabel("Describe your reporting experience", {
      exact: true,
    });
    await answer.fill("I prepared financial reports using Excel.");
    await page
      .getByRole("button", { name: "Copy answer", exact: true })
      .click();
    await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
    await answer.fill("I prepared financial reports using Excel and SQL.");
    await page
      .getByRole("button", { name: "Copy answer", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Save answers", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Answers saved" })
      .waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal(
      await answer.inputValue(),
      "I prepared financial reports using Excel and SQL.",
    );
    const saved = await prisma.trackedApplication.findUniqueOrThrow({
      where: { id: tracked.id },
    });
    assert.equal(
      saved.status,
      "PREPARING",
      "saving answers is not a submission",
    );
    assert.equal(
      parseAssistantState(saved.assistantState)?.questions[1].answer,
      "",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: onboarding defer/resume/complete, original destination, draft isolation, year precision, invalid dates, legacy text, profile save/reload, mobile layout, question review/copy/save and no false submission",
    );
  } catch (error) {
    await page.screenshot({
      path: "output/playwright/profile-history-failure.png",
      fullPage: true,
    });
    console.error(
      (
        await page
          .locator("main")
          .innerText()
          .catch(() => page.locator("body").innerText())
      ).slice(0, 7000),
    );
    throw error;
  } finally {
    await browser.close();
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
