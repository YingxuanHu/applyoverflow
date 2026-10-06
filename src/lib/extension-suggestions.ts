import { z } from "zod";
import { captureSchema } from "@/lib/application-assistant";
import { questionAssistance } from "../../extensions/chrome/question-policy.mjs";
import type { ProfileFormValues } from "@/lib/profile";
import { autofillHistoryDates } from "@/lib/profile-history";

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
    case "knowledge": return `This is a professional knowledge or problem-solving question. Answer it directly with a technically sound explanation or proposed approach, including relevant trade-offs and how you would verify the result. General professional knowledge is allowed; it is not evidence of the applicant's past experience. Use conditional/future wording for a proposed approach. Do not invent personal accomplishments, tools used in past work, credentials, results or metrics. Cite profile evidence only when claiming the applicant has done something. Do not refuse a conceptual question merely because the resume does not describe that exact scenario.`;
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

export function suggestionEvidence(profile: ProfileFormValues, note: string, question = ""): SuggestionEvidence[] {
  // Explicit allowlist: do not pass contact details, demographics, eligibility
  // answers, saved application answers or the full resume to the model.
  const period = (entry: Parameters<typeof autofillHistoryDates>[0]) => {
    const dates = autofillHistoryDates(entry);
    return dates?.start ? ` Period: ${dates.start} to ${dates.current ? "Present" : dates.end || "end not documented"}.` : "";
  };
  const rows = [
    { id: "summary", text: profile.summary.slice(0, 1800) },
    { id: "skills", text: profile.skills.slice(0, 80).map(s => s.name).join(", ").slice(0, 1600) },
    ...profile.experiences.slice(0, 30).map((x, i) => ({ id: `experience-${i}`, text: `${x.title} at ${x.company}${period(x)}: ${x.description}`.slice(0, 2600) })),
    ...profile.projects.slice(0, 30).map((x, i) => ({ id: `project-${i}`, text: `${x.name}: ${x.description}`.slice(0, 2400) })),
    ...profile.educations.slice(0, 10).map((x, i) => ({ id: `education-${i}`, text: `${x.degree}${x.fieldOfStudy ? ` in ${x.fieldOfStudy}` : ""} at ${x.school}${period(x)}`.slice(0, 600) })),
    { id: "your-note", text: note },
  ];
  const tokens = (text: string) => new Set((text.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) || [])
    .filter(token => !/^(the|and|for|your|you|with|about|what|how|tell|describe|experience|project|have|that|this|would|could|please|using|work|built)$/.test(token)));
  const query = tokens(question), populated = rows.filter(x => x.text.trim());
  const scored = populated.map((row, index) => ({ row, index, words: tokens(row.text) }));
  const score = (item: typeof scored[number]) => [...query].reduce((sum, token) => sum + (item.words.has(token)
    ? 1 + Math.log(1 + scored.length / (scored.filter(source => source.words.has(token)).length || 1)) : 0), 0);
  // Search the whole structured profile before applying the prompt budget. A
  // relevant older project must not disappear behind the first six jobs.
  const fixed = populated.filter(row => ["summary", "skills", "your-note"].includes(row.id));
  const selected = scored.filter(item => !fixed.includes(item.row)).sort((a, b) => score(b) - score(a) || a.index - b.index);
  const result = [...fixed];
  let size = fixed.reduce((sum, row) => sum + row.text.length, 0);
  for (const { row } of selected) {
    if (result.length >= 14 || size + row.text.length > 22_000) continue;
    result.push(row); size += row.text.length;
  }
  return result;
}

export const generatedSuggestionSchema = z.object({
  answer: z.string().trim().max(2500),
  evidence: z.array(z.object({ id: z.string().max(60), quote: z.string().trim().min(1).max(300) }).strict()).max(4),
  missing: z.string().trim().max(240),
}).strict();

export function parseSuggestion(raw: string, sources: SuggestionEvidence[], limits: { maxLength?: number; maxWords?: number; options?: string[]; allowUncited?: boolean } = {}) {
  const result = generatedSuggestionSchema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
  if (!result.answer && !result.missing) throw new Error("Draft contains neither an answer nor a missing fact.");
  if (result.answer && result.missing) throw new Error("Draft contains both an answer and a missing fact.");
  if (result.answer && ((!result.evidence.length && !limits.allowUncited) || result.evidence.some(ref =>
    !sources.some(source => source.id === ref.id && source.text.includes(ref.quote)))))
    throw new Error("Draft evidence could not be verified.");
  if ((limits.maxLength && result.answer.length > limits.maxLength) ||
      (limits.maxWords && result.answer.trim().split(/\s+/).length > limits.maxWords))
    throw new Error("Draft exceeds the employer's answer limit.");
  if (result.answer && limits.options?.length && !limits.options.includes(result.answer))
    throw new Error("Draft does not match an available answer choice.");
  return result;
}
