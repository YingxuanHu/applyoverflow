import { type NextRequest } from "next/server";

import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { handleApiRouteError, rateLimitResponse, successResponse } from "@/lib/api-utils";
import { upsertTrackedApplicationFromJob } from "@/lib/queries/tracker";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "jobs:prepare",
      API_RATE_LIMITS.authenticatedWrite
    );
    if (rateLimited) return rateLimited;

    const { id } = await params;
    const tracked = await upsertTrackedApplicationFromJob({
      canonicalJobId: id,
      status: "PREPARING",
    });

    return successResponse(
      {
        applicationId: tracked.applicationId,
        created: tracked.created,
        status: tracked.status,
        workspaceUrl: `/applications/${tracked.applicationId}`,
      },
      tracked.created ? 201 : 200
    );
  } catch (error) {
    return handleApiRouteError(
      error,
      "POST /api/jobs/[id]/prepare",
      "Failed to prepare this job in applications"
    );
  }
}
