import {
  errorResponse,
  isUnauthorizedApiError,
  rateLimitResponse,
  successResponse,
  unauthorizedResponse,
} from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { isAiFeatureAllowed } from "@/lib/ai-access";
import { requireCurrentUserProfile } from "@/lib/current-user";
import { syncStoredResumeForProfile } from "@/lib/profile-resume-service";
import { resumeParserErrorResponse } from "@/lib/resume-parser";
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
      allowAiParse: isAiFeatureAllowed(user.email),
      signal: request.signal,
    });

    revalidateProfileViews();
    return successResponse({ message: result.message });
  } catch (error) {
    if (isUnauthorizedApiError(error)) return unauthorizedResponse();
    const parserFailure = resumeParserErrorResponse(error);
    if (parserFailure) return parserFailure;
    return errorResponse(
      error instanceof Error ? error.message : "Resume extraction failed.",
      400
    );
  }
}
