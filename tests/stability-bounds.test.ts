import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??=
  "postgresql://user:pass@localhost:5432/applyoverflow_test";

const NOW = new Date("2026-07-09T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function at(offsetMs: number) {
  return new Date(NOW.getTime() + offsetMs);
}

test("computeWorkdayHostMetrics aggregates blocked/success/cooldown/runtime per host", async () => {
  const { computeWorkdayHostMetrics } = await import(
    "../src/lib/ingestion/company-discovery"
  );

  const metrics = computeWorkdayHostMetrics(
    [
      // Host A: two recently blocked sources plus one stale failure that must
      // be ignored, one recent success, two future cooldowns.
      {
        token: "hosta|careers",
        boardUrl: "https://hosta.example.com/careers",
        cooldownUntil: at(5 * HOUR),
        lastFailureAt: at(-1 * HOUR),
        lastSuccessfulPollAt: at(-2 * 24 * HOUR),
        lastHttpStatus: 429,
        consecutiveFailures: 3,
        metadataJson: { pollRuntime: { avgMs: 20_000 } },
      },
      {
        token: "hosta|jobs",
        boardUrl: "https://hosta.example.com/jobs",
        cooldownUntil: at(10 * HOUR),
        lastFailureAt: at(-2 * HOUR),
        lastSuccessfulPollAt: null,
        lastHttpStatus: 403,
        consecutiveFailures: 5,
        metadataJson: { pollRuntime: { avgMs: 40_000 } },
      },
      {
        // Failure older than 24h -> not counted as blocked.
        token: "hosta|stale",
        boardUrl: "https://hosta.example.com/stale",
        cooldownUntil: null,
        lastFailureAt: at(-48 * HOUR),
        lastSuccessfulPollAt: null,
        lastHttpStatus: 429,
        consecutiveFailures: 10,
        metadataJson: null,
      },
      // Host B: a healthy source with a past (expired) cooldown and a runtime
      // sourced from lastSummary.runtimeMs.
      {
        token: "hostb|careers",
        boardUrl: "https://hostb.example.com/careers",
        cooldownUntil: at(-1 * HOUR),
        lastFailureAt: null,
        lastSuccessfulPollAt: at(-1 * 24 * HOUR),
        lastHttpStatus: null,
        consecutiveFailures: 0,
        metadataJson: { lastSummary: { runtimeMs: 15_000 } },
      },
    ],
    NOW
  );

  const hostA = metrics.get("hosta");
  assert.ok(hostA, "expected host A metrics");
  assert.equal(hostA.blockedSourceCount, 2);
  assert.equal(hostA.blockedStreak, 5);
  assert.equal(hostA.recentSuccessCount, 1);
  assert.deepEqual(hostA.cooldownUntil, at(10 * HOUR));
  // (20000 + 40000) / 2
  assert.equal(hostA.avgRuntimeMs, 30_000);

  const hostB = metrics.get("hostb");
  assert.ok(hostB, "expected host B metrics");
  assert.equal(hostB.blockedSourceCount, 0);
  assert.equal(hostB.blockedStreak, 0);
  assert.equal(hostB.recentSuccessCount, 1);
  assert.equal(hostB.cooldownUntil, null);
  assert.equal(hostB.avgRuntimeMs, 15_000);
});

test("computeWorkdayHostMetrics falls back to boardUrl host when token has no host prefix", async () => {
  const { computeWorkdayHostMetrics } = await import(
    "../src/lib/ingestion/company-discovery"
  );

  const metrics = computeWorkdayHostMetrics(
    [
      {
        token: "",
        boardUrl: "https://hostc.example.com/jobs",
        cooldownUntil: null,
        lastFailureAt: at(-1 * HOUR),
        lastSuccessfulPollAt: null,
        lastHttpStatus: 503,
        consecutiveFailures: 2,
        metadataJson: null,
      },
    ],
    NOW
  );

  const hostC = metrics.get("hostc.example.com");
  assert.ok(hostC, "expected boardUrl-derived host metrics");
  assert.equal(hostC.blockedSourceCount, 1);
  assert.equal(hostC.blockedStreak, 2);
});
