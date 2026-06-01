import { successResponse, errorResponse } from "@/lib/api-utils";
import { buildAiGeneratedDocumentTitle } from "@/lib/ai-document-naming";
import { UnauthorizedError, requireCurrentUserProfile } from "@/lib/current-user";
import { buildJobContext, buildProfileContext } from "@/lib/ai/context-builders";
import { assessProfileForAi } from "@/lib/ai/profile-context";
import { prisma } from "@/lib/db";
import { buildDocumentStorageKey, saveFile } from "@/lib/storage";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
    const { generateCoverLetter } = await import("@/lib/ai/cover-letter");
    const result = await generateCoverLetter(jobCtx, profileCtx);
    result.profileNotice = profileReadiness.profileNotice;

    // Persist the generated letter as an AI document. Best-effort.
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
        },
        select: { id: true },
      });
      savedDocumentId = savedDoc.id;
    } catch (persistError) {
      console.error("Failed to persist AI-generated cover letter:", persistError);
    }

    return successResponse({ ...result, documentId: savedDocumentId });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return errorResponse("Unauthorized", 401);
    }
    console.error("POST /api/jobs/[id]/ai/cover-letter error:", error);
    const message = error instanceof Error ? error.message : "Cover letter generation failed";
    return errorResponse(message, 500);
  }
}
