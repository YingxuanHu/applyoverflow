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
