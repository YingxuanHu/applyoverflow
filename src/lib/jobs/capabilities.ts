import { buildDescriptionPresentation } from "@/lib/jobs/description-presentation";

const CAPABILITIES: Array<[string, RegExp]> = [
  ["typescript", /\btypescript\b/i],
  ["javascript", /\bjavascript\b/i],
  ["react", /\breact(?:\.js)?\b/i],
  ["python", /\bpython\b/i],
  ["java", /\bjava\b/i],
  ["sql", /\b(?:sql|postgresql|mysql)\b/i],
  ["aws", /\b(?:aws|amazon web services)\b/i],
  ["kubernetes", /\b(?:kubernetes|k8s)\b/i],
  ["figma", /\bfigma\b/i],
  ["excel", /\b(?:microsoft )?excel\b/i],
  ["salesforce", /\bsalesforce\b/i],
  ["tableau", /\btableau\b/i],
  ["financial reporting", /\bfinancial (?:reporting|statements)\b/i],
  ["reconciliation", /\breconcil(?:iation|iations|ing|e)\b/i],
  ["financial modeling", /\bfinancial modell?ing\b/i],
  ["gaap", /\bgaap\b/i],
  ["ifrs", /\bifrs\b/i],
  ["budgeting", /\bbudget(?:ing| planning| management)\b/i],
  ["forecasting", /\bforecast(?:ing|s)\b/i],
  ["recruiting", /\b(?:recruiting|recruitment|talent acquisition)\b/i],
  ["employee relations", /\bemployee relations\b/i],
  ["payroll", /\bpayroll\b/i],
  ["hris", /\b(?:hris|human resources information systems?)\b/i],
  ["seo", /\b(?:seo|search engine optimization)\b/i],
  ["content strategy", /\bcontent strateg(?:y|ies)\b/i],
  [
    "campaign management",
    /\b(?:campaign management|manage.{0,20}campaigns)\b/i,
  ],
  ["market research", /\bmarket research\b/i],
  ["contract review", /\b(?:contract review|review.{0,20}contracts)\b/i],
  ["legal research", /\blegal research\b/i],
  ["regulatory compliance", /\bregulatory compliance\b/i],
  ["privacy", /\b(?:data privacy|gdpr|pipeda)\b/i],
  ["procurement", /\b(?:procurement|strategic sourcing)\b/i],
  ["supply chain", /\bsupply chain\b/i],
  ["project management", /\bproject management\b/i],
  ["process improvement", /\bprocess improvement\b/i],
  ["customer success", /\bcustomer success\b/i],
  ["account management", /\baccount management\b/i],
  ["grant writing", /\bgrant writing\b/i],
  ["policy analysis", /\bpolicy (?:analysis|research)\b/i],
  ["underwriting", /\bunderwriting\b/i],
  ["claims management", /\bclaims management\b/i],
  ["fundraising", /\bfundrais(?:ing|er)\b/i],
  ["copy editing", /\bcopy[- ]?edit(?:ing|or)\b/i],
];
export function extractCapabilities(text: string) {
  return CAPABILITIES.filter(([, pattern]) => pattern.test(text)).map(
    ([name]) => name,
  );
}
export function capabilityEvidence(description: string) {
  const { sections } = buildDescriptionPresentation(description);
  return sections.flatMap((section, sectionIndex) =>
    section.blocks.flatMap((block, blockIndex) => {
      const texts =
        block.kind === "list"
          ? block.items
          : block.kind === "paragraph"
            ? [block.text]
            : [];
      return texts.flatMap((text, itemIndex) => {
        // An explicit negation is not a requirement, even under a Requirements heading.
        if (/\b(?:not required|no experience|not necessary)\b/i.test(text))
          return [];
        return extractCapabilities(text).map((skill) => ({
          skill,
          text,
          sectionIndex,
          blockIndex,
          itemIndex,
          category: /\b(?:preferred|nice.to.have|a plus|bonus)\b/i.test(text)
            ? "preferred"
            : section.category,
        }));
      });
    }),
  );
}
