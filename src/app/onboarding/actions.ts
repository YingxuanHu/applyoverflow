"use server";

import { z } from "zod";
import {
  requireCurrentUserProfile,
  UnauthorizedError,
} from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { buildProfileTextCopies, normalizeContact } from "@/lib/profile";
import { contactToProfileColumnUpdates } from "@/lib/profile-contact-sync";
import {
  ONBOARDING_KEY,
  JOB_GOALS_KEY,
  jobGoalsSchema,
  setupProfileSchema,
  parseOnboardingState,
  getSetupCompletionError,
} from "@/lib/profile-setup";
import { revalidatePaths, revalidateProfileViews } from "@/lib/revalidation";
import { invalidateTopPicksForUser } from "@/lib/top-picks/service";

const setupSaveSchema = z
  .object({
    intent: z.enum(["save", "defer", "complete"]),
    revision: z.number().int().nonnegative(),
    profileUpdatedAt: z.string().datetime(),
    step: z.number().int().min(0).max(2),
    draft: setupProfileSchema,
    goals: jobGoalsSchema,
  })
  .strict();

export async function saveSetup(payload: unknown) {
  const parsed = setupSaveSchema.safeParse(payload);
  if (!parsed.success)
    return {
      error:
        "Check your details, including your email and field lengths, then try again.",
    };
  const input = parsed.data;
  if (JSON.stringify(input).length > 250_000)
    return {
      error:
        "Your profile is too long. Shorten the descriptions and try again.",
    };
  const completionError =
    input.intent === "complete" ? getSetupCompletionError(input.draft) : null;
  if (completionError) return { error: completionError };
  try {
    const user = await requireCurrentUserProfile();
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "UserProfile" WHERE id = ${user.id} FOR UPDATE`;
      const record = await tx.userPreference.findUnique({
        where: { userId_key: { userId: user.id, key: ONBOARDING_KEY } },
      });
      const state = parseOnboardingState(record?.value);
      if (!record || !state)
        return {
          error:
            "This setup is no longer active. Edit your details in Profile.",
        };
      if (state.status === "complete")
        return input.intent === "complete"
          ? { revision: state.revision }
          : { error: "Setup is complete. Edit your details in Profile." };
      if (state.revision !== input.revision)
        return {
          error:
            "Setup changed in another tab. Reload to use the latest details.",
        };
      if (input.intent === "complete") {
        const profile = await tx.userProfile.findUniqueOrThrow({
          where: { id: user.id },
        });
        if (profile.updatedAt.toISOString() !== input.profileUpdatedAt)
          return {
            error:
              "Your profile changed while setup was open. Reload to review your latest profile before finishing.",
          };
        const contact = normalizeContact(input.draft.contact);
        await tx.userProfile.update({
          where: { id: user.id },
          data: {
            headline: input.draft.headline || null,
            summary: input.draft.summary || null,
            ...buildProfileTextCopies(input.draft),
            ...contactToProfileColumnUpdates(contact),
            contactJson: contact,
            skillsJson: input.draft.skills,
            experiencesJson: input.draft.experiences,
            educationsJson: input.draft.educations,
            projectsJson: input.draft.projects,
          },
        });
        await tx.userPreference.upsert({
          where: { userId_key: { userId: user.id, key: JOB_GOALS_KEY } },
          create: {
            userId: user.id,
            key: JOB_GOALS_KEY,
            value: JSON.stringify(input.goals),
          },
          update: { value: JSON.stringify(input.goals) },
        });
      }
      const revision = state.revision + 1;
      await tx.userPreference.update({
        where: { id: record.id },
        data: {
          value: JSON.stringify({
            version: 1,
            revision,
            step: input.step,
            status:
              input.intent === "complete"
                ? "complete"
                : input.intent === "defer"
                  ? "deferred"
                  : state.status,
            ...(input.intent === "complete"
              ? { confirmedAt: new Date().toISOString() }
              : {
                  draft: input.draft,
                  goals: input.goals,
                  profileUpdatedAt: input.profileUpdatedAt,
                }),
          }),
        },
      });
      return { revision };
    });
    if (result.error) return result;
    if (input.intent === "complete") {
      await invalidateTopPicksForUser(user.id).catch(() =>
        console.error("[onboarding] Could not queue picks refresh"),
      );
      revalidateProfileViews();
      revalidatePaths(["/jobs", "/jobs/top-picks"]);
    }
    revalidatePaths(["/onboarding", "/profile"]);
    return result;
  } catch (error) {
    if (error instanceof UnauthorizedError)
      return { error: "Your session expired. Sign in again to continue." };
    console.error(
      "[onboarding] Save failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return {
      error:
        "Could not save your setup. Your changes are still here; please try again.",
    };
  }
}

export async function saveJobGoals(payload: unknown) {
  const parsed = jobGoalsSchema.safeParse(payload);
  if (!parsed.success)
    return { error: "Use up to five role titles and check the location." };
  try {
    const user = await requireCurrentUserProfile();
    await prisma.userPreference.upsert({
      where: { userId_key: { userId: user.id, key: JOB_GOALS_KEY } },
      create: {
        userId: user.id,
        key: JOB_GOALS_KEY,
        value: JSON.stringify(parsed.data),
      },
      update: { value: JSON.stringify(parsed.data) },
    });
    await invalidateTopPicksForUser(user.id).catch(() =>
      console.error("[job-goals] Could not queue picks refresh"),
    );
    revalidatePaths(["/profile", "/jobs/top-picks", "/jobs"]);
    return { success: true };
  } catch {
    return { error: "Could not save your job interests. Please try again." };
  }
}
