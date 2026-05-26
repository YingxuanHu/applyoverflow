import type { TrackedApplicationStatus } from "@/generated/prisma/client";

export const TRACKED_STATUS_LABEL: Record<TrackedApplicationStatus, string> = {
  WISHLIST: "Wishlist",
  PREPARING: "Preparing",
  APPLIED: "Applied",
  SCREEN: "Screen",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

// Status pill colors:
//   Yellow  → Preparing (warm "in-flight" tone, signals "not yet sent")
//   Green   → Screen / Interview / Offer (positive momentum stages)
//   Red     → Rejected (terminal negative)
//   Neutral → Wishlist / Applied / Withdrawn (default, no positive or
//             negative signal yet)
const NEUTRAL = "bg-secondary text-secondary-foreground";
const POSITIVE = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
const PREPARING = "bg-amber-500/10 text-amber-700 dark:text-amber-300";
const REJECTED = "bg-destructive/10 text-destructive";

export function trackedStatusClass(status: TrackedApplicationStatus) {
  switch (status) {
    case "PREPARING":
      return PREPARING;
    case "SCREEN":
    case "INTERVIEW":
    case "OFFER":
      return POSITIVE;
    case "REJECTED":
      return REJECTED;
    case "WISHLIST":
    case "APPLIED":
    case "WITHDRAWN":
    default:
      return NEUTRAL;
  }
}

export function formatTrackerDate(value: Date | null) {
  if (!value) return "No deadline";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
  }).format(value);
}
