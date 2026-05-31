import { type NextRequest } from "next/server";

import type { TrackedApplicationStatus } from "@/generated/prisma/client";
import { errorResponse, successResponse } from "@/lib/api-utils";
import { UnauthorizedError } from "@/lib/current-user";
import { createTrackedApplication } from "@/lib/queries/tracker";
import { revalidateTrackerOverviewViews } from "@/lib/revalidation";

const statusOptions = new Set<TrackedApplicationStatus>([
  "WISHLIST",
  "PREPARING",
  "APPLIED",
  "SCREEN",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
]);

function parseDateValue(rawValue: unknown) {
  const value = String(rawValue ?? "").trim();
  if (!value) return null;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date.");
  }

  return parsed;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const company = String(body.company ?? "").trim();
    const roleTitle = String(body.roleTitle ?? "").trim();
    const roleUrl = String(body.roleUrl ?? "").trim() || null;
    const statusRaw = String(body.status ?? "APPLIED").trim().toUpperCase();
    const reminder = String(body.reminder ?? "").trim() || null;

    if (!company || !roleTitle) {
      return errorResponse("Company and role title are required.", 400);
    }

    if (!statusOptions.has(statusRaw as TrackedApplicationStatus)) {
      return errorResponse("Invalid status.", 400);
    }

    const createdApplication = await createTrackedApplication({
      company,
      roleTitle,
      roleUrl,
      status: statusRaw as TrackedApplicationStatus,
      deadline: parseDateValue(body.deadline),
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
    if (error instanceof UnauthorizedError) {
      return errorResponse("Unauthorized", 401);
    }

    console.error("POST /api/applications error:", error);
    return errorResponse(
      error instanceof Error ? error.message : "Could not add application.",
      500
    );
  }
}
