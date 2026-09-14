import { type NextRequest } from "next/server";

import { UserJobPreferenceFeedbackType } from "@/generated/prisma/client";
import {
  API_BODY_LIMITS,
  errorResponse,
  handleApiRouteError,
  parseJsonBodyWithLimit,
  rateLimitResponse,
  successResponse,
} from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { requireCurrentProfileId } from "@/lib/current-user";
import { saveTopPickFeedback } from "@/lib/top-picks/service";
import { revalidatePaths } from "@/lib/revalidation";
import { prisma } from "@/lib/db";
import { enqueueDurableTopPicksRefresh } from "@/lib/top-picks/refresh-queue";
import { buildDefaultCanonicalVisibilityWhere } from "@/lib/jobs/visibility";

const FEEDBACK_TYPES = new Set<string>(Object.values(UserJobPreferenceFeedbackType));

export async function GET() {
  try {
    const userId = await requireCurrentProfileId();
    const data = await prisma.userJobPreferenceFeedback.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, distinct: ["jobId"], take: 100, select: { jobId: true, job: { select: { title: true, company: true } } } });
    return successResponse({ data });
  } catch (error) { return handleApiRouteError(error, "GET /api/jobs/top-picks/feedback", "Could not load hidden picks"); }
}

export async function DELETE(request: NextRequest) {
  try {
    const limited = await rateLimitResponse(request, "jobs:top-picks:feedback", API_RATE_LIMITS.authenticatedWrite);
    if (limited) return limited;
    const userId = await requireCurrentProfileId();
    const parsed = await parseJsonBodyWithLimit<{ jobId?: unknown }>(request, API_BODY_LIMITS.smallJson, "Restore pick");
    if (!parsed.ok) return parsed.response;
    const jobId = parsed.data?.jobId;
    if (typeof jobId !== "string" || !jobId || jobId.length > 200) return errorResponse("Invalid jobId", 400);
    const restored = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "UserProfile" WHERE id = ${userId} FOR UPDATE`;
      const removed = await tx.userJobPreferenceFeedback.deleteMany({ where: { userId, jobId } });
      if (!removed.count) return false;
      const profile = await tx.userMatchProfile.findUnique({ where: { userId }, select: { profileVersion: true } });
      if (!profile) return false;
      const result = await tx.userTopPick.updateMany({ where: { userId, jobId, profileVersion: profile.profileVersion, expiresAt: { gt: new Date() }, job: { is: buildDefaultCanonicalVisibilityWhere() } }, data: { isValid: true, invalidatedAt: null } });
      return result.count > 0;
    });
    await enqueueDurableTopPicksRefresh({ userId, reason: "feedback_changed", priorityScore: 60 });
    revalidatePaths(["/jobs", "/jobs/top-picks"]);
    return successResponse({ success: true, restored });
  } catch (error) { return handleApiRouteError(error, "DELETE /api/jobs/top-picks/feedback", "Could not restore pick"); }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "jobs:top-picks:feedback",
      API_RATE_LIMITS.authenticatedWrite
    );
    if (rateLimited) return rateLimited;

    const parsedBody = await parseJsonBodyWithLimit<Record<string, unknown>>(
      request,
      API_BODY_LIMITS.smallJson,
      "Top picks feedback request"
    );
    if (!parsedBody.ok) return parsedBody.response;

    const body = parsedBody.data;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid JSON body", 400);
    }
    const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
    const feedbackType =
      typeof body?.feedbackType === "string" ? body.feedbackType.trim() : "";

    if (!jobId) return errorResponse("jobId is required", 400);
    if (!FEEDBACK_TYPES.has(feedbackType)) {
      return errorResponse("Unsupported feedback type", 400);
    }

    const userId = await requireCurrentProfileId();
    const feedback = await saveTopPickFeedback({
      userId,
      jobId,
      feedbackType: feedbackType as UserJobPreferenceFeedbackType,
    });
    revalidatePaths(["/jobs", "/jobs/top-picks"]);
    return successResponse({ success: true, feedbackId: feedback.id });
  } catch (error) {
    return handleApiRouteError(
      error,
      "POST /api/jobs/top-picks/feedback",
      "Failed to save feedback"
    );
  }
}
