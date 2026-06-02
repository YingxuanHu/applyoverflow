import assert from "node:assert/strict";
import test from "node:test";

import {
  getStartOfTodayInTimeZone,
  normalizeUserTimeZone,
  parseDateTimeLocalInTimeZone,
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

test("datetime-local values are parsed as wall time in the user's timezone", () => {
  const parsed = parseDateTimeLocalInTimeZone("2026-06-15T09:30", "America/Toronto");

  assert.equal(parsed?.toISOString(), "2026-06-15T13:30:00.000Z");
});

test("datetime-local parser rejects impossible local times", () => {
  assert.equal(parseDateTimeLocalInTimeZone("2026-02-31T09:30", "America/Toronto"), null);
  assert.equal(parseDateTimeLocalInTimeZone("not-a-date", "America/Toronto"), null);
});
