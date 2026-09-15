import { API_BODY_LIMITS, errorResponse, handleApiRouteError, parseJsonBodyWithLimit, rateLimitResponse, successResponse } from "@/lib/api-utils";
import { requireCurrentProfileId } from "@/lib/current-user";
import { jobDataReportSchema } from "@/lib/jobs/data-report";
import { reportJobData } from "@/lib/queries/job-data-reports";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireCurrentProfileId();
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json") || request.headers.get("sec-fetch-site") === "cross-site") {
      return errorResponse("A same-site JSON request is required.", 415);
    }
    const limited = await rateLimitResponse(request, "jobs:report", { limit: 10, windowMs: 60 * 60 * 1000 });
    if (limited) return limited;
    const body = await parseJsonBodyWithLimit(request, API_BODY_LIMITS.smallJson);
    if (!body.ok) return body.response;
    const parsed = jobDataReportSchema.safeParse(body.data);
    if (!parsed.success) return errorResponse("Choose an issue and include 5 to 500 characters of detail.");
    const { id } = await params;
    if (!id || id.length > 200) return errorResponse("Invalid job.");
    const report = await reportJobData(id, parsed.data);
    return report ? successResponse(report) : errorResponse("Job not found.", 404);
  } catch (error) {
    return handleApiRouteError(error, "POST /api/jobs/[id]/report", "Could not submit the report.");
  }
}
