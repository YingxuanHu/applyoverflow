import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const defaultUrl = "https://applyoverflow.com/api/health";
class HealthCheckError extends Error {}

export async function checkPublicHealth(url = defaultUrl, { timeoutMs = 10_000, expectedRevision } = {}) {
  const target = new URL(url);
  const local = ["127.0.0.1", "[::1]", "localhost"].includes(target.hostname);
  if (!(target.protocol === "https:" || (local && target.protocol === "http:")) ||
      target.username || target.password || target.search || target.hash || target.pathname !== "/api/health") {
    throw new HealthCheckError("invalid-health-url");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new HealthCheckError("invalid-timeout");
  if (expectedRevision !== undefined && !/^[a-f0-9]{40}$/.test(expectedRevision)) throw new HealthCheckError("invalid-expected-revision");
  const started = Date.now();
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(target, {
      method: "GET", redirect: "manual", credentials: "omit", cache: "no-store", signal,
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new HealthCheckError(`health-http-${response.status}`);
    }
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
      await response.body?.cancel();
      throw new HealthCheckError("health-not-json");
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body ?? []) {
      bytes += chunk.byteLength;
      if (bytes > 4096) throw new HealthCheckError("health-response-too-large");
      chunks.push(chunk);
    }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new HealthCheckError("health-invalid-json"); }
    if (payload?.status !== "ready") throw new HealthCheckError("health-not-ready");
    if (typeof payload.revision !== "string" || !/^[a-f0-9]{40}$/.test(payload.revision)) throw new HealthCheckError("health-invalid-revision");
    if (expectedRevision !== undefined && payload.revision !== expectedRevision) throw new HealthCheckError("health-revision-mismatch");
    // Never log response bodies, headers, URLs, or arbitrary server error text.
    return { status: "ready", revision: payload.revision, durationMs: Date.now() - started };
  } catch (error) {
    if (error instanceof HealthCheckError) throw error;
    throw new HealthCheckError(signal.aborted ? "health-timeout" : "health-network-failure");
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    url: { type: "string" }, "timeout-ms": { type: "string" }, "expected-revision": { type: "string" },
  } });
  const result = await checkPublicHealth(values.url, {
    timeoutMs: values["timeout-ms"] === undefined ? 10_000 : Number(values["timeout-ms"]),
    expectedRevision: values["expected-revision"],
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`Public health check failed: ${error instanceof HealthCheckError ? error.message : "invalid-monitor-configuration"}`);
    process.exitCode = 1;
  });
}
