import assert from "node:assert/strict";
import test from "node:test";

import {
  getStartOfTodayInTimeZone,
  normalizeUserTimeZone,
} from "@/lib/time-zone";

test("start of today uses the requested user's local timezone", () => {
  const summerNow = new Date("2026-05-30T15:30:00.000Z");
  assert.equal(
    getStartOfTodayInTimeZone("America/Toronto", summerNow).toISOString(),
    "2026-05-30T04:00:00.000Z"
  );

  const winterNow = new Date("2026-01-15T15:30:00.000Z");
  assert.equal(
    getStartOfTodayInTimeZone("America/Toronto", winterNow).toISOString(),
    "2026-01-15T05:00:00.000Z"
  );
});

test("invalid timezones fall back to the app default", () => {
  const previousAppTimeZone = process.env.APP_TIME_ZONE;
  process.env.APP_TIME_ZONE = "America/Toronto";
  try {
    assert.equal(normalizeUserTimeZone("not/a-zone"), "America/Toronto");
  } finally {
    if (previousAppTimeZone === undefined) {
      delete process.env.APP_TIME_ZONE;
    } else {
      process.env.APP_TIME_ZONE = previousAppTimeZone;
    }
  }
});
