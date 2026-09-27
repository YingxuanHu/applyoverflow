import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const env = {
  ...process.env,
  DEPLOY_HOST: "example.invalid", DEPLOY_USER: "deploy",
  DEPLOY_SSH_KEY: "synthetic-test-key", DEPLOY_KNOWN_HOSTS: "synthetic-host-key",
  DEPLOY_SHA: "a".repeat(40), GHCR_USER: "YingxuanHu", GHCR_TOKEN: "synthetic-registry-token",
  WEB_IMAGE: `ghcr.io/yingxuanhu/applyoverflow-web@sha256:${"b".repeat(64)}`,
  MIGRATION_IMAGE: `ghcr.io/yingxuanhu/applyoverflow-migrations@sha256:${"c".repeat(64)}`,
};

for (const [name, overrides] of [
  ["missing host-key verification", { DEPLOY_KNOWN_HOSTS: "" }],
  ["untrusted SSH host arguments", { DEPLOY_HOST: "example.invalid;touch /tmp/unsafe" }],
  ["mutable image tags", { WEB_IMAGE: "ghcr.io/yingxuanhu/applyoverflow-web:latest" }],
]) {
  test(`SSH dispatch refuses ${name} before connecting`, () => {
    const result = spawnSync("bash", ["deploy/ci/dispatch.sh", "deploy"], {
      env: { ...env, ...overrides }, encoding: "utf8", timeout: 5_000,
    });
    assert.notEqual(result.status, 0);
    assert.equal(result.error, undefined, "Invalid inputs should fail immediately without a network timeout");
  });
}

test("SSH dispatch pins the host key, keeps tokens off argv, and cleans credentials", t => {
  const root = mkdtempSync(join(tmpdir(), "ao-dispatch-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin"), log = join(root, "calls.jsonl");
  mkdirSync(bin);
  const mock = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2), command = path.basename(process.argv[1]);
if (command === 'ssh' && args.at(-1).includes('mktemp')) console.log('/tmp/applyoverflow-ci.Fixture01');
let tokenOnStdin = false;
if (command === 'ssh' && args.at(-1).startsWith('bash')) tokenOnStdin = fs.readFileSync(0, 'utf8').trim() === 'synthetic-registry-token';
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify({args, tokenOnStdin}) + '\\n');
`;
  for (const command of ["ssh", "scp"]) writeFileSync(join(bin, command), mock, { mode: 0o755 });
  const result = spawnSync("bash", ["deploy/ci/dispatch.sh", "deploy"], {
    env: { ...env, MOCK_LOG: log, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8", timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(calls.length, 3);
  assert.equal(calls[2].tokenOnStdin, true);
  for (const { args } of calls) {
    assert.ok(args.includes("StrictHostKeyChecking=yes"));
    const key = args[args.indexOf("-i") + 1];
    assert.equal(existsSync(key), false, "Temporary SSH credentials are removed on exit");
    assert.ok(!args.join(" ").includes("synthetic-registry-token"));
  }
});
