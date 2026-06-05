import { type NextRequest } from "next/server";
import {
  prepareApplicationReview,
  submitApplicationReview,
  updateApplicationSubmissionStatus,
} from "@/lib/queries/applications";
import { errorResponse, handleApiRouteError, rateLimitResponse, successResponse } from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";

const SUBMISSION_STATUS_BY_INTENT = {
  confirm: "CONFIRMED",
  fail: "FAILED",
  withdraw: "WITHDRAWN",
} as const;

/** POST — prepare or submit */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "jobs:apply",
      API_RATE_LIMITS.authenticatedWrite
    );
    if (rateLimited) return rateLimited;

    const { id } = await params;
    const body = await request.json();
    const intent = typeof body?.intent === "string" ? body.intent : null;

    if (intent === "prepare") {
      const result = await prepareApplicationReview(id);
      return successResponse(result, 201);
    }

    if (intent === "submit") {
      const result = await submitApplicationReview(id);
      return successResponse(result, 201);
    }

    return errorResponse("Invalid application intent", 400);
  } catch (error) {
    return handleApiRouteError(
      error,
      "POST /api/jobs/[id]/apply",
      "Failed to update application review"
    );
  }
}

/** PATCH — update submission status after it has been recorded */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "jobs:apply-status",
      API_RATE_LIMITS.authenticatedWrite
    );
    if (rateLimited) return rateLimited;

    const { id } = await params;
    const body = await request.json();
    const patchIntent = typeof body?.intent === "string" ? body.intent : null;

    if (!patchIntent || !(patchIntent in SUBMISSION_STATUS_BY_INTENT)) {
      return errorResponse("Invalid intent — expected confirm, fail, or withdraw", 400);
    }

    const result = await updateApplicationSubmissionStatus(
      id,
      SUBMISSION_STATUS_BY_INTENT[patchIntent as keyof typeof SUBMISSION_STATUS_BY_INTENT]
    );
    return successResponse(result);
  } catch (error) {
    return handleApiRouteError(
      error,
      "PATCH /api/jobs/[id]/apply",
      "Failed to update submission status"
    );
  }
}
