import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module";

type Profile = { id: string; authUserId: string | null; email: string; name: string };
type ProfileWhere = Partial<Profile> & { OR?: ProfileWhere[] };

function profileFixture(initial: Profile[]) {
  const rows = initial.map((row) => ({ ...row }));
  const matches = (row: Profile, where: ProfileWhere): boolean =>
    where.OR ? where.OR.some((item) => matches(row, item)) :
      Object.entries(where).every(([key, value]) => row[key as keyof Profile] === value);
  const write = (data: Partial<Profile>, existing?: Profile) => {
    const next = { id: `profile-${rows.length}`, ...existing, ...data } as Profile;
    if (rows.some((row) => row !== existing &&
      (row.email === next.email || (next.authUserId && row.authUserId === next.authUserId)))) {
      throw new Error("Unique profile ownership/email constraint");
    }
    if (existing) Object.assign(existing, next);
    else rows.push(next);
    return next;
  };
  const find = async ({ where }: { where: ProfileWhere }) => rows.find((row) => matches(row, where)) ?? null;
  const { syncProfileForAuthUser } = loadTsModule<typeof import("../src/lib/user-profile-sync")>(
    "src/lib/user-profile-sync.ts",
    { "@/lib/db": { prisma: { userProfile: {
      findFirst: find,
      findUnique: find,
      create: async ({ data }: { data: Profile }) => write(data),
      update: async ({ where, data }: { where: ProfileWhere; data: Partial<Profile> }) => {
        const existing = rows.find((row) => matches(row, where));
        assert.ok(existing);
        return write(data, existing);
      },
      upsert: async ({ where, create, update }: { where: ProfileWhere; create: Profile; update: Partial<Profile> }) => {
        const existing = rows.find((row) => matches(row, where));
        return write(existing ? update : create, existing);
      },
    } } } },
  );
  return { rows, syncProfileForAuthUser };
}

test("an email reused after an auth email change cannot transfer the previous owner's stale profile", async () => {
  const existing = { id: "private-profile", authUserId: "original-owner", email: "reused@example.test", name: "Original owner" };
  const { rows, syncProfileForAuthUser } = profileFixture([existing]);
  await assert.rejects(syncProfileForAuthUser({ id: "new-account", email: existing.email, name: "New account" }));
  assert.deepEqual(rows, [existing]);
});

test("sign-up cannot claim an unbound legacy profile just by supplying its email", async () => {
  const existing = { id: "legacy-profile", authUserId: null, email: "legacy@example.test", name: "Legacy owner" };
  const { rows, syncProfileForAuthUser } = profileFixture([existing]);
  await assert.rejects(syncProfileForAuthUser({ id: "new-account", email: existing.email, name: "Unverified signup" }));
  assert.deepEqual(rows, [existing]);
});

test("an owned profile is resolved by account ID and refreshed without changing ownership", async () => {
  const { rows, syncProfileForAuthUser } = profileFixture([
    { id: "own-profile", authUserId: "owner", email: "old@example.test", name: "Old name" },
  ]);
  const profile = await syncProfileForAuthUser({ id: "owner", email: "new@example.test", name: "New name" });
  assert.equal(profile.id, "own-profile");
  assert.equal(profile.authUserId, "owner");
  assert.equal(profile.email, "new@example.test");
  assert.equal(rows.length, 1);
});

test("a conflicting email never replaces an account's existing profile or rebinds another profile", async () => {
  const initial = [
    { id: "other-profile", authUserId: "other-owner", email: "conflict@example.test", name: "Other" },
    { id: "own-profile", authUserId: "owner", email: "old@example.test", name: "Owner" },
  ];
  const { rows, syncProfileForAuthUser } = profileFixture(initial);
  await assert.rejects(syncProfileForAuthUser({ id: "owner", email: initial[0].email, name: "Owner" }));
  assert.deepEqual(rows, initial);
});

test("concurrent first requests converge on one account-owned profile", async () => {
  const { rows, syncProfileForAuthUser } = profileFixture([]);
  const user = { id: "owner", email: "owner@example.test", name: "Owner" };
  const profiles = await Promise.all([syncProfileForAuthUser(user), syncProfileForAuthUser(user)]);
  assert.equal(profiles[0].id, profiles[1].id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].authUserId, user.id);
});

type Query = { where: Record<string, unknown>; select?: Record<string, unknown> };
type Row = Record<string, unknown>;
function selected(row: Row, query: Query): Row {
  return query.select
    ? Object.fromEntries(Object.entries(query.select).filter(([key]) => key in row).map(([key, selection]) => [
      key,
      typeof selection === "object" && selection !== null && Array.isArray(row[key])
        ? row[key].map((nested: Row) => selected(nested, selection as Query)) : row[key],
    ]))
    : row;
}

function exportFixture(failure?: "anonymous" | "stale") {
  let reads = 0;
  class UnauthorizedError extends Error {}
  class ReauthenticationRequiredError extends Error {}
  const models: Record<string, unknown> = {};
  for (const [model, field, owner] of [
    ["user", "id", "owner"], ["userProfile", "id", "owner-profile"],
    ["trackedApplication", "userId", "owner"], ["notification", "userId", "owner"],
    ["reminderLog", "userId", "owner"], ["savedJob", "userId", "owner-profile"],
    ["userBehaviorSignal", "userId", "owner-profile"], ["applicationPackage", "userId", "owner-profile"],
    ["applicationSubmission", "userId", "owner-profile"],
    ["resumeLibraryEntry", "userId", "owner-profile"], ["resumeBuild", "userId", "owner-profile"],
    ["onboardingEvent", "userId", "owner"],
  ]) {
    const rows: Row[] = [
      { id: `${model}-own`, [field]: owner, name: "Own data", password: "fixture-password-hash", token: "fixture-token" },
      { id: `${model}-foreign`, [field]: "foreign", name: "FOREIGN PRIVATE DATA" },
    ];
    const read = (query: Query) => {
      reads += 1;
      assert.equal(query.where[field], owner, `${model} must use the authenticated account/profile`);
      return rows.filter((row) => Object.entries(query.where).every(([key, value]) => row[key as keyof typeof row] === value))
        .map((row) => selected(row, query));
    };
    if (model === "resumeLibraryEntry") Object.assign(rows[0], {
      title: "Owned library entry", archivedAt: new Date("2026-01-01"),
      variations: [{ id: "owned-variation", name: "Owned variation", bulletsJson: ["Owned bullet"], token: "fixture-token" }],
    });
    if (model === "resumeBuild") Object.assign(rows[0], {
      name: "Owned resume build", snapshotJson: { summary: "Owned snapshot" },
      items: [{ id: "owned-build-item", entryId: "resumeLibraryEntry-own", includedBulletIds: ["bullet-1"], snapshotJson: { title: "Owned item snapshot" }, token: "fixture-token" }],
    });
    if (model === "onboardingEvent") {
      Object.assign(rows[0], { event: "setup_completed", entry: "profile", filled: 4, remaining: 0 });
      rows.push({ id: "anonymous-event", userId: null, event: "ANONYMOUS PRIVATE DATA" });
    }
    // Synthetic secret fields prove explicit selections on auth/new exports;
    // existing non-auth tables have no credential columns.
    if (!["user", "userProfile", "resumeLibraryEntry", "resumeBuild", "onboardingEvent"].includes(model)) {
      delete rows[0].password;
      delete rows[0].token;
    }
    models[model] = { findUnique: async (query: Query) => read(query)[0], findMany: async (query: Query) => read(query) };
  }
  const { GET } = loadTsModule<typeof import("../src/app/api/settings/export/route")>("src/app/api/settings/export/route.ts", {
    "@/lib/api-rate-limit": { API_RATE_LIMITS: { dataExport: {} } },
    "@/lib/api-utils": { rateLimitResponse: async () => null },
    "@/lib/current-user": {
      UnauthorizedError, ReauthenticationRequiredError,
      requireFreshSensitiveSession: async () => {
        if (failure === "anonymous") throw new UnauthorizedError();
        if (failure === "stale") throw new ReauthenticationRequiredError("Sign in again");
        return { authUserId: "owner", sessionId: "current" };
      },
      requireCurrentUserIds: async () => ({ authUserId: "owner", profileId: "owner-profile" }),
    },
    "@/lib/db": { prisma: models },
  });
  return { GET, readCount: () => reads };
}

test("export ignores supplied account identifiers, scopes every root query and excludes credentials", async () => {
  const { GET, readCount } = exportFixture();
  const response = await GET(new Request("https://example.test/api/settings/export?userId=foreign&profileId=foreign"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment;/);
  const body = await response.text();
  assert.match(body, /Own data/);
  assert.doesNotMatch(body, /FOREIGN PRIVATE DATA|ANONYMOUS PRIVATE DATA|fixture-password-hash|fixture-token/);
  assert.equal(readCount(), 12);
  const payload = JSON.parse(body);
  assert.equal(payload.resumeLibrary.entries[0].title, "Owned library entry");
  assert.ok(payload.resumeLibrary.entries[0].archivedAt);
  assert.equal(payload.resumeLibrary.entries[0].variations[0].bulletsJson[0], "Owned bullet");
  assert.equal(payload.resumeLibrary.builds[0].snapshotJson.summary, "Owned snapshot");
  assert.equal(payload.resumeLibrary.builds[0].items[0].snapshotJson.title, "Owned item snapshot");
  assert.deepEqual(payload.resumeLibrary.builds[0].items[0].includedBulletIds, ["bullet-1"]);
  assert.equal(payload.onboardingEvents[0].event, "setup_completed");
});

for (const failure of ["anonymous", "stale"] as const) {
  test(`export rejects ${failure} authentication before reading personal data`, async () => {
    const { GET, readCount } = exportFixture(failure);
    assert.equal((await GET(new Request("https://example.test/api/settings/export"))).status, 401);
    assert.equal(readCount(), 0);
  });
}

test("extension revocation cannot target another account even with a known connection ID", async () => {
  let authenticated = true;
  let connections = [{ id: "own", userId: "owner" }, { id: "foreign", userId: "other" }];
  const { revokeExtension } = loadTsModule<typeof import("../src/app/settings/extension/actions")>("src/app/settings/extension/actions.ts", {
    "next/cache": { revalidatePath: () => {} },
    "@/lib/current-user": { requireCurrentUserIds: async () => {
      if (!authenticated) throw new Error("Unauthorized");
      return { authUserId: "owner", profileId: "owner-profile" };
    } },
    "@/lib/db": { prisma: { extensionConnection: { deleteMany: async ({ where }: Query) => {
      connections = connections.filter((row) => !Object.entries(where).every(([key, value]) => row[key as keyof typeof row] === value));
    } } } },
    "@/lib/application-assistant": {},
  });
  const form = new FormData();
  form.set("id", "foreign");
  form.set("userId", "other");
  await revokeExtension(form);
  assert.equal(connections.length, 2);
  form.set("id", "own");
  authenticated = false;
  await assert.rejects(revokeExtension(form), /Unauthorized/);
  assert.equal(connections.length, 2);
  authenticated = true;
  await revokeExtension(form);
  assert.deepEqual(connections, [{ id: "foreign", userId: "other" }]);
});

test("account security DTO only lists the current account and never returns password hashes or session tokens", async () => {
  const now = new Date();
  const { getAccountSecurityData } = loadTsModule<typeof import("../src/lib/queries/auth-security")>("src/lib/queries/auth-security.ts", {
    "next/headers": { headers: async () => new Headers() },
    "@/lib/auth": { auth: { api: { getSession: async () => ({ session: { id: "current" } }) } } },
    "@/lib/current-user": { requireCurrentAuthUserId: async () => "owner" },
    "@/lib/db": { withPrismaConnectionRetry: (fn: () => unknown) => fn(), prisma: {
      account: { findMany: async (query: Query) => {
        assert.equal(query.where.userId, "owner");
        return [selected({ id: "credential", providerId: "credential", accountId: "owner", password: "fixture-hash", createdAt: now, updatedAt: now }, query)];
      } },
      session: { findMany: async (query: Query) => {
        assert.equal(query.where.userId, "owner");
        assert.ok(query.where.expiresAt);
        return [selected({ id: "current", token: "fixture-token", createdAt: now, updatedAt: now, expiresAt: now }, query)];
      } },
    } },
  });
  const data = await getAccountSecurityData();
  assert.equal(data.currentSessionId, "current");
  assert.equal(data.accounts[0].hasPassword, true);
  assert.doesNotMatch(JSON.stringify(data), /fixture-hash|fixture-token/);
});
