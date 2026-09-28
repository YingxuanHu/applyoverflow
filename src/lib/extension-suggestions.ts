import { z } from "zod";
import { captureSchema } from "@/lib/application-assistant";
import { questionAssistance } from "../../extensions/chrome/question-policy.mjs";
import type { ProfileFormValues } from "@/lib/profile";
import { historyDateText } from "@/lib/profile-history";

export { questionAssistance };
export function suggestionTask(label: string) {
  const kind = questionAssistance(label);
  if (kind === "draft" && /anything (?:else )?about your (?:experience|background)|additional (?:information|experience)|help us evaluate your fit/i.test(label))
    return "overview";
  if (kind === "draft" && /\b(?:why|what)\b.{0,65}\b(?:interest\w*|join|work (?:at|for|with)|attract\w*|motivat\w*)\b|^\s*why (?:this|the) (?:role|job|company)[?*\s]*$/i.test(label) &&
      !/\b(?:do you have|have you|how many years)\b/i.test(label)) return "motivation";
  if (kind === "qualification") {
    if (/\b(?:education(?:al)?|degree|diploma|academic)\b/i.test(label)) return "education";
    if (/\b(?:certifications?|credentials?|certified|professional licen[cs]es?)\b/i.test(label)) return "credential";
  }
  return kind;
}

export function suggestionTaskInstructions(label: string) {
  const factual = `This is a factual qualification question. Every condition must be supported to suggest Yes. Missing evidence is NOT evidence of No. Do not infer years, direct reports, industry experience, hiring responsibilities or credentials from a title. If any condition is unproven, return an empty answer and one short question for the missing fact. Suggest No only when explicit applicant evidence contradicts the requirement. For skills or technology choices, use only explicitly documented skills or tools, never infer related technologies (Java is not JavaScript). Give the requested fact concisely, not a general professional overview.`;
  switch (suggestionTask(label)) {
    case "overview": return `This is an open-ended professional overview, NOT a qualification test. Write a useful, modest first-person overview of 1-2 documented strengths and their transferable value. Do not require experience in the employer's exact industry or demand facts absent from the resume. Do not claim the applicant meets any unproven requirements. For example, a software engineer can truthfully describe data analysis, reliability or process improvement without claiming fraud-team leadership. If any professional experience or project evidence exists, draft from it instead of asking the applicant to write an answer. Do not include a hiring recommendation or evaluate eligibility.`;
    case "motivation": return `This is a professional motivation/alignment question, NOT a qualification test or a request to guess personal passion. Answer through factual alignment: connect one or two documented professional facts to the role's work, using language such as "My experience in ... aligns with ...". This is a wording pattern, not evidence. Do not claim enthusiasm, preferences, personal reasons or prior employer/industry experience that is not documented. A relevant professional summary or documented skill is sufficient; do not demand a more specific workflow example, automation/standardization steps, metrics or outcomes unless the question explicitly requests them. Only the applicant facts actually stated in the answer need support; unasked-for details are not missing facts. The job description and role title are employer context only, never candidate evidence or proof that the applicant meets every requirement. If the job description is absent, use the role title only for broad context without inventing employer priorities. Write a short factual alignment answer from the available professional evidence instead of asking the applicant to restate it. If an explicitly requested fact is genuinely missing, use MISSING.`;
    case "qualification": return `${factual} When asked about programming languages, distinguish languages from frameworks (React is not a programming language). A skills list alone does not establish recent professional usage or which language was used most extensively. Use explicit role evidence for the requested scope; never infer comparative usage, duration or proficiency from a mention.`;
    case "education": return `${factual} Use only directly documented education. For highest completed education, compare all supplied education entries; an ongoing, expected, incomplete or planned degree is NOT a completed degree. A school name, attendance dates, coursework or job title alone does not establish a degree or graduation. Do not invent education dates, degree equivalence or completion. If a lower completed degree is documented, it can be used instead of an unfinished higher degree.`;
    case "credential": return `${factual} Name a professional certification or license only if explicitly documented as earned or held by the applicant. Training, exam preparation, an intended certification, or using a vendor's tools does not establish certification. Never infer validity, expiry, license jurisdiction or certification dates; if the question requires these and they are absent, ask for the missing fact.`;
    case "context": return `For a professional hypothetical (what you would build), propose a modest answer based on a stack and project actually documented in the profile. Frame any future idea as a proposal ("I would build..."), not an existing accomplishment. Describe demonstrated experience instead of claiming an unsupported confidence ranking or preference. If the question requires a preference or confidence choice, it must be explicitly stated in the applicant's note; otherwise return an empty answer and ask. Use the applicant's note when present. Never invent personal circumstances, availability, or reasons for part-time work or a career change.`;
    default: return `Draft from the applicant's documented professional experience. For projects and accomplishments, give one relevant documented example and only the stated contribution, technologies and results. Do not invent metrics, implementation details or claim an example is the applicant's greatest or favorite. If the question requests an architectural decision affecting multiple teams, require evidence of both the applicant's decision and its cross-team impact; a technical title or single-team project is insufficient. Similarly, coaching requires explicit coaching evidence. When a requested example or scope is absent, use MISSING and ask for that fact, never embellish a different example. For motivation, relate that experience to the role without inventing personal reasons or preferences. Do not demand proof of every job requirement for an open-ended question.`;
  }
}

type SuggestionLimits = { maxLength?: number; maxWords?: number; options?: string[] };

export function suggestionAnswerInstructions(limits: SuggestionLimits = {}) {
  return `The answer MUST be at most ${Math.min(limits.maxLength ?? 2500, 2500)} characters${limits.maxWords ? ` and ${limits.maxWords} words` : ""}. For a narrative, write a concise first-person draft, normally 40-80 words but only as long as the evidence and limit allow. For a short factual field, return just the requested fact. Use a shorter complete answer, never a truncated sentence or padded prose. ${limits.options?.length ? "Answer choices are supplied: match ONE offered choice verbatim, without explanation, markdown, multiple combined choices or added punctuation. Every part of that choice must be supported; if no exact choice fully answers the question, return an empty answer and ask for the missing fact. Never select No, None, Other or the nearest choice merely because evidence is absent." : "Write natural, grammatical prose with no citation markers, bracketed edits, placeholders or markdown."}`;
}

export const suggestionOutputInstructions = `Return exactly ONE of two mutually exclusive states:
SUPPORTED: answer is nonempty, evidence contains 1-4 exact supporting quotes, and missing is exactly "".
MISSING: answer is exactly "", evidence is exactly [], and missing contains one short clarifying question.
If any requested fact is still unknown or uncertain, use MISSING instead of a partial answer. Never include an answer alongside a missing-fact question, and never attach evidence to MISSING. Do not hide uncertainty by simply deleting missing from an unsupported answer.`;

export function suggestionRetryFeedback(error: unknown) {
  // Only fixed feedback crosses into the prompt, never exception text or model
  // output that could contain applicant facts, job text or embedded instructions.
  const reasons = {
    "Draft must provide either a supported answer or a missing fact.": ["answer_state", "The answer/missing/evidence fields violate the mutually exclusive output states. Reassess support and return one valid state; do not keep a partial answer with a clarification."],
    "Draft evidence could not be verified.": ["evidence", "A supporting source or exact quote could not be verified. Use only exact excerpts from the identified supplied sources. If support is absent, use MISSING."],
    "Draft exceeds the employer's answer limit.": ["limit", "The answer exceeded a character or word limit. Write a shorter complete supported answer within every original limit."],
    "Draft does not match an available answer choice.": ["choice", "The answer was not one exact offered choice. Return a verbatim fully supported choice, or use MISSING; do not choose the nearest option."],
  } as const;
  const [code, instruction] = error instanceof Error && Object.hasOwn(reasons, error.message)
    ? reasons[error.message as keyof typeof reasons]
    : ["format", "The output was not valid JSON in the required schema. Return only the required answer, evidence and missing fields with their original types and bounds."];
  return `The previous output failed validation (${code}). ${instruction}\n${suggestionOutputInstructions}\nAll original evidence, exact-choice and answer-limit checks still apply. Supporting quotes must be 8-300 characters copied verbatim from their identified sources.`;
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
  const fields = (values: Record<string, string>) => Object.entries(values)
    .filter(([, value]) => value.trim()).map(([key, value]) => `${key}: ${value.trim()}`).join("\n");
  const skills = profile.skills.slice(0, 40).map(s => s.name.trim()).filter(Boolean).join(", ");
  const rows = [
    { id: "summary", text: profile.summary.slice(0, 1800) },
    { id: "skills", text: skills ? `Documented skills: ${skills}` : "" },
    ...profile.experiences.slice(0, 6).map((x, i) => ({ id: `experience-${i}`, text: fields({ Title: x.title, Company: x.company, Description: x.description }).slice(0, 1800) })),
    ...profile.projects.slice(0, 4).map((x, i) => ({ id: `project-${i}`, text: fields({ Project: x.name, Role: x.title, Description: x.description }).slice(0, 1500) })),
    // Keep descriptions (including legacy education text and credentials) and
    // explicit study status. Omitting either can turn an unfinished degree into
    // an apparent award. Include all bounded profile entries, not just the first 3.
    ...profile.educations.slice(0, 25).map((x, i) => ({ id: `education-${i}`, text: fields({
      Degree: x.degree, "Field of study": x.fieldOfStudy ?? "", School: x.school,
      "Recorded study dates": historyDateText(x),
      Status: x.dates?.current ? "Currently studying; completion is not established by this entry." : "",
      Description: x.description.slice(0, 3000),
    }) })),
    { id: "your-note", text: note },
  ];
  return rows.filter(x => x.text.trim());
}

export const generatedSuggestionSchema = z.object({
  answer: z.string().trim().max(2500),
  evidence: z.array(z.object({ id: z.string().max(60), quote: z.string().trim().min(8).max(300) }).strict()).max(4),
  missing: z.string().trim().max(240),
}).strict();

// Retry references select existing excerpts instead of copying quotes again;
// neither model-created source IDs nor rewritten quotes can be repaired silently.
export function suggestionCitationRepair(sources: SuggestionEvidence[], limits: SuggestionLimits = {}) {
  const excerpts: Array<{ reference: number; id: string; quote: string }> = [];
  for (const source of sources) {
    for (let start = 0; start < source.text.length && excerpts.length < 100; start += 240) {
      const quote = source.text.slice(start, start + 300).trim();
      if (quote.length >= 8) excerpts.push({ reference: excerpts.length, id: source.id, quote });
    }
    if (excerpts.length >= 100) break;
  }
  const schema = z.object({
    answer: generatedSuggestionSchema.shape.answer,
    references: z.array(z.number().int().min(0).max(Math.max(0, excerpts.length - 1))).max(4),
    missing: generatedSuggestionSchema.shape.missing,
  }).strict();
  return {
    excerpts, schema,
    instructions: `Reassess the original question against the original professional evidence. Return only a JSON object with answer (string), references (an array of integer reference numbers from citationExcerpts), and missing (string).
SUPPORTED: answer is nonempty, references contains 1-4 distinct reference numbers whose excerpts support every applicant fact in the answer, and missing is exactly "".
MISSING: answer is exactly "", references is exactly [], and missing is one short clarifying question.
Reference numbers are only citation pointers, not evidence of qualifications. Do not use an excerpt merely because it contains a technology name. Read its full source for negation, scope and context; do not omit qualifiers or infer recency, comparative usage, years, leadership or coaching. Never infer React is a programming language or Java from JavaScript. Summarize documented language usage without adding unsupported superlatives. All original question, exact-choice and length limits remain mandatory. Do not copy or salvage the rejected draft.`,
    parse(raw: string) {
      const result = schema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
      if (new Set(result.references).size !== result.references.length || result.references.some(reference => !excerpts[reference]))
        throw new Error("Draft evidence could not be verified.");
      return parseSuggestion(JSON.stringify({ answer: result.answer, missing: result.missing,
        evidence: result.references.map(reference => ({ id: excerpts[reference].id, quote: excerpts[reference].quote })),
      }), sources, limits);
    },
  };
}

export function parseSuggestion(raw: string, sources: SuggestionEvidence[], limits: SuggestionLimits = {}) {
  const result = generatedSuggestionSchema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")));
  if (result.answer ? Boolean(result.missing) : !result.missing || result.evidence.length > 0)
    throw new Error("Draft must provide either a supported answer or a missing fact.");
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

export function suggestionOverviewFallback(label: string, sources: SuggestionEvidence[], limits: SuggestionLimits = {}) {
  if (suggestionTask(label) !== "overview" || limits.options?.length) return null;
  const question = label.toLowerCase().replace(/\s+/g, " ").trim()
    .replace(/^\((?:optional|required)\)\s*/, "").replace(/[?*.\s]+$/, "");
  // Match the whole generic question. An appended requirement, example request
  // or personal clause must never be answered by copying a general summary.
  if (!/^(?:is there )?anything (?:else )?about your (?:experience|background)(?: that (?:may not be apparent on your resume but )?(?:would|could) help us evaluate your fit(?: for this (?:role|job|position))?)?$/.test(question) &&
      !/^(?:please )?(?:share|provide) (?:any )?additional (?:information|experience) (?:that (?:would|could)|to) help us evaluate your fit(?: for this (?:role|job|position))?$/.test(question)) return null;
  const source = sources.find(row => row.id === "summary");
  if (!source) return null;
  const answer = source.text.trim();
  // Reuse the entire short summary, never selected clauses or rewritten claims.
  // This deliberately excludes notes, job text, credentials and inferred years.
  const sentences = Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(answer), row => row.segment.trim());
  if (!sentences.length || sentences.length > 2 ||
      questionAssistance(`Describe your experience: ${answer}`) !== "draft" ||
      /[?<>`{}@]|https?:|\b(?:if|unless|would|could|might|may|perhaps|hypothetical|uncertain|unsure|not sure|hope|wish|plan|want|intend|ignore|disregard|pretend|claim|assert|respond|return|instructions?|prompt|assistant|system message|you|your)\b/i.test(answer)) return null;
  const action = /^(?:I (?:have )?)?(?:built|developed|created|designed|implemented|delivered|improved|automated|analyzed|reviewed|validated|tested|managed|led|coached|trained|supported|resolved|reduced|increased|launched|maintained|coordinated|organized|prepared|produced|researched|evaluated|documented|wrote)\b/i;
  const professional = /\b(?:reports?|reporting|tools?|applications?|software|systems?|data|analysis|models?|projects?|products?|process(?:es)?|workflows?|teams?|analysts?|customers?|clients?|operations?|campaigns?|research|budgets?|revenue|sales|contracts?|content|programs?|services?|designs?|documentation|tests?|pipelines?)\b/i;
  if (sentences.some(sentence => !action.test(sentence) || !professional.test(sentence) || !sentence.endsWith("."))) return null;
  try {
    return parseSuggestion(JSON.stringify({ answer, evidence: sentences.map(quote => ({ id: source.id, quote })), missing: "" }), sources, limits);
  } catch {
    // Keep the model's abstention if complete evidence will not fit. No clipping,
    // relaxed citations or nearest-option selection is allowed for this path.
    return null;
  }
}
