import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { hashPassword } from "better-auth/crypto";
import * as sessionPolicy from "../src/lib/auth-session-policy";
import { loadTsModule } from "./helpers/load-ts-module";

const origin = "https://account-security.example.test";
const secret = "synthetic-account-lifecycle-test-secret-never-deployed";
const password = "Synthetic-fixture-password-123";
const passwordHash = hashPassword(password);

// Exercise the installed Better Auth handler with this app's real configuration.
// Only persistence and outbound delivery are replaced. No server, database, or
// provider connection is opened, and no ambient provider configuration is read.
async function authFixture() {
  const now = new Date();
  const db: Record<string, Record<string, unknown>[]> = {
    user: ["owner", "other"].map((id) => ({
      id, name: id, email: `${id}@example.test`, emailVerified: true,
      status: "ACTIVE", createdAt: now, updatedAt: now,
    })),
    session: [
      { id: "current", userId: "owner", token: "current-token" },
      { id: "sibling", userId: "owner", token: "sibling-token" },
      { id: "foreign", userId: "other", token: "foreign-token" },
    ].map((session) => ({ ...session, createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 86_400_000) })),
    account: [{
      id: "credential", userId: "owner", accountId: "owner", providerId: "credential",
      password: await passwordHash, createdAt: now, updatedAt: now,
    }],
    verification: [],
  };
  const env = { NODE_ENV: "production", BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: secret };
  const runtimeOrigin = loadTsModule<typeof import("../src/lib/runtime-origin")>(
    "src/lib/runtime-origin.ts", {}, { process: { env } },
  );
  const forbiddenDependency = () => { throw new Error("Unexpected external dependency in isolated auth test"); };
  const { auth: options } = loadTsModule<{ auth: BetterAuthOptions }>("src/lib/auth.ts", {
    "better-auth": { betterAuth: (config: BetterAuthOptions) => config },
    "@better-auth/prisma-adapter": { prismaAdapter: () => memoryAdapter(db) },
    "@/lib/auth-verification": { deliverVerificationEmail: forbiddenDependency },
    "@/lib/auth-session-policy": sessionPolicy,
    "@/lib/db": { prisma: {} },
    "@/lib/email": { sendEmail: forbiddenDependency },
    "@/lib/runtime-origin": runtimeOrigin,
    "@/lib/user-profile-sync": { syncProfileForAuthUser: forbiddenDependency },
    "@/lib/profile-setup": { INITIAL_ONBOARDING: {}, ONBOARDING_KEY: "onboarding" },
  }, { process: { env } });
  const auth = betterAuth({ ...options, logger: { disabled: true } });
  function cookie(token: string) {
    const signature = createHmac("sha256", secret).update(token).digest("base64");
    return `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
  }
  function post(path: string, body = {}, token: string | null = "current-token", requestOrigin: string | null = origin) {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (token) headers.set("Cookie", cookie(token));
    if (requestOrigin) headers.set("Origin", requestOrigin);
    return auth.handler(new Request(`${origin}/api/auth/${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
  }
  return { db, auth, cookie, post };
}

test("session revocation does not delete a known foreign session token", async () => {
  const { post, db } = await authFixture();
  const response = await post("revoke-session", { token: "foreign-token", userId: "other" });
  assert.equal(response.status, 200);
  assert.equal(db.session.length, 3);
  assert.ok(db.session.some((session) => session.token === "foreign-token"));
});

test("revoking a sibling invalidates it without touching the current or other account's sessions", async () => {
  const { post, db, auth, cookie } = await authFixture();
  assert.equal((await post("revoke-session", { token: "sibling-token" })).status, 200);
  assert.deepEqual(db.session.map((session) => session.id).sort(), ["current", "foreign"]);
  const stale = await auth.handler(new Request(`${origin}/api/auth/get-session`, { headers: { Cookie: cookie("sibling-token") } }));
  assert.equal(await stale.json(), null);
});

test("revoke-other-sessions ignores a supplied foreign user ID", async () => {
  const { post, db } = await authFixture();
  assert.equal((await post("revoke-other-sessions", { userId: "other" })).status, 200);
  assert.deepEqual(db.session.map((session) => session.id).sort(), ["current", "foreign"]);
});

test("revoke-sessions removes only the authenticated account's sessions", async () => {
  const { post, db } = await authFixture();
  assert.equal((await post("revoke-sessions", { userId: "other" })).status, 200);
  assert.deepEqual(db.session.map((session) => session.id), ["foreign"]);
  assert.equal((await post("delete-user")).status, 401);
  assert.equal(db.user.length, 2);
});

for (const path of ["delete-user", "revoke-session", "revoke-sessions", "revoke-other-sessions"]) {
  test(`${path} denies anonymous, revoked, missing-origin and foreign-origin requests`, async () => {
    const { post, db } = await authFixture();
    const body = path === "revoke-session" ? { token: "sibling-token" } : {};
    assert.equal((await post(path, body, null)).status, 401);
    assert.equal((await post(path, body, "revoked-token")).status, 401);
    assert.equal((await post(path, body, "current-token", null)).status, 403);
    assert.equal((await post(path, body, "current-token", "https://untrusted.example.test")).status, 403);
    assert.equal(db.user.length, 2);
    assert.equal(db.session.length, 3);
  });
}

test("delete-user only deletes the authenticated user even with a foreign user ID", async () => {
  const { post, db } = await authFixture();
  const response = await post("delete-user", { userId: "other", password });
  assert.equal(response.status, 200);
  assert.deepEqual(db.user.map((user) => user.id), ["other"]);
  assert.deepEqual(db.session.map((session) => session.userId), ["other"]);
  assert.equal(db.account.length, 0);
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
});

test("an old session needs the correct account password for deletion", async () => {
  const { post, db } = await authFixture();
  db.session[0].createdAt = new Date(Date.now() - 2 * 86_400_000);
  assert.equal((await post("delete-user")).status, 400);
  assert.equal((await post("delete-user", { password: "wrong-fixture-password" })).status, 400);
  assert.equal(db.user.length, 2);
  assert.equal((await post("delete-user", { password })).status, 200);
  assert.deepEqual(db.user.map((user) => user.id), ["other"]);
});

test("a deletion verification token for another account cannot authorize deleting either account", async () => {
  const { post, db } = await authFixture();
  db.verification.push({
    id: "delete-verification", identifier: "delete-account-other-verification",
    value: "other", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), updatedAt: new Date(),
  });
  assert.equal((await post("delete-user", { token: "other-verification", password })).status, 404);
  assert.equal(db.user.length, 2);
  assert.equal(db.session.length, 3);
});

test("even a fresh credential session needs a nonempty valid password before deletion", async () => {
  const { post, db } = await authFixture();
  for (const body of [{}, { password: "" }, { password: "incorrect-password" }]) {
    assert.equal((await post("delete-user", body)).status, 400);
    assert.equal(db.user.length, 2);
    assert.equal(db.account.length, 1);
    assert.equal(db.session.length, 3);
  }
  assert.equal((await post("delete-user", { password })).status, 200);
  assert.deepEqual(db.user.map((user) => user.id), ["other"]);
});

test("credential deletion cannot bypass the password requirement with a token or callback", async () => {
  const { post, db, auth, cookie } = await authFixture();
  db.verification.push({
    id: "own-delete-verification", identifier: "delete-account-own-verification",
    value: "owner", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), updatedAt: new Date(),
  });
  assert.equal((await post("delete-user", { token: "own-verification" })).status, 400);
  const response = await auth.handler(new Request(`${origin}/api/auth/delete-user/callback?token=own-verification`, {
    headers: { Cookie: cookie("current-token") },
  }));
  assert.equal(response.status, 400);
  assert.equal(db.user.length, 2);
  assert.equal(db.account.length, 1);
  assert.equal(db.session.length, 3);
});

test("a trailing slash cannot bypass the credential password requirement", async () => {
  const { post, db } = await authFixture();
  const response = await post("delete-user/");
  assert.ok(response.status >= 400);
  assert.equal(db.user.length, 2);
  assert.equal(db.account.length, 1);
});

function useGoogleAccount(db: Record<string, Record<string, unknown>[]>) {
  db.account = [{
    id: "google-account", userId: "owner", providerId: "google", accountId: "google-owner",
    accessToken: "synthetic-oauth-token", createdAt: new Date(), updatedAt: new Date(),
  }];
}

test("a fresh Google-only session can delete without an unusable password challenge", async () => {
  const { post, db } = await authFixture();
  useGoogleAccount(db);
  assert.equal((await post("delete-user")).status, 200);
  assert.deepEqual(db.user.map((user) => user.id), ["other"]);
  assert.equal(db.account.length, 0);
});

test("an expired Google session cannot authorize deletion", async () => {
  const { post, db } = await authFixture();
  useGoogleAccount(db);
  db.session[0].expiresAt = new Date(Date.now() - 1000);
  assert.equal((await post("delete-user")).status, 401);
  assert.equal(db.user.length, 2);
  assert.equal(db.account.length, 1);
});

test("a credential-store failure cannot fall back to passwordless deletion", async (t) => {
  const { post, db, auth } = await authFixture();
  const context = await auth.$context;
  t.mock.method(console, "error", () => {});
  context.internalAdapter.findCredentialAccount = async () => { throw new Error("Synthetic credential-store outage"); };
  const response = await post("delete-user");
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /Synthetic credential-store outage/);
  assert.equal(db.user.length, 2);
  assert.equal(db.account.length, 1);
  assert.equal(db.session.length, 3);
});

test("Google-only deletion requires a fresh session and succeeds after reauthentication", async () => {
  const { post, db } = await authFixture();
  useGoogleAccount(db);
  db.session[0].createdAt = new Date(Date.now() - 2 * 86_400_000);
  assert.equal((await post("delete-user")).status, 400);
  assert.equal((await post("delete-user", { password })).status, 400);
  assert.equal(db.user.length, 2);
  db.session[0].createdAt = new Date();
  assert.equal((await post("delete-user")).status, 200);
});

test("a Google deletion token cannot bypass session freshness on either endpoint", async () => {
  const { post, db, auth, cookie } = await authFixture();
  useGoogleAccount(db);
  db.session[0].createdAt = new Date(Date.now() - 2 * 86_400_000);
  db.verification.push({
    id: "google-delete-verification", identifier: "delete-account-google-verification",
    value: "owner", expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), updatedAt: new Date(),
  });
  assert.equal((await post("delete-user", { token: "google-verification" })).status, 400);
  const response = await auth.handler(new Request(`${origin}/api/auth/delete-user/callback?token=google-verification`, {
    headers: { Cookie: cookie("current-token") },
  }));
  assert.equal(response.status, 400);
  assert.equal(db.user.length, 2);
  assert.equal(db.account.length, 1);
  db.session[0].createdAt = new Date();
  assert.equal((await post("delete-user")).status, 200);
});

test("having a Google account does not waive an existing credential password", async () => {
  const { post, db } = await authFixture();
  const credential = db.account[0];
  useGoogleAccount(db);
  db.account.push(credential);
  assert.equal((await post("delete-user")).status, 400);
  assert.equal(db.user.length, 2);
  assert.equal((await post("delete-user", { password })).status, 200);
});
