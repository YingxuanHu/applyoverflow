import { type NextRequest } from "next/server";

import { UserJobPreferenceFeedbackType } from "@/generated/prisma/client";
import {
  API_BODY_LIMITS,
  errorResponse,
  handleApiRouteError,
  parseJsonBodyWithLimit,
  rateLimitResponse,
  successResponse,
} from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { requireCurrentProfileId } from "@/lib/current-user";
import { saveTopPickFeedback } from "@/lib/top-picks/service";
import { revalidatePaths } from "@/lib/revalidation";

const FEEDBACK_TYPES = new Set<string>(Object.values(UserJobPreferenceFeedbackType));

export async function POST(request: NextRequest) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "jobs:top-picks:feedback",
      API_RATE_LIMITS.authenticatedWrite
    );
    if (rateLimited) return rateLimited;

    const parsedBody = await parseJsonBodyWithLimit<Record<string, unknown>>(
      request,
      API_BODY_LIMITS.smallJson,
      "Top picks feedback request"
    );
    if (!parsedBody.ok) return parsedBody.response;

    const body = parsedBody.data;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid JSON body", 400);
    }
    const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
    const feedbackType =
      typeof body?.feedbackType === "string" ? body.feedbackType.trim() : "";

    if (!jobId) return errorResponse("jobId is required", 400);
    if (!FEEDBACK_TYPES.has(feedbackType)) {
      return errorResponse("Unsupported feedback type", 400);
    }

    const userId = await requireCurrentProfileId();
    const feedback = await saveTopPickFeedback({
      userId,
      jobId,
      feedbackType: feedbackType as UserJobPreferenceFeedbackType,
    });
    revalidatePaths(["/jobs", "/jobs/top-picks"]);
    return successResponse({ success: true, feedbackId: feedback.id });
  } catch (error) {
    return handleApiRouteError(
      error,
      "POST /api/jobs/top-picks/feedback",
      "Failed to save feedback"
    );
  }
}
