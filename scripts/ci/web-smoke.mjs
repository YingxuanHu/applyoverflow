import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp } from "node:fs/promises";

// Exercise the deployable standalone bundle, not the development server.
await cp("public", ".next/standalone/public", { recursive: true });
await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
const origin = "http://127.0.0.1:3107";
const server = spawn(process.execPath, [".next/standalone/server.js"], {
  env: { ...process.env, PORT: "3107", HOSTNAME: "127.0.0.1", NODE_ENV: "production" },
  stdio: "inherit",
});
const closed = once(server, "close");
const request = (path, options = {}) => fetch(origin + path, { signal: AbortSignal.timeout(5_000), ...options });
try {
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    assert.equal(server.exitCode, null, "Production server exited before becoming ready");
    try {
      const response = await request("/api/health");
      const body = await response.json();
      ready = response.ok && body.status === "ready" && body.revision === process.env.BUILD_SHA;
    } catch { /* Startup may not yet have bound the HTTP port. */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  assert.ok(ready, "Production server must be ready on the expected revision");
  assert.equal((await request("/")).status, 200);
  const jobs = await request("/jobs", { redirect: "manual" });
  assert.ok([302, 303, 307, 308].includes(jobs.status), "Anonymous jobs requests must require sign-in");
  const extension = await request("/downloads/applyoverflow-assistant.zip");
  assert.equal(extension.status, 200);
  const bytes = new Uint8Array(await extension.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04], "Extension download must be a ZIP, not an error page");
  console.log("PASS standalone readiness, auth redirect, and public extension download");
} finally {
  server.kill("SIGTERM");
  const force = setTimeout(() => server.kill("SIGKILL"), 5_000);
  await closed;
  clearTimeout(force);
}
