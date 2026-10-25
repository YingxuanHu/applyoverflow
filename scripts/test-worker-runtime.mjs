import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Never load the production ecosystem or inherit its secrets/PM2 daemon.
const root = resolve(import.meta.dirname, "..");
const directory = await mkdtemp(join(tmpdir(), "ao-pm2-"));
const env = {
  PATH: process.env.PATH, HOME: directory, PM2_HOME: join(directory, "pm2"),
  PM2_SILENT: "true", PM2_IO_DISABLE: "true", PM2_DISABLE_VERSION_CHECK: "true",
};
const fixture = resolve(root, "scripts/fixtures/pm2-smoke-worker.ts");
const tsx = resolve(root, "node_modules/.bin/tsx");
const definitions = [
  { name: "node-loader", script: fixture, interpreter: process.execPath, interpreter_args: "--import tsx --require dotenv/config", args: ["--fixture-argument"] },
  { name: "tsx-cli", script: tsx, args: ["-r", "dotenv/config", fixture, "--fixture-argument"] },
  { name: "shell-worker", script: "bash", interpreter: "none", args: ["-c", 'exec "$1" -r dotenv/config "$2" --fixture-argument', "fixture", tsx, fixture] },
];
const config = join(directory, "ecosystem.config.cjs");
let runtime;
let output = "";
try {
  await writeFile(join(directory, "fixture.env"), "PM2_DOTENV_FIXTURE=loaded\n");
  await writeFile(config, `module.exports = ${JSON.stringify({ apps: definitions.map(app => ({
    ...app, cwd: root, autorestart: false, kill_timeout: 2_000, merge_logs: true,
    output: join(directory, `${app.name}.out.log`), error: join(directory, `${app.name}.err.log`),
    env: { ...env, DATABASE_PROCESS_ROLE: "smoke", DOTENV_CONFIG_PATH: join(directory, "fixture.env"),
      PM2_SMOKE_READY: join(directory, `${app.name}.json`), port: "fixture-env-value" },
  })) })};\n`);
  runtime = spawn(process.execPath, [resolve(root, "node_modules/pm2/bin/pm2-runtime"), "start", config], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  runtime.stdout.on("data", data => { output = (output + data).slice(-16_000); });
  runtime.stderr.on("data", data => { output = (output + data).slice(-16_000); });
  let spawnError;
  runtime.on("error", error => { spawnError = error; });
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    assert.equal(runtime.exitCode, null, `PM2 runtime exited early: ${output}`);
    ready = true;
    for (const app of definitions) {
      try {
        const record = JSON.parse(await readFile(join(directory, `${app.name}.json`), "utf8"));
        assert.ok(record.pid > 0);
        process.kill(record.pid, 0);
      } catch { ready = false; }
    }
    if (ready) break;
    await delay(100);
  }
  assert.ok(ready, `PM2 worker startup timed out: ${output}`);
  const processes = JSON.parse(execFileSync(process.execPath, [resolve(root, "node_modules/pm2/bin/pm2"), "jlist"], { cwd: root, env, encoding: "utf8", timeout: 10_000 }));
  assert.deepEqual(processes.map(app => app.name).sort(), definitions.map(app => app.name).sort());
  assert.ok(processes.every(app => app.pm2_env.status === "online" && app.pm2_env.restart_time === 0));
  console.log("PASS isolated pm2-runtime: node --import tsx, tsx CLI, bash worker, dotenv/env propagation and dependency imports; no production workers");
} finally {
  if (runtime && runtime.exitCode === null) {
    const closed = new Promise(resolveClose => runtime.once("close", resolveClose));
    runtime.kill("SIGINT");
    try { await Promise.race([closed, delay(10_000).then(() => { throw new Error("PM2 did not stop"); })]); }
    catch (error) {
      execFileSync(process.execPath, [resolve(root, "node_modules/pm2/bin/pm2"), "kill"], { env, timeout: 10_000, stdio: "pipe" });
      runtime.kill("SIGKILL");
      await closed;
      throw error;
    }
  }
  await rm(directory, { recursive: true, force: true });
}
