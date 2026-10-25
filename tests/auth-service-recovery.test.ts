import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { APIError } from "better-auth/api";
import { NextRequest } from "next/server";
// 16.4.3's installed API still exports the legacy name, unlike its docs.
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

import * as availability from "../src/lib/service-availability";
import * as csp from "../src/lib/content-security-policy";
import { loadTsModule } from "./helpers/load-ts-module";

const secret = "test-only-session-secret-not-a-production-credential";
const token = "test-session-token";
const cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${createHmac("sha256", secret).update(token).digest("base64")}`)}`;
const user = { id: "auth-1", name: "Test User", email: "test@example.invalid" };
const liveSession = () => ({
  id: "session-1", userId: user.id, user: { status: "ACTIVE" },
  createdAt: new Date(Date.now() - 3600_000), updatedAt: new Date(), expiresAt: new Date(Date.now() + 86400_000),
});

function fixture() {
  const state = {
    policySession: liveSession() as ReturnType<typeof liveSession> | null,
    authSession: { user } as { user: typeof user } | null,
    policyError: null as unknown, authError: null as unknown, profileError: null as unknown,
    connectionError: null as unknown, headersError: null as unknown,
    headers: new Headers({ cookie }),
  };
  const calls = { policy: 0, auth: 0, profile: 0 };
  const logs: unknown[][] = [];
  const env: Record<string, string | undefined> = { NODE_ENV: "production", BETTER_AUTH_SECRET: secret };
  const globals = { process: { env }, console: { error: (...args: unknown[]) => logs.push(args) } };
  const policy = loadTsModule<typeof import("../src/lib/auth-session-policy")>("src/lib/auth-session-policy.ts", {}, globals);
  const db = {
    prisma: { session: { findUnique: async () => {
      calls.policy++;
      if (state.policyError) throw state.policyError;
      return state.policySession;
    } } },
    withPrismaConnectionRetry: async <T>(operation: () => Promise<T>) => {
      if (state.connectionError) throw state.connectionError;
      return operation();
    },
  };
  const current = loadTsModule<typeof import("../src/lib/current-user")>("src/lib/current-user.ts", {
    "next/headers": { headers: async () => { if (state.headersError) throw state.headersError; return state.headers; } },
    react: { cache: (fn: unknown) => fn },
    "@/lib/db": db, "@/lib/auth-session-policy": policy, "@/lib/service-availability": availability,
    "@/lib/auth": { auth: { api: { getSession: async () => {
      calls.auth++;
      if (state.authError) throw state.authError;
      return state.authSession;
    } } } },
    "@/lib/user-profile-sync": { syncProfileForAuthUser: async () => {
      calls.profile++;
      if (state.profileError) throw state.profileError;
      return { id: "profile-1" };
    } },
  }, globals);
  const api = loadTsModule<typeof import("../src/lib/api-utils")>("src/lib/api-utils.ts", {
    "@/lib/current-user": current, "@/lib/api-rate-limit": {}, "@/lib/service-availability": availability,
  }, globals);
  const proxy = loadTsModule<typeof import("../src/proxy")>("src/proxy.ts", {
    "@/lib/db": db, "@/lib/auth-session-policy": policy, "@/lib/service-availability": availability,
    "@/lib/content-security-policy": { ...csp, addReportOnlyCsp: (headers: Headers) => headers.set("Content-Security-Policy-Report-Only", csp.REPORT_ONLY_CSP) },
  }, globals);
  const request = (path = "/jobs", headers: Record<string, string> = {}, method = "GET") => new NextRequest(`https://app.example${path}`, {
    method, headers: { cookie: state.headers.get("cookie") ?? "", ...headers },
  });
  return { state, calls, env, logs, current, api, proxy, request };
}

test("absent and forged cookies remain anonymous without a database lookup", async () => {
  for (const value of ["", "better-auth.session_token=forged.invalid"]) {
    const f = fixture();
    f.state.headers = new Headers({ cookie: value });
    f.state.connectionError = new Error("database unavailable");
    assert.equal(await f.current.getOptionalSessionUser(), null);
    await assert.rejects(f.current.requireCurrentAuthUserId(), f.current.UnauthorizedError);
    assert.deepEqual(f.calls, { policy: 0, auth: 0, profile: 0 });
  }
});

test("revoked, inactive, expired, lifetime-limited and disabled sessions remain unauthorized", async () => {
  const cases = [null, { ...liveSession(), expiresAt: new Date(0) },
    { ...liveSession(), updatedAt: new Date(Date.now() - 8 * 86400_000) },
    { ...liveSession(), createdAt: new Date(Date.now() - 31 * 86400_000) },
    { ...liveSession(), user: { status: "DISABLED" } }];
  for (const policySession of cases) {
    const f = fixture();
    f.state.policySession = policySession;
    await assert.rejects(f.current.requireCurrentAuthUserId(), f.current.UnauthorizedError);
    assert.equal(f.calls.auth, 0);
    const response = await f.proxy.proxy(f.request("/jobs?query=finance"));
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get("location")!).searchParams.get("callbackUrl"), "/jobs?query=finance");
  }
});

test("auth refresh revocation is unauthorized, but auth service errors are unavailable", async () => {
  const f = fixture();
  f.state.authError = new APIError("UNAUTHORIZED", { message: "Session revoked" });
  await assert.rejects(f.current.requireCurrentAuthUserId(), f.current.UnauthorizedError);
  f.state.authError = new APIError("INTERNAL_SERVER_ERROR", { message: "Database down" });
  await assert.rejects(f.current.requireCurrentAuthUserId(), availability.ServiceUnavailableError);
  f.state.authError = null;
  f.state.authSession = null;
  assert.equal(await f.current.getOptionalSessionUser(), null);
  f.state.authSession = { user: { ...user, id: "wrong-account" } };
  assert.equal(await f.current.getOptionalSessionUser(), null);
});

test("database outage returns retryable 503 with no logout, secrets, or cached response; the same session recovers", async () => {
  const f = fixture();
  const failure = new Error("postgres://private:password@database/account?token=secret");
  f.state.policyError = failure;
  let error: unknown;
  try { await f.current.requireCurrentUserIds(); } catch (caught) { error = caught; }
  assert.ok(error instanceof availability.ServiceUnavailableError);
  assert.equal(error.cause, failure);
  const response = f.api.handleApiRouteError(error, "GET /api/jobs", "Failed");
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("location"), null);
  const body = await response.json();
  assert.equal(body.code, "SERVICE_UNAVAILABLE");
  assert.match(body.error, /do not need to sign out/);
  assert.doesNotMatch(JSON.stringify([body, f.logs]), /password|postgres|token=secret/);
  f.state.policyError = null;
  assert.equal(await f.current.requireCurrentAuthUserId(), user.id);
  assert.equal(f.state.headers.get("cookie"), cookie);
  assert.deepEqual(JSON.parse(JSON.stringify(await f.current.requireCurrentUserIds())), { authUserId: user.id, profileId: "profile-1" });
});

test("connection, profile and configuration failures never become authentication failures", async () => {
  const f = fixture();
  f.state.connectionError = new Error("Connect failed after retry");
  await assert.rejects(f.current.getOptionalSessionUser(), availability.ServiceUnavailableError);
  f.state.connectionError = null;
  f.state.profileError = new Error("Profile store unavailable");
  await assert.rejects(f.current.requireCurrentUserProfile(), availability.ServiceUnavailableError);
  delete f.env.BETTER_AUTH_SECRET;
  await assert.rejects(f.current.getOptionalSessionUser(), availability.ServiceUnavailableError);
  assert.equal((await f.proxy.proxy(f.request())).status, 503);
});

test("fresh-sensitive and web-session checks preserve unavailability versus reauthentication", async () => {
  const f = fixture();
  f.state.policyError = new Error("Unavailable");
  await assert.rejects(f.current.requireFreshSensitiveSession(), availability.ServiceUnavailableError);
  await assert.rejects(f.current.requireCurrentWebSession(), availability.ServiceUnavailableError);
  f.state.policyError = null;
  f.state.policySession!.createdAt = new Date(Date.now() - 2 * 86400_000);
  await assert.rejects(f.current.requireFreshSensitiveSession(), f.current.ReauthenticationRequiredError);
});

test("Next dynamic request signals are not swallowed or mislabeled as dependency failures", async () => {
  const f = fixture();
  const signal = new Error("DYNAMIC_SERVER_USAGE");
  f.state.headersError = signal;
  await assert.rejects(f.current.getOptionalSessionUser(), error => error === signal);
  assert.equal(f.calls.policy, 0);
});

test("proxy serves recoverable HTML for navigation and 503 JSON for RSC/actions, never redirects an outage", async () => {
  const f = fixture();
  f.state.policyError = new Error("Database down");
  const html = await f.proxy.proxy(f.request('/jobs?query=%3Cscript%3Esecret%3C/script%3E', { accept: "text/html" }));
  assert.equal(html.status, 503);
  assert.equal(html.headers.get("location"), null);
  assert.equal(html.headers.get("set-cookie"), null);
  assert.equal(html.headers.get("cache-control"), "no-store");
  assert.ok(html.headers.has("content-security-policy-report-only"));
  const text = await html.text();
  assert.match(text, /href=""/);
  assert.match(text, /Try again/);
  assert.doesNotMatch(text, /secret|script|Database/);
  const rsc = await f.proxy.proxy(f.request("/jobs", { rsc: "1", accept: "text/html" }));
  assert.equal(rsc.status, 503);
  assert.equal((await rsc.json()).code, "SERVICE_UNAVAILABLE");
  const action = await f.proxy.proxy(f.request("/profile", { "next-action": "action-id" }, "POST"));
  assert.equal(action.status, 503);
  f.state.policyError = null;
  assert.equal((await f.proxy.proxy(f.request())).headers.get("x-middleware-next"), "1");
});

test("public documents and setup actions remain reachable without the proxy database check", async () => {
  const f = fixture();
  f.state.policyError = new Error("Database down");
  for (const path of ["/", "/extension/privacy", "/api/health", "/api/security/csp-report"]) {
    const response = await f.proxy.proxy(f.request(path));
    assert.equal(response.headers.get("x-middleware-next"), "1");
    assert.ok(response.headers.has("content-security-policy-report-only"));
  }
  assert.equal((await f.proxy.proxy(f.request("/onboarding", { "next-action": "save-draft" }, "POST"))).headers.get("x-middleware-next"), "1");
  assert.equal(f.calls.policy, 0);
});

test("API invalid-session responses stay 401 and unrelated defects stay 500", async () => {
  const f = fixture();
  assert.equal(f.api.handleApiRouteError(new f.current.UnauthorizedError(), "test", "Failed").status, 401);
  assert.equal(f.api.handleApiRouteError(new Error("Other failure"), "test", "Failed").status, 500);
});

test("Next matcher includes public/protected documents and APIs, while excluding framework assets", () => {
  const { config } = fixture().proxy;
  for (const url of ["/", "/jobs", "/profile", "/extension/privacy", "/api/health", "/api/security/csp-report"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }), true, url);
  }
  for (const url of ["/_next/static/chunk.js", "/_next/image?url=logo.png", "/favicon.ico"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }), false, url);
  }
});
