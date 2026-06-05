import {
  errorResponse,
  isUnauthorizedApiError,
  rateLimitResponse,
  successResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { requireCurrentUserProfile } from "@/lib/current-user";
import { syncStoredResumeForProfile } from "@/lib/profile-resume-service";
import { revalidateProfileViews } from "@/lib/revalidation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "document:resume-sync",
      API_RATE_LIMITS.documentSync
    );
    if (rateLimited) return rateLimited;

    const user = await requireCurrentUserProfile();
    const { id } = await params;

    const result = await syncStoredResumeForProfile({
      user,
      documentId: id,
    });

    revalidateProfileViews();
    return successResponse({ message: result.message });
  } catch (error) {
    if (isUnauthorizedApiError(error)) return unauthorizedResponse();
    return errorResponse(
      error instanceof Error ? error.message : "Resume extraction failed.",
      400
    );
  }
}
