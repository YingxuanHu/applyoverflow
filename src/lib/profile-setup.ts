import { z } from "zod";
import { getSafeSignInCallback } from "./auth-return-path";
import { historyDatesSchema } from "./profile-history";

export const ONBOARDING_KEY = "profile-onboarding-v1";
export const JOB_GOALS_KEY = "job-goals-v1";
const text = (max: number) => z.string().trim().max(max);
export const jobGoalsSchema = z
  .object({
    targetTitles: z
      .array(text(100).min(1))
      .max(5)
      .transform((items) => [...new Set(items)]),
    preferredLocation: text(200),
    country: z.enum(["", "CA", "US"]),
  })
  .strict();
export type JobGoals = z.infer<typeof jobGoalsSchema>;
export const EMPTY_JOB_GOALS: JobGoals = {
  targetTitles: [],
  preferredLocation: "",
  country: "",
};
export function parseJobGoals(value?: string | null): JobGoals | null {
  try {
    return jobGoalsSchema.parse(JSON.parse(value ?? "null"));
  } catch {
    return null;
  }
}

export const setupProfileSchema = z
  .object({
    headline: text(200),
    summary: text(5000),
    location: text(200),
    workAuthorization: text(500),
    contact: z
      .object({
        fullName: text(160),
        givenName: text(100).optional(),
        familyName: text(100).optional(),
        preferredName: text(100).optional(),
        pronouns: text(80).optional(),
        autofillResume: z.boolean().optional(),
        email: text(160),
        phone: text(80),
        location: text(140),
        linkedInUrl: text(280),
        githubUrl: text(280),
        portfolioUrl: text(280),
        streetAddress: text(200).optional(),
        addressLine2: text(120).optional(),
        city: text(100).optional(),
        region: text(100).optional(),
        postalCode: text(30).optional(),
        country: z.enum(["", "CA", "US"]).optional(),
      })
      .strict(),
    skills: z.array(z.object({ name: text(120) })).max(25),
    experiences: z
      .array(
        z.object({
          title: text(140),
          company: text(140),
          time: text(100),
          dates: historyDatesSchema.optional(),
          location: text(140),
          description: text(3000),
        }),
      )
      .max(25),
    educations: z
      .array(
        z.object({
          school: text(160),
          degree: text(160),
          time: text(100),
          dates: historyDatesSchema.optional(),
          location: text(140),
          description: text(3000),
        }),
      )
      .max(25),
    projects: z
      .array(
        z.object({
          name: text(160),
          title: text(140),
          time: text(100),
          location: text(140),
          description: text(3000),
        }),
      )
      .max(25),
  })
  .strict();
export type SetupProfile = z.infer<typeof setupProfileSchema>;
export function getSetupCompletionError(profile: SetupProfile) {
  if (!profile.contact.fullName.trim())
    return "Add your full name before finishing.";
  if (!z.email().safeParse(profile.contact.email).success)
    return "Add a valid contact email before finishing.";
  return null;
}
export const onboardingStateSchema = z
  .object({
    version: z.literal(1),
    status: z.enum(["pending", "deferred", "complete"]),
    step: z.number().int().min(0).max(2),
    revision: z.number().int().min(0),
    draft: setupProfileSchema.optional(),
    goals: jobGoalsSchema.optional(),
    confirmedAt: z.string().datetime().optional(),
    profileUpdatedAt: z.string().datetime().optional(),
  })
  .strict();
export type OnboardingState = z.infer<typeof onboardingStateSchema>;
export const INITIAL_ONBOARDING: OnboardingState = {
  version: 1,
  status: "pending",
  step: 0,
  revision: 0,
};
export function parseOnboardingState(
  value?: string | null,
): OnboardingState | null {
  try {
    return onboardingStateSchema.parse(JSON.parse(value ?? "null"));
  } catch {
    return null;
  }
}
export function setupReturnPath(value: unknown) {
  const path = getSafeSignInCallback(value);
  const pathname = new URL(path, "https://applyoverflow.local").pathname;
  return /^\/(?:onboarding|sign-up|sign-in|api|auth|verify-email-required)(?:\/|$)/.test(
    pathname,
  ) || pathname === "/"
    ? "/jobs"
    : path;
}
export function onboardingDestination(
  state: OnboardingState | null,
  destination: unknown,
) {
  const next = setupReturnPath(destination);
  return state?.status === "pending"
    ? `/onboarding?from=${encodeURIComponent(next)}`
    : next;
}
