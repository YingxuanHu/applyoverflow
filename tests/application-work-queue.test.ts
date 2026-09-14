import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applicationAttention,
  applicationCalendarDay,
  matchesApplicationView,
  type ApplicationWorkItem,
} from "../src/lib/applications/work-queue";

const now = Date.parse("2026-09-14T16:00:00Z");
const base: ApplicationWorkItem = {
  status: "APPLIED",
  updatedAt: "2026-09-07T16:00:00Z",
  deadline: null,
  events: [],
};
test("follow-up starts at seven days and excludes wishlist, offers and closed applications", () => {
  assert.equal(matchesApplicationView(base, "follow-up", now), true);
  assert.equal(matchesApplicationView(base, "follow-up", now - 1), false);
  for (const status of [
    "WISHLIST",
    "PREPARING",
    "OFFER",
    "ACCEPTED",
    "REJECTED",
    "DECLINED",
    "WITHDRAWN",
  ] as const) {
    assert.equal(
      matchesApplicationView({ ...base, status }, "follow-up", now),
      false,
      status,
    );
  }
});
test("future reminders suppress follow-up, historical and undated reminders do not", () => {
  const reminder = {
    id: "r",
    note: "Email recruiter",
    reminderAt: "2026-09-15T16:00:00Z",
  };
  assert.equal(
    applicationAttention({ ...base, events: [reminder] }, now).followUp,
    false,
  );
  assert.equal(
    applicationAttention(
      {
        ...base,
        events: [{ ...reminder, reminderAt: "2026-09-01T16:00:00Z" }],
      },
      now,
    ).followUp,
    true,
  );
  assert.equal(
    applicationAttention(
      { ...base, events: [{ ...reminder, reminderAt: null }] },
      now,
    ).followUp,
    true,
  );
  assert.equal(
    applicationAttention(
      {
        ...base,
        events: [{ ...reminder, reminderAt: "2026-10-01T16:00:00Z" }],
      },
      now,
    ).upcoming,
    false,
  );
});
test("date-only wishlist deadlines include today, not submitted or closed applications", () => {
  const due = {
    ...base,
    status: "PREPARING" as const,
    deadline: "2026-09-14T00:00:00Z",
  };
  assert.equal(matchesApplicationView(due, "wishlist", now), true);
  assert.equal(applicationAttention(due, now).deadlineSoon, true);
  assert.equal(applicationAttention(due, now).deadlineOverdue, false);
  assert.equal(
    applicationAttention({ ...due, deadline: "2026-09-13T00:00:00Z" }, now)
      .deadlineOverdue,
    true,
  );
  assert.equal(
    applicationAttention({ ...due, status: "APPLIED" }, now).deadlineSoon,
    false,
  );
  assert.equal(
    applicationAttention({ ...due, status: "REJECTED" }, now).upcoming,
    false,
  );
});
test("next reminder is date-ordered without mutating the source timeline", () => {
  const events = [
    { id: "later", note: "Later", reminderAt: "2026-10-01T00:00:00Z" },
    { id: "next", note: "Next", reminderAt: "2026-09-15T00:00:00Z" },
  ];
  assert.equal(
    applicationAttention({ ...base, events }, now).nextReminder?.id,
    "next",
  );
  assert.equal(events[0].id, "later");
});

test("a deadline does not become overdue at UTC midnight while it is still today for the user", () => {
  const evening = Date.parse("2026-09-15T02:00:00Z");
  const day = applicationCalendarDay(evening, "America/Toronto");
  assert.equal(day, Date.parse("2026-09-14T00:00:00Z"));
  const application = { ...base, status: "WISHLIST" as const, deadline: "2026-09-14T00:00:00Z" };
  assert.equal(applicationAttention(application, evening, day).deadlineOverdue, false);
  assert.equal(applicationAttention(application, evening, day).deadlineSoon, true);
  assert.equal(applicationCalendarDay(evening, "Asia/Tokyo"), Date.parse("2026-09-15T00:00:00Z"));
});
