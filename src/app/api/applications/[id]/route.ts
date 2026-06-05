import { type NextRequest } from "next/server";

import {
  errorResponse,
  isUnauthorizedApiError,
  rateLimitResponse,
  successResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import {
  ReauthenticationRequiredError,
  requireFreshSensitiveSession,
} from "@/lib/current-user";
import { deleteTrackedApplication } from "@/lib/queries/tracker";
import { revalidateDeletedApplicationViews } from "@/lib/revalidation";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "applications:delete",
      API_RATE_LIMITS.authenticatedWrite
    );
    if (rateLimited) return rateLimited;

    await requireFreshSensitiveSession();
    const { id } = await params;
    const deleted = await deleteTrackedApplication({ applicationId: id });

    revalidateDeletedApplicationViews(deleted.canonicalJobId);

    return successResponse({ success: true });
  } catch (error) {
    if (isUnauthorizedApiError(error)) return unauthorizedResponse();

    if (error instanceof ReauthenticationRequiredError) {
      return errorResponse(error.message, 401);
    }

    console.error("DELETE /api/applications/[id] error:", error);
    return errorResponse("Failed to delete application", 500);
  }
}
