import type { TrackedApplicationStatus } from "@/generated/prisma/client";

const DAY = 86_400_000;
const CLOSED = new Set<TrackedApplicationStatus>([
  "ACCEPTED",
  "REJECTED",
  "DECLINED",
  "WITHDRAWN",
]);
const AWAITING_RESPONSE = new Set<TrackedApplicationStatus>([
  "APPLIED",
  "SCREEN",
  "INTERVIEW",
]);

export type ApplicationWorkItem = {
  status: TrackedApplicationStatus;
  deadline: Date | string | null;
  updatedAt: Date | string;
  events: {
    id: string;
    note: string | null;
    reminderAt: Date | string | null;
  }[];
};

export const APPLICATION_VIEWS = [
  {
    id: "all",
    label: "All results",
    hint: "All applications matching your search and filters",
  },
  {
    id: "active",
    label: "In progress",
    hint: "Applied, screening, interviews, and offers",
  },
  {
    id: "upcoming",
    label: "Next 7 days",
    hint: "Scheduled reminders and wishlist deadlines in the next seven days",
  },
  {
    id: "follow-up",
    label: "Follow up",
    hint: "Awaiting a response with no update in seven days and no future reminder, or a passed wishlist deadline",
  },
  {
    id: "wishlist",
    label: "Wishlist",
    hint: "Saved applications not yet submitted",
  },
  {
    id: "closed",
    label: "Closed",
    hint: "Accepted, rejected, declined, and withdrawn applications",
  },
] as const;
export type ApplicationView = (typeof APPLICATION_VIEWS)[number]["id"];

export function applicationCalendarDay(now: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(value("year"), value("month") - 1, value("day"));
}

export function applicationAttention(
  application: ApplicationWorkItem,
  now: number,
  today = Math.floor(now / DAY) * DAY,
) {
  const closed = CLOSED.has(application.status);
  const wishlist =
    application.status === "WISHLIST" || application.status === "PREPARING";
  const quietDays = Math.max(
    0,
    Math.floor((now - new Date(application.updatedAt).getTime()) / DAY),
  );
  const nextReminder =
    application.events
      .filter(
        (event) =>
          event.reminderAt && new Date(event.reminderAt).getTime() >= now,
      )
      .sort(
        (a, b) =>
          new Date(a.reminderAt!).getTime() - new Date(b.reminderAt!).getTime(),
      )[0] ?? null;
  // Deadlines are date-only UTC values. A submitted application no longer needs an apply-deadline warning.
  const deadline = application.deadline
    ? new Date(application.deadline).getTime()
    : null;
  const deadlineOverdue = wishlist && deadline !== null && deadline < today;
  const deadlineSoon =
    wishlist &&
    deadline !== null &&
    deadline >= today &&
    deadline < today + 7 * DAY;
  const upcoming =
    !closed &&
    (deadlineSoon ||
      Boolean(
        nextReminder &&
          new Date(nextReminder.reminderAt!).getTime() < now + 7 * DAY,
      ));
  const followUp =
    !closed &&
    (deadlineOverdue ||
      (AWAITING_RESPONSE.has(application.status) &&
        quietDays >= 7 &&
        !nextReminder));
  return {
    closed,
    wishlist,
    active: !closed && !wishlist,
    quietDays,
    nextReminder,
    deadlineSoon,
    deadlineOverdue,
    upcoming,
    followUp,
  };
}

export function matchesApplicationView(
  application: ApplicationWorkItem,
  view: ApplicationView,
  now: number,
  today?: number,
) {
  const attention = applicationAttention(application, now, today);
  switch (view) {
    case "active":
      return attention.active;
    case "upcoming":
      return attention.upcoming;
    case "follow-up":
      return attention.followUp;
    case "wishlist":
      return attention.wishlist;
    case "closed":
      return attention.closed;
    default:
      return true;
  }
}
