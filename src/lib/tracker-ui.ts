import type { TrackedApplicationStatus } from "@/generated/prisma/client";

export const TRACKED_STATUS_LABEL: Record<TrackedApplicationStatus, string> = {
  WISHLIST: "Wishlist",
  PREPARING: "Wishlist",
  APPLIED: "Applied",
  SCREEN: "Screen",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  DECLINED: "Declined",
  WITHDRAWN: "Closed",
};

// Status pill colors:
//   Green   → Screen / Interview / Offer / Accepted (positive momentum stages)
//   Red     → Rejected / Declined (terminal negative)
//   Neutral → Wishlist / Applied / Closed (default, no positive or
//             negative signal yet)
const NEUTRAL = "bg-secondary text-secondary-foreground";
const POSITIVE = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
const REJECTED = "bg-destructive/10 text-destructive";

export function trackedStatusClass(status: TrackedApplicationStatus) {
  switch (status) {
    case "SCREEN":
    case "INTERVIEW":
    case "OFFER":
    case "ACCEPTED":
      return POSITIVE;
    case "REJECTED":
    case "DECLINED":
      return REJECTED;
    case "WISHLIST":
    case "PREPARING":
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
