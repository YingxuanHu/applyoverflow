import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Benchmarks use synthetic accounts; record response metadata, never cookies,
// credentials, capability tokens or application answer bodies.
export async function workflowBenchmark(page, directory, name, environment = "local application and database; synthetic account and extension transport") {
  await mkdir(directory, { recursive: true });
  const steps = [], responses = [], errors = [], started = performance.now();
  let previous = started;
  let responseOffset = 0;
  const requests = new WeakMap();
  page.on("request", request => requests.set(request, performance.now()));
  page.on("response", response => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/api/")) return;
    responses.push({ path: url.pathname, method: response.request().method(), status: response.status(),
      elapsedMs: Math.round(performance.now() - (requests.get(response.request()) ?? performance.now())) });
  });
  page.on("pageerror", error => errors.push(error.message));
  return {
    assertHealthy() {
      if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
    },
    async checkpoint(label) {
      const elapsedMs = Math.round(performance.now() - previous);
      const screenshot = `${name}-${steps.length + 1}.png`;
      const state = await page.locator(".app-page").innerText().catch(() => "");
      await page.screenshot({ path: resolve(directory, screenshot), fullPage: true, animations: "disabled" });
      steps.push({ label, elapsedMs, screenshot, state: state.slice(0, 12000), responses: responses.slice(responseOffset), status: "passed" });
      responseOffset = responses.length;
      previous = performance.now();
    },
    async finish(error) {
      const durations = steps.map(step => step.elapsedMs).sort((a, b) => a - b);
      const report = { createdAt: new Date().toISOString(), revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        workingTreeDirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
        environment,
        status: error || errors.length ? "failed" : "passed", failure: error ? String(error) : null,
        elapsedMs: Math.round(performance.now() - started), checkpoints: steps.length,
        stepMedianMs: durations[Math.floor(durations.length / 2)] ?? null,
        stepP95Ms: durations[Math.min(durations.length - 1, Math.floor(durations.length * .95))] ?? null,
        steps, responses, browserErrors: errors };
      await writeFile(resolve(directory, `${name}.json`), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ benchmark: name, status: report.status, checkpoints: steps.length, elapsedMs: report.elapsedMs,
        stepMedianMs: report.stepMedianMs, stepP95Ms: report.stepP95Ms, browserErrors: errors.length }));
    },
  };
}
