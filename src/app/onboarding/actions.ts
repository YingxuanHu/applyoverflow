"use server";

import { z } from "zod";
import {
  requireCurrentUserProfile,
  UnauthorizedError,
} from "@/lib/current-user";
import { prisma } from "@/lib/db";
import { buildProfileFormValues, buildProfileTextCopies, normalizeContact, normalizeExperiences, normalizeEducations } from "@/lib/profile";
import { contactToProfileColumnUpdates } from "@/lib/profile-contact-sync";
import {
  ONBOARDING_KEY,
  JOB_GOALS_KEY,
  jobGoalsSchema,
  setupProfileSchema,
  parseOnboardingState,
  getSetupCompletionError,
  applyReviewedSetup,
  pendingSetupScopes,
  reviewScopeSchema,
  REVIEW_SCOPES,
  type ReviewScope,
  type SetupProfile,
  INITIAL_ONBOARDING,
} from "@/lib/profile-setup";
import { historyValidationError } from "@/lib/profile-history";
import { revalidatePaths, revalidateProfileViews } from "@/lib/revalidation";
import { invalidateTopPicksForUser } from "@/lib/top-picks/service";
import { recordOnboardingEvent } from "@/lib/queries/onboarding-events";

const setupSaveSchema = z
  .object({
    intent: z.enum(["save", "defer", "complete", "confirm", "goals"]),
    protocol: z.literal(2).optional(),
    profileId: z.string().optional(),
    journey: z.string().uuid().optional(),
    entry: z.enum(["website", "extension"]).optional(),
    scopes: z.array(reviewScopeSchema).max(6).optional(),
    revision: z.number().int().nonnegative(),
    profileUpdatedAt: z.string().datetime(),
    step: z.number().int().min(0).max(2),
    draft: setupProfileSchema,
    goals: jobGoalsSchema,
  })
  .strict();

export async function saveSetup(payload: unknown): Promise<{ error: string } | { revision: number; profileUpdatedAt?: string; draft?: SetupProfile; remaining?: ReviewScope[]; confirmed?: boolean }> {
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
    input.intent === "complete" || input.intent === "confirm" ? getSetupCompletionError(input.draft) : null;
  if (completionError) return { error: completionError };
  try {
    const user = await requireCurrentUserProfile();
    if (input.protocol === 2 && input.profileId !== user.id) return { error: "Your signed-in account changed. Reload before saving this draft." };
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
      if (state.version === 2 && input.protocol !== 2)
        return { error: "Setup was updated. Reload this page before continuing." };
      if (state.status === "complete")
        return input.intent === "complete"
          ? { revision: state.revision }
          : { error: "Setup is complete. Edit your details in Profile." };
      if (state.revision !== input.revision)
        return {
          error:
            "Setup changed in another tab. Reload to use the latest details.",
        };
      const profile = await tx.userProfile.findUniqueOrThrow({ where: { id: user.id } });
      if (input.protocol !== 2 && profile.updatedAt.toISOString() !== input.profileUpdatedAt)
        return { error: "Your account or profile changed. Reload setup before saving this draft." };
      let profileRevision = input.profileUpdatedAt;
      let canonical = buildProfileFormValues(profile, user);
      const confirms = input.intent === "complete" || input.intent === "confirm";
      const scopes: ReviewScope[] = input.intent === "complete" ? [...REVIEW_SCOPES] : [...new Set<ReviewScope>(input.scopes ?? ["contact"])];
      if (confirms) {
        if (profile.updatedAt.toISOString() !== input.profileUpdatedAt)
          return {
            error:
              "Your profile changed while setup was open. Reload to review your latest profile before finishing.",
          };
        if (!scopes.includes("contact")) return { error: "Review your contact details before continuing." };
        const reviewed = applyReviewedSetup(canonical, input.draft, scopes);
        const historyError = (scopes.includes("experiences") && historyValidationError(reviewed.experiences)) || (scopes.includes("educations") && historyValidationError(reviewed.educations));
        if (historyError) return { error: historyError };
        const contact = normalizeContact(reviewed.contact);
        const history = {
          experiences: normalizeExperiences(reviewed.experiences),
          educations: normalizeEducations(reviewed.educations),
        };
        const updated = await tx.userProfile.update({
          where: { id: user.id },
          data: {
            headline: reviewed.headline || null,
            summary: reviewed.summary || null,
            ...buildProfileTextCopies({ ...reviewed, ...history }),
            ...contactToProfileColumnUpdates(contact),
            contactJson: contact,
            skillsJson: reviewed.skills,
            experiencesJson: history.experiences,
            educationsJson: history.educations,
            projectsJson: reviewed.projects,
          },
        });
        profileRevision = updated.updatedAt.toISOString();
        canonical = buildProfileFormValues(updated, user);
      }
      if (input.intent === "goals" || input.intent === "complete") {
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
      const savedDraft = confirms ? applyReviewedSetup(input.draft, canonical, scopes) : input.draft;
      const remaining = pendingSetupScopes(canonical, savedDraft);
      const leaving = ["defer", "goals", "complete"].includes(input.intent);
      const complete = leaving && !remaining.length && Boolean(state.confirmedAt || confirms);
      await tx.userPreference.update({
        where: { id: record.id },
        data: {
          value: JSON.stringify({
            version: input.protocol === 2 ? 2 : 1,
            revision,
            step: remaining.length && (confirms || leaving) ? 1 : input.step,
            status:
              complete
                ? "complete"
                : input.intent === "defer" || confirms || input.intent === "goals"
                  ? "deferred"
                  : state.status,
            confirmedAt: confirms ? new Date().toISOString() : state.confirmedAt,
            confirmedScopes: [...new Set([...(state.confirmedScopes ?? []), ...(confirms ? scopes : [])])],
            ...(!complete ? { draft: savedDraft, goals: input.goals } : {}),
            profileUpdatedAt: profileRevision,
          }),
        },
      });
      return { revision, profileUpdatedAt: profileRevision, remaining, confirmed: confirms, ...(confirms ? { draft: savedDraft } : {}) };
    });
    if (result.error) return result;
    if (input.journey && input.entry && user.authUserId && ["confirm", "complete", "defer"].includes(input.intent))
      await recordOnboardingEvent({ journey: input.journey, entry: input.entry, event: input.intent === "defer" ? "setup_step_deferred" : "profile_details_confirmed" }, user.authUserId);
    if (["complete", "confirm", "goals"].includes(input.intent)) {
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

export async function beginProfileReview() {
  const user = await requireCurrentUserProfile();
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "UserProfile" WHERE id = ${user.id} FOR UPDATE`;
    const previous = await tx.userPreference.findUnique({ where: { userId_key: { userId: user.id, key: ONBOARDING_KEY } } });
    const state = parseOnboardingState(previous?.value);
    if (state && state.status !== "complete") return;
    const profile = await tx.userProfile.findUniqueOrThrow({ where: { id: user.id } });
    const value = JSON.stringify({ ...INITIAL_ONBOARDING, version: 2, status: "deferred", step: 1,
      revision: (state?.revision ?? -1) + 1, profileUpdatedAt: profile.updatedAt.toISOString(), confirmedAt: state?.confirmedAt });
    await tx.userPreference.upsert({ where: { userId_key: { userId: user.id, key: ONBOARDING_KEY } },
      create: { userId: user.id, key: ONBOARDING_KEY, value }, update: { value } });
  });
  return { started: true };
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
