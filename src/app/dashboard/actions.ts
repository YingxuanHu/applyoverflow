"use server";

import type { TrackedApplicationStatus } from "@/generated/prisma/client";

import { createTrackedApplication } from "@/lib/queries/tracker";
import { revalidateTrackerOverviewViews } from "@/lib/revalidation";

type TrackerActionState = {
  error: string | null;
  success: string | null;
  createdApplicationId: string | null;
};

const statusOptions = new Set<TrackedApplicationStatus>([
  "WISHLIST",
  "APPLIED",
  "SCREEN",
  "INTERVIEW",
  "OFFER",
  "ACCEPTED",
  "REJECTED",
  "DECLINED",
  "WITHDRAWN",
]);

function parseDate(rawValue: FormDataEntryValue | null) {
  const value = String(rawValue ?? "").trim();
  if (!value) return null;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date.");
  }

  return parsed;
}

function toActionState(error: unknown): TrackerActionState {
  return {
    error: error instanceof Error ? error.message : "Request failed.",
    success: null,
    createdApplicationId: null,
  };
}

export async function createTrackedApplicationAction(
  _previousState: TrackerActionState,
  formData: FormData
): Promise<TrackerActionState> {
  try {
    const company = String(formData.get("company") ?? "").trim();
    const roleTitle = String(formData.get("roleTitle") ?? "").trim();
    const roleUrl = String(formData.get("roleUrl") ?? "").trim() || null;
    const statusRaw = String(formData.get("status") ?? "APPLIED").trim().toUpperCase();
    const reminder = String(formData.get("reminder") ?? "").trim() || null;

    if (!company || !roleTitle) {
      return {
        error: "Company and role title are required.",
        success: null,
        createdApplicationId: null,
      };
    }

    if (!statusOptions.has(statusRaw as TrackedApplicationStatus)) {
      return { error: "Invalid status.", success: null, createdApplicationId: null };
    }

    const createdApplication = await createTrackedApplication({
      company,
      roleTitle,
      roleUrl,
      status: statusRaw as TrackedApplicationStatus,
      deadline: parseDate(formData.get("deadline")),
      initialReminderNote: reminder,
    });

    revalidateTrackerOverviewViews();
    return {
      error: null,
      success: "Tracked application added.",
      createdApplicationId: createdApplication.id,
    };
  } catch (error) {
    return toActionState(error);
  }
}
