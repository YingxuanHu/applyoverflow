import { handleApiRouteError, rateLimitResponse, successResponse } from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { prisma } from "@/lib/db";
import { requireCurrentProfileId } from "@/lib/current-user";

/**
 * PATCH /api/jobs/[id]/notes
 * Body: { notes: string }
 *
 * Upserts a personal note on the job's ApplicationPackage.
 * Creates a minimal package record if one doesn't exist yet.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "jobs:notes",
      API_RATE_LIMITS.authenticatedWrite
    );
    if (rateLimited) return rateLimited;

    const userId = await requireCurrentProfileId();
    const { id: jobId } = await params;
    const body = await request.json().catch(() => null);
    const notes: string = typeof body?.notes === "string" ? body.notes.slice(0, 4000) : "";

    // Find existing package or create a stub
    const existing = await prisma.applicationPackage.findFirst({
      where: { canonicalJobId: jobId, userId },
      orderBy: { updatedAt: "desc" },
    });

    if (existing) {
      await prisma.applicationPackage.update({
        where: { id: existing.id },
        data: { userNotes: notes || null },
      });
    } else {
      // Need a resumeVariant to create a package — use the default one
      const defaultVariant = await prisma.resumeVariant.findFirst({
        where: { userId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      });

      if (!defaultVariant) {
        // No resume variant yet — store nothing, return success
        return successResponse({ saved: false, reason: "no_resume_variant" });
      }

      await prisma.applicationPackage.create({
        data: {
          userId,
          canonicalJobId: jobId,
          resumeVariantId: defaultVariant.id,
          userNotes: notes || null,
        },
      });
    }

    return successResponse({ saved: true });
  } catch (error) {
    return handleApiRouteError(
      error,
      "PATCH /api/jobs/[id]/notes",
      "Failed to save notes"
    );
  }
}
