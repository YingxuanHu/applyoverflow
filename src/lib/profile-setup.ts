import { z } from "zod";
import { getSafeSignInCallback } from "./auth-return-path";
import { profileApplicationAnswersSchema } from "./profile-application-answers";

export const ONBOARDING_KEY = "profile-onboarding-v1";
export const JOB_GOALS_KEY = "job-goals-v1";
const text = (max: number) => z.string().trim().max(max);
// Drafts may contain unfinished dates. Canonical confirmation validates only
// the sections the user actually reviewed with historyValidationError.
const draftDatesSchema = z.object({ start: text(20), end: text(20), current: z.boolean() }).strict();
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
        applicationAnswers: profileApplicationAnswersSchema.optional(),
        aiToolUsage: text(1200).optional(),
        email: text(160),
        phone: text(80),
        phoneCountry: z.enum(["", "CA", "US"]).optional(),
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
          dates: draftDatesSchema.optional(),
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
          fieldOfStudy: text(160).optional(),
          time: text(100),
          dates: draftDatesSchema.optional(),
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
export const REVIEW_SCOPES = ["contact", "address", "experiences", "educations", "projects", "summary"] as const;
export const reviewScopeSchema = z.enum(REVIEW_SCOPES);
export type ReviewScope = z.infer<typeof reviewScopeSchema>;
const CONTACT_KEYS = ["fullName", "givenName", "familyName", "preferredName", "email", "phone", "phoneCountry", "location"] as const;
const ADDRESS_KEYS = ["streetAddress", "addressLine2", "city", "region", "postalCode", "country", "linkedInUrl", "githubUrl", "portfolioUrl"] as const;

// Review only exposes these fields. In particular, importing a resume must not
// change sharing consent, optional application answers, or demographic choices.
export function applyReviewedSetup(current: SetupProfile, draft: SetupProfile, scopes: readonly ReviewScope[]): SetupProfile {
  const next = structuredClone(current);
  for (const scope of scopes) {
    if (scope === "contact" || scope === "address") {
      for (const key of scope === "contact" ? CONTACT_KEYS : ADDRESS_KEYS) {
        if (draft.contact[key] !== undefined || current.contact[key] !== undefined)
          Object.assign(next.contact, { [key]: draft.contact[key] ?? "" });
      }
    } else if (scope === "summary") {
      next.headline = draft.headline;
      next.summary = draft.summary;
      next.skills = structuredClone(draft.skills);
    } else {
      Object.assign(next, { [scope]: structuredClone(draft[scope]) });
    }
  }
  return next;
}

export function pendingSetupScopes(current: SetupProfile, draft?: SetupProfile): ReviewScope[] {
  if (!draft) return [];
  const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, ordered(item)])) : value;
  const canonical = JSON.stringify(ordered(current));
  return REVIEW_SCOPES.filter(scope => JSON.stringify(ordered(applyReviewedSetup(current, draft, [scope]))) !== canonical);
}

export function isExtensionSetupPath(value: string) {
  return new URL(getSafeSignInCallback(value), "https://applyoverflow.local").pathname === "/extension/setup";
}
export function getSetupCompletionError(profile: SetupProfile) {
  if (!profile.contact.fullName.trim())
    return "Add your full name before finishing.";
  if (!z.email().safeParse(profile.contact.email).success)
    return "Add a valid contact email before finishing.";
  return null;
}
export const onboardingStateSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    status: z.enum(["pending", "deferred", "complete"]),
    step: z.number().int().min(0).max(2),
    revision: z.number().int().min(0),
    draft: setupProfileSchema.optional(),
    goals: jobGoalsSchema.optional(),
    confirmedAt: z.string().datetime().optional(),
    profileUpdatedAt: z.string().datetime().optional(),
    confirmedScopes: z.array(reviewScopeSchema).optional(),
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
  // Setup and brief authorization are coordinated outside the timed identity
  // window. Never insert the full onboarding wizard into extension consent.
  const extensionPath = /^\/extension\/(?:setup|connect)(?:\?|$)/.test(next);
  return state?.status === "pending" && !extensionPath
    ? `/onboarding?from=${encodeURIComponent(next)}`
    : next;
}
