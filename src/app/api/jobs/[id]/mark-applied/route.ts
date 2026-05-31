import { type NextRequest } from "next/server";

import { errorResponse, successResponse } from "@/lib/api-utils";
import { UnauthorizedError } from "@/lib/current-user";
import { recordAction } from "@/lib/queries/behavior";
import { saveJob } from "@/lib/queries/saved-jobs";
import { upsertTrackedApplicationFromJob } from "@/lib/queries/tracker";
import { revalidatePaths, revalidateTrackerOverviewViews } from "@/lib/revalidation";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
    if (error instanceof UnauthorizedError) {
      return errorResponse("Unauthorized", 401);
    }

    console.error("POST /api/jobs/[id]/mark-applied error:", error);
    return errorResponse("Failed to mark this job as applied", 500);
  }
}
