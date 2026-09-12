import { after, type NextRequest } from "next/server";
import { enqueueDescriptionRepair } from "@/lib/jobs/description-repair";
import { getJobById } from "@/lib/queries/jobs";
import { errorResponse, handleApiRouteError, rateLimitResponse, successResponse } from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "jobs:detail",
      API_RATE_LIMITS.publicRead
    );
    if (rateLimited) return rateLimited;

    const { id } = await params;
    const job = await getJobById(id);
    if (!job) return errorResponse("Job not found", 404);
    after(() => enqueueDescriptionRepair(job).catch(() => console.warn("Description repair could not be queued")));
    return successResponse(job);
  } catch (error) {
    return handleApiRouteError(error, "GET /api/jobs/[id]", "Failed to fetch job");
  }
}
