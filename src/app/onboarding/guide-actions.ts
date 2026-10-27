"use server";

import { prisma } from "@/lib/db";
import { requireCurrentUserIds, UnauthorizedError } from "@/lib/current-user";
import { GETTING_STARTED_KEY, saveGuideSchema } from "@/lib/getting-started";

export async function saveGettingStarted(input: unknown) {
  const parsed = saveGuideSchema.safeParse(input);
  if (!parsed.success) return { error: "This guide step is invalid. Reload the page and try again." };
  try {
    const { authUserId, profileId } = await requireCurrentUserIds();
    if (parsed.data.accountId !== authUserId) return { error: "Your account changed. Reload the page to continue setup." };
    const state = { version: 1 as const, status: parsed.data.status, step: parsed.data.step };
    await prisma.userPreference.upsert({
      where: { userId_key: { userId: profileId, key: GETTING_STARTED_KEY } },
      create: { userId: profileId, key: GETTING_STARTED_KEY, value: JSON.stringify(state) },
      update: { value: JSON.stringify(state) },
    });
    return { state };
  } catch (error) {
    return { error: error instanceof UnauthorizedError
      ? "Sign in again, then reopen Getting started. Your saved profile is unchanged."
      : "We couldn't save your guide progress. Please try again. Your profile is unchanged." };
  }
}
