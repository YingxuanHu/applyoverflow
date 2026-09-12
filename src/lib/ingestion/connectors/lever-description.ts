import { descriptionHtmlToText } from "@/lib/jobs/description-html";

export type LeverDescription = {
  description?: string | null;
  descriptionPlain?: string | null;
  opening?: string | null;
  openingPlain?: string | null;
  descriptionBody?: string | null;
  descriptionBodyPlain?: string | null;
  lists?: Array<{ text?: string | null; content?: string | null }> | null;
  additional?: string | null;
  additionalPlain?: string | null;
  salaryDescription?: string | null;
  salaryDescriptionPlain?: string | null;
};

export function buildLeverDescription(job: LeverDescription): string {
  const read = (html?: string | null, plain?: string | null) =>
    descriptionHtmlToText(html?.trim() || plain?.trim() || "");
  // Lever's description already includes opening + descriptionBody.
  const overview = read(job.description, job.descriptionPlain) ||
    [read(job.opening, job.openingPlain), read(job.descriptionBody, job.descriptionBodyPlain)].filter(Boolean).join("\n\n");
  const lists = (job.lists ?? []).map((list) => {
    const heading = read(list.text);
    const content = read(list.content);
    return [heading ? `## ${heading}` : "", content].filter(Boolean).join("\n\n");
  });
  return [overview, ...lists, read(job.additional, job.additionalPlain), read(job.salaryDescription, job.salaryDescriptionPlain)]
    .filter(Boolean).join("\n\n");
}
