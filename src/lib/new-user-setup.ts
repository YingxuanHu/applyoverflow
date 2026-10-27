import type { PrismaClient } from "@/generated/prisma/client";
import { createAutofillNotice } from "@/lib/announcements/delivery";
import { GETTING_STARTED_KEY, INITIAL_GUIDE } from "@/lib/getting-started";
import { INITIAL_ONBOARDING, ONBOARDING_KEY } from "@/lib/profile-setup";

// Auth ID owns notifications; profile ID owns preferences. Retrying the hook
// must neither reset a user's progress nor recreate a dismissed announcement.
export async function initializeNewUserSetup(db: PrismaClient, accountId: string, profileId: string) {
  await db.$transaction(async (tx) => {
    for (const [key, value] of [
      [ONBOARDING_KEY, INITIAL_ONBOARDING],
      [GETTING_STARTED_KEY, INITIAL_GUIDE],
    ] as const) {
      await tx.userPreference.upsert({
        where: { userId_key: { userId: profileId, key } },
        create: { userId: profileId, key, value: JSON.stringify(value) },
        update: {},
      });
    }
    await createAutofillNotice(tx, accountId);
  });
}
