import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { hashPassword } from "better-auth/crypto";
import { isLocalDevelopmentDatabaseUrl } from "../../src/lib/local-development-auth";
import { verifyApplicationTracker } from "./application-tracker";

const root = process.env.TEST_APP_URL ?? "http://127.0.0.1:3001";
if (
  process.env.NODE_ENV === "production" ||
  !["localhost", "127.0.0.1"].includes(new URL(root).hostname) ||
  !isLocalDevelopmentDatabaseUrl(process.env.DATABASE_URL)
) {
  throw new Error(
    "UX fixtures require a loopback app and database, never production.",
  );
}

async function main() {
  const { prisma } = await import("../../src/lib/db");
  const {
    buildAndStoreUserMatchProfile,
    replaceUserTopPicks,
    refreshTopPicksForUser,
  } = await import("../../src/lib/top-picks/service");
  const { loadScoringDescriptions } = await import(
    "../../src/lib/top-picks/source-descriptions"
  );
  const { upsertJobFeedIndex } = await import(
    "../../src/lib/ingestion/search-index"
  );
  const users: string[] = [];
  const jobs: string[] = [];
  const rawJobs: string[] = [];
  const password = `Fixture-${randomUUID()}`;
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    timezoneId: "Pacific/Honolulu",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(90000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => console.error("Browser request failed", {
    method: request.method(), path: new URL(request.url()).pathname,
    error: request.failure()?.errorText,
  }));
  page.on("console", (message) => {
    if (message.type() === "error") console.error("Browser console", message.text());
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/jobs/saved-searches"))
      console.log(
        "saved-search response",
        response.status(),
        response.request().method(),
      );
  });
  async function request(
    target: Page,
    path: string,
    method = "GET",
    body?: object,
  ) {
    return target.evaluate(
      async ({ path, method, body }) => {
        const response = await fetch(path, {
          method,
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        return { status: response.status, body: await response.json() };
      },
      { path, method, body },
    );
  }
  async function login(target: Page, email: string) {
    // Readiness is the hydrated form, not unrelated network-idle/HMR activity.
    await target.goto(`${root}/sign-in`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await target.getByLabel(/^Email/).fill(email);
    await target.getByLabel("Password", { exact: true }).fill(password);
    await target.getByRole("button", { name: "Sign in", exact: true }).click();
    await target.waitForURL(`${root}/jobs`);
    await target
      .getByRole("heading", { name: "Jobs", exact: true, level: 1 })
      .waitFor();
    await target.getByRole("button", { name: "Search jobs", exact: true }).waitFor();
  }
  try {
    await mkdir("output/playwright", { recursive: true });
    const emails: string[] = [];
    for (let index = 0; index < 2; index++) {
      const id = `ux-test-${randomUUID()}`;
      const email = `${id}@example.test`;
      await prisma.user.create({
        data: {
          id,
          email,
          name: "UX Fixture",
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
              id,
              email,
              name: "UX Fixture",
              headline: "Senior financial analyst",
              summary: "Eight years in financial reporting and reconciliation.",
              location: "Toronto, ON, Canada",
              skillsJson: ["Financial reporting", "SQL", "IFRS"],
              skillsText: "Financial reporting, SQL, IFRS",
              workAuthorization: "Canada",
              contactJson: { email },
              experienceLevel: "SENIOR",
            },
          },
        },
      });
      users.push(id);
      emails.push(email);
    }
    const now = new Date();
    for (let index = 0; index < 3; index++) {
      const id = `ux-job-${randomUUID()}`;
      await prisma.jobCanonical.create({
        data: {
          id,
          title: `Senior Financial Analyst ${index + 1}`,
          company: "UX Fixture Finance",
          location: "Toronto, ON, Canada",
          region: "CA",
          workMode: index === 0 ? "REMOTE" : "HYBRID",
          workModeConfidence: 1,
          workModeStatus: "confident",
          employmentType: "FULL_TIME",
          employmentTypeGroup: "FULL_TIME",
          roleFamily: "Financial Analysis",
          normalizedRoleCategory: "FINANCE_ACCOUNTING",
          industry: "FINANCE",
          description: `Fictional local test posting.\n\n## Requirements\n- Financial reporting and IFRS experience.\n- SQL is required.\n\n## Preferred qualifications\n- Python is a plus.\n\n## Responsibilities\n${Array.from({ length: 24 }, (_, line) => `- Review the financial reporting process for test scenario ${line + 1}.`).join("\n")}\n\nPlease attach a cover letter.`,
          shortSummary: "Local financial analyst test fixture.",
          applyUrl: `https://example.test/jobs/${id}`,
          status: "LIVE",
          availabilityScore: 95,
          qualityScore: 95,
          trustScore: 95,
          freshnessScore: 95,
          postedAt: now,
          lastSourceSeenAt: now,
          lastConfirmedAliveAt: now,
          salaryMin: 100000,
          salaryMax: 140000,
          salaryCurrency: "CAD",
          salaryPeriod: "YEAR",
        },
      });
      jobs.push(id);
      await prisma.jobCanonical.update({
        where: { id },
        data: {
          normalizedRoleCategoryConfidence: 1,
          normalizedRoleCategoryStatus: "CONFIDENT",
          normalizedCareerStage: "SENIOR",
          normalizedCareerStageConfidence: 1,
          experienceLevel: "SENIOR",
          experienceLevelGroup: "SENIOR_LEAD_STAFF",
        },
      });
      const raw = await prisma.jobRaw.create({
        data: {
          sourceId: id,
          sourceName: "OfficialCompany:UXFixture",
          sourceTier: "TIER_1",
          rawPayload: {},
          fetchedAt: now,
        },
      });
      rawJobs.push(raw.id);
      await prisma.jobSourceMapping.create({
        data: {
          canonicalJobId: id,
          rawJobId: raw.id,
          sourceName: "OfficialCompany:UXFixture",
          sourceUrl: `https://example.test/jobs/${id}`,
          sourceQualityKind: "DIRECT_COMPANY",
          sourceQualityRank: 100,
          sourceType: "COMPANY_SITE",
          sourceReliability: 1,
          isPrimary: true,
        },
      });
      await upsertJobFeedIndex(id);
    }
    if (process.env.TEST_TRACKER_ONLY === "1") {
      await login(page, emails[1]);
      await verifyApplicationTracker(page, root, users[1], jobs[0]);
      assert.deepEqual(errors, []);
      return;
    }
    const profile = await buildAndStoreUserMatchProfile(users[0]);
    assert.ok(profile);
    for (const [index, jobId] of jobs.entries())
      await prisma.userTopPick.create({
        data: {
          userId: users[0],
          jobId,
          score: index === 1 ? 99 : 95 - index,
          rank: index + 1,
          scoreBreakdown: {},
          matchReasons: ["Financial reporting matches your profile"],
          concerns: [],
          profileVersion: profile.profileVersion,
          jobVersion: now,
          computedAt: now,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
    const versions = await prisma.jobCanonical.findMany({
      where: { id: { in: jobs } },
      select: { id: true, updatedAt: true },
    });
    const coldStart = performance.now();
    const descriptions = await loadScoringDescriptions(versions);
    const coldMs = performance.now() - coldStart;
    const warmStart = performance.now();
    assert.equal((await loadScoringDescriptions(versions)).size, 3);
    const warmMs = performance.now() - warmStart;
    assert.ok(descriptions.get(jobs[0])?.includes("IFRS"));

    await login(page, emails[0]);
    const filteredPicks = await request(page, "/api/jobs/top-picks?titleSearch=Analyst+Senior&companySearch=Fixture+Finance&workMode=REMOTE&workMode=HYBRID&careerStage=SENIOR&locationSearch=Toronto%2C+ON");
    assert.equal(filteredPicks.status, 200);
    assert.deepEqual(filteredPicks.body.data.map((pick: { job: { id: string } }) => pick.job.id).sort(), [...jobs].sort(), "Picks API honors repeated filters and all keyword terms");
    const wrongCityPicks = await request(page, "/api/jobs/top-picks?locationSearch=Ottawa%2C+ON");
    assert.equal(wrongCityPicks.body.data.length, 0, "qualified location never expands to the entire province");
    await page.goto(`${root}/jobs/top-picks`, { waitUntil: "networkidle" });
    const detail = page.locator('aside[aria-label^="Details for"]');
    const list = page.getByRole("region", { name: "Jobs on this page" });
    await detail
      .getByRole("heading", { name: "Senior Financial Analyst 1", exact: true })
      .waitFor();
    assert.ok((await detail.innerText()).includes("Listed in your profile"));
    const copiedLink = new URL(await detail.getByRole("link", { name: "Full page", exact: true }).getAttribute("href") ?? "", root);
    assert.equal(
      copiedLink.pathname,
      `/jobs/${jobs[0]}`,
      "full-page links identify the job independently of feed order",
    );
    assert.equal(
      new URL(copiedLink.searchParams.get("from")!, root).hash,
      `#job-${jobs[0]}`,
    );
    const rows = list.getByRole("button");
    await detail
      .getByLabel("Reason for hiding this pick")
      .selectOption("WRONG_LOCATION");
    await detail
      .getByRole("button", { name: "Not interested", exact: true })
      .click();
    await page.getByRole("button", { name: "Undo", exact: true }).waitFor();
    assert.equal(
      (await request(page, "/api/jobs/top-picks/feedback")).body.data[0].jobId,
      jobs[0],
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page
      .getByRole("button", { name: "Undo", exact: true })
      .waitFor({ state: "hidden" });
    assert.equal(
      (await request(page, "/api/jobs/top-picks/feedback")).body.data.length,
      0,
    );
    await rows.first().click();
    await detail.locator("[data-description-scroll]").evaluate((node) => {
      node.scrollTop = 280;
    });
    await page.waitForTimeout(200);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(
      () =>
        (document.querySelector("[data-description-scroll]")?.scrollTop ?? 0) >=
        275,
    );
    await detail.locator("[data-description-scroll]").evaluate((node) => {
      node.scrollTop = 0;
    });
    await page.screenshot({
      path: "output/playwright/ux-picks-desktop.png",
      fullPage: true,
    });
    for (const viewport of [
      { width: 1024, height: 600 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      if (viewport.width >= 1024) {
        const geometry = await detail.evaluate((node) => [
          node.getBoundingClientRect().height,
          document
            .querySelector('[aria-label="Jobs on this page"]')!
            .getBoundingClientRect().height,
          document.querySelector("[data-description-scroll]")!.clientHeight,
        ]);
        assert.ok(Math.abs(geometry[0] - geometry[1]) < 2);
        assert.ok(
          geometry[2] >= 120,
          `description viewport usable: ${geometry[2]}`,
        );
      }
    }
    await rows.first().click();
    await page.screenshot({
      path: "output/playwright/ux-picks-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${root}/jobs?titleSearch=Financial&region=CA`, {
      waitUntil: "networkidle",
    });
    await page.getByText("Saved searches", { exact: true }).click();
    await page
      .getByLabel("Saved search name", { exact: true })
      .fill("Finance shortlist");
    await page
      .getByRole("button", { name: "Save current search", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Finance shortlist", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("status")
        .filter({ hasText: "Updating the job list" })
        .count(),
      0,
      "saving is not a feed navigation",
    );
    const saved = (await request(page, "/api/jobs/saved-searches")).body
      .data[0];
    assert.ok(
      saved.query.includes("region=CA") &&
        saved.query.includes("titleSearch=Financial"),
    );
    await page
      .getByRole("button", { name: "Rename Finance shortlist", exact: true })
      .click();
    await page
      .getByLabel("New search name", { exact: true })
      .fill("Finance Canada");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await page
      .getByRole("link", { name: "Finance Canada", exact: true })
      .waitFor();
    const secondContext = await browser.newContext();
    const second = await secondContext.newPage();
    await login(second, emails[1]);
    assert.equal(
      (await request(second, "/api/jobs/saved-searches")).body.data.length,
      0,
    );
    assert.equal(
      (
        await request(second, "/api/jobs/saved-searches", "POST", {
          action: "delete",
          id: saved.id,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await request(second, "/api/jobs/saved-searches", "POST", {
          action: "rename",
          id: saved.id,
          name: "Wrong owner",
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await request(page, "/api/jobs/top-picks/feedback", "POST", {
          jobId: jobs[1],
          feedbackType: "WRONG_WORK_MODE",
        })
      ).status,
      200,
    );
    assert.equal(
      (await request(second, "/api/jobs/top-picks/feedback")).body.data.length,
      0,
    );
    await request(second, "/api/jobs/top-picks/feedback", "DELETE", {
      jobId: jobs[1],
    });
    assert.ok(
      (await request(page, "/api/jobs/top-picks/feedback")).body.data.some(
        (row: { jobId: string }) => row.jobId === jobs[1],
      ),
      "another account cannot restore owned feedback",
    );
    await request(page, "/api/jobs/top-picks/feedback", "DELETE", {
      jobId: jobs[1],
    });
    await request(page, "/api/jobs/top-picks/feedback", "POST", {
      jobId: jobs[2],
      feedbackType: "NOT_INTERESTED",
    });
    await prisma.userTopPick.updateMany({
      where: { userId: users[0], jobId: jobs[2] },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    assert.equal(
      (
        await request(page, "/api/jobs/top-picks/feedback", "DELETE", {
          jobId: jobs[2],
        })
      ).body.restored,
      false,
      "Undo must not republish an expired pick",
    );
    const freshContext = await browser.newContext();
    const fresh = await freshContext.newPage();
    await login(fresh, emails[0]);
    assert.equal(
      (await request(fresh, "/api/jobs/saved-searches")).body.data[0].name,
      "Finance Canada",
      "saved searches survive a new browser session",
    );
    const savedSearches = page.locator("details").filter({ has: page.locator("summary", { hasText: "Saved searches" }) });
    if ((await savedSearches.getAttribute("open")) === null) {
      await savedSearches.locator("summary").click();
    }
    await savedSearches
      .getByText("Discovered since review", { exact: true })
      .click();
    await page.waitForURL((url) => url.searchParams.has("discoveredSince"));
    assert.equal(
      new URL(page.url()).searchParams.get("titleSearch"),
      "Financial",
    );
    assert.equal(new URL(page.url()).searchParams.get("region"), "CA");
    await page.getByText(/^Discovered after/).waitFor();
    assert.equal(
      (
        await request(
          page,
          `/api/jobs?titleSearch=Financial&region=CA&discoveredSince=${encodeURIComponent(saved.reviewedAt)}`,
        )
      ).body.data.length,
      0,
    );
    assert.equal(
      (
        await request(page, "/api/jobs/saved-searches", "POST", {
          action: "reviewed",
          id: saved.id,
        })
      ).status,
      200,
    );

    await page.goto(`${root}/profile`, { waitUntil: "networkidle" });
    await page.locator("summary").filter({ hasText: "Requirements for Picks for you" }).click();
    await page
      .getByLabel("Eligible country", { exact: true })
      .selectOption("CA");
    await page
      .getByLabel("When a requirement is not stated", { exact: true })
      .selectOption("exclude");
    await page
      .getByLabel("Minimum advertised annual salary", { exact: true })
      .fill("90000");
    await page.getByRole("checkbox", { name: "remote", exact: true }).check();
    await page
      .getByRole("button", { name: "Save requirements", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Requirements saved" })
      .waitFor();
    const rules = (await request(page, "/api/jobs/top-picks/requirements"))
      .body;
    assert.equal(rules.country, "CA");
    assert.deepEqual(rules.workModes, ["REMOTE"]);
    assert.equal(
      (await request(second, "/api/jobs/top-picks/requirements")).body.country,
      "ANY",
    );
    assert.equal(
      (await request(page, "/api/jobs/top-picks")).body.data.length,
      0,
      "old cached recommendations invalidated",
    );
    await request(page, "/api/jobs/top-picks/feedback", "POST", {
      jobId: jobs[0],
      feedbackType: "NOT_INTERESTED",
    });
    assert.equal(
      (
        await request(page, "/api/jobs/top-picks/feedback", "DELETE", {
          jobId: jobs[0],
        })
      ).body.restored,
      false,
      "Undo must not restore a pick from old requirements",
    );
    await assert.rejects(
      replaceUserTopPicks({
        userId: users[0],
        profileVersion: profile.profileVersion,
        picks: [],
      }),
      /settings changed/,
    );
    const current = await buildAndStoreUserMatchProfile(users[0]);
    assert.equal(current?.requirements?.country, "CA");
    const refresh = await refreshTopPicksForUser(users[0], {
      reason: "local_ux_test",
      candidateLimit: 30,
      storeLimit: 10,
    });
    assert.ok(refresh.storedCount > 0, "local worker produces matches");
    const refreshed = (await request(page, "/api/jobs/top-picks")).body.data;
    assert.ok(
      refreshed.some(
        (pick: { job: { id: string } }) => pick.job.id === jobs[0],
      ),
      "eligible remote match survives",
    );
    assert.ok(
      refreshed.every(
        (pick: { job: { workMode: string } }) => pick.job.workMode === "REMOTE",
      ),
      "generated picks respect the required work arrangement",
    );
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(
      await page.getByLabel("Eligible country", { exact: true }).inputValue(),
      "CA",
    );
    await page.screenshot({
      path: "output/playwright/ux-requirements-desktop.png",
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
      path: "output/playwright/ux-requirements-mobile.png",
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(() => document.body.scrollWidth > innerWidth),
      false,
      "profile header must not extend beyond the mobile viewport",
    );
    await page.goto(`${root}/jobs/${jobs[0]}/apply`, {
      waitUntil: "networkidle",
    });
    await page
      .getByRole("heading", { name: "Before you apply", exact: true })
      .waitFor();
    assert.ok(
      (await page.innerText("body")).includes(
        "posting asks for a cover letter",
      ),
    );
    assert.ok((await page.innerText("body")).includes("Choose a resume"));
    await page.screenshot({
      path: "output/playwright/ux-preflight-mobile.png",
      fullPage: true,
    });
    assert.equal(
      (
        await request(page, "/api/jobs/saved-searches", "POST", {
          action: "delete",
          id: saved.id,
        })
      ).status,
      200,
    );
    const { TOP_PICKS_ALGORITHM_VERSION } = await import("../../src/lib/top-picks/config");
    const { enqueueDurableTopPicksRefresh, claimTopPicksRefreshTasks, finishTopPicksRefreshTask } = await import("../../src/lib/top-picks/refresh-queue");
    const currentProfile = await buildAndStoreUserMatchProfile(users[0]);
    assert.ok(currentProfile);
    await prisma.userTopPick.updateMany({ where: { userId: users[0] }, data: { isValid: false } });
    const task = await prisma.topPickRefreshTask.update({ where: { userId: users[0] }, data: {
      status: "SUCCESS", finishedAt: new Date(), leaseExpiresAt: null,
      lastResult: { profileVersion: currentProfile.profileVersion, storedCount: 0, algorithmVersion: TOP_PICKS_ALGORITHM_VERSION },
    } });
    let automaticRefreshRequests = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/jobs/top-picks/refresh") && request.method() === "POST") automaticRefreshRequests++;
    });
    await page.goto(`${root}/jobs/top-picks`, { waitUntil: "networkidle" });
    await page.getByText("No qualifying picks right now", { exact: true }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(automaticRefreshRequests, 0, "Fresh zero results should not trigger repeated refreshes");
    assert.equal((await prisma.topPickRefreshTask.findUniqueOrThrow({ where: { id: task.id } })).requestedVersion, task.requestedVersion);
    await page.screenshot({ path: "output/playwright/ranking-empty-result-mobile.png", fullPage: true });

    await prisma.topPickRefreshTask.update({ where: { id: task.id }, data: { finishedAt: new Date(Date.now() - 7200000) } });
    await page.goto(`${root}/jobs`, { waitUntil: "networkidle" });
    const [refreshRequest] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/jobs/top-picks/refresh") && response.request().method() === "POST", { timeout: 90000 }),
      page.getByRole("navigation", { name: "Jobs workspace" }).getByRole("link", { name: "Picks for you", exact: true }).click(),
    ]);
    assert.equal(refreshRequest.status(), 200);
    await page.getByText("Finding your top matches", { exact: true }).waitFor();
    assert.equal(automaticRefreshRequests, 1, "Opening the stale tab starts exactly one refresh");
    // The dev server can finish its inline worker before the next POST. Hold
    // only this fixture queued, revoking any inline lease, to test pending-work
    // reuse rather than accidentally requesting a new refresh after success.
    const queued = await prisma.topPickRefreshTask.update({
      where: { id: task.id },
      data: {
        status: "PENDING",
        startedAt: null,
        leaseExpiresAt: null,
        notBeforeAt: new Date(Date.now() + 5 * 60_000),
      },
    });
    const queuedVersion = queued.requestedVersion;
    for (let index = 0; index < 2; index++) {
      // Use the browser's secure-cookie behavior on loopback production builds.
      const duplicate = await request(page, "/api/jobs/top-picks/refresh", "POST");
      assert.equal(duplicate.status, 200);
    }
    assert.equal((await prisma.topPickRefreshTask.findUniqueOrThrow({ where: { id: task.id } })).requestedVersion, queuedVersion, "Duplicate refresh API calls must reuse the queued work");
    await enqueueDurableTopPicksRefresh({ userId: users[0], priorityScore: 1000000, candidateLimit: 30, storeLimit: 10 });
    const [claim] = await claimTopPicksRefreshTasks(1);
    assert.equal(claim.userId, users[0]);
    const loaded = await refreshTopPicksForUser(users[0], { claim, candidateLimit: 30, storeLimit: 10 });
    await finishTopPicksRefreshTask(claim, "SUCCESS", { lastResult: loaded });
    await page.getByRole("region", { name: "Jobs on this page" }).waitFor();
    assert.ok(loaded.storedCount > 0);
    assert.equal(automaticRefreshRequests, 3, "One automatic refresh plus two deliberate duplicate requests; no polling refresh loop");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: "output/playwright/ranking-refreshed-picks-desktop.png", fullPage: true });
    await verifyApplicationTracker(second, root, users[1], jobs[0]);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        passed: [
          "populated picks",
          "source qualification evidence",
          "specific feedback and Undo",
          "description scroll restore",
          "desktop/mobile geometry",
          "saved search create/rename/review/delete",
          "cross-account authorization",
          "new-session persistence",
          "discovery cutoff with original filters",
          "strict requirement save/reload",
          "old snapshot invalidation and publication guard",
          "application preflight",
          "fresh zero-result cache without refresh loops",
          "automatic cold-cache loading and worker completion",
        ],
        descriptionCache: { coldMs, warmMs },
      }),
    );
  } catch (error) {
    console.error("Failure URL:", page.url());
    console.error((await page.innerText("body")).slice(-9000));
    await page.screenshot({
      path: "output/playwright/ux-workflow-failure.png",
      fullPage: true,
    });
    throw error;
  } finally {
    await browser.close();
    // Only remove IDs created by this run; pre-existing local data is untouched.
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.jobCanonical.deleteMany({ where: { id: { in: jobs } } });
    await prisma.jobRaw.deleteMany({ where: { id: { in: rawJobs } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
