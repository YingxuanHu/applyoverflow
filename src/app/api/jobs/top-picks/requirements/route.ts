import { type NextRequest } from "next/server";
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
import { prisma } from "@/lib/db";
import {
  REQUIREMENTS_KEY,
  parseRequirements,
  requirementsSchema,
} from "@/lib/top-picks/requirements";
import { enqueueDurableTopPicksRefresh } from "@/lib/top-picks/refresh-queue";
import { revalidatePaths } from "@/lib/revalidation";

export async function GET() {
  try {
    const userId = await requireCurrentProfileId();
    const row = await prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: REQUIREMENTS_KEY } },
    });
    return successResponse(parseRequirements(row?.value));
  } catch (error) {
    return handleApiRouteError(
      error,
      "GET requirements",
      "Could not load requirements",
    );
  }
}
export async function PUT(request: NextRequest) {
  try {
    const limited = await rateLimitResponse(
      request,
      "jobs:requirements",
      API_RATE_LIMITS.authenticatedWrite,
    );
    if (limited) return limited;
    const userId = await requireCurrentProfileId();
    const body = await parseJsonBodyWithLimit(
      request,
      API_BODY_LIMITS.smallJson,
      "Match requirements",
    );
    if (!body.ok) return body.response;
    const parsed = requirementsSchema.safeParse(body.data);
    if (!parsed.success)
      return errorResponse("Invalid match requirements", 400);
    await prisma.$transaction(async (tx) => {
      // Serialize settings with profile snapshots and recommendation publication.
      await tx.$queryRaw`SELECT id FROM "UserProfile" WHERE id = ${userId} FOR UPDATE`;
      await tx.userPreference.upsert({
        where: { userId_key: { userId, key: REQUIREMENTS_KEY } },
        create: {
          userId,
          key: REQUIREMENTS_KEY,
          value: JSON.stringify(parsed.data),
          isHardFilter: true,
        },
        update: { value: JSON.stringify(parsed.data), isHardFilter: true },
      });
      await tx.userMatchProfile.updateMany({
        where: { userId },
        data: { profileVersion: { increment: 1 } },
      });
      await tx.userTopPick.updateMany({
        where: { userId },
        data: { isValid: false, invalidatedAt: new Date() },
      });
    });
    await enqueueDurableTopPicksRefresh({
      userId,
      reason: "requirements_changed",
      priorityScore: 75,
    });
    revalidatePaths(["/profile", "/jobs/top-picks"]);
    return successResponse({ success: true });
  } catch (error) {
    return handleApiRouteError(
      error,
      "PUT requirements",
      "Could not save requirements",
    );
  }
}
