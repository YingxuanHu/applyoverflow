import { prisma } from "@/lib/db";
import {
  ONBOARDING_KEY,
  onboardingDestination,
  parseOnboardingState,
} from "@/lib/profile-setup";

export async function getPostSignInDestination(
  authUserId: string,
  destination: unknown,
) {
  const record = await prisma.userPreference.findFirst({
    where: { user: { authUserId }, key: ONBOARDING_KEY },
    select: { value: true },
  });
  return onboardingDestination(
    parseOnboardingState(record?.value),
    destination,
  );
}
