import { errorResponse, handleApiRouteError, rateLimitResponse, successResponse } from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { buildJobContext, buildProfileContext } from "@/lib/ai/context-builders";
import { assessProfileForAi } from "@/lib/ai/profile-context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "ai:job-fit",
      API_RATE_LIMITS.aiAnalyze
    );
    if (rateLimited) return rateLimited;

    const { id } = await params;

    if (!process.env.OPENAI_API_KEY) {
      return errorResponse("OPENAI_API_KEY not configured", 503);
    }

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
    const { analyzeJobFit } = await import("@/lib/ai/job-fit");
    const result = await analyzeJobFit(jobCtx, profileCtx);

    return successResponse({ ...result, profileNotice: profileReadiness.profileNotice });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    return handleApiRouteError(error, "POST /api/jobs/[id]/ai/analyze", message);
  }
}
