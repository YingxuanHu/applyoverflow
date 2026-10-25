import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

test("resume ingestion never bypasses failed isolation and preserves the local API", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--conditions=react-server", "--import", "tsx", "tests/fixtures/resume-ingestion-boundary.ts",
  ], { cwd: process.cwd(), env: { PATH: process.env.PATH, NODE_ENV: "test" }, timeout: 30_000, maxBuffer: 16 * 1024 });
  assert.match(stdout, /Ingestion boundary:/);
});
