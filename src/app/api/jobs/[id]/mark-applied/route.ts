import { type NextRequest } from "next/server";

import { handleApiRouteError, rateLimitResponse, successResponse } from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { recordAction } from "@/lib/queries/behavior";
import { saveJob } from "@/lib/queries/saved-jobs";
import { upsertTrackedApplicationFromJob } from "@/lib/queries/tracker";
import { revalidatePaths, revalidateTrackerOverviewViews } from "@/lib/revalidation";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "jobs:mark-applied",
      API_RATE_LIMITS.authenticatedWrite
    );
    if (rateLimited) return rateLimited;

    const { id } = await params;
    const [tracked] = await Promise.all([
      upsertTrackedApplicationFromJob({
        canonicalJobId: id,
        status: "APPLIED",
      }),
      saveJob(id, "APPLIED"),
      recordAction(id, "APPLY"),
    ]);

    revalidateTrackerOverviewViews();
    revalidatePaths(["/jobs", `/jobs/${id}`]);

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
      "POST /api/jobs/[id]/mark-applied",
      "Failed to mark this job as applied"
    );
  }
}
