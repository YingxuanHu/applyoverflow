// Approximate text similarity never grants permission to reuse a personal or
// company-specific answer. questionKey is an exact, typed semantic mapping.
export type AnswerKind =
  | "profile_fact"
  | "experience_story"
  | "company_relationship"
  | "referral"
  | "work_authorization"
  | "sensitive"
  | "custom";
export type SavedApplicationAnswer = {
  kind: AnswerKind;
  questionKey: string;
  answer: string;
  approved: boolean;
  reuse: "never" | "suggest" | "fill";
  companyId?: string;
  country?: string;
  profileRevision: string;
};
export function decideAnswerReuse(
  answer: SavedApplicationAnswer,
  context: {
    kind: AnswerKind;
    questionKey: string;
    companyId?: string;
    country?: string;
    profileRevision: string;
  },
): "ask" | "suggest" | "fill" {
  if (
    !answer.approved ||
    !answer.answer.trim() ||
    answer.reuse === "never" ||
    answer.kind !== context.kind ||
    answer.questionKey !== context.questionKey
  )
    return "ask";
  if (context.kind === "sensitive") return "ask";
  if (
    context.kind === "company_relationship" ||
    context.kind === "referral" ||
    context.kind === "custom"
  ) {
    if (!context.companyId || answer.companyId !== context.companyId)
      return "ask";
    return "suggest";
  }
  if (context.kind === "work_authorization") {
    if (!context.country || answer.country !== context.country) return "ask";
    return "suggest";
  }
  if (
    context.kind === "experience_story" ||
    answer.profileRevision !== context.profileRevision ||
    answer.reuse === "suggest"
  )
    return "suggest";
  return "fill";
}
