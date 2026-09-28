import { z } from "zod";
import { captureSchema } from "@/lib/application-assistant";
import { questionAssistance } from "../../extensions/chrome/question-policy.mjs";
import type { ProfileFormValues } from "@/lib/profile";

export { questionAssistance };
export function suggestionTask(label: string) {
  const kind = questionAssistance(label);
  if (kind === "draft" && /anything (?:else )?about your (?:experience|background)|additional (?:information|experience)|help us evaluate your fit/i.test(label))
    return "overview";
  return kind;
}

export function suggestionTaskInstructions(label: string) {
  switch (suggestionTask(label)) {
    case "overview": return `This is an open-ended professional overview, NOT a qualification test. Write a useful, modest first-person overview of 1-2 documented strengths and their transferable value. Do not require experience in the employer's exact industry or demand facts absent from the resume. Do not claim the applicant meets any unproven requirements. For example, a software engineer can truthfully describe data analysis, reliability or process improvement without claiming fraud-team leadership. If any professional experience or project evidence exists, draft from it instead of asking the applicant to write an answer. Do not include a hiring recommendation or evaluate eligibility.`;
    case "qualification": return `This is a factual qualification question. Every condition must be supported to suggest Yes. Missing evidence is NOT evidence of No. Do not infer years, direct reports, industry experience, hiring responsibilities or credentials from a title. If any condition is unproven, return an empty answer and one short question for the missing fact. Suggest No only when explicit applicant evidence contradicts the requirement. If answer choices are supplied, match ONE verbatim. Do not put an explanation in the answer value.`;
    case "context": return `For a professional hypothetical (what you would build) or preferred technology, propose a modest answer based on a stack and project actually documented in the profile. Frame any future idea as a proposal ("I would build..."), not an existing accomplishment. Describe demonstrated experience instead of claiming an unsupported confidence ranking. Use the applicant's note when present. Never invent personal circumstances, availability, or reasons for part-time work or a career change.`;
    default: return `Draft from the applicant's documented professional experience. For motivation, relate that experience to the role without inventing personal reasons. Do not demand proof of every job requirement for an open-ended question.`;
  }
}
export const suggestionRequestSchema = z.object({
  url: captureSchema.shape.url,
  label: z.string().trim().min(1).max(500),
  title: z.string().max(180),
  jobDescription: z.string().max(8000),
  note: z.string().trim().max(1200).default(""),
  revision: z.string().datetime(),
  maxLength: z.number().int().min(1).max(3000).optional(),
  maxWords: z.number().int().min(1).max(1000).optional(),
  options: z.array(z.string().trim().min(1).max(500)).max(80).optional(),
}).strict();
export type SuggestionEvidence = { id: string; text: string };

export function suggestionEvidence(profile: ProfileFormValues, note: string): SuggestionEvidence[] {
  // Explicit allowlist: do not pass contact details, demographics, eligibility
  // answers, saved application answers or the full resume to the model.
  const rows = [
    { id: "summary", text: profile.summary.slice(0, 1800) },
    { id: "skills", text: profile.skills.slice(0, 40).map(s => s.name).join(", ") },
    ...profile.experiences.slice(0, 6).map((x, i) => ({ id: `experience-${i}`, text: `${x.title} at ${x.company}: ${x.description}`.slice(0, 1800) })),
    ...profile.projects.slice(0, 4).map((x, i) => ({ id: `project-${i}`, text: `${x.name}: ${x.description}`.slice(0, 1500) })),
    ...profile.educations.slice(0, 3).map((x, i) => ({ id: `education-${i}`, text: `${x.degree}${x.fieldOfStudy ? ` in ${x.fieldOfStudy}` : ""} at ${x.school}`.slice(0, 400) })),
    { id: "your-note", text: note },
  ];
  return rows.filter(x => x.text.trim());
}

export const generatedSuggestionSchema = z.object({
  answer: z.string().trim().max(2500),
  evidence: z.array(z.object({ id: z.string().max(60), quote: z.string().trim().min(8).max(300) }).strict()).max(4),
  missing: z.string().trim().max(240),
}).strict();

export function parseSuggestion(raw: string, sources: SuggestionEvidence[], limits: { maxLength?: number; maxWords?: number; options?: string[] } = {}) {
  const result = generatedSuggestionSchema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
  if (result.answer && (!result.evidence.length || result.evidence.some(ref =>
    !sources.some(source => source.id === ref.id && source.text.includes(ref.quote)))))
    throw new Error("Draft evidence could not be verified.");
  if ((limits.maxLength && result.answer.length > limits.maxLength) ||
      (limits.maxWords && result.answer.trim().split(/\s+/).length > limits.maxWords))
    throw new Error("Draft exceeds the employer's answer limit.");
  if (result.answer && limits.options?.length && !limits.options.includes(result.answer))
    throw new Error("Draft does not match an available answer choice.");
  return result;
}
