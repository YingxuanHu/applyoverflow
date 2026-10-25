import assert from "node:assert/strict";
import test from "node:test";
import * as csp from "../src/lib/content-security-policy";
import * as availability from "../src/lib/service-availability";
import { loadTsModule } from "./helpers/load-ts-module";

function fixture() {
  const logs: unknown[][] = [];
  const globals = { console: { info: (...args: unknown[]) => logs.push(args) } };
  const api = loadTsModule<typeof import("../src/lib/api-utils")>("src/lib/api-utils.ts", {
    "@/lib/api-rate-limit": {}, "@/lib/current-user": {}, "@/lib/service-availability": availability,
  }, globals);
  const route = loadTsModule<typeof import("../src/app/api/security/csp-report/route")>("src/app/api/security/csp-report/route.ts", {
    "@/lib/api-utils": api, "@/lib/content-security-policy": csp,
  }, globals);
  return { ...route, logs };
}

const sensitiveReport = {
  "csp-report": {
    "effective-directive": "script-src-elem", disposition: "report",
    "document-uri": "https://app.example/reset?token=private-token",
    "blocked-uri": "https://private.example/resume-name?email=private@example.invalid",
    "source-file": "https://app.example/private-profile", "script-sample": "private resume contents",
    referrer: "https://private-employer.example", "original-policy": "sensitive-policy",
    "line-number": 42, "user-id": "private-user-id",
  },
};
const request = (body: unknown = sensitiveReport, type = "application/csp-report") => new Request("https://app.example/api/security/csp-report", {
  method: "POST", headers: { "content-type": type, cookie: "private-cookie", "user-agent": "private-user-agent" }, body: JSON.stringify(body),
});

test("production emits observation-only CSP without enforcement or script samples", () => {
  const policy = loadTsModule<typeof csp>("src/lib/content-security-policy.ts", {}, { process: { env: { NODE_ENV: "production" } } });
  const headers = new Headers();
  policy.addReportOnlyCsp(headers);
  assert.equal(headers.get("Content-Security-Policy"), null);
  assert.match(headers.get("Content-Security-Policy-Report-Only")!, /script-src 'self'/);
  assert.match(headers.get("Content-Security-Policy-Report-Only")!, /report-uri \/api\/security\/csp-report/);
  assert.equal(headers.get("Reporting-Endpoints"), 'csp="/api/security/csp-report"');
  assert.doesNotMatch(policy.REPORT_ONLY_CSP, /unsafe-inline|unsafe-eval|report-sample/);
});

test("development does not generate framework/HMR violation traffic", () => {
  const policy = loadTsModule<typeof csp>("src/lib/content-security-policy.ts", {}, { process: { env: { NODE_ENV: "development" } } });
  const headers = new Headers();
  policy.addReportOnlyCsp(headers);
  assert.equal([...headers].length, 0);
});

test("legacy reports retain only allowlisted directive/category values", async () => {
  const f = fixture();
  const response = await f.POST(request());
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(f.logs, [["[security.csp.report-only]", [{ directive: "script-src-elem", resource: "network", disposition: "report" }]]]);
  assert.doesNotMatch(JSON.stringify(f.logs), /private|token|resume|cookie|policy|42/);
});

test("Reporting API batches ignore all URL, sample, user-agent and unsupported report fields", async () => {
  const f = fixture();
  const response = await f.POST(request([
    { type: "csp-violation", url: "https://app.example/private", user_agent: "private", body: {
      effectiveDirective: "style-src-attr", blockedURL: "inline", disposition: "report", sample: "private", documentURL: "private",
    } },
    { type: "deprecation", body: { effectiveDirective: "script-src", blockedURL: "private" } },
    { type: "csp-violation", body: { effectiveDirective: "attacker\nprivate", blockedURL: "inline" } },
    { type: "csp-violation", body: { effectiveDirective: "script-src", blockedURL: "inline", disposition: "enforce" } },
  ], "application/reports+json"));
  assert.equal(response.status, 204);
  assert.deepEqual(f.logs, [["[security.csp.report-only]", [{ directive: "style-src-attr", resource: "inline", disposition: "report" }]]]);
});

test("data/blob resources are reduced to categories, not retained contents", () => {
  for (const [url, category] of [["data:text/plain,secret", "data"], ["blob:https://app.example/secret", "blob"], ["custom:secret", "other"]]) {
    assert.deepEqual(csp.summarizeCspReports({ "csp-report": { "effective-directive": "img-src", "blocked-uri": url } }),
      [{ directive: "img-src", resource: category, disposition: "report" }]);
  }
});

test("report endpoint rejects wrong media types, cross-site reports, malformed JSON and excessive batches", async () => {
  const f = fixture();
  assert.equal((await f.POST(request({}, "text/plain"))).status, 415);
  const crossSite = request(); crossSite.headers.set("sec-fetch-site", "cross-site");
  assert.equal((await f.POST(crossSite)).status, 403);
  assert.equal((await f.POST(new Request("https://app.example", { method: "POST", headers: { "content-type": "application/csp-report" }, body: "{" }))).status, 400);
  assert.equal((await f.POST(request(Array(csp.CSP_REPORT_MAX_BATCH + 1).fill(sensitiveReport)))).status, 400);
  assert.deepEqual(f.logs, []);
});

test("declared and streaming report bodies are byte-bounded even with a misleading Content-Length", async () => {
  const f = fixture();
  const declared = request(); declared.headers.set("content-length", String(csp.CSP_REPORT_MAX_BYTES + 1));
  assert.equal((await f.POST(declared)).status, 413);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(csp.CSP_REPORT_MAX_BYTES + 1))); },
    cancel() { cancelled = true; },
  });
  const streamed = new Request("https://app.example", {
    method: "POST", headers: { "content-type": "application/csp-report", "content-length": "1" }, body: stream, duplex: "half",
  } as RequestInit & { duplex: string });
  assert.equal((await f.POST(streamed)).status, 413);
  assert.equal(cancelled, true);
  assert.deepEqual(f.logs, []);
});

test("report volume is process-bounded without IP or user identity buckets", async () => {
  const f = fixture();
  for (let i = 0; i < csp.CSP_REPORT_REQUESTS_PER_MINUTE; i++) assert.equal((await f.POST(request())).status, 204);
  const response = await f.POST(request());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(f.logs.length, csp.CSP_REPORT_REQUESTS_PER_MINUTE);
});

test("a stalled report stream times out and is cancelled without logging input", async () => {
  const f = fixture();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const stalled = new Request("https://app.example", {
    method: "POST", headers: { "content-type": "application/csp-report" }, body, duplex: "half",
  } as RequestInit & { duplex: string });
  assert.equal((await f.POST(stalled)).status, 408);
  assert.equal(cancelled, true);
  assert.deepEqual(f.logs, []);
});
