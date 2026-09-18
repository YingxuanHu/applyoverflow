import { redirect } from "next/navigation";
import { requireCurrentUserProfile } from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { buildProfileFormValues } from "@/lib/profile";
import {
  EMPTY_JOB_GOALS,
  JOB_GOALS_KEY,
  ONBOARDING_KEY,
  parseJobGoals,
  parseOnboardingState,
  setupReturnPath,
} from "@/lib/profile-setup";
import { ProfileSetup } from "@/components/profile/profile-setup";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const user = await requireCurrentUserProfile();
  const preferences = await prisma.userPreference.findMany({
    where: { userId: user.id, key: { in: [ONBOARDING_KEY, JOB_GOALS_KEY] } },
  });
  const state = parseOnboardingState(
    preferences.find((item) => item.key === ONBOARDING_KEY)?.value,
  );
  const returnTo = setupReturnPath((await searchParams).from);
  if (!state || state.status === "complete") redirect(returnTo);
  const profileChanged = Boolean(
    state.profileUpdatedAt &&
      state.profileUpdatedAt !== user.updatedAt.toISOString(),
  );
  const resume = await prisma.document.findFirst({
    where: { userId: user.id, type: "RESUME" },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
    select: { title: true },
  });
  return (
    <ProfileSetup
      initialState={profileChanged ? { ...state, draft: undefined } : state}
      profileChanged={profileChanged}
      initialProfile={buildProfileFormValues(user, user)}
      initialGoals={
        parseJobGoals(
          preferences.find((item) => item.key === JOB_GOALS_KEY)?.value,
        ) ?? EMPTY_JOB_GOALS
      }
      profileUpdatedAt={user.updatedAt.toISOString()}
      resumeTitle={resume?.title ?? null}
      returnTo={returnTo}
    />
  );
}
