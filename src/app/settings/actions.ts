"use server";

import { saveTrackerSettings } from "@/lib/queries/tracker";
import { requireCurrentProfileId, UnauthorizedError } from "@/lib/current-user";
import { normalizeSalaryCurrency } from "@/lib/currency-conversion";
import { revalidatePaths } from "@/lib/revalidation";
import { invalidateTopPicksForUser } from "@/lib/top-picks/service";

import type { SettingsActionState } from "./action-state";

// WorkMode / ExperienceLevel are Prisma enums; casting a raw form value straight
// to the enum type lets a crafted value reach Prisma and surface a raw
// PrismaClientValidationError. Validate against the allowed members and treat
// anything else as unset.
const SETTINGS_WORK_MODE_VALUES = new Set([
  "REMOTE",
  "HYBRID",
  "ONSITE",
  "FLEXIBLE",
  "UNKNOWN",
]);
const SETTINGS_EXPERIENCE_LEVEL_VALUES = new Set([
  "ENTRY",
  "MID",
  "SENIOR",
  "LEAD",
  "EXECUTIVE",
  "UNKNOWN",
]);

function parseOptionalInt(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function handleError(error: unknown): SettingsActionState {
  if (error instanceof UnauthorizedError) {
    return { error: "Your session has expired. Sign in again.", success: null };
  }
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return { error: message, success: null };
}

export async function saveAccountSettings(
  _prev: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  try {
    const nameRaw = formData.get("name");
    const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
    if (!name) {
      return { error: "Name cannot be empty.", success: null };
    }

    await saveTrackerSettings({ name });
    revalidatePaths(["/settings", "/profile"]);
    return { error: null, success: "Account details updated." };
  } catch (error) {
    return handleError(error);
  }
}

export async function savePreferencesSettings(
  _prev: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  try {
    const preferredWorkModeRaw = formData.get("preferredWorkMode");
    const experienceLevelRaw = formData.get("experienceLevel");
    const salaryMin = parseOptionalInt(formData.get("salaryMin"));
    const salaryMax = parseOptionalInt(formData.get("salaryMax"));
    const salaryCurrency = normalizeSalaryCurrency(
      typeof formData.get("salaryCurrency") === "string"
        ? String(formData.get("salaryCurrency"))
        : null
    );

    if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) {
      return {
        error: "Minimum salary cannot exceed maximum salary.",
        success: null,
      };
    }

    const profileId = await requireCurrentProfileId();

    await saveTrackerSettings({
      preferredWorkMode:
        typeof preferredWorkModeRaw === "string" &&
        SETTINGS_WORK_MODE_VALUES.has(preferredWorkModeRaw)
          ? (preferredWorkModeRaw as
              | "REMOTE"
              | "HYBRID"
              | "ONSITE"
              | "FLEXIBLE"
              | "UNKNOWN")
          : null,
      experienceLevel:
        typeof experienceLevelRaw === "string" &&
        SETTINGS_EXPERIENCE_LEVEL_VALUES.has(experienceLevelRaw)
          ? (experienceLevelRaw as
              | "ENTRY"
              | "MID"
              | "SENIOR"
              | "LEAD"
              | "EXECUTIVE"
              | "UNKNOWN")
          : null,
      salaryMin,
      salaryMax,
      salaryCurrency: salaryCurrency ?? undefined,
      location:
        typeof formData.get("location") === "string"
          ? String(formData.get("location"))
          : undefined,
    });
    await invalidateTopPicksForUser(profileId);
    revalidatePaths(["/settings", "/profile", "/jobs", "/jobs/top-picks"]);
    return { error: null, success: "Job preferences saved." };
  } catch (error) {
    return handleError(error);
  }
}

export async function saveNotificationSettings(
  _prev: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  try {
    await saveTrackerSettings({
      emailNotificationsEnabled:
        formData.get("emailNotificationsEnabled") === "on",
    });
    revalidatePaths(["/settings", "/notifications"]);
    return { error: null, success: "Notification preferences saved." };
  } catch (error) {
    return handleError(error);
  }
}
