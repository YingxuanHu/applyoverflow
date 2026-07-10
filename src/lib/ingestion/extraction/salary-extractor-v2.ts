import type { Region } from "@/generated/prisma/client";
import type { SalaryExtractionV2, SalaryPeriod } from "@/lib/ingestion/extraction/types";

const SALARY_KEYWORD_RE =
  /\b(salary|compensation|pay(?:\s+range|\s+details|\s+rate)?|base pay|base salary|hourly|wage|annual|per year|per hour|cad|usd|eur|gbp)\b/i;
const NOT_DISCLOSED_RE =
  /\b(salary|compensation|pay)\s+(?:is\s+)?(?:not\s+(?:listed|disclosed|available|provided)|undisclosed|competitive)\b/i;
const MONEY_RE =
  /(?:([$€£])|\b(USD|CAD|EUR|GBP|AUD|NZD|US\$|CA\$|C\$)\b)\s*(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?/g;
const RANGE_RE =
  /(?:(?:[$€£]|\b(?:USD|CAD|EUR|GBP|AUD|NZD|US\$|CA\$|C\$)\b)\s*)?\d[\d,]*(?:\.\d+)?\s*[kKmM]?\s*(?:-|–|—|to)\s*(?:(?:[$€£]|\b(?:USD|CAD|EUR|GBP|AUD|NZD|US\$|CA\$|C\$)\b)\s*)?\d[\d,]*(?:\.\d+)?\s*[kKmM]?/i;
const RANGE_WITH_PERIOD_RE =
  /\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:\/|\bper\b)\s*(?:hr|hour|yr|year|day|week|month))?\s*(?:-|–|—|to)\s*\d[\d,]*(?:\.\d+)?\s*[kKmM]?(?:\s*(?:\/|\bper\b)\s*(?:hr|hour|yr|year|day|week|month))?/i;
const PLAIN_AMOUNT_RE = /\b\d[\d,]*(?:\.\d+)?\s*[kKmM]?\b/g;
const BAD_CONTEXT_RE =
  /\b(401k|401\(k\)|years? of experience|founded in|employees|users|customers|revenue|valuation|funding|series [a-z]|job id|requisition)\b/i;

// Any annualized salary below this floor is implausible as a yearly figure and
// almost certainly a shorter-period value (hourly/weekly/etc.); above the
// ceiling it is noise. Both the structured and text/regex branches share these
// bounds so they guard consistently.
const ANNUAL_SALARY_FLOOR = 10_000;
const ANNUAL_SALARY_CEILING = 5_000_000;

const PERIOD_HINTS: Array<{ period: NonNullable<SalaryPeriod>; pattern: RegExp; multiplier: number }> = [
  { period: "hour", pattern: /\b(per\s+hour|\/\s*hour|hourly|per\s+hr|\/\s*hr)\b/i, multiplier: 2080 },
  { period: "day", pattern: /\b(per\s+day|\/\s*day|daily)\b/i, multiplier: 260 },
  { period: "week", pattern: /\b(per\s+week|\/\s*week|weekly)\b/i, multiplier: 52 },
  { period: "month", pattern: /\b(per\s+month|\/\s*month|monthly)\b/i, multiplier: 12 },
  { period: "year", pattern: /\b(per\s+year|\/\s*year|annually|annual|yearly|base salary range)\b/i, multiplier: 1 },
];

export function extractSalaryV2(input: {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  description?: string | null;
  regionHint?: Region | null;
}): SalaryExtractionV2 {
  if (input.salaryMin != null || input.salaryMax != null) {
    const min = input.salaryMin ?? input.salaryMax ?? null;
    const max = input.salaryMax ?? input.salaryMin ?? null;
    // Structured min/max carry no period, so they are treated as annual. A
    // value below the annual floor (e.g. an hourly 45) would otherwise be
    // emitted as $45/year. Refuse to annualize it — mark it ambiguous instead —
    // mirroring the plausibility floor the text/regex branch applies. Genuine
    // annual values pass through untouched.
    if ([min, max].some((value) => value != null && value < ANNUAL_SALARY_FLOOR)) {
      return emptySalary("ambiguous", ["structured_salary_below_annual_floor"]);
    }
    return {
      min,
      max,
      currency: normalizeCurrencyCode(input.salaryCurrency) ?? inferDefaultCurrency(input.regionHint),
      period: "year",
      annualizedMin: min,
      annualizedMax: max,
      rawText: null,
      source: "structured",
      status: "present",
      confidence: 0.95,
      reasons: ["structured_salary"],
      penalties: [],
    };
  }

  const text = input.description?.trim() ?? "";
  if (!text) return emptySalary("not_found", ["description_missing"]);
  if (NOT_DISCLOSED_RE.test(text)) {
    return {
      ...emptySalary("not_disclosed", ["salary_explicitly_not_disclosed"]),
      rawText: text.match(NOT_DISCLOSED_RE)?.[0] ?? "Salary not disclosed",
      confidence: 0.9,
    };
  }

  const snippets = collectSalarySnippets(text);
  let best: SalaryExtractionV2 | null = null;
  for (const snippet of snippets) {
    const parsed = parseSalarySnippet(snippet, input);
    if (!parsed) continue;
    if (!best || parsed.confidence > best.confidence) best = parsed;
  }

  if (best) return best;
  if (/\d[\d,]*(?:\.\d+)?\s*[kKmM]?\s*(?:-|–|—|to)\s*\d/i.test(text) && SALARY_KEYWORD_RE.test(text)) {
    return emptySalary("failed_parse", ["salary_context_failed_parse"]);
  }
  if (MONEY_RE.test(text) && SALARY_KEYWORD_RE.test(text)) {
    MONEY_RE.lastIndex = 0;
    return emptySalary("ambiguous", ["salary_like_money_ambiguous"]);
  }
  MONEY_RE.lastIndex = 0;
  return emptySalary("not_found", ["no_salary_context"]);
}

function parseSalarySnippet(
  snippet: string,
  input: {
    salaryCurrency: string | null;
    regionHint?: Region | null;
  }
): SalaryExtractionV2 | null {
  if (!snippet || BAD_CONTEXT_RE.test(snippet)) return null;
  const hasKeyword = SALARY_KEYWORD_RE.test(snippet);
  const hasRange = RANGE_RE.test(snippet) || RANGE_WITH_PERIOD_RE.test(snippet);
  if (!hasKeyword && !hasRange) return null;

  let amounts = [...snippet.matchAll(MONEY_RE)].map((match) => ({
    amount: parseAmountToken(match[3] ?? "", match[4] ?? ""),
    currency: inferCurrencyFromToken(match[1], match[2]),
  }));
  MONEY_RE.lastIndex = 0;
  if (amounts.length < 2 && hasRange && (hasKeyword || MONEY_RE.test(snippet))) {
    MONEY_RE.lastIndex = 0;
    amounts = [...snippet.matchAll(PLAIN_AMOUNT_RE)]
      .filter((match) => !isYearLikeToken(match[0]))
      .slice(0, 2)
      .map((match) => {
        const parsed = match[0].trim().match(/^(\d[\d,]*(?:\.\d+)?)\s*([kKmM])?$/);
        return {
          amount: parseAmountToken(parsed?.[1] ?? "", parsed?.[2] ?? ""),
          currency: null,
        };
      });
    PLAIN_AMOUNT_RE.lastIndex = 0;
  }
  const numericAmounts = amounts.map((entry) => entry.amount).filter((value): value is number => value != null);
  if (numericAmounts.length === 0) return null;

  const period = detectSalaryPeriod(snippet);
  const multiplier = periodToMultiplier(period);
  const annualized = numericAmounts.map((amount) => Math.round(amount * multiplier));
  const plausible = annualized.filter(
    (amount) => amount >= ANNUAL_SALARY_FLOOR && amount <= ANNUAL_SALARY_CEILING
  );
  if (plausible.length === 0) return null;

  const min = numericAmounts[0] ?? null;
  const max = numericAmounts[1] ?? numericAmounts[0] ?? null;
  const annualizedMin = plausible[0] ?? null;
  const annualizedMax = plausible[1] ?? plausible[0] ?? null;
  if (!min || !max || !annualizedMin || !annualizedMax || annualizedMax < annualizedMin) {
    return null;
  }

  const currency =
    amounts.map((entry) => entry.currency).find(Boolean) ??
    normalizeCurrencyCode(input.salaryCurrency) ??
    inferDefaultCurrency(input.regionHint);
  const reasons = ["salary_context"];
  if (hasRange) reasons.push("salary_range");
  if (period) reasons.push(`salary_period_${period}`);

  return {
    min,
    max,
    currency,
    period: period ?? "year",
    annualizedMin,
    annualizedMax,
    rawText: snippet,
    source: "description_regex",
    status: "present",
    confidence: clamp01(0.58 + (hasKeyword ? 0.18 : 0) + (hasRange ? 0.14 : 0) + (period ? 0.08 : 0)),
    reasons,
    penalties: [],
  };
}

function collectSalarySnippets(raw: string) {
  const normalized = raw
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = normalized.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
  const snippets = new Set<string>();
  for (const sentence of sentences) {
    if (SALARY_KEYWORD_RE.test(sentence) || RANGE_RE.test(sentence)) {
      snippets.add(sentence.slice(0, 500));
    }
  }
  if (snippets.size === 0 && (SALARY_KEYWORD_RE.test(normalized) || RANGE_RE.test(normalized))) {
    snippets.add(normalized.slice(0, 500));
  }
  return [...snippets];
}

function detectSalaryPeriod(snippet: string): SalaryPeriod {
  for (const hint of PERIOD_HINTS) {
    if (hint.pattern.test(snippet)) return hint.period;
  }
  return null;
}

function periodToMultiplier(period: SalaryPeriod) {
  return PERIOD_HINTS.find((hint) => hint.period === period)?.multiplier ?? 1;
}

function parseAmountToken(rawValue: string, rawSuffix: string) {
  const value = Number(rawValue.replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  if (/m/i.test(rawSuffix)) return value * 1_000_000;
  if (/k/i.test(rawSuffix)) return value * 1_000;
  return value;
}

function isYearLikeToken(token: string) {
  const numeric = Number(token.replace(/,/g, ""));
  return Number.isInteger(numeric) && numeric >= 1900 && numeric <= 2100;
}

function inferCurrencyFromToken(symbol: string | undefined, code: string | undefined) {
  const raw = `${symbol ?? ""}${code ?? ""}`.toUpperCase();
  if (raw.includes("CAD") || raw.includes("CA$") || raw.includes("C$")) return "CAD";
  if (raw.includes("USD") || raw.includes("US$")) return "USD";
  if (raw.includes("EUR") || raw.includes("€")) return "EUR";
  if (raw.includes("GBP") || raw.includes("£")) return "GBP";
  if (raw.includes("AUD")) return "AUD";
  if (raw.includes("NZD")) return "NZD";
  if (raw.includes("$")) return null;
  return null;
}

function normalizeCurrencyCode(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

function inferDefaultCurrency(region: Region | null | undefined) {
  if (region === "CA") return "CAD";
  if (region === "US") return "USD";
  return "USD";
}

function emptySalary(status: SalaryExtractionV2["status"], reasons: string[]): SalaryExtractionV2 {
  return {
    min: null,
    max: null,
    currency: null,
    period: null,
    annualizedMin: null,
    annualizedMax: null,
    rawText: null,
    source: "none",
    status,
    confidence: status === "not_found" ? 0.7 : 0.45,
    reasons,
    penalties: [],
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
