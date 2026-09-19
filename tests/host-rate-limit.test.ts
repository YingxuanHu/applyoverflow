import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithSourceHostGate, retryAfterMs, SourceHostRateLimitError, type SourceHostGate } from "../src/lib/ingestion/host-rate-limit";

test("Retry-After supports seconds and HTTP dates without shortening valid cooldowns", () => {
  const now = Date.parse("2026-09-19T12:00:00Z");
  assert.equal(retryAfterMs("120", now), 120000);
  assert.equal(retryAfterMs("Sat, 19 Sep 2026 12:10:00 GMT", now), 600000);
  assert.equal(retryAfterMs("172800", now), 172800000);
  assert.equal(retryAfterMs(null, now), 60000);
  assert.equal(retryAfterMs("nonsense", now), 60000);
});

test("a host's 429 prevents a different tenant from sending a request", async (t) => {
  let retryAt: Date | undefined;
  const hosts: string[] = [];
  const gate: SourceHostGate = {
    async reserve(host) { hosts.push(host); return { waitMs: 0, retryAt }; },
    async defer(host, duration) { hosts.push(host); retryAt = new Date(Date.now() + duration); },
  };
  const request = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 429, headers: { "retry-after": "120" } }));
  await fetchWithSourceHostGate("https://www.workable.com/api/accounts/one", {}, gate);
  await assert.rejects(fetchWithSourceHostGate("https://www.workable.com/api/accounts/two", {}, gate), SourceHostRateLimitError);
  assert.equal(request.mock.callCount(), 1);
  assert.ok(hosts.every((host) => host === "www.workable.com"));
});

test("abort during shared spacing does not send a provider request", async (t) => {
  const controller = new AbortController();
  const request = t.mock.method(globalThis, "fetch", async () => Response.json({}));
  const gate: SourceHostGate = {
    async reserve() { controller.abort(new Error("fixture abort")); return { waitMs: 1000 }; },
    async defer() {},
  };
  await assert.rejects(fetchWithSourceHostGate("https://www.workable.com/api/accounts/one", { signal: controller.signal }, gate), /fixture abort/);
  assert.equal(request.mock.callCount(), 0);
});
