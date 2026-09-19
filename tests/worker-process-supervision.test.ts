import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const root = process.cwd();
const apps = require("../ecosystem.config.cjs").apps as Array<{
  name: string;
  script: string;
  interpreter?: string;
  interpreter_args?: string;
  args: string;
  max_memory_restart?: string;
}>;

test("ingestion supervision targets actual TypeScript workers, not CLI wrappers", () => {
  for (const name of [
    "ingest-daemon",
    "ingest-poll-worker",
    "ingest-validation-worker",
    "ingest-discovery-worker",
  ]) {
    const app = apps.find((item) => item.name === name)!;
    assert.ok(app, name);
    assert.match(app.script, /^scripts\/ingest-.*\.ts$/);
    assert.equal(app.interpreter, "node");
    assert.equal(app.interpreter_args, "--import tsx --require dotenv/config");
    assert.ok(app.max_memory_restart);
    assert.doesNotMatch(app.args, /tsx|dotenv/);
  }
});

test("real worker memory guards allow measured runtime overhead and remain configurable", () => {
  const env: NodeJS.ProcessEnv = { ...process.env, APPLYOVERFLOW_WORKER_GROUPS: "all" };
  const guards = [
    ["ingest-daemon", "INGEST_DAEMON_MAX_MEMORY_RESTART", "1024M"],
    ["ingest-poll-worker", "INGEST_POLL_MAX_MEMORY_RESTART", "1024M"],
    ["ingest-validation-worker", "INGEST_VALIDATION_MAX_MEMORY_RESTART", "768M"],
    ["ingest-discovery-worker", "INGEST_DISCOVERY_MAX_MEMORY_RESTART", "768M"],
  ];
  for (const [, key] of guards) delete env[key];
  const read = () => {
    const result = spawnSync(process.execPath, ["-e",
      'console.log(JSON.stringify(require("./ecosystem.config.cjs").apps.map(a=>[a.name,a.max_memory_restart])))',
    ], { cwd: root, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return new Map<string, string>(JSON.parse(result.stdout));
  };
  const defaults = read();
  for (const [name, key, expected] of guards) {
    assert.equal(defaults.get(name), expected);
    env[key] = "900M";
  }
  for (const [name] of guards) assert.equal(read().get(name), "900M");
});

test(
  "PM2 monitors the same PID that executes TypeScript and dotenv",
  { timeout: 25000 },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "applyoverflow-worker-pid-"));
    const home = path.join(dir, "pm2");
    const app = apps.find((item) => item.name === "ingest-poll-worker")!;
    const config = path.join(dir, "ecosystem.config.cjs");
    const fixture = path.join(dir, "fixture.ts");
    await writeFile(path.join(dir, ".env"), "SUPERVISION_FIXTURE=loaded\n");
    await writeFile(
      fixture,
      `
    const value: string = process.env.SUPERVISION_FIXTURE!;
    console.log("WORKER_IDENTITY=" + JSON.stringify({ pid: process.pid, value, args: process.argv.slice(2) }));
    setInterval(() => {}, 1000);
  `,
    );
    await writeFile(
      config,
      `module.exports = ${JSON.stringify({
        apps: [
          {
            ...app,
            name: "pid-fixture",
            script: fixture,
            cwd: root,
            args: "--role=poll --interval=60",
            autorestart: false,
            output: "/dev/null",
            error: "/dev/null",
            env: { DOTENV_CONFIG_PATH: path.join(dir, ".env") },
          },
        ],
      })};`,
    );
    const env = {
      ...process.env,
      PM2_HOME: home,
      PM2_PUBLIC_KEY: "",
      PM2_SECRET_KEY: "",
    };
    const child = spawn(
      process.execPath,
      [path.join(root, "node_modules/pm2/bin/pm2-runtime"), config],
      {
        cwd: root,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const closed = new Promise<void>((resolve) =>
      child.once("close", () => resolve()),
    );
    try {
      const identity = await new Promise<{
        pid: number;
        value: string;
        args: string[];
      }>((resolve, reject) => {
        let output = "";
        const timer = setTimeout(
          () => reject(new Error(output.slice(-3000))),
          12000,
        );
        const receive = (chunk: Buffer) => {
          output += chunk.toString();
          const match = /WORKER_IDENTITY=(\{[^\n]+\})/.exec(output);
          if (match) {
            clearTimeout(timer);
            resolve(JSON.parse(match[1]));
          }
        };
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.stdout.on("data", receive);
        child.stderr.on("data", receive);
      });
      const listing = spawnSync(
        process.execPath,
        [path.join(root, "node_modules/pm2/bin/pm2"), "jlist"],
        {
          cwd: root,
          env,
          encoding: "utf8",
          timeout: 5000,
        },
      );
      assert.equal(listing.status, 0, listing.stderr);
      const managed = JSON.parse(listing.stdout).find(
        (item: { name: string }) => item.name === "pid-fixture",
      );
      assert.equal(
        managed.pid,
        identity.pid,
        "memory and signal supervision must reach the real worker",
      );
      assert.equal(identity.value, "loaded");
      assert.deepEqual(identity.args, ["--role=poll", "--interval=60"]);
    } finally {
      child.kill("SIGTERM");
      await closed;
      await rm(dir, { recursive: true, force: true });
    }
  },
);
