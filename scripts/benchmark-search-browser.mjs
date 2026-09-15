import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = new URL(process.env.TEST_APP_URL ?? "http://127.0.0.1:3003");
const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
assert.ok(local || (base.protocol === "https:" && process.env.BENCHMARK_REMOTE === "1"), "Remote benchmarking requires HTTPS and BENCHMARK_REMOTE=1");
assert.ok(!base.username && !base.password, "Do not put credentials in the URL");
assert.ok(process.env.BENCHMARK_STORAGE_STATE, "Provide an authenticated Playwright storage-state path");
const rounds = Number(process.env.BENCHMARK_ROUNDS ?? 3);
assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 5, "Use 1 to 5 rounds (at most 30 sequential navigations)");
const scenarios = [
  ["Board", "/jobs"],
  ["Engineer", "/jobs?titleSearch=engineer"],
  ["Toronto", "/jobs?searchScope=location&locationSearch=Toronto"],
  ["Toronto page 2", "/jobs?searchScope=location&locationSearch=Toronto&page=2"],
  ["Remote analyst", "/jobs?titleSearch=analyst&workMode=REMOTE"],
  ["Marketing, newest", "/jobs?titleSearch=marketing&sortBy=newest"],
];
const browser = await chromium.launch();
const samples = [];
try {
  const context = await browser.newContext({ storageState: process.env.BENCHMARK_STORAGE_STATE, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(30_000);
  page.setDefaultTimeout(30_000);
  for (let round = 1; round <= rounds; round++) {
    for (const [name, path] of scenarios) {
      const started = performance.now();
      try {
        const response = await page.goto(new URL(path, base.origin).href, { waitUntil: "domcontentloaded" });
        assert.ok(response?.ok(), `HTTP ${response?.status()}`);
        if (new URL(page.url()).pathname !== "/jobs") throw new Error("Session unavailable; refresh the storage state");
        const list = page.getByRole("region", { name: "Jobs on this page", exact: true });
        const empty = page.getByText(/^(No jobs on this page|No jobs match these filters|No jobs available right now)$/);
        await list.or(empty).first().waitFor({ state: "visible" });
        const resultsReadyMs = Math.round(performance.now() - started);
        let selectionReadyMs = null;
        if (await list.isVisible()) {
          // A real selection verifies hydration, not just server-rendered rows.
          const choices = list.getByRole("button");
          const index = (await choices.count()) > 1 ? 1 : 0;
          const choice = choices.nth(index);
          const selectionStarted = performance.now();
          await choice.click();
          await page.waitForFunction((index) => document.querySelectorAll('[aria-label="Jobs on this page"] button')[index]?.getAttribute("aria-current") === "true", index);
          selectionReadyMs = Math.round(performance.now() - selectionStarted);
        }
        const sample = { round, name, path, resultsReadyMs, selectionReadyMs };
        samples.push(sample);
        console.log(JSON.stringify(sample));
      } catch (error) {
        const message = error instanceof Error ? error.message.split("\n")[0] : "Benchmark failed";
        samples.push({ round, name, path, error: message });
        console.error(JSON.stringify({ round, name, error: message }));
        if (message.startsWith("Session unavailable")) throw error;
      }
      await page.waitForTimeout(1500);
    }
  }
  const times = samples.filter((sample) => !sample.error).map((sample) => sample.resultsReadyMs).sort((a, b) => a - b);
  const percentile = (fraction) => times.length ? times[Math.ceil(times.length * fraction) - 1] : null;
  const p95Ms = percentile(0.95);
  const errors = samples.filter((sample) => sample.error).length;
  console.log(JSON.stringify({ total: samples.length, errors, p50Ms: percentile(0.5), p95Ms, resultsBudgetMs: 2000, passesBudget: !errors && p95Ms !== null && p95Ms <= 2000,
    note: "Small sequential browser sample, not a load test. Round 1 is a first visit, not a guaranteed cold database cache. Exact counts do not block this measurement." }));
  if (errors || p95Ms === null || p95Ms > 2000) process.exitCode = 1;
} finally {
  await browser.close();
}
