import { getCleanJobDescriptionDisplayBlocks, type DescriptionBlock } from "@/lib/job-description-format";
import { descriptionMetadata } from "@/lib/jobs/description-text-structure";

type DescriptionCategory = "overview" | "responsibilities" | "requirements" | "preferred" | "compensation" | "benefits" | "other";
export type ReadableDescriptionSection = { heading: string | null; category: DescriptionCategory; blocks: DescriptionBlock[] };

function categorize(heading: string): DescriptionCategory {
  const text = heading.toLowerCase().replace(/[’']/g, "");
  if (/preferred|nice to have|bonus|atout|souhait/.test(text) || text === "desired") return "preferred";
  if (/compensation|salary|pay details|rémunération|salaire/.test(text)) return "compensation";
  if (/benefits|what we offer|perks|avantages/.test(text)) return "benefits";
  if (/responsibilit|what you(?:ll| will) do|missions|your impact/.test(text)) return "responsibilities";
  if (/requirement|qualification|what you.*bring|who you are|skills|exigences|profil recherché/.test(text) || text === "minimum" || text === "required") return "requirements";
  if (/about.*(?:role|job)|overview|summary|description/.test(text)) return "overview";
  return "other";
}

export function buildDescriptionPresentation(raw: string) {
  const sections: ReadableDescriptionSection[] = [];
  for (const block of getCleanJobDescriptionDisplayBlocks(raw)) {
    if (block.kind === "header") {
      sections.push({ heading: block.text, category: categorize(block.text), blocks: [] });
    } else {
      if (!sections.length) sections.push({ heading: null, category: "overview", blocks: [] });
      sections.at(-1)!.blocks.push(block);
    }
  }
  const highlights: Array<{ label: string; text: string; sectionIndex: number }> = [];
  const priority: DescriptionCategory[] = ["requirements", "responsibilities", "compensation", "benefits", "preferred"];
  for (const category of priority) {
    const sectionIndex = sections.findIndex((section) => section.category === category && section.blocks.length);
    if (sectionIndex < 0) continue;
    const section = sections[sectionIndex];
    const first = section.blocks[0];
    let text = first.kind === "list" ? first.items[0] : first.kind === "paragraph" ? first.text : "";
    // Salary bounds need their locality, maximum and alternatives, not just the first minimum.
    if (category === "compensation" && descriptionMetadata(text)) {
      text = section.blocks.map((block) => block.kind === "paragraph" ? block.text : block.kind === "list" ? block.items.join(" ") : "").join(" ");
    }
    // Only complete, verbatim blocks; no generated claims or truncated requirements.
    if (!text || text.length > 320) continue;
    highlights.push({ label: section.heading!, text, sectionIndex });
    if (highlights.length === 3) break;
  }
  return { sections, highlights: sections.length >= 3 && highlights.length >= 2 ? highlights : [] };
}
