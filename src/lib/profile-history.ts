import { z } from "zod";

// A year without a month remains a year. Unknown dates never become January.
const datePart = z
  .string()
  .regex(/^(?:|(?:19|20|21)\d{2}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?)$/)
  .refine(value => {
    if (value.length !== 10) return true;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Check the calendar date.");
export const historyDatesSchema = z
  .object({
    start: datePart,
    end: datePart,
    current: z.boolean(),
  })
  .strict()
  .superRefine((dates, ctx) => {
    if (dates.current && dates.end) {
      ctx.addIssue({
        code: "custom",
        message: "Current entries cannot have an end date.",
        path: ["end"],
      });
    }
    if (dates.start && dates.end) {
      const earliestStart =
        dates.start.length === 4 ? `${dates.start}-01-01` : dates.start.length === 7 ? `${dates.start}-01` : dates.start;
      const latestEnd = dates.end.length === 4 ? `${dates.end}-12-31` : dates.end.length === 7 ? `${dates.end}-31` : dates.end;
      if (earliestStart > latestEnd) {
        ctx.addIssue({
          code: "custom",
          message: "End date must not be before start date.",
          path: ["end"],
        });
      }
    }
  });

export type ProfileHistoryDates = z.infer<typeof historyDatesSchema>;
export type ProfileHistory = { time: string; dates?: ProfileHistoryDates };
export const HISTORY_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function readHistoryDates(
  value: unknown,
): ProfileHistoryDates | undefined {
  const parsed = historyDatesSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

// Read-only extension projection. Keep legacy profile text unchanged and use
// only explicit, unambiguous endpoints at their original precision.
export function autofillHistoryDates(entry: ProfileHistory): ProfileHistoryDates | undefined {
  if (entry.dates) return readHistoryDates(entry.dates);
  const parts = entry.time.trim().split(/\s+(?:-|--|to)\s+|\s*[\u2013\u2014]\s*/i);
  if (parts.length !== 2) return;
  const parse = (value: string) => {
    if (/^(?:19|20|21)\d{2}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return value;
    const match = /^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.? (?:(\d{1,2}),? )?((?:19|20|21)\d{2})$/i.exec(value);
    if (!match) return;
    const month = HISTORY_MONTHS.findIndex(name => name.toLowerCase() === match[1].slice(0, 3).toLowerCase()) + 1;
    return `${match[3]}-${String(month).padStart(2, "0")}${match[2] ? `-${match[2].padStart(2, "0")}` : ""}`;
  };
  let start = parse(parts[0]);
  const current = /^(?:present|current|now)$/i.test(parts[1]);
  const end = current ? "" : parse(parts[1]);
  if (!start && end && end.length === 7) {
    const sharedYear = parse(`${parts[0]} ${end.slice(0, 4)}`);
    // "Jan - Aug 2025" has one shared year; "Nov - Feb 2025" is
    // ambiguous and must not silently become a previous-year start.
    if (sharedYear?.length === 7 && sharedYear <= end) start = sharedYear;
  }
  return start && end !== undefined ? readHistoryDates({ start, end, current }) : undefined;
}

// Recover a missing major only from explicit program wording, not a school's
// reputation, coursework, or an unrelated minor. User-entered values win.
export function educationFieldOfStudy(entry: { school: string; degree: string; fieldOfStudy?: string }): string {
  if (entry.fieldOfStudy?.trim()) return entry.fieldOfStudy.trim();
  const degree = entry.degree.trim();
  const clean = (value: string) => value.trim().replace(/[.)]+$/, "").trim();
  const explicit = degree.match(/(?:^|[,;(]\s*)(?:major(?:ing)?|field of study|concentration|emphasis|speciali[sz]ation)(?:\s+in)?\s*:?\s+([^;()]+)\)?$/i);
  if (explicit) return clean(explicit[1]).slice(0, 160);
  const parts = degree.split(/\s+(?:&|and|\/)\s+(?=(?:bachelor|master|doctor|BBA|BSc|BA|MBA|MSc)\b)/i);
  const award = "(?:Bachelor(?:'s)?|Master(?:'s)?|Doctor)(?: of)? (?:Science|Arts|Engineering|Business Administration|Commerce|Education|Philosophy)";
  const short = "(?:B\\.?Sc\\.?|B\\.?S\\.?|B\\.?A\\.?|B\\.?Eng\\.?|BBA|M\\.?Sc\\.?|M\\.?S\\.?|M\\.?A\\.?|M\\.?Eng\\.?|MBA|Ph\\.?D\\.?)";
  const qualified = new RegExp(`^(?:${award}|${short})(?:\\s+in\\s+|\\s*[,:(-]\\s*)([^;()]+)\\)?$`, "i");
  const direct = /^(?:Bachelor(?:'s)?|Master(?:'s)?|Doctor) of ([^;(),]+)$/i;
  const subject = (value: string) => {
    const match = value.match(qualified) || value.match(direct);
    if (!match) return "";
    const result = clean(match[1]);
    return /^(?:arts|science|engineering|philosophy|business administration|commerce|education)$/i.test(result) ||
      /\b(?:minor|gpa|honou?rs|university|college|bachelor|master|doctor)\b/i.test(result) ? "" : result;
  };
  if (parts.length === 1) return subject(degree).slice(0, 160);
  const schoolSubject = entry.school.match(/(?:school|department|faculty) of (.+)$/i)?.[1]?.trim().toLowerCase();
  const matches = parts.map(subject).filter(value => value && value.toLowerCase() === schoolSubject);
  return matches.length === 1 ? matches[0].slice(0, 160) : "";
}

export function formatHistoryDates(dates: ProfileHistoryDates): string {
  const label = (part: string) =>
    part.length >= 7
      ? `${HISTORY_MONTHS[Number(part.slice(5, 7)) - 1]}${part.length === 10 ? ` ${Number(part.slice(8))},` : ""} ${part.slice(0, 4)}`
      : part;
  const start = label(dates.start);
  const end = dates.current ? "Present" : label(dates.end);
  if (start && end) return `${start} - ${end}`;
  if (start) return `From ${start}`;
  if (end) return dates.current ? end : `Until ${end}`;
  return "";
}

export function historyDateText(entry: ProfileHistory): string {
  const dates = readHistoryDates(entry.dates);
  return dates ? formatHistoryDates(dates) : entry.time;
}

export function historyValidationError(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const [index, item] of value.entries()) {
    if (
      !item ||
      typeof item !== "object" ||
      !("dates" in item) ||
      item.dates === undefined
    )
      continue;
    const result = historyDatesSchema.safeParse(item.dates);
    if (!result.success)
      return `Entry ${index + 1}: check the start and end dates. Use a four-digit year (1900-2199), with an optional month and day; the end cannot be before the start.`;
  }
  return null;
}

// Importing a second stint at the same employer must not merge it with the first.
export function historyPeriodsMatch(
  left: ProfileHistory,
  right: ProfileHistory,
): boolean {
  const key = (entry: ProfileHistory) =>
    historyDateText(entry).trim().toLowerCase().replace(/\s+/g, " ");
  const a = key(left);
  const b = key(right);
  return !a || !b || a === b;
}
