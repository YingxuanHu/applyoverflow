import { type NextRequest } from "next/server";

import {
  handleApiRouteError,
  rateLimitResponse,
  successResponse,
} from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { requireCurrentProfileId } from "@/lib/current-user";
import {
  enqueueTopPicksRefresh,
  getTopPicksRefreshStatus,
} from "@/lib/top-picks/service";
import { runTopPicksRefreshQueue } from "@/lib/top-picks/refresh-worker";

export async function POST(request: NextRequest) {
  try {
    const rateLimited = await rateLimitResponse(
      request,
      "jobs:top-picks:refresh",
      { ...API_RATE_LIMITS.authenticatedWrite, limit: 10 }
    );
    if (rateLimited) return rateLimited;

    const userId = await requireCurrentProfileId();
    const refresh = await enqueueTopPicksRefresh(userId, {
      reason: "manual_api",
    });
    if (shouldKickTopPicksRefreshInline()) {
      void runTopPicksRefreshQueue({ limit: 1, concurrency: 1 }).catch((error) => {
        console.error("top-picks refresh kick failed", { userId, error });
      });
    }

    return successResponse({
      status: refresh.status,
      refresh: await getTopPicksRefreshStatus(userId),
    });
  } catch (error) {
    return handleApiRouteError(
      error,
      "POST /api/jobs/top-picks/refresh",
      "Failed to refresh top picks"
    );
  }
}

function shouldKickTopPicksRefreshInline() {
  const explicit = process.env.TOP_PICKS_INLINE_REFRESH_KICK?.trim().toLowerCase();
  if (explicit) {
    return explicit === "1" || explicit === "true" || explicit === "yes";
  }

  return process.env.NODE_ENV !== "production";
}
