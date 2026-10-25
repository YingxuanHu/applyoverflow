import http from "node:http";
import https from "node:https";
import { setTimeout as delay } from "node:timers/promises";
import { boundedNumber, requireEvidence, validateHttpTarget, type Isolation } from "./launch-evidence-safety";

export const WORKLOADS = {
  feed: "/api/jobs?page=1",
  title: "/api/jobs?titleSearch=engineer&page=1",
  canada: "/api/jobs?region=CA&page=1",
  us: "/api/jobs?region=US&page=1",
  city: "/api/jobs?locationSearch=Toronto&page=1",
  tech: "/api/jobs?roleCategory=SOFTWARE_ENGINEERING&page=1",
  finance: "/api/jobs?roleCategory=FINANCE_ACCOUNTING&page=1",
  general: "/api/jobs?roleCategory=MARKETING&page=1",
} as const;
type Workload = keyof typeof WORKLOADS;
type Oracle = { minRows: number; requiredIds?: string[] };
export type CapacityConfig = Isolation & {
  target: string;
  allowOrigins: string[];
  evidenceKind: "fixture" | "isolated_application";
  ramp: number[];
  stageDurationMs: number;
  requestTimeoutMs: number;
  requestsPerSecond: number;
  maxRequests: number;
  maxResponseBytes: number;
  thresholds: { p95Ms: number; maxErrorRate: number; minRequestsPerWorkload: number };
  workloads: Partial<Record<Workload, Oracle>>;
};
type Sample = { workload: Workload; latencyMs: number; error: string | null; status: number | null };

export function validateCapacityConfig(config: CapacityConfig) {
  const target = validateHttpTarget(config.target, config.allowOrigins, config);
  requireEvidence(["fixture", "isolated_application"].includes(config.evidenceKind), "EVIDENCE_KIND_REQUIRED");
  requireEvidence(Array.isArray(config.ramp) && config.ramp.length >= 1 && config.ramp.length <= 5 && config.ramp[0] === 1, "BOUNDED_RAMP_REQUIRED");
  config.ramp.forEach((n, i) => {
    boundedNumber(n, 1, 16, "CONCURRENCY_LIMIT");
    requireEvidence(i === 0 || (n > config.ramp[i - 1] && n <= config.ramp[i - 1] * 2), "RAMP_MUST_INCREASE_AT_MOST_TWO_FOLD");
  });
  boundedNumber(config.stageDurationMs, 100, 30_000, "STAGE_DURATION_LIMIT");
  boundedNumber(config.requestTimeoutMs, 10, 10_000, "REQUEST_TIMEOUT_LIMIT");
  requireEvidence(config.ramp.length * (config.stageDurationMs + config.requestTimeoutMs) <= 180_000, "WALL_TIME_LIMIT");
  boundedNumber(config.requestsPerSecond, 1, 20, "REQUEST_RATE_LIMIT");
  boundedNumber(config.maxRequests, 1, 3000, "REQUEST_COUNT_LIMIT");
  boundedNumber(config.maxResponseBytes, 128, 2_097_152, "RESPONSE_SIZE_LIMIT");
  boundedNumber(config.thresholds.p95Ms, 1, 10_000, "P95_THRESHOLD_REQUIRED");
  boundedNumber(config.thresholds.maxErrorRate, 0, 0.2, "ERROR_BUDGET_REQUIRED", false);
  boundedNumber(config.thresholds.minRequestsPerWorkload, 1, 500, "SAMPLE_THRESHOLD_REQUIRED");
  const workloads = Object.keys(config.workloads) as Workload[];
  requireEvidence(workloads.length > 0 && workloads.every((key) => Object.hasOwn(WORKLOADS, key)), "FIXED_READ_ONLY_WORKLOAD_REQUIRED");
  for (const key of workloads) {
    const oracle = config.workloads[key]!;
    boundedNumber(oracle.minRows, 1, 100, "NONEMPTY_ORACLE_REQUIRED");
    requireEvidence(!oracle.requiredIds || (Array.isArray(oracle.requiredIds) && oracle.requiredIds.length <= 100 && oracle.requiredIds.every((id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id))), "INVALID_ORACLE_IDS");
  }
  return { target, workloads };
}

function validBody(body: Buffer, oracle: Oracle) {
  try {
    const result = JSON.parse(body.toString("utf8"));
    return Array.isArray(result.data) && result.data.length >= oracle.minRows && result.data.length <= 100 && result.page === 1 &&
      Number.isInteger(result.pageSize) && result.pageSize > 0 && result.data.length <= result.pageSize &&
      (result.total === null || (Number.isInteger(result.total) && result.total >= result.data.length)) &&
      result.data.every((row: { id?: unknown; status?: unknown }) => row && typeof row.id === "string" && row.status === "LIVE") &&
      new Set(result.data.map((row: { id: string }) => row.id)).size === result.data.length &&
      (oracle.requiredIds ?? []).every((id) => result.data.some((row: { id: string }) => row.id === id));
  } catch { return false; }
}

function requestSample(target: URL, workload: Workload, config: CapacityConfig): Promise<Sample> {
  return new Promise((resolve) => {
    const started = performance.now();
    let settled = false;
    let status: number | null = null;
    const finish = (error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ workload, latencyMs: performance.now() - started, error, status });
    };
    const request = (target.protocol === "https:" ? https : http).request(new URL(WORKLOADS[workload], target), {
      method: "GET", agent: false,
      headers: { accept: "application/json", "user-agent": "launch-evidence/1" },
    }, (response) => {
      status = response.statusCode ?? null;
      if (status !== 200) {
        finish(status && status >= 300 && status < 400 ? "redirect_rejected" : "http_status");
        response.destroy();
        return;
      }
      if (!response.headers["content-type"]?.toLowerCase().includes("application/json")) {
        finish("content_type");
        response.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > config.maxResponseBytes) { finish("response_size"); response.destroy(); }
        else chunks.push(chunk);
      });
      response.on("end", () => finish(validBody(Buffer.concat(chunks), config.workloads[workload]!) ? null : "response_oracle"));
      response.on("error", () => finish("response_transport"));
      response.on("aborted", () => finish("response_transport"));
    });
    const timer = setTimeout(() => { finish("timeout"); request.destroy(); }, config.requestTimeoutMs);
    request.on("error", () => finish("transport"));
    request.end();
  });
}

export function percentile(values: number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] * 100) / 100;
}

export function summarizeSamples(samples: Sample[], thresholds: CapacityConfig["thresholds"]) {
  const errors = samples.filter((sample) => sample.error !== null);
  const times = samples.map((sample) => sample.latencyMs);
  const p95Ms = percentile(times, 0.95);
  const errorRate = samples.length ? errors.length / samples.length : null;
  return {
    requests: samples.length, errors: errors.length, errorRate,
    errorKinds: Object.fromEntries([...new Set(errors.map((s) => s.error!))].sort().map((key) => [key, errors.filter((s) => s.error === key).length])),
    p50Ms: percentile(times, 0.5), p95Ms, p99Ms: percentile(times, 0.99),
    passed: samples.length >= thresholds.minRequestsPerWorkload && p95Ms !== null && p95Ms <= thresholds.p95Ms && errorRate !== null && errorRate <= thresholds.maxErrorRate,
  };
}

export async function runCapacity(config: CapacityConfig) {
  const { target, workloads } = validateCapacityConfig(config);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const stages = [];
  let dispatched = 0;
  let requestLimitReached = false;
  for (const concurrency of config.ramp) {
    const stageStart = performance.now();
    const deadline = stageStart + config.stageDurationMs;
    const pending = new Set<Promise<void>>();
    const samples: Sample[] = [];
    let skippedSlots = 0;
    let stageDispatched = 0;
    let nextStartAt = stageStart;
    while (performance.now() < deadline) {
      if (performance.now() < nextStartAt) {
        await delay(Math.max(1, Math.min(nextStartAt, deadline) - performance.now()));
        continue;
      }
      nextStartAt = performance.now() + 1000 / config.requestsPerSecond;
      if (dispatched >= config.maxRequests) { requestLimitReached = true; break; }
      if (pending.size < concurrency) {
        const workload = workloads[stageDispatched++ % workloads.length];
        dispatched++;
        const task = requestSample(target, workload, config).then((sample) => { samples.push(sample); }).finally(() => pending.delete(task));
        pending.add(task);
      } else { skippedSlots++; }
    }
    await Promise.all(pending);
    const elapsedMs = performance.now() - stageStart;
    const byWorkload = Object.fromEntries(workloads.map((key) => [key, summarizeSamples(samples.filter((s) => s.workload === key), config.thresholds)]));
    const summary = summarizeSamples(samples, config.thresholds);
    const passed = summary.passed && Object.values(byWorkload).every((metric) => metric.passed) && skippedSlots === 0 && !requestLimitReached;
    stages.push({ concurrency, elapsedMs: Math.round(elapsedMs), offeredRequestsPerSecond: config.requestsPerSecond, completedRequestsPerSecond: samples.length * 1000 / elapsedMs, skippedSlots, ...summary, byWorkload, passed });
    if (!passed) break;
  }
  const complete = stages.length === config.ramp.length && !requestLimitReached;
  return {
    schemaVersion: 1, startedAt, environment: config.environment, evidenceKind: config.evidenceKind,
    evidenceLevel: config.evidenceKind === "fixture" ? "harness_verified_only" : "bounded_public_read_workload_measured",
    productionCapacityEstablished: false, userJourneyCapacityEstablished: false,
    complete, passed: complete && stages.every((stage) => stage.passed), elapsedMs: Math.round(performance.now() - started),
    stopReason: requestLimitReached ? "request_limit" : stages.some((stage) => !stage.passed) ? "threshold_or_sample_failure" : "completed",
    thresholds: { p95Ms: config.thresholds.p95Ms, maxErrorRate: config.thresholds.maxErrorRate, minRequestsPerWorkload: config.thresholds.minRequestsPerWorkload },
    limits: { ramp: [...config.ramp], stageDurationMs: config.stageDurationMs, requestTimeoutMs: config.requestTimeoutMs, maxRequests: config.maxRequests, maxResponseBytes: config.maxResponseBytes },
    stages,
  };
}
