import type { NextRequest } from "next/server";
import { errorResponse, handleApiRouteError, rateLimitResponse, successResponse } from "@/lib/api-utils";
import { getOptionalCurrentUserProfile, UnauthorizedError } from "@/lib/current-user";
import { parseJobFilters } from "@/lib/jobs/search-params";
import { normalizeSalaryCurrency } from "@/lib/currency-conversion";
import { getJobSearchCount } from "@/lib/queries/jobs";
import { JobCountBusyError } from "@/lib/queries/job-count-budget";

export async function GET(request: NextRequest) {
  try {
    const limited = await rateLimitResponse(request, "jobs:count", { limit: 30, windowMs: 60_000, scope: "user-or-ip" });
    if (limited) return limited;
    const profile = await getOptionalCurrentUserProfile();
    if (!profile?.authUserId) throw new UnauthorizedError();
    const filters = parseJobFilters(request.nextUrl.searchParams, normalizeSalaryCurrency(profile.salaryCurrency) ?? "USD");
    const total = await getJobSearchCount(filters, { viewerProfileId: profile.id, authUserId: profile.authUserId });
    if (total === null) return errorResponse("An exact count is not available for this query", 400);
    return successResponse({ total }, 200, { "Cache-Control": "private, no-store" });
  } catch (error) {
    if (error instanceof JobCountBusyError) {
      return successResponse({ error: "Matching total is temporarily busy" }, 503, { "Retry-After": "3", "Cache-Control": "private, no-store" });
    }
    return handleApiRouteError(error, "GET /api/jobs/count", "Could not load matching total");
  }
}
