"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Runs as a plain Node child to test the actual runtime restrictions. */

const { readFileSync, writeFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const mode = Buffer.concat(chunks).toString();
  if (mode === "spin") { while (true) { /* Exercise a blocked child event loop. */ } }
  if (mode === "flood") { process.stdout.write("x".repeat(9 * 1024 * 1024)); return; }
  if (mode === "crash") process.exit(3);
  if (mode === "rss") {
    const buffers = [];
    setInterval(() => buffers.push(Buffer.alloc(4 * 1024 * 1024, 1)), 5);
    return;
  }
  if (mode === "heap") {
    const values = [];
    while (true) values.push(new Array(100_000).fill(123456));
  }
  const denied = (action) => {
    try { action(); return false; } catch (error) { return error.code === "ERR_ACCESS_DENIED"; }
  };
  const result = {
    envKeys: Object.keys(process.env).sort(),
    readDenied: denied(() => readFileSync(resolve(process.cwd(), "../../package.json"))),
    writeDenied: denied(() => writeFileSync(resolve(process.cwd(), "probe-output"), "blocked")),
    childDenied: denied(() => spawnSync(process.execPath, ["--version"])),
  };
  process.stdout.write(JSON.stringify({ ok: true, text: JSON.stringify(result), previews: [], pages: 0 }));
});
