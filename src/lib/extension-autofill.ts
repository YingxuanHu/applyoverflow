import { z } from "zod";
import { captureSchema, questionKey, questionKind, type AnswerLibrary } from "@/lib/application-assistant";

export const autofillPlanSchema = captureSchema.omit({ title: true }).extend({
  history: z.boolean().default(false),
});
export const autofillProfileFields = {
  givenName: 100, familyName: 100, fullName: 200, preferredName: 100,
  pronouns: 80, email: 320, phone: 80, phoneCountry: 2, streetAddress: 240,
  addressLine2: 240, city: 120, region: 120, postalCode: 32,
  country: 2, linkedInUrl: 500, githubUrl: 500, portfolioUrl: 500,
} as const;
const reusableKind = (label: string) => ["custom", "referral", "company_relationship"].includes(questionKind(label));
export const autofillAnswerSchema = z.object({
  url: captureSchema.shape.url,
  label: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(3000),
  profileKey: z.enum(Object.keys(autofillProfileFields) as [keyof typeof autofillProfileFields, ...Array<keyof typeof autofillProfileFields>]).optional(),
  revision: z.string().datetime(),
}).strict().superRefine((input, ctx) => {
  if (input.profileKey) {
    if (input.answer.length > autofillProfileFields[input.profileKey] ||
      (["country", "phoneCountry"].includes(input.profileKey) && !["CA", "US"].includes(input.answer)) ||
      (input.profileKey === "email" && !z.string().email().safeParse(input.answer).success) ||
      (/Url$/.test(input.profileKey) && !z.string().url().regex(/^https?:\/\//i).safeParse(input.answer).success))
      ctx.addIssue({ code: "custom", message: "Check the profile value and try again." });
  } else if (!reusableKind(input.label)) {
    ctx.addIssue({ code: "custom", message: "This answer must be reviewed on each application." });
  }
});

export function reusableAutofillAnswers(library: AnswerLibrary, companyKey: string, revision: string, labels: string[]) {
  return labels.flatMap(label => {
    if (!reusableKind(label)) return [];
    const matches = library.filter(item => item.companyId === companyKey &&
      item.questionKey === questionKey(label) && item.kind === questionKind(label) &&
      item.autofillConfirmed === true && item.profileRevision === revision);
    return matches.length === 1 ? [{ label, answer: matches[0].answer }] : [];
  });
}
