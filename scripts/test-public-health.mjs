import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { checkPublicHealth } from "./check-public-health.mjs";

const revision = "a".repeat(40);
async function withServer(handler, check) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await check(`http://127.0.0.1:${server.address().port}/api/health`); }
  finally {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  }
}
const json = (response, body, status = 200) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

test("read-only readiness and revision check returns only bounded public metadata", async () => {
  await withServer((request, response) => {
    assert.equal(request.method, "GET");
    assert.equal(request.url, "/api/health");
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers.authorization, undefined);
    json(response, { status: "ready", revision, privateDetail: "must not appear in output" });
  }, async url => {
    const result = await checkPublicHealth(url, { expectedRevision: revision });
    assert.deepEqual(Object.keys(result).sort(), ["durationMs", "revision", "status"]);
    assert.equal(result.status, "ready");
    assert.equal(result.revision, revision);
    assert.ok(result.durationMs >= 0);
  });
});

test("fails on unhealthy HTTP responses and does not follow redirects", async () => {
  for (const status of [302, 401, 500, 503]) {
    let calls = 0;
    await withServer((request, response) => {
      calls++;
      response.setHeader("Location", "/api/health");
      json(response, { status: "ready", revision, error: "private server detail" }, status);
    }, async url => {
      await assert.rejects(checkPublicHealth(url), { message: `health-http-${status}` });
      assert.equal(calls, 1);
    });
  }
});

test("requires ready status and a full immutable revision, never development or unknown", async () => {
  for (const [body, message] of [
    [{ status: "unavailable", revision }, "health-not-ready"],
    [{ status: "ok", revision }, "health-not-ready"],
    ...[undefined, "development", "unknown", "abc123", "b".repeat(64), "private detail"].map(value => [
      { status: "ready", revision: value }, "health-invalid-revision",
    ]),
  ]) await withServer((request, response) => json(response, body), url => assert.rejects(checkPublicHealth(url), { message }));
});

test("optional expected deployed revision detects drift without comparing against newer main", async () => {
  await withServer((request, response) => json(response, { status: "ready", revision }), url =>
    assert.rejects(checkPublicHealth(url, { expectedRevision: "b".repeat(40) }), { message: "health-revision-mismatch" }));
});

test("rejects HTML, malformed JSON and oversized payloads without exposing their contents", async () => {
  for (const [contentType, body, message] of [
    ["text/html", "private error page", "health-not-json"],
    ["application/json", "private invalid JSON", "health-invalid-json"],
    ["application/json", "x".repeat(4097), "health-response-too-large"],
  ]) await withServer((request, response) => {
    response.writeHead(200, { "Content-Type": contentType }); response.end(body);
  }, url => assert.rejects(checkPublicHealth(url), { message }));
});

test("bounds both header and body wait times", async () => {
  for (const sendHeaders of [false, true]) await withServer((request, response) => {
    if (sendHeaders) { response.writeHead(200, { "Content-Type": "application/json" }); response.write('{"status":'); }
  }, async url => {
    const started = Date.now();
    await assert.rejects(checkPublicHealth(url, { timeoutMs: 80 }), { message: "health-timeout" });
    assert.ok(Date.now() - started < 2000);
  });
});

test("network errors are sanitized and invalid configuration is rejected before fetching", async () => {
  await withServer(request => request.socket.destroy(), url => assert.rejects(checkPublicHealth(url), { message: "health-network-failure" }));
  for (const url of ["http://applyoverflow.com/api/health", "https://user:secret@applyoverflow.com/api/health", "https://applyoverflow.com/api/health?token=secret", "https://applyoverflow.com/api/health#secret", "https://applyoverflow.com/api/profile"]) {
    await assert.rejects(checkPublicHealth(url), { message: "invalid-health-url" });
  }
  await assert.rejects(checkPublicHealth(undefined, { timeoutMs: 0 }), { message: "invalid-timeout" });
  await assert.rejects(checkPublicHealth(undefined, { expectedRevision: "main" }), { message: "invalid-expected-revision" });
});
