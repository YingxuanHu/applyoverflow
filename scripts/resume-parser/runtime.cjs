"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Plain Node runtime shared with standalone children; no TS loader or app imports. */

const { spawn, execFile } = require("node:child_process");
const { readFile } = require("node:fs/promises");
const { resolve, join } = require("node:path");
const { LIMITS, ERRORS, ResumeParserError, validateInput } = require("./policy.cjs");

// Global across Next route bundles, with no queue retaining uploaded buffers.
const poolKey = Symbol.for("applyoverflow.resume-parser-pool.v1");
const pool = globalThis[poolKey] ??= { active: 0 };

async function residentBytes(pid) {
  if (process.platform === "linux") {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const kb = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status)?.[1];
    if (!kb) throw new Error("RSS unavailable");
    return Number(kb) * 1024;
  }
  if (process.platform === "darwin") {
    return new Promise((resolveRss, reject) => execFile("/bin/ps", ["-o", "rss=", "-p", String(pid)],
      { env: { LANG: "C" }, timeout: 1000, maxBuffer: 1024 }, (error, stdout) => {
        const kb = Number(stdout.trim());
        if (error || !Number.isFinite(kb) || kb <= 0) reject(error ?? new Error("RSS unavailable"));
        else resolveRss(kb * 1024);
      }));
  }
  throw new Error("Unsupported parser platform");
}

/** One request per process. Options are trusted server/test configuration, never request data. */
async function parseResume(buffer, fileName, mimeType, options = {}) {
  const validated = validateInput(buffer, fileName, mimeType);
  if (options.signal?.aborted) throw new ResumeParserError("CANCELLED");
  if (pool.active >= LIMITS.concurrency) throw new ResumeParserError("BUSY");
  if (!["linux", "darwin"].includes(process.platform) || Number(process.versions.node.split(".")[0]) < 22) {
    throw new ResumeParserError("UNAVAILABLE");
  }
  pool.active++;
  try {
    const root = resolve(options.runtimeRoot ?? process.cwd());
    const worker = resolve(options.workerPath ?? join(root, "scripts/resume-parser/worker.cjs"));
    return await new Promise((resolveResult, reject) => {
      let failure;
      let closed = false;
      let readingRss = false;
      let rssFailures = 0;
      let totalBytes = 0;
      const chunks = [];
      const child = spawn(process.execPath, [
        `--max-old-space-size=${LIMITS.heapMb}`, "--max-semi-space-size=8",
        "--disable-wasm-trap-handler", "--disallow-code-generation-from-strings",
        "--permission", `--allow-fs-read=${join(root, "node_modules")}`,
        `--allow-fs-read=${join(root, "scripts/resume-parser")}`,
        `--allow-fs-read=${worker}`, "--allow-addons", "--no-warnings",
        worker, validated.kind, options.preview === true ? "preview" : "text",
      ], {
        cwd: join(root, "scripts/resume-parser"),
        // No inherited credentials, NODE_OPTIONS, preload hooks, HOME, PATH, or proxy config.
        env: { LANG: "C.UTF-8", TZ: "UTC", NODE_ENV: "production", UV_THREADPOOL_SIZE: "1" },
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
      const stop = (code) => {
        if (closed || failure) return;
        failure = new ResumeParserError(code);
        child.kill("SIGKILL");
      };
      const deadline = setTimeout(() => stop("TIMEOUT"), Math.min(options.deadlineMs ?? LIMITS.deadlineMs, LIMITS.deadlineMs));
      // V8 limits exclude Buffers/native canvas. The parent samples total RSS even
      // while synchronous parser code is stalled. This is not a kernel cgroup cap.
      const memory = setInterval(async () => {
        if (readingRss || closed || !child.pid) return;
        readingRss = true;
        try {
          const rss = await residentBytes(child.pid);
          rssFailures = 0;
          if (rss > Math.min(options.rssBytes ?? LIMITS.rssBytes, LIMITS.rssBytes)) stop("MEMORY_LIMIT");
        } catch {
          // ps/proc can observe an exiting process before Node delivers close.
          // Persistent monitoring failure still fails closed, never unbounded.
          if (++rssFailures >= 3 && !closed && child.exitCode === null && child.signalCode === null) stop("UNAVAILABLE");
        } finally { readingRss = false; }
      }, 50);
      const cancel = () => stop("CANCELLED");
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) cancel();
      child.on("error", () => { failure ??= new ResumeParserError("UNAVAILABLE"); });
      child.stdin.on("error", () => { /* The close event handles early exits and EPIPE. */ });
      child.stdout.on("data", (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > LIMITS.outputBytes) stop("OUTPUT_LIMIT");
        else if (!failure) chunks.push(chunk);
      });
      child.on("close", (code, signal) => {
        closed = true;
        clearTimeout(deadline);
        clearInterval(memory);
        options.signal?.removeEventListener("abort", cancel);
        // Do not release the slot until the OS has reaped the child.
        if (failure) return reject(failure);
        if (code !== 0) return reject(new ResumeParserError(signal === "SIGABRT" ? "MEMORY_LIMIT" : "UNAVAILABLE"));
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (result.ok === false && Object.hasOwn(ERRORS, result.code)) return reject(new ResumeParserError(result.code));
          if (result.ok !== true || typeof result.text !== "string" || Buffer.byteLength(result.text) > LIMITS.textBytes ||
              !Array.isArray(result.previews) || result.previews.length > LIMITS.previewPages ||
              result.previews.some((value) => typeof value !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value)) ||
              !Number.isInteger(result.pages) || result.pages < 0 || result.pages > LIMITS.pages) {
            return reject(new ResumeParserError("INVALID"));
          }
          resolveResult({ text: result.text, previews: result.previews, pages: result.pages, ...validated });
        } catch { reject(new ResumeParserError("INVALID")); }
      });
      child.stdin.end(buffer);
    });
  } finally { pool.active--; }
}

module.exports = { parseResume, ResumeParserError, LIMITS, validateInput };
