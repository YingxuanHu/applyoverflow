import { errorResponse, handleApiRouteError, rateLimitResponse, successResponse } from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { buildProfileContext } from "@/lib/ai/context-builders";
import { readCoverLetterRequestOptions } from "@/lib/ai/cover-letter-request";
import { getCoverLetterJobContextIssue } from "@/lib/ai/cover-letter-readiness";
import { persistGeneratedCoverLetterDocument } from "@/lib/ai/generated-cover-letter-document";
import type { JobContext } from "@/lib/ai/job-fit";
import { assessProfileForAi } from "@/lib/ai/profile-context";
import { requireCurrentAuthUserId, requireCurrentUserProfile } from "@/lib/current-user";
import { prisma } from "@/lib/db";

async function buildTrackedApplicationJobContext(
  applicationId: string,
  authUserId: string
): Promise<JobContext | null> {
  const application = await prisma.trackedApplication.findFirst({
    where: { id: applicationId, userId: authUserId },
    select: {
      company: true,
      roleTitle: true,
      jobDescription: true,
      canonicalJob: {
        select: {
          title: true,
          company: true,
          location: true,
          workMode: true,
          experienceLevel: true,
          roleFamily: true,
          salaryMin: true,
          salaryMax: true,
          salaryCurrency: true,
          description: true,
        },
      },
    },
  });

  if (!application) {
    return null;
  }

  const canonicalJob = application.canonicalJob;
  const description = application.jobDescription?.trim() || canonicalJob?.description?.trim() || "";

  return {
    title: canonicalJob?.title ?? application.roleTitle,
    company: canonicalJob?.company ?? application.company,
    location: canonicalJob?.location ?? "Unknown",
    workMode: canonicalJob?.workMode ?? "FLEXIBLE",
    experienceLevel: canonicalJob?.experienceLevel ?? null,
    roleFamily: canonicalJob?.roleFamily ?? "General",
    salaryMin: canonicalJob?.salaryMin ?? null,
    salaryMax: canonicalJob?.salaryMax ?? null,
    salaryCurrency: canonicalJob?.salaryCurrency ?? null,
    description,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "ai:application-cover-letter",
      API_RATE_LIMITS.aiCoverLetter
    );
    if (rateLimited) return rateLimited;

    const { id } = await params;

    if (!process.env.OPENAI_API_KEY) {
      return errorResponse("OPENAI_API_KEY not configured", 503);
    }

    const authUserId = await requireCurrentAuthUserId();
    const coverLetterOptions = await readCoverLetterRequestOptions(request);

    const [jobCtx, profileCtx] = await Promise.all([
      buildTrackedApplicationJobContext(id, authUserId),
      buildProfileContext(),
    ]);

    if (!jobCtx) {
      return errorResponse(
        "Add a job description first, or use a pool-linked application that already has one.",
        400
      );
    }
    const jobIssue = getCoverLetterJobContextIssue(jobCtx);
    if (jobIssue) return errorResponse(jobIssue, 400);
    if (!profileCtx) {
      return errorResponse("Profile not found", 404);
    }
    const profileReadiness = assessProfileForAi(profileCtx);
    if (!profileReadiness.canUseAi) {
      return errorResponse(profileReadiness.blockingMessage ?? "Please complete your profile.", 400);
    }

    const { generateCoverLetter } = await import("@/lib/ai/cover-letter");
    const result = await generateCoverLetter(jobCtx, profileCtx, coverLetterOptions);
    result.profileNotice = profileReadiness.profileNotice;

    // Best-effort persistence: storage / DB failures should not block inline text.
    let savedDocumentId: string | null = null;
    try {
      const profile = await requireCurrentUserProfile();
      const savedDoc = await persistGeneratedCoverLetterDocument({
        userId: profile.id,
        job: jobCtx,
        text: result.text,
        sourceApplicationId: id,
      });
      savedDocumentId = savedDoc.id;
    } catch (persistError) {
      console.error("Failed to persist AI-generated cover letter:", persistError);
    }

    return successResponse({ ...result, documentId: savedDocumentId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cover letter generation failed";
    return handleApiRouteError(error, "POST /api/applications/[id]/ai/cover-letter", message);
  }
}
