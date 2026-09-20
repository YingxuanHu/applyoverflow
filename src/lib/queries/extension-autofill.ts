import "server-only";
import { prisma } from "@/lib/db";
import { buildProfileFormValues, normalizeContact, normalizeExperiences, normalizeEducations } from "@/lib/profile";
import { ANSWER_LIBRARY_KEY, applicationContext, parseAnswerLibrary, questionKey } from "@/lib/application-assistant";
import { autofillAnswerSchema, autofillPlanSchema, autofillProfileFields, reusableAutofillAnswers } from "@/lib/extension-autofill";
import { AssistantError } from "@/lib/queries/application-assistant";
import { contactToProfileColumnUpdates } from "@/lib/profile-contact-sync";

export async function getAutofillPlan(userId: string, raw: unknown) {
  const input = autofillPlanSchema.parse(raw);
  const profile = await prisma.userProfile.findUnique({
    where: { authUserId: userId },
    select: {
      contactJson: true, updatedAt: true, phone: true, location: true,
      linkedinUrl: true, githubUrl: true, portfolioUrl: true,
      experiencesJson: input.history, educationsJson: input.history,
      authUser: { select: { name: true, email: true } },
      preferences: { where: { key: ANSWER_LIBRARY_KEY }, select: { value: true } },
    },
  });
  if (!profile) throw new AssistantError("Complete your ApplyOverflow profile first.");
  const contact = buildProfileFormValues(profile, profile.authUser ?? undefined).contact;
  const revision = profile.updatedAt.toISOString();
  // Export only application fields, never demographic or work-authorization data.
  const fields = Object.fromEntries((Object.keys(autofillProfileFields) as Array<keyof typeof autofillProfileFields>)
    .map(key => [key, contact[key] ?? ""]));
  return {
    contact: fields, revision, includeResume: contact.autofillResume === true,
    answers: reusableAutofillAnswers(parseAnswerLibrary(profile.preferences[0]?.value), applicationContext(input.url, true)!.companyKey, revision, input.questions),
    history: input.history ? [
      ...normalizeExperiences(profile.experiencesJson).slice(0, 10).map(entry => ({ kind: "experience", entry })),
      ...normalizeEducations(profile.educationsJson).slice(0, 10).map(entry => ({ kind: "education", entry })),
    ] : [],
  };
}

export async function rememberAutofillAnswer(userId: string, raw: unknown) {
  const input = autofillAnswerSchema.parse(raw);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "UserProfile" WHERE "authUserId" = ${userId} FOR UPDATE`;
    const profile = await tx.userProfile.findUniqueOrThrow({ where: { authUserId: userId } });
    if (profile.updatedAt.toISOString() !== input.revision)
      throw new AssistantError("Your profile changed. Autofill again before remembering this answer.", 409);
    if (input.profileKey) {
      const contact = { ...normalizeContact(profile.contactJson), [input.profileKey]: input.answer };
      const updated = await tx.userProfile.update({
        where: { id: profile.id },
        data: { contactJson: contact, ...contactToProfileColumnUpdates(buildProfileFormValues({ ...profile, contactJson: contact }).contact) },
      });
      return { revision: updated.updatedAt.toISOString() };
    }
    const key = { userId: profile.id, key: ANSWER_LIBRARY_KEY };
    const preference = await tx.userPreference.findUnique({ where: { userId_key: key } });
    const context = applicationContext(input.url, true)!;
    const library = parseAnswerLibrary(preference?.value).filter(item =>
      item.companyId !== context.companyKey || item.questionKey !== questionKey(input.label));
    if (library.length >= 60) throw new AssistantError("Remove unused saved answers in Settings before remembering another.");
    library.push({ companyId: context.companyKey, companyLabel: context.tenant,
      questionKey: questionKey(input.label), questionLabel: input.label,
      answer: input.answer, kind: "custom", profileRevision: input.revision, autofillConfirmed: true });
    await tx.userPreference.upsert({ where: { userId_key: key },
      create: { ...key, value: JSON.stringify(library) }, update: { value: JSON.stringify(library) } });
    return { revision: input.revision };
  });
}
