import { type NextRequest } from "next/server";

import {
  handleApiRouteError,
  rateLimitResponse,
  successResponse,
} from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { requireCurrentProfileId } from "@/lib/current-user";
import { getTopPicksRefreshStatus } from "@/lib/top-picks/service";

export async function GET(request: NextRequest) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "jobs:top-picks:status",
      API_RATE_LIMITS.publicRead
    );
    if (rateLimited) return rateLimited;

    const userId = await requireCurrentProfileId();
    return successResponse(await getTopPicksRefreshStatus(userId));
  } catch (error) {
    return handleApiRouteError(
      error,
      "GET /api/jobs/top-picks/status",
      "Failed to fetch top picks status"
    );
  }
}
