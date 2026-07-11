import { type NextRequest } from "next/server";

import type { TrackedApplicationStatus } from "@/generated/prisma/client";
import {
  API_BODY_LIMITS,
  errorResponse,
  handleApiRouteError,
  rateLimitResponse,
  requestSizeLimitResponse,
  successResponse,
} from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { createTrackedApplication } from "@/lib/queries/tracker";
import { revalidateTrackerOverviewViews } from "@/lib/revalidation";

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

function parseDateValue(rawValue: unknown) {
  const value = String(rawValue ?? "").trim();
  if (!value) return null;

  // Require strict YYYY-MM-DD and reject impossible calendar dates, which JS
  // Date otherwise silently rolls forward (e.g. 2026-02-30 -> 2026-03-02).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Invalid date.");
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Invalid date.");
  }

  return parsed;
}

export async function POST(request: NextRequest) {
  try {
    const tooLarge = requestSizeLimitResponse(
      request,
      API_BODY_LIMITS.smallJson,
      "Application request"
    );
    if (tooLarge) return tooLarge;

    const rateLimited = await rateLimitResponse(
      request,
      "applications:create",
      API_RATE_LIMITS.authenticatedWrite
    );
    if (rateLimited) return rateLimited;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid JSON body.", 400);
    }
    const company = String(body.company ?? "").trim();
    const roleTitle = String(body.roleTitle ?? "").trim();
    const roleUrl = String(body.roleUrl ?? "").trim() || null;
    const statusRaw = String(body.status ?? "APPLIED").trim().toUpperCase();
    const reminder = String(body.reminder ?? "").trim() || null;

    if (!company || !roleTitle) {
      return errorResponse("Company and role title are required.", 400);
    }
    if (company.length > 200) {
      return errorResponse("Company name is too long (max 200 chars).", 400);
    }
    if (roleTitle.length > 300) {
      return errorResponse("Job title is too long (max 300 chars).", 400);
    }
    if (roleUrl && roleUrl.length > 2000) {
      return errorResponse("Job link is too long (max 2000 chars).", 400);
    }
    if (reminder && reminder.length > 1000) {
      return errorResponse("Reminder text is too long (max 1000 chars).", 400);
    }
    if (roleUrl && !/^https?:\/\/\S+$/i.test(roleUrl)) {
      return errorResponse("Job link must start with http:// or https://", 400);
    }

    if (!statusOptions.has(statusRaw as TrackedApplicationStatus)) {
      return errorResponse("Invalid status.", 400);
    }

    let deadline: Date | null;
    try {
      deadline = parseDateValue(body.deadline);
    } catch {
      return errorResponse("Invalid deadline.", 400);
    }

    const createdApplication = await createTrackedApplication({
      company,
      roleTitle,
      roleUrl,
      status: statusRaw as TrackedApplicationStatus,
      deadline,
      initialReminderNote: reminder,
    });

    revalidateTrackerOverviewViews();
    return successResponse(
      {
        applicationId: createdApplication.id,
        success: "Tracked application added.",
      },
      201
    );
  } catch (error) {
    return handleApiRouteError(error, "POST /api/applications", "Could not add application.");
  }
}
