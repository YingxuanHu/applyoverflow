// Career pages very often display their total job count ("87 open positions",
// "Showing 1–20 of 87 jobs"). Extracting that number lets callers reconcile it
// against how many jobs were actually parsed and flag incomplete extraction
// (pagination, JS rendering) instead of silently under-reporting.
//
// Deliberately conservative: only explicit job-count phrasings match, "of N"
// pagination totals win over standalone phrases, and implausible values are
// rejected so employee counts, years, salaries, and "10,000+ jobs" marketing
// banners never produce a count.
import {
  STRIP_TAGS_RE,
  decodeHtmlEntitiesFull,
} from "@/lib/ingestion/html-description";

const MIN_PLAUSIBLE_DISPLAYED_COUNT = 1;
const MAX_PLAUSIBLE_DISPLAYED_COUNT = 20_000;

// A count with optional comma thousands separators.
const COUNT_NUMBER = String.raw`\d{1,3}(?:,\d{3})+|\d+`;
// Blocks mid-number matches ("000" in "10,000") and numbers glued to letters,
// currency symbols, ranges, fractions ("24/7"), or decimals.
const COUNT_GUARD = String.raw`(?<![\da-z,.$£€#/\-\u2010-\u2015])`;
// ASCII hyphen plus the unicode hyphen/dash block (U+2010–U+2015).
const DASH = String.raw`[-\u2010-\u2015]`;
const JOB_NOUN = String.raw`(?:jobs?|positions?|roles?|results?|openings?)`;

type CountPattern = {
  pattern: RegExp;
  // "2026 results" is financial-report noise, not a job count; bare year-like
  // values (no thousands separator) are rejected for the weakest phrasing.
  rejectBareYears?: boolean;
};

// "Showing 1–20 of 87 jobs" / "Displaying 1 to 25 of 111 roles".
const OF_TOTAL_PATTERNS: CountPattern[] = [
  {
    pattern: new RegExp(
      String.raw`${COUNT_GUARD}(?:${COUNT_NUMBER}) ?(?:${DASH}|\bto\b) ?(?:${COUNT_NUMBER}) of ${COUNT_GUARD}(${COUNT_NUMBER}) (?:open )?${JOB_NOUN}\b`,
      "gi"
    ),
  },
];

const JOB_PHRASE_PATTERNS: CountPattern[] = [
  // "87 open positions" / "3 open roles" / "42 open jobs"
  {
    pattern: new RegExp(
      String.raw`${COUNT_GUARD}(${COUNT_NUMBER}) open (?:jobs?|positions?|roles?|opportunit(?:y|ies))\b`,
      "gi"
    ),
  },
  // "12 openings" / "6 current openings" / "9 job openings"
  {
    pattern: new RegExp(
      String.raw`${COUNT_GUARD}(${COUNT_NUMBER}) (?:current |job )?openings?\b`,
      "gi"
    ),
  },
  // "9 jobs available" / "14 positions available"
  {
    pattern: new RegExp(
      String.raw`${COUNT_GUARD}(${COUNT_NUMBER}) (?:jobs?|positions?|roles?) available\b`,
      "gi"
    ),
  },
  // "View all 156 jobs"
  {
    pattern: new RegExp(
      String.raw`\b(?:view|see|browse) all ${COUNT_GUARD}(${COUNT_NUMBER}) (?:open )?${JOB_NOUN}\b`,
      "gi"
    ),
  },
  // "231 results"
  {
    pattern: new RegExp(
      String.raw`${COUNT_GUARD}(${COUNT_NUMBER}) results?\b`,
      "gi"
    ),
    rejectBareYears: true,
  },
];

// "over 500 jobs", "more than 500 jobs", "10,000+ jobs": approximate marketing
// counts, not a displayed board total.
const APPROXIMATE_PREFIX_RE =
  /(?:\b(?:over|than|nearly|almost|about|around|approximately|up ?to)|[~>+])[ ]?$/i;

export function extractDisplayedJobCount(html: string): number | null {
  if (!html) return null;
  const text = htmlToVisibleText(html);
  if (!text) return null;

  // Pagination totals ("of N") are the authoritative signal; standalone
  // phrases can be stale department-level counts, so only their largest
  // plausible value is used as a fallback.
  const ofTotals = collectPlausibleCounts(text, OF_TOTAL_PATTERNS);
  if (ofTotals.length > 0) return Math.max(...ofTotals);

  const phraseCounts = collectPlausibleCounts(text, JOB_PHRASE_PATTERNS);
  if (phraseCounts.length > 0) return Math.max(...phraseCounts);

  return null;
}

// Flag extraction as suspect only when the shortfall is both proportionally
// large (1.5x the fetched count) and absolutely large (at least 5 jobs) so
// tiny boards and rounding noise do not trigger alarms.
export function isJobCountCompletenessSuspect(
  displayedJobCount: number | null,
  fetchedJobCount: number
): boolean {
  return (
    displayedJobCount !== null &&
    displayedJobCount >= fetchedJobCount * 1.5 &&
    displayedJobCount - fetchedJobCount >= 5
  );
}

function collectPlausibleCounts(
  text: string,
  patterns: readonly CountPattern[]
) {
  const counts: number[] = [];
  for (const { pattern, rejectBareYears } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1] ?? "";
      const value = Number.parseInt(raw.replace(/,/g, ""), 10);
      if (!Number.isFinite(value)) continue;
      if (
        value < MIN_PLAUSIBLE_DISPLAYED_COUNT ||
        value > MAX_PLAUSIBLE_DISPLAYED_COUNT
      ) {
        continue;
      }
      if (rejectBareYears && !raw.includes(",") && value >= 1900 && value <= 2099) {
        continue;
      }
      const index = match.index ?? 0;
      if (APPROXIMATE_PREFIX_RE.test(text.slice(Math.max(0, index - 16), index))) {
        continue;
      }
      counts.push(value);
    }
  }
  return counts;
}

// Counts are often split across inline tags ("<b>87</b> open positions"), so
// tags are stripped before matching. Block boundaries become newlines so a
// number in one section never glues onto a job phrase in the next (e.g.
// "Best Workplace 2026" followed by an "Open positions" heading).
function htmlToVisibleText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/\s+/g, " ")
    .replace(
      /<(br|\/p|\/div|\/li|\/ul|\/ol|\/section|\/article|\/h[1-6]|\/t[dhr]|\/table)[^>]*>/gi,
      "\n"
    )
    .replace(STRIP_TAGS_RE, " ");

  return decodeHtmlEntitiesFull(stripped)
    .replace(/\u00a0/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim();
}
