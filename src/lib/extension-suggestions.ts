import { z } from "zod";
import { captureSchema } from "@/lib/application-assistant";
import { questionAssistance } from "../../extensions/chrome/question-policy.mjs";
import type { ProfileFormValues } from "@/lib/profile";

export { questionAssistance };
export const suggestionRequestSchema = z.object({
  url: captureSchema.shape.url,
  label: z.string().trim().min(1).max(500),
  title: z.string().max(180),
  jobDescription: z.string().max(8000),
  note: z.string().trim().max(1200).default(""),
  revision: z.string().datetime(),
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
    ...profile.educations.slice(0, 3).map((x, i) => ({ id: `education-${i}`, text: `${x.degree} at ${x.school}`.slice(0, 400) })),
    { id: "your-note", text: note },
  ];
  return rows.filter(x => x.text.trim());
}

const generatedSchema = z.object({
  answer: z.string().trim().max(2500),
  evidence: z.array(z.object({ id: z.string().max(60), quote: z.string().trim().min(8).max(300) }).strict()).max(4),
  missing: z.string().trim().max(240).default(""),
}).strict();

export function parseSuggestion(raw: string, sources: SuggestionEvidence[]) {
  const result = generatedSchema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
  if (result.answer && (!result.evidence.length || result.evidence.some(ref =>
    !sources.some(source => source.id === ref.id && source.text.includes(ref.quote)))))
    throw new Error("Draft evidence could not be verified.");
  return result;
}
