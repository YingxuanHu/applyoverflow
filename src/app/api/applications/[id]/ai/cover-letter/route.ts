import { errorResponse, successResponse } from "@/lib/api-utils";
import { buildAiGeneratedDocumentTitle } from "@/lib/ai-document-naming";
import { buildProfileContext } from "@/lib/ai/context-builders";
import type { JobContext } from "@/lib/ai/job-fit";
import { assessProfileForAi } from "@/lib/ai/profile-context";
import { UnauthorizedError, requireCurrentAuthUserId, requireCurrentUserProfile } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { buildDocumentStorageKey, deleteFile, saveFile } from "@/lib/storage";

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
  const description =
    application.jobDescription?.trim() ||
    canonicalJob?.description?.trim() ||
    [
      "No full job description is available for this tracked application.",
      "Write the cover letter using the known job title, company, linked job metadata, and the user's saved profile.",
    ].join(" ");

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
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!process.env.OPENAI_API_KEY) {
      return errorResponse("OPENAI_API_KEY not configured", 503);
    }

    const authUserId = await requireCurrentAuthUserId();

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
    if (!profileCtx) {
      return errorResponse("Profile not found", 404);
    }
    const profileReadiness = assessProfileForAi(profileCtx);
    if (!profileReadiness.canUseAi) {
      return errorResponse(profileReadiness.blockingMessage ?? "Please complete your profile.", 400);
    }

    const { generateCoverLetter } = await import("@/lib/ai/cover-letter");
    const result = await generateCoverLetter(jobCtx, profileCtx);
    result.profileNotice = profileReadiness.profileNotice;

    // Persist the generated cover letter as an AI-generated document. We
    // store it as plain text (UTF-8) so the user can re-open / re-download
    // it from the Documents tab. Best-effort: any storage / DB failure is
    // swallowed so the user still gets the text back inline.
    let savedDocumentId: string | null = null;
    try {
      const profile = await requireCurrentUserProfile();
      const title = buildAiGeneratedDocumentTitle({
        kind: "COVER_LETTER",
        company: jobCtx.company,
        roleTitle: jobCtx.title,
      });
      const buffer = Buffer.from(result.text, "utf-8");
      const fileName = `${title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "")}.txt`;
      const storageKey = buildDocumentStorageKey({
        userId: profile.id,
        title,
        extension: ".txt",
        type: "COVER_LETTER",
      });
      await saveFile(storageKey, buffer, { contentType: "text/plain; charset=utf-8" });
      const savedDoc = await prisma.document.create({
        data: {
          userId: profile.id,
          type: "COVER_LETTER",
          title,
          originalFileName: fileName,
          filename: fileName,
          mimeType: "text/plain; charset=utf-8",
          sizeBytes: buffer.byteLength,
          storageKey,
          isPrimary: false,
          isAiGenerated: true,
          sourceApplicationId: id,
          extractedText: result.text,
          extractedAt: new Date(),
        },
        select: { id: true, title: true },
      });
      savedDocumentId = savedDoc.id;

      const olderGeneratedDocs = await prisma.document.findMany({
        where: {
          userId: profile.id,
          type: "COVER_LETTER",
          isAiGenerated: true,
          sourceApplicationId: id,
          id: { not: savedDoc.id },
          trackedApplicationLinks: { none: {} },
        },
        select: { id: true, storageKey: true },
      });
      if (olderGeneratedDocs.length > 0) {
        await prisma.document.deleteMany({
          where: { id: { in: olderGeneratedDocs.map((document) => document.id) } },
        });
        await Promise.allSettled(
          olderGeneratedDocs.map((document) => deleteFile(document.storageKey))
        );
      }
    } catch (persistError) {
      console.error("Failed to persist AI-generated cover letter:", persistError);
    }

    return successResponse({ ...result, documentId: savedDocumentId });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return errorResponse("Unauthorized", 401);
    }
    console.error("POST /api/applications/[id]/ai/cover-letter error:", error);
    const message = error instanceof Error ? error.message : "Cover letter generation failed";
    return errorResponse(message, 500);
  }
}
