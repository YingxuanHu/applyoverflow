import assert from "node:assert/strict";
import test from "node:test";

import {
  getSensitiveActionSessionFailure,
  getSessionPolicyFailure,
  isSessionFreshForSensitiveAction,
  isSessionUsableByPolicy,
} from "../src/lib/auth-session-policy";

const now = new Date("2026-06-01T12:00:00.000Z");

function minutesAgo(minutes: number) {
  return new Date(now.getTime() - minutes * 60 * 1000);
}

function daysAgo(days: number) {
  return minutesAgo(days * 24 * 60);
}

function baseSession(overrides: Partial<{ createdAt: Date; updatedAt: Date; expiresAt: Date }> = {}) {
  return {
    createdAt: daysAgo(1),
    updatedAt: minutesAgo(10),
    expiresAt: daysAgo(-10),
    ...overrides,
  };
}

test("session policy allows active sessions inside idle and hard lifetime windows", () => {
  const session = baseSession();

  assert.equal(getSessionPolicyFailure(session, now), null);
  assert.equal(isSessionUsableByPolicy(session, now), true);
});

test("session policy expires idle sessions after seven days of inactivity", () => {
  const session = baseSession({ updatedAt: daysAgo(8) });

  assert.equal(getSessionPolicyFailure(session, now), "inactive");
  assert.equal(isSessionUsableByPolicy(session, now), false);
});

test("session policy enforces a thirty day hard maximum lifetime", () => {
  const session = baseSession({ createdAt: daysAgo(31) });

  assert.equal(getSessionPolicyFailure(session, now), "max_lifetime");
  assert.equal(isSessionUsableByPolicy(session, now), false);
});

test("session policy treats expired database sessions as unusable", () => {
  const session = baseSession({ expiresAt: minutesAgo(1) });

  assert.equal(getSessionPolicyFailure(session, now), "expired");
  assert.equal(isSessionUsableByPolicy(session, now), false);
});

test("sensitive actions require a fresh sign-in within twenty four hours", () => {
  const staleSensitiveSession = baseSession({
    createdAt: minutesAgo(24 * 60 + 1),
    updatedAt: minutesAgo(10),
  });

  assert.equal(getSensitiveActionSessionFailure(staleSensitiveSession, now), "not_fresh");
  assert.equal(isSessionFreshForSensitiveAction(staleSensitiveSession, now), false);

  const freshSensitiveSession = baseSession({
    createdAt: minutesAgo(23 * 60),
    updatedAt: minutesAgo(10),
  });

  assert.equal(getSensitiveActionSessionFailure(freshSensitiveSession, now), null);
  assert.equal(isSessionFreshForSensitiveAction(freshSensitiveSession, now), true);
});
