import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { prisma } from "../../src/lib/db";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";

export async function verifyApplicationTracker(
  page: Page,
  root: string,
  userId: string,
  jobId: string,
) {
  if (
    process.env.NODE_ENV === "production" ||
    !["127.0.0.1", "localhost"].includes(new URL(root).hostname) ||
    !isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL)
  )
    throw new Error("Tracker fixtures are local only");
  const companyId = `logo-fixture-${randomUUID()}`;
  const ids: string[] = [];
  const original = await prisma.jobCanonical.findUniqueOrThrow({
    where: { id: jobId },
    select: { companyId: true, company: true },
  });
  const now = Date.now();
  const day = 86_400_000;
  try {
    await prisma.company.create({
      data: {
        id: companyId,
        name: "Stripe",
        companyKey: companyId,
        domain: "stripe.com",
      },
    });
    await prisma.jobCanonical.update({
      where: { id: jobId },
      data: { companyId, company: "Stripe" },
    });
    const { upsertJobFeedIndex } = await import(
      "../../src/lib/ingestion/search-index"
    );
    await upsertJobFeedIndex(jobId);
    for (const [index, status] of (
      ["APPLIED", "WISHLIST", "INTERVIEW", "ACCEPTED"] as const
    ).entries()) {
      const id = `tracker-fixture-${randomUUID()}`;
      await prisma.trackedApplication.create({
        data: {
          id,
          userId,
          company: index === 0 ? "Stripe" : "Local Example Company",
          roleTitle: `Tracker Test Role ${index + 1}`,
          canonicalJobId: index === 0 ? jobId : null,
          status,
          updatedAt: new Date(now - 14 * day),
          deadline:
            index === 1
              ? new Date(Math.floor(now / day) * day + 2 * day)
              : null,
          events:
            index === 2
              ? {
                  create: {
                    type: "REMINDER",
                    note: "Prepare interview questions",
                    reminderAt: new Date(now + 2 * day),
                  },
                }
              : undefined,
        },
      });
      ids.push(id);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const start = Date.now();
    await page.goto(`${root}/applications?reset=1`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("group", { name: "Application views" }).waitFor();
    const loadMs = Date.now() - start;
    const views = page.getByRole("group", { name: "Application views" });
    await views
      .getByRole("button", { name: "Follow up 1", exact: true })
      .waitFor();
    await views
      .getByRole("button", { name: "Next 7 days 2", exact: true })
      .waitFor();
    const first = page.locator(`#application-${ids[0]}`);
    await first.locator("[data-company-logo] img").waitFor();
    await page.waitForFunction((id) => {
      const image = document.querySelector<HTMLImageElement>(
        `#application-${id} [data-company-logo] img`,
      );
      return (
        image?.complete &&
        image.naturalWidth > 0 &&
        getComputedStyle(image).opacity === "1"
      );
    }, ids[0]);
    const logo = await page.evaluate(async () => {
      const response = await fetch("/api/company-logo?domain=stripe.com");
      return {
        status: response.status,
        bytes: (await response.arrayBuffer()).byteLength,
        cache: response.headers.get("cache-control"),
      };
    });
    assert.equal(logo.status, 200);
    assert.ok(logo.bytes <= 32768);
    assert.match(logo.cache ?? "", /max-age=86400/);
    const feed = await page.evaluate(async () =>
      (
        await fetch("/api/jobs?companySearch=Stripe&titleSearch=Financial")
      ).json(),
    );
    assert.equal(
      feed.data.find((job: { id: string }) => job.id === jobId)?.companyRecord?.domain,
      "stripe.com",
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction((id) => {
      const image = document.querySelector<HTMLImageElement>(
        `#application-${id} [data-company-logo] img`,
      );
      return (
        image?.complete &&
        image.naturalWidth > 0 &&
        getComputedStyle(image).opacity === "1"
      );
    }, ids[0]);
    await page.route("**/api/company-logo?domain=stripe.com", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await page.reload({ waitUntil: "networkidle" });
    await first
      .locator("[data-company-logo] img")
      .waitFor({ state: "detached" });
    assert.equal(
      (await first.locator("[data-company-logo]").innerText()).trim(),
      "ST",
    );
    assert.equal(
      (await first.locator("[data-company-logo]").boundingBox())?.width,
      28,
    );
    await page.unroute("**/api/company-logo?domain=stripe.com");
    await page.reload({ waitUntil: "networkidle" });
    await page.screenshot({
      path: "output/playwright/application-queue-desktop.png",
      fullPage: true,
    });
    const viewStart = Date.now();
    await views.getByRole("button", { name: /^Follow up/ }).click();
    assert.equal(
      await page.locator('[id^="application-tracker-fixture-"]').count(),
      1,
    );
    const viewSwitchMs = Date.now() - viewStart;
    const statusStart = Date.now();
    await first
      .getByLabel("Status for Tracker Test Role 1")
      .selectOption("SCREEN");
    await page
      .getByText("No applications in this view", { exact: true })
      .waitFor();
    const statusUpdateMs = Date.now() - statusStart;
    assert.equal(
      (
        await prisma.trackedApplication.findUniqueOrThrow({
          where: { id: ids[0] },
        })
      ).status,
      "SCREEN",
    );
    assert.equal(
      await prisma.trackedApplicationEvent.count({
        where: { trackedApplicationId: ids[0], type: "SCREEN" },
      }),
      1,
    );
    await views.getByRole("button", { name: /^All results/ }).click();
    await first
      .getByRole("button", {
        name: "Schedule reminder for Tracker Test Role 1",
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Schedule reminder",
      exact: true,
    });
    await dialog
      .getByLabel("Next step", { exact: true })
      .fill("Send portfolio to recruiter");
    await dialog.getByLabel("Reminder time").fill("2020-01-01T09:00");
    await dialog
      .getByRole("button", { name: "Schedule reminder", exact: true })
      .click();
    await dialog
      .getByRole("alert")
      .filter({ hasText: "Reminder date must be in the future." })
      .waitFor();
    assert.equal(
      await dialog.getByLabel("Next step", { exact: true }).inputValue(),
      "Send portfolio to recruiter",
    );
    await dialog.getByRole("button", { name: "Tomorrow", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Schedule reminder", exact: true })
      .click();
    await dialog.waitFor({ state: "hidden" });
    await first.getByText(/Send portfolio to recruiter/).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await first.getByText(/Send portfolio to recruiter/).waitFor();
    const reminder = await prisma.trackedApplicationEvent.findFirstOrThrow({
      where: { trackedApplicationId: ids[0], type: "REMINDER" },
    });
    assert.ok(reminder.reminderAt!.getTime() > now);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: "output/playwright/application-queue-mobile.png",
      fullPage: true,
    });
    await first
      .getByRole("button", {
        name: "Schedule reminder for Tracker Test Role 1",
      })
      .click();
    await page.screenshot({
      path: "output/playwright/application-reminder-mobile.png",
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("button", { name: "Add application", exact: true })
      .click();
    const addDialog = page.getByRole("dialog", {
      name: "Add application",
      exact: true,
    });
    await addDialog
      .getByLabel("Company", { exact: true })
      .fill("Fixture manual company");
    await addDialog
      .getByLabel("Role", { exact: true })
      .fill("Tracker Test Manual Role");
    await addDialog
      .getByRole("button", { name: "Add application", exact: true })
      .click();
    await addDialog.waitFor({ state: "hidden" });
    await page
      .getByRole("link", { name: "Tracker Test Manual Role", exact: true })
      .waitFor();
    ids.push(
      (
        await prisma.trackedApplication.findFirstOrThrow({
          where: { userId, roleTitle: "Tracker Test Manual Role" },
        })
      ).id,
    );
    await verifyWorkspaceDraftRecovery(page, root, ids[0]);
    await page.goto(`${root}/applications?reset=1`, { waitUntil: "networkidle" });
    await page
      .getByRole("group", { name: "Application views" })
      .getByRole("button", { name: /^Closed/ })
      .click();
    await page
      .getByRole("link", { name: "Tracker Test Role 4", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("link", { name: "Tracker Test Role 1", exact: true })
        .count(),
      0,
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${root}/jobs?companySearch=Stripe&titleSearch=Financial`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>('[data-company-logo] img');
      return image?.complete && image.naturalWidth > 0 && getComputedStyle(image).opacity === "1";
    });
    await page.screenshot({ path: "output/playwright/job-company-logo-desktop.png", fullPage: true });
    console.log(
      JSON.stringify({
        tracker:
          "PASS: views, inline status, timeline event, reminder validation/draft/persistence, add modal, mobile geometry",
        loadMs,
        viewSwitchMs,
        statusUpdateMs,
        logo,
      }),
    );
  } finally {
    await prisma.trackedApplication.deleteMany({ where: { id: { in: ids } } });
    await prisma.trackedApplication.deleteMany({
      where: { userId, roleTitle: "Tracker Test Manual Role" },
    });
    await prisma.jobCanonical.update({ where: { id: jobId }, data: original });
    await prisma.company.deleteMany({ where: { id: companyId } });
  }
}

async function verifyWorkspaceDraftRecovery(page: Page, root: string, id: string) {
  await page.goto(`${root}/applications/${id}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Tracker Test Role 1", exact: true }).waitFor();
  await page.getByRole("button", { name: "Add reminder", exact: true }).click();
  const note = page.getByPlaceholder("Reminder", { exact: true });
  await note.fill("Keep the interview preparation draft");
  await page.getByLabel("Notify at", { exact: true }).fill("2020-01-01T09:00");
  await page.getByRole("button", { name: "Save reminder", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Reminder date must be in the future." }).first().waitFor();
  assert.equal(await note.inputValue(), "Keep the interview preparation draft");
  await page.getByLabel("Notify at", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save reminder", exact: true }).click();
  await note.waitFor({ state: "hidden" });
  await page.getByText("Keep the interview preparation draft", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Edit reminder", exact: true }).first().click();
  await note.fill("Keep an edited reminder too");
  await page.getByLabel("Notify at", { exact: true }).fill("2020-01-01T09:00");
  await page.getByRole("button", { name: "Save reminder", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Reminder date must be in the future." }).first().waitFor();
  assert.equal(await note.inputValue(), "Keep an edited reminder too");
  await page.locator("form").filter({ has: note }).getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("button", { name: "Paste posting", exact: true }).click();
  const paste = page.getByPlaceholder("Paste the full job posting text here...");
  await paste.fill("Too short, keep me.");
  await page.getByRole("button", { name: "Organize & save", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "too short to format" }).first().waitFor();
  assert.equal(await paste.inputValue(), "Too short, keep me.");
  const posting = "## About the role\nWe are looking for a Software Engineer to build reliable systems for financial services and improve release safety across our platform.\n\n## Responsibilities\n- Build and maintain APIs used by customer-facing workflows and internal operations teams.\n- Document decisions and work closely with security teams to improve reliability.\n\n## Required qualifications\n- Three years of TypeScript experience and authorization to work in Canada.";
  await paste.fill(posting);
  const endpoint = `${root}/applications/${id}`;
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Organize & save", exact: true }).click();
    await page.getByRole("button", { name: "Organizing...", exact: true }).waitFor();
    assert.equal(await paste.inputValue(), posting, "pending save keeps the editor and draft");
    await paste.waitFor({ state: "hidden" });
  } finally {
    await page.unroute(endpoint);
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Three years of TypeScript experience and authorization to work in Canada.", { exact: true }).waitFor();
  const saved = await prisma.trackedApplication.findUniqueOrThrow({ where: { id } });
  assert.match(saved.jobDescription ?? "", /Required qualifications/);
  await page.screenshot({ path: "output/playwright/application-workspace-draft-recovery.png", fullPage: true });
  console.log("PASS: workspace timestamps, reminder create/edit validation, description retry and delayed save persistence");
}
