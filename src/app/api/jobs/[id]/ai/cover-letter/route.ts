import {
  API_BODY_LIMITS,
  errorResponse,
  handleApiRouteError,
  rateLimitResponse,
  requestSizeLimitResponse,
  successResponse,
} from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { requireCurrentUserProfile } from "@/lib/current-user";
import { buildJobContext, buildProfileContext } from "@/lib/ai/context-builders";
import { readCoverLetterRequestOptions } from "@/lib/ai/cover-letter-request";
import { persistGeneratedCoverLetterDocument } from "@/lib/ai/generated-cover-letter-document";
import { assessProfileForAi } from "@/lib/ai/profile-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const tooLarge = requestSizeLimitResponse(
      request,
      API_BODY_LIMITS.mediumJson,
      "Cover letter request"
    );
    if (tooLarge) return tooLarge;

    const rateLimited = await rateLimitResponse(
      request,
      "ai:job-cover-letter",
      API_RATE_LIMITS.aiCoverLetter
    );
    if (rateLimited) return rateLimited;

    const { id } = await params;

    if (!process.env.OPENAI_API_KEY) {
      return errorResponse("OPENAI_API_KEY not configured", 503);
    }
    const coverLetterOptions = await readCoverLetterRequestOptions(request);

    const [jobCtx, profileCtx] = await Promise.all([
      buildJobContext(id),
      buildProfileContext(),
    ]);

    if (!jobCtx) return errorResponse("Job not found", 404);
    if (!profileCtx) return errorResponse("Profile not found", 404);
    const profileReadiness = assessProfileForAi(profileCtx);
    if (!profileReadiness.canUseAi) {
      return errorResponse(profileReadiness.blockingMessage ?? "Please complete your profile.", 400);
    }

    // Lazy-import to avoid bundling the OpenAI SDK into other routes
    const { generateCoverLetter } = await import("@/lib/ai/cover-letter");
    const result = await generateCoverLetter(jobCtx, profileCtx, coverLetterOptions);
    result.profileNotice = profileReadiness.profileNotice;

    // Persist the generated letter as an AI document. Best-effort.
    let savedDocumentId: string | null = null;
    try {
      const profile = await requireCurrentUserProfile();
      const savedDoc = await persistGeneratedCoverLetterDocument({
        userId: profile.id,
        job: jobCtx,
        text: result.text,
      });
      savedDocumentId = savedDoc.id;
    } catch (persistError) {
      console.error("Failed to persist AI-generated cover letter:", persistError);
    }

    return successResponse({ ...result, documentId: savedDocumentId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cover letter generation failed";
    return handleApiRouteError(error, "POST /api/jobs/[id]/ai/cover-letter", message);
  }
}
