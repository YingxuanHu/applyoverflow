import { errorResponse, rateLimitResponse, successResponse } from "@/lib/api-utils";
import { API_RATE_LIMITS } from "@/lib/api-rate-limit";
import { getOptionalCurrentProfileId } from "@/lib/current-user";
import { prisma, withPrismaConnectionRetry } from "@/lib/db";
import {
  isDefaultJobsStateQuery,
  JOBS_SEARCH_STATE_PREFERENCE_KEY,
  jobsPreferenceValueFromQueryString,
  normalizeJobsStateQuery,
} from "@/lib/jobs/search-state";

export async function POST(request: Request) {
  const rateLimited = await rateLimitResponse(
    request,
    "preferences:jobs-search-state",
    API_RATE_LIMITS.authenticatedWrite
  );
  if (rateLimited) return rateLimited;

  const profileId = await getOptionalCurrentProfileId();
  if (!profileId) {
    return errorResponse("Authentication required", 401);
  }

  const body = (await request.json().catch(() => null)) as { query?: unknown } | null;
  const query = normalizeJobsStateQuery(
    typeof body?.query === "string" ? body.query : "",
    { includePage: false }
  );

  if (isDefaultJobsStateQuery(query)) {
    await deleteSavedJobsSearchState(profileId);
    return successResponse({ ok: true, state: "default" });
  }

  await withPrismaConnectionRetry(() =>
    prisma.userPreference.upsert({
      create: {
        key: JOBS_SEARCH_STATE_PREFERENCE_KEY,
        userId: profileId,
        value: jobsPreferenceValueFromQueryString(query),
      },
      update: {
        value: jobsPreferenceValueFromQueryString(query),
      },
      where: {
        userId_key: {
          key: JOBS_SEARCH_STATE_PREFERENCE_KEY,
          userId: profileId,
        },
      },
    })
  );

  return successResponse({ ok: true, state: "saved" });
}

export async function DELETE() {
  const profileId = await getOptionalCurrentProfileId();
  if (!profileId) {
    return successResponse({ ok: true });
  }

  await deleteSavedJobsSearchState(profileId);
  return successResponse({ ok: true });
}

async function deleteSavedJobsSearchState(profileId: string) {
  await withPrismaConnectionRetry(() =>
    prisma.userPreference.deleteMany({
      where: {
        key: JOBS_SEARCH_STATE_PREFERENCE_KEY,
        userId: profileId,
      },
    })
  );
}
