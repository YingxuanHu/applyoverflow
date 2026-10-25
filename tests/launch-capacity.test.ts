import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { runCapacity, summarizeSamples, validateCapacityConfig, WORKLOADS, type CapacityConfig } from "../scripts/lib/capacity-harness";
import { redactedFailure, validateDatabaseTarget, validateHttpTarget } from "../scripts/lib/launch-evidence-safety";

const isolation = { environment: "local", isolatedSyntheticData: true, noProductionInfrastructure: true } as const;
function config(target: string): CapacityConfig {
  return {
    ...isolation, target, allowOrigins: [target], evidenceKind: "fixture", ramp: [1],
    stageDurationMs: 160, requestTimeoutMs: 2000, requestsPerSecond: 20, maxRequests: 20, maxResponseBytes: 1024,
    thresholds: { p95Ms: 1500, maxErrorRate: 0, minRequestsPerWorkload: 2 },
    workloads: { feed: { minRows: 1, requiredIds: ["synthetic-job"] } },
  };
}
const body = { data: [{ id: "synthetic-job", status: "LIVE" }], page: 1, pageSize: 20, total: 1 };
async function withServer(handler: http.RequestListener, run: (target: string) => Promise<void>) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
}

test("production, public/private DNS, credentials, wildcard allowlists and missing attestations fail closed", () => {
  for (const target of ["https://applyoverflow.com", "http://203.0.113.20", "http://staging.example.com", "http://localhost:3000", "http://169.254.169.254", "http://127.0.0.1:3000/path", "http://user:secret@127.0.0.1:3000", "http://127.0.0.1:3000?secret=token"]) {
    assert.throws(() => validateCapacityConfig(config(target)));
  }
  const input = config("http://127.0.0.1:3000");
  assert.throws(() => validateCapacityConfig({ ...input, allowOrigins: ["*"] }));
  assert.throws(() => validateCapacityConfig({ ...input, allowOrigins: [input.target, "*"] }));
  assert.throws(() => validateCapacityConfig({ ...input, environment: "production" } as unknown as CapacityConfig));
  assert.throws(() => validateCapacityConfig({ ...input, noProductionInfrastructure: false } as unknown as CapacityConfig));
  assert.throws(() => validateCapacityConfig({ ...input, isolatedSyntheticData: false } as unknown as CapacityConfig));
  assert.throws(() => validateHttpTarget("http://10.0.0.2", ["http://10.0.0.2"], isolation));
  assert.equal(validateHttpTarget("http://10.0.0.2", ["http://10.0.0.2"], { ...isolation, environment: "staging" }).host, "10.0.0.2");
});

test("dedicated DB allowlist never falls back to production names or URL overrides", () => {
  const url = "postgresql://fixture:secret@127.0.0.1:5439/launch_evidence_fixture_test";
  const allowed = "postgresql://127.0.0.1:5439/launch_evidence_fixture_test";
  assert.equal(validateDatabaseTarget(url, allowed, isolation).pathname, "/launch_evidence_fixture_test");
  for (const target of [url.replace("launch_evidence_fixture_test", "autoapplication"), `${url}?host=production`, `${url}?options=-c%20default_transaction_read_only=off`, url.replace("127.0.0.1", "prod.example.com")]) {
    assert.throws(() => validateDatabaseTarget(target, allowed, isolation));
  }
  assert.throws(() => validateDatabaseTarget(url, "*", isolation));
  assert.deepEqual(redactedFailure(new Error(`secret ${url}`)), { schemaVersion: 1, complete: false, passed: false, error: "EVIDENCE_RUN_FAILED" });
});

test("all resource bounds and fixed workloads are validated before requests", () => {
  const input = config("http://127.0.0.1:3000");
  for (const change of [{ ramp: [2] }, { ramp: [1, 4] }, { ramp: [1, 2, 1] }, { ramp: [1, 2, 4, 8, 32] }, { stageDurationMs: 60_000 }, { requestTimeoutMs: Infinity }, { requestsPerSecond: 21 }, { maxRequests: 3001 }, { maxResponseBytes: 2_097_153 }, { workloads: { upload: { minRows: 1 } } }, { workloads: { feed: { minRows: 0 } } }]) {
    assert.throws(() => validateCapacityConfig({ ...input, ...change } as CapacityConfig));
  }
  assert.ok(Object.values(WORKLOADS).every((path) => path.startsWith("/api/jobs?")));
});

test("nearest-rank p95 and inclusive error budgets cannot hide slow or failed requests", () => {
  const samples = Array.from({ length: 20 }, (_, i) => ({ workload: "feed" as const, latencyMs: i + 1, status: i ? 200 : 503, error: i ? null : "http_status" }));
  const threshold = { p95Ms: 19, maxErrorRate: 0.05, minRequestsPerWorkload: 20 };
  assert.equal(summarizeSamples(samples, threshold).passed, true);
  assert.equal(summarizeSamples(samples, { ...threshold, p95Ms: 18 }).passed, false);
  assert.equal(summarizeSamples(samples, { ...threshold, maxErrorRate: 0.049 }).passed, false);
  assert.equal(summarizeSamples([], threshold).p95Ms, null);
  assert.equal(summarizeSamples([], threshold).passed, false);
});

test("local HTTP fixture proves ramp, rate bounds, body oracle and redacted metrics only", async () => {
  let requests = 0;
  await withServer((req, res) => {
    requests++;
    assert.equal(req.method, "GET");
    assert.equal(req.url, WORKLOADS.feed);
    assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers.authorization, undefined);
    res.writeHead(200, { "content-type": "application/json", "set-cookie": "SECRET_COOKIE" });
    res.end(JSON.stringify({ ...body, privateFixtureMarker: "DO_NOT_LOG" }));
  }, async (target) => {
    const input = { ...config(target), ramp: [1, 2], requestsPerSecond: 2, stageDurationMs: 1500 };
    Object.assign(input.thresholds, { privateConfigMarker: "DO_NOT_LOG" });
    const report = await runCapacity(input);
    assert.equal(report.passed, true, JSON.stringify(report));
    assert.equal(report.stages.length, 2);
    assert.equal(report.evidenceLevel, "harness_verified_only");
    assert.equal(report.productionCapacityEstablished, false);
    assert.ok(requests <= 8);
    const json = JSON.stringify(report);
    for (const secret of [target, "synthetic-job", "SECRET_COOKIE", "DO_NOT_LOG"]) assert.ok(!json.includes(secret));
  });
});

test("HTTP errors stop the ramp and are included in the error denominator", async () => {
  await withServer((_req, res) => { res.writeHead(503); res.end("private details"); }, async (target) => {
    const report = await runCapacity({ ...config(target), ramp: [1, 2, 4] });
    assert.equal(report.passed, false);
    assert.equal(report.complete, false);
    assert.equal(report.stages.length, 1);
    assert.equal(report.stages[0].errorRate, 1);
  });
});

test("local slow responses fail the latency threshold even with zero HTTP errors", async () => {
  await withServer((_req, res) => {
    const timer = setTimeout(() => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }, 30);
    res.on("close", () => clearTimeout(timer));
  }, async (target) => {
    const report = await runCapacity({ ...config(target), thresholds: { ...config(target).thresholds, p95Ms: 10 } });
    assert.equal(report.passed, false);
    assert.equal(report.stages[0].errors, 0);
    assert.ok(report.stages[0].p95Ms! >= 25);
  });
});

test("saturated concurrency records unserved arrival slots instead of claiming target throughput", async () => {
  await withServer((_req, res) => {
    const timer = setTimeout(() => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }, 80);
    res.on("close", () => clearTimeout(timer));
  }, async (target) => {
    const report = await runCapacity({ ...config(target), requestTimeoutMs: 500, thresholds: { ...config(target).thresholds, p95Ms: 500 } });
    assert.equal(report.passed, false);
    assert.ok(report.stages[0].skippedSlots >= 1);
  });
});

test("redirects are rejected without contacting their destination", async () => {
  let followed = 0;
  await withServer((_req, res) => { followed++; res.end(); }, async (destination) => {
    await withServer((_req, res) => { res.writeHead(302, { location: `${destination}/resume?secret=token` }); res.end(); }, async (target) => {
      const report = await runCapacity(config(target));
      assert.equal(report.passed, false);
      assert.ok(report.stages[0].errorKinds.redirect_rejected >= 1);
      assert.equal(followed, 0);
    });
  });
});

test("timeouts cover stalled response bodies and keep concurrency bounded", async () => {
  let active = 0;
  let maximum = 0;
  await withServer((_req, res) => {
    active++; maximum = Math.max(maximum, active);
    res.on("close", () => active--);
    res.writeHead(200, { "content-type": "application/json" }); res.write('{"data":');
  }, async (target) => {
    const report = await runCapacity({ ...config(target), requestTimeoutMs: 30 });
    assert.equal(report.passed, false);
    assert.ok(report.stages[0].errorKinds.timeout >= 1);
    assert.ok(report.elapsedMs < 5000);
    assert.equal(maximum, 1);
  });
});

test("oversized bodies, HTML login pages, empty results and wrong oracle IDs fail", async () => {
  for (const [contentType, payload, error] of [
    ["application/json", "x".repeat(2048), "response_size"],
    ["text/html", "<html>Sign in</html>", "content_type"],
    ["application/json", JSON.stringify({ ...body, data: [] }), "response_oracle"],
    ["application/json", JSON.stringify({ ...body, data: [{ id: "wrong", status: "LIVE" }] }), "response_oracle"],
  ]) {
    await withServer((_req, res) => { res.writeHead(200, { "content-type": contentType }); res.end(payload); }, async (target) => {
      const report = await runCapacity(config(target));
      assert.equal(report.passed, false);
      assert.ok(report.stages[0].errorKinds[error] >= 1);
    });
  }
});

test("per-workload sample floors and global request cap cannot produce a green partial run", async () => {
  await withServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }, async (target) => {
    const partial = await runCapacity({ ...config(target), maxRequests: 1 });
    assert.equal(partial.passed, false);
    assert.equal(partial.stopReason, "request_limit");
    const insufficient = await runCapacity({ ...config(target), workloads: { feed: { minRows: 1 }, city: { minRows: 1 } }, thresholds: { ...config(target).thresholds, minRequestsPerWorkload: 4 } });
    assert.equal(insufficient.passed, false);
    assert.equal(insufficient.stages[0].byWorkload.city.passed, false);
  });
});
