import { successResponse, errorResponse } from "@/lib/api-utils";
import { UnauthorizedError } from "@/lib/current-user";
import { buildJobContext, buildProfileContext } from "@/lib/ai/context-builders";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    let resumeId: string | null = null;

    try {
      const body = (await request.json()) as { resumeId?: unknown };
      if (typeof body?.resumeId === "string" && body.resumeId.trim()) {
        resumeId = body.resumeId.trim();
      }
    } catch {
      // Empty or invalid JSON means "analyze from the saved profile".
    }

    if (!process.env.OPENAI_API_KEY) {
      return errorResponse("OPENAI_API_KEY not configured", 503);
    }

    const [jobCtx, profileCtx] = await Promise.all([
      buildJobContext(id),
      buildProfileContext({ resumeId }),
    ]);

    if (!jobCtx) return errorResponse("Job not found", 404);
    if (!profileCtx) return errorResponse("Profile not found", 404);

    // Lazy-import to avoid bundling the OpenAI SDK into other routes
    const { analyzeJobFit } = await import("@/lib/ai/job-fit");
    const result = await analyzeJobFit(jobCtx, profileCtx);

    return successResponse(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return errorResponse("Unauthorized", 401);
    }
    if (
      error instanceof Error &&
      error.message === "Selected resume was not found on your profile."
    ) {
      return errorResponse(error.message, 400);
    }
    console.error("POST /api/jobs/[id]/ai/analyze error:", error);
    const message = error instanceof Error ? error.message : "Analysis failed";
    return errorResponse(message, 500);
  }
}
