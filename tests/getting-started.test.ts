import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import * as guide from "../src/lib/getting-started";
import { initializeNewUserSetup } from "../src/lib/new-user-setup";
import { ONBOARDING_KEY } from "../src/lib/profile-setup";
import { loadTsModule } from "./helpers/load-ts-module";

test("only explicitly enrolled new accounts auto-open the guide", () => {
  for (const value of [undefined, null, "", "{bad", "{}", '{"version":2,"status":"new","step":0}']) {
    assert.equal(guide.parseGuideState(value).status, "deferred");
  }
  assert.deepEqual(guide.parseGuideState(JSON.stringify(guide.INITIAL_GUIDE)), guide.INITIAL_GUIDE);
  for (const step of [-1, 5, 1.5, "1"]) {
    assert.equal(guide.saveGuideSchema.safeParse({ accountId: "user", status: "deferred", step }).success, false);
  }
  assert.equal(guide.saveGuideSchema.safeParse({ accountId: "user", status: "new", step: 0 }).success, false);
  assert.equal(guide.saveGuideSchema.safeParse({ accountId: "user", status: "complete", step: 4, connected: true }).success, false);
});

test("new-user initialization is idempotent and sends an in-app notice, never email", async () => {
  const preferences = new Map<string, string>();
  let notified = false;
  let notifications = 0;
  const tx = {
    userPreference: { upsert: async ({ where, create, update }: { where: { userId_key: { userId: string; key: string } }; create: { value: string }; update: unknown }) => {
      assert.equal(where.userId_key.userId, "profile-1");
      assert.deepEqual(update, {});
      if (!preferences.has(where.userId_key.key)) preferences.set(where.userId_key.key, create.value);
    } },
    user: { findFirst: async ({ where }: { where: { id: string; status: string } }) => {
      assert.equal(where.id, "auth-1"); assert.equal(where.status, "ACTIVE"); return { id: "auth-1" };
    } },
    announcementDelivery: {
      createMany: async ({ skipDuplicates }: { skipDuplicates: boolean }) => assert.equal(skipDuplicates, true),
      updateMany: async () => { if (notified) return { count: 0 }; notified = true; return { count: 1 }; },
    },
    notification: { create: async ({ data }: { data: { userId: string; actionPath: string } }) => {
      assert.equal(data.userId, "auth-1"); assert.equal(data.actionPath, "/extension/guide"); notifications++;
    } },
  };
  const db = { $transaction: async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx) } as unknown as PrismaClient;
  await initializeNewUserSetup(db, "auth-1", "profile-1");
  assert.equal(notifications, 1);
  assert.equal(guide.parseGuideState(preferences.get(guide.GETTING_STARTED_KEY)).status, "new");
  assert.ok(preferences.has(ONBOARDING_KEY));
  const saved = JSON.stringify({ version: 1, status: "deferred", step: 3 });
  preferences.set(guide.GETTING_STARTED_KEY, saved);
  await initializeNewUserSetup(db, "auth-1", "profile-1");
  assert.equal(notifications, 1, "a retry must not recreate a dismissed notification");
  assert.equal(preferences.get(guide.GETTING_STARTED_KEY), saved);
});

class UnauthorizedError extends Error {}
function actionFixture({ denied = false, unavailable = false } = {}) {
  const writes: { where: { userId_key: { userId: string; key: string } }; update: { value: string } }[] = [];
  const { saveGettingStarted } = loadTsModule<typeof import("../src/app/onboarding/guide-actions")>("src/app/onboarding/guide-actions.ts", {
    "@/lib/getting-started": guide,
    "@/lib/current-user": { UnauthorizedError, requireCurrentUserIds: async () => {
      if (denied) throw new UnauthorizedError();
      return { authUserId: "auth-1", profileId: "profile-1" };
    } },
    "@/lib/db": { prisma: { userPreference: { upsert: async (input: typeof writes[number]) => {
      if (unavailable) throw new Error("private database details"); writes.push(input);
    } } } },
  });
  return { saveGettingStarted, writes };
}

test("guide progress is owner-bound and cannot change profile or extension consent", async () => {
  const { saveGettingStarted, writes } = actionFixture();
  assert.match((await saveGettingStarted({ accountId: "other", status: "complete", step: 4 })).error!, /account changed/);
  assert.equal(writes.length, 0);
  for (const [step, status] of [[2, "deferred"], [4, "complete"]] as const) {
    const result = await saveGettingStarted({ accountId: "auth-1", status, step });
    assert.equal(result.state?.status, status);
    assert.equal(writes.at(-1)?.where.userId_key.userId, "profile-1");
    assert.equal(writes.at(-1)?.where.userId_key.key, guide.GETTING_STARTED_KEY);
    assert.deepEqual(JSON.parse(writes.at(-1)!.update.value), { version: 1, status, step });
  }
});

test("guide save has actionable validation, expired-session and retry errors", async () => {
  const invalid = actionFixture();
  assert.match((await invalid.saveGettingStarted({ accountId: "auth-1", status: "deferred", step: 500 })).error!, /invalid/);
  assert.equal(invalid.writes.length, 0);
  const expired = actionFixture({ denied: true });
  assert.match((await expired.saveGettingStarted({ accountId: "auth-1", status: "deferred", step: 1 })).error!, /Sign in again/);
  const unavailable = actionFixture({ unavailable: true });
  const result = await unavailable.saveGettingStarted({ accountId: "auth-1", status: "deferred", step: 1 });
  assert.match(result.error!, /try again/);
  assert.doesNotMatch(result.error!, /private database/);
});
