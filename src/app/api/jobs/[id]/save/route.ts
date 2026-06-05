import { type NextRequest } from "next/server";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { saveJob, unsaveJob } from "@/lib/queries/saved-jobs";
import { recordAction } from "@/lib/queries/behavior";
import {
  removeTrackedWishlistFromJob,
  upsertTrackedApplicationFromJob,
} from "@/lib/queries/tracker";
import { handleApiRouteError, rateLimitResponse, successResponse } from "@/lib/api-utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "jobs:save",
      API_RATE_LIMITS.authenticatedWrite
    );
    if (rateLimited) return rateLimited;

    const { id } = await params;
    const [tracked] = await Promise.all([
      upsertTrackedApplicationFromJob({
        canonicalJobId: id,
        status: "WISHLIST",
      }),
      recordAction(id, "SAVE"),
    ]);

    const saved = await saveJob(
      id,
      tracked.status === "WISHLIST" || tracked.status === "PREPARING"
        ? "ACTIVE"
        : "APPLIED"
    );

    return successResponse(
      {
        ...saved,
        trackedStatus: tracked.status,
      },
      tracked.created ? 201 : 200
    );
  } catch (error) {
    return handleApiRouteError(
      error,
      "POST /api/jobs/[id]/save",
      "Failed to add job to wishlist"
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "jobs:unsave",
      API_RATE_LIMITS.authenticatedWrite
    );
    if (rateLimited) return rateLimited;

    const { id } = await params;
    await Promise.all([unsaveJob(id), removeTrackedWishlistFromJob(id)]);
    return successResponse({ success: true });
  } catch (error) {
    return handleApiRouteError(
      error,
      "DELETE /api/jobs/[id]/save",
      "Failed to remove job from wishlist"
    );
  }
}
