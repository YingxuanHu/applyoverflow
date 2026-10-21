import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://unit:test@localhost:5432/unit";
const now = new Date("2026-10-21T12:00:00Z");
const url = "https://example.com/jobs/123456/software-engineer";

test("HEAD never renews availability, even for a reachable posting URL", async (t) => {
  const { checkApplyUrlAvailability } = await import("../src/lib/ingestion/pipeline");
  for (const status of [200, 204, 302, 403, 405, 429, 503]) {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response(null, { status }));
    const result = await checkApplyUrlAvailability(url, now);
    assert.equal(result.aliveConfirmedAt, null, String(status));
    assert.equal(result.deadSignalAt, null, String(status));
    assert.equal(result.validationStatus, "NEEDS_REVALIDATION", String(status));
    mock.mock.restore();
  }
});

test("HEAD retains explicit gone evidence", async (t) => {
  const { checkApplyUrlAvailability } = await import("../src/lib/ingestion/pipeline");
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 410 }));
  const result = await checkApplyUrlAvailability(url, now);
  assert.equal(result.aliveConfirmedAt, null);
  assert.equal(result.deadSignalAt, now);
  assert.equal(result.validationStatus, "BROKEN_APPLY_LINK");
});

test("blocked and failed fetches do not turn cached closure text into a dead posting", async (t) => {
  const { checkUrlHealth } = await import("../src/lib/ingestion/health-checker");
  for (const [status, expected] of [[403, "BLOCKED"], [429, "BLOCKED"], [503, "ERROR"]] as const) {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response("This job is no longer available", { status, headers: { "content-type": "text/html" } }));
    const result = await checkUrlHealth({ url, urlType: "APPLY", title: "Software Engineer", company: "ExampleCo", description: "", deadline: null, now });
    assert.equal(result.result, expected);
    mock.mock.restore();
  }
});

test("body verification distinguishes confirmed, unavailable and unverified postings", async (t) => {
  const { checkUrlHealth } = await import("../src/lib/ingestion/health-checker");
  for (const [body, expected] of [
    ["Software Engineer at ExampleCo. Build distributed services, maintain APIs, and collaborate with our product team.", "ALIVE"],
    ["This job is no longer available.", "DEAD"],
    ["Welcome to ExampleCo. Sign in to your account to continue. Enable JavaScript and accept cookies to use this website.", "SUSPECT"],
  ] as const) {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response(body, { headers: { "content-type": "text/html" } }));
    const result = await checkUrlHealth({ url, urlType: "APPLY", title: "Software Engineer", company: "ExampleCo", description: "", deadline: null, now });
    assert.equal(result.result, expected);
    mock.mock.restore();
  }
});
