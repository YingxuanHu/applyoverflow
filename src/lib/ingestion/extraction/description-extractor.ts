import { sanitizeJobDescriptionText } from "@/lib/job-cleanup";
import type { DescriptionExtractionResult } from "@/lib/ingestion/extraction/types";
import type { SourceConnectorJob } from "@/lib/ingestion/types";

const STRONG_DESCRIPTION_SIGNALS = [
  /\bresponsibilities\b/i,
  /\brequirements\b/i,
  /\bqualifications\b/i,
  /\babout the role\b/i,
  /\bwhat you(?:'|’)ll do\b/i,
  /\bwhat you will do\b/i,
  /\bwhat you bring\b/i,
  /\bskills\b/i,
  /\bexperience\b/i,
  /\bbenefits\b/i,
  /\bwho you are\b/i,
  /\bnice to have\b/i,
  /\bminimum qualifications\b/i,
  /\bpreferred qualifications\b/i,
] satisfies RegExp[];

const PAGE_CHROME_SIGNALS = [
  /\bskip to main content\b/i,
  /\bsearch jobs\b/i,
  /\bview all openings\b/i,
  /\bcookie policy\b/i,
  /\bprivacy policy\b/i,
  /\bterms of use\b/i,
  /\bapply now\b/i,
  /\bsign in\b/i,
  /\btalent community\b/i,
  /\bloading\b/i,
  /\berror\b/i,
  /\bjavascript disabled\b/i,
] satisfies RegExp[];

export function extractAndScoreDescription(
  job: Pick<SourceConnectorJob, "description">,
  context?: { title?: string | null; location?: string | null }
): DescriptionExtractionResult {
  try {
    const text = sanitizeJobDescriptionText(job.description, context);
    const wordCount = countWords(text);
    if (!text) {
      return {
        text: null,
        source: "none",
        confidence: 0,
        status: "missing",
        wordCount: 0,
        reasons: [],
        penalties: ["DESCRIPTION_MISSING"],
      };
    }

    const chromeHits = PAGE_CHROME_SIGNALS.filter((pattern) => pattern.test(text)).length;
    const strongHits = STRONG_DESCRIPTION_SIGNALS.filter((pattern) => pattern.test(text)).length;
    const penalties: string[] = [];
    const reasons: string[] = [];
    let confidence = 0.35;

    if (wordCount >= 120 && strongHits > 0) {
      confidence += 0.42;
      reasons.push("role_specific_sections");
    } else if (wordCount >= 50) {
      confidence += 0.25;
      reasons.push("usable_length");
    } else {
      penalties.push("DESCRIPTION_SHORT");
    }

    if (strongHits >= 2) confidence += 0.1;
    if (chromeHits >= 3) {
      penalties.push("DESCRIPTION_PAGE_CHROME");
      confidence -= 0.5;
    } else if (chromeHits > 0 && wordCount < 80) {
      penalties.push("DESCRIPTION_PAGE_CHROME");
      confidence -= 0.35;
    }

    const status: DescriptionExtractionResult["status"] =
      penalties.includes("DESCRIPTION_PAGE_CHROME")
        ? "page_chrome"
        : wordCount >= 120 && strongHits > 0
          ? "strong"
          : wordCount >= 50
            ? "usable"
            : "short";

    return {
      text,
      source: "connector_raw",
      confidence: clamp01(confidence),
      status,
      wordCount,
      reasons,
      penalties,
    };
  } catch {
    return {
      text: null,
      source: "none",
      confidence: 0,
      status: "failed",
      wordCount: 0,
      reasons: [],
      penalties: ["DESCRIPTION_EXTRACTION_FAILED"],
    };
  }
}

function countWords(text: string) {
  return text.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word)).length;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
