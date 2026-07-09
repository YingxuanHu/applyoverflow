import assert from "node:assert/strict";
import test from "node:test";

import { decideSourceCircuitAction } from "@/lib/ingestion/source-circuit-breaker";

const NOW = new Date("2026-07-09T12:00:00.000Z");

function daysAgo(days: number) {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

test("healthy sources are kept", () => {
  const decision = decideSourceCircuitAction({
    now: NOW,
    consecutiveFailures: 2,
    retainedLiveJobCount: 40,
    lastSuccessfulPollAt: daysAgo(1),
    createdAt: daysAgo(200),
  });
  assert.equal(decision.action, "KEEP");
});

test("recent success keeps even a high failure counter alive", () => {
  const decision = decideSourceCircuitAction({
    now: NOW,
    consecutiveFailures: 150,
    retainedLiveJobCount: 0,
    lastSuccessfulPollAt: daysAgo(2),
    createdAt: daysAgo(300),
  });
  assert.equal(decision.action, "KEEP");
});

test("persistent failures route to rediscovery", () => {
  const decision = decideSourceCircuitAction({
    now: NOW,
    consecutiveFailures: 30,
    retainedLiveJobCount: 5,
    lastSuccessfulPollAt: daysAgo(20),
    createdAt: daysAgo(300),
  });
  assert.equal(decision.action, "REDISCOVER");
});

test("hopeless zombies with nothing retained are disabled", () => {
  const decision = decideSourceCircuitAction({
    now: NOW,
    consecutiveFailures: 4_128,
    retainedLiveJobCount: 0,
    lastSuccessfulPollAt: daysAgo(90),
    createdAt: daysAgo(400),
  });
  assert.equal(decision.action, "DISABLE");
});

test("zombies that still retain live jobs go to rediscovery, not disable", () => {
  const decision = decideSourceCircuitAction({
    now: NOW,
    consecutiveFailures: 500,
    retainedLiveJobCount: 120,
    lastSuccessfulPollAt: daysAgo(60),
    createdAt: daysAgo(400),
  });
  assert.equal(decision.action, "REDISCOVER");
});

test("never-successful sources age from createdAt", () => {
  const decision = decideSourceCircuitAction({
    now: NOW,
    consecutiveFailures: 200,
    retainedLiveJobCount: 0,
    lastSuccessfulPollAt: null,
    createdAt: daysAgo(45),
  });
  assert.equal(decision.action, "DISABLE");
});
