import { NextResponse } from "next/server";

import { getOptionalCurrentProfileId } from "@/lib/current-user";
import { prisma, withPrismaConnectionRetry } from "@/lib/db";
import {
  isDefaultJobsStateQuery,
  JOBS_SEARCH_STATE_PREFERENCE_KEY,
  jobsPreferenceValueFromQueryString,
  normalizeJobsStateQuery,
} from "@/lib/jobs/search-state";

export async function POST(request: Request) {
  const profileId = await getOptionalCurrentProfileId();
  if (!profileId) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { query?: unknown } | null;
  const query = normalizeJobsStateQuery(
    typeof body?.query === "string" ? body.query : "",
    { includePage: false }
  );

  if (isDefaultJobsStateQuery(query)) {
    await deleteSavedJobsSearchState(profileId);
    return NextResponse.json({ ok: true, state: "default" });
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

  return NextResponse.json({ ok: true, state: "saved" });
}

export async function DELETE() {
  const profileId = await getOptionalCurrentProfileId();
  if (!profileId) {
    return NextResponse.json({ ok: true });
  }

  await deleteSavedJobsSearchState(profileId);
  return NextResponse.json({ ok: true });
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
