import { type NextRequest } from "next/server";

import {
  handleApiRouteError,
  paginatedResponse,
  parseBoundedIntParam,
  rateLimitResponse,
} from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { requireCurrentProfileId } from "@/lib/current-user";
import { parseJobFilters, parseTopPicksFilters } from "@/lib/jobs/search-params";
import { getTopPicksForUser } from "@/lib/queries/top-picks";

export async function GET(request: NextRequest) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "jobs:top-picks:list",
      API_RATE_LIMITS.publicRead
    );
    if (rateLimited) return rateLimited;

    const userId = await requireCurrentProfileId();
    const sp = request.nextUrl.searchParams;
    const result = await getTopPicksForUser(userId, {
      ...parseTopPicksFilters(sp),
      page: Math.min(20, parseJobFilters(sp).page ?? 1),
      minScore:
        parseBoundedIntParam(sp.get("minScore"), 0, { min: 0, max: 100 }) ||
        undefined,
    });

    return paginatedResponse(
      result.data,
      result.total,
      result.page,
      result.pageSize,
      result.hasNextPage
    );
  } catch (error) {
    return handleApiRouteError(
      error,
      "GET /api/jobs/top-picks",
      "Failed to fetch top picks"
    );
  }
}
