import { z } from "zod";

// Voluntary answers are user-entered only. Never derive them from a resume,
// location, name, recommendations, or an AI-generated answer.
export const applicationAnswerFields = [
  { key: "gender", label: "Gender identity", options: ["Woman", "Man", "Non-binary", "Prefer not to answer"] },
  { key: "ethnicity", label: "Race or ethnicity", options: ["American Indian or Alaska Native", "Asian", "Black or African American", "Hispanic or Latino", "Native Hawaiian or Other Pacific Islander", "White", "Two or more races", "Prefer not to answer"] },
  { key: "hispanicLatino", label: "Hispanic or Latino", options: ["Yes", "No", "Prefer not to answer"] },
  { key: "veteran", label: "U.S. protected veteran status", options: ["I identify as one or more of the classifications of a protected veteran", "I am not a protected veteran", "I don't wish to answer"] },
  { key: "disability", label: "Disability status (current or past)", options: ["Yes, I have a disability, or have had one in the past", "No, I do not have a disability and have not had one in the past", "I do not want to answer"] },
  { key: "over18", label: "At least 18 years old", options: ["Yes", "No"] },
  { key: "authorizedCA", label: "Legally authorized to work in Canada", options: ["Yes", "No"] },
  { key: "authorizedUS", label: "Legally authorized to work in the United States", options: ["Yes", "No"] },
  { key: "sponsorshipCA", label: "Require work sponsorship in Canada, now or in future", options: ["Yes", "No"] },
  { key: "sponsorshipUS", label: "Require work sponsorship in the United States, now or in future", options: ["Yes", "No"] },
] as const;
export type ApplicationAnswerKey = typeof applicationAnswerFields[number]["key"];
export type ProfileApplicationAnswers = { enabled: boolean; values: Partial<Record<ApplicationAnswerKey, string>> };
const shape = Object.fromEntries(applicationAnswerFields.map(field => [field.key, z.enum(["", ...field.options]).optional()]));
export const profileApplicationAnswersSchema: z.ZodType<ProfileApplicationAnswers> = z.object({
  enabled: z.boolean(), values: z.object(shape).strict(),
}).strict();

export function normalizeApplicationAnswers(raw: unknown): ProfileApplicationAnswers {
  const parsed = profileApplicationAnswersSchema.safeParse(raw);
  return parsed.success ? parsed.data : { enabled: false, values: {} };
}

export function commonApplicationAnswers(raw: unknown, labels: string[]) {
  const saved = normalizeApplicationAnswers(raw);
  if (!saved.enabled) return [];
  return labels.flatMap(label => {
    const text = label.normalize("NFKC").replace(/[*:]/g, "").replace(/\(optional\)|\(required\)/gi, "").trim().replace(/\s+/g, " ").toLowerCase();
    let key: ApplicationAnswerKey | undefined;
    if (/^(gender|gender identity|i identify my gender as|what is your gender identity\??|how do you describe your gender identity\??)$/.test(text)) key = "gender";
    if (/^(race|ethnicity|race\/ethnicity|race or ethnicity|racial or ethnic identity|what is your race and ethnicity\??)$/.test(text)) key = "ethnicity";
    if (/^(are you hispanic(?: or |\/)latino\??|hispanic or latino)$/.test(text)) key = "hispanicLatino";
    if (/^(veteran status|protected veteran status|u\.s\. protected veteran status)$/.test(text)) key = "veteran";
    if (/^(disability status|disability|voluntary self-identification of disability)$/.test(text)) key = "disability";
    if (/^are you at least 18( years old| years of age)?\??$/.test(text)) key = "over18";
    // Country must be explicit in the question. Residence is not work eligibility.
    const authorization = text.match(/^are you (legally )?authorized to work in (canada|the united states|the us|the u\.s\.)\??$/);
    if (authorization) key = authorization[2] === "canada" ? "authorizedCA" : "authorizedUS";
    const sponsorship = text.match(/^will you (now or in the future|now or in future) require (employment |visa |work )?sponsorship (to work )?in (canada|the united states|the us|the u\.s\.)\??$/);
    if (sponsorship) key = sponsorship[4] === "canada" ? "sponsorshipCA" : "sponsorshipUS";
    const answer = key && saved.values[key];
    // Sex, generic veteran, and current-only disability questions deliberately
    // do not receive broader identity/protected-veteran/lifetime answers.
    return answer ? [{ label, answer }] : [];
  });
}
