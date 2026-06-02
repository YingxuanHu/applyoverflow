const FALLBACK_TIME_ZONE = "America/Toronto";

export const USER_TIME_ZONE_COOKIE = "autoapplication.timeZone";

export function normalizeUserTimeZone(value?: string | null) {
  const candidate = value?.trim();
  const configuredFallback =
    normalizeTimeZone(process.env.APP_TIME_ZONE) ??
    normalizeTimeZone(process.env.TZ) ??
    FALLBACK_TIME_ZONE;

  return normalizeTimeZone(candidate) ?? configuredFallback;
}

export function getStartOfTodayInTimeZone(
  timeZone: string,
  now: Date = new Date()
) {
  const normalizedTimeZone = normalizeUserTimeZone(timeZone);
  const parts = getZonedDateTimeParts(now, normalizedTimeZone);

  return zonedLocalTimeToUtc(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: 0,
      minute: 0,
      second: 0,
    },
    normalizedTimeZone
  );
}

function normalizeTimeZone(value?: string | null) {
  const candidate = value?.trim();
  if (!candidate) return null;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return null;
  }
}

function getZonedDateTimeParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const values = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getZonedDateTimeParts(date, timeZone);
  const zonedAsUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return zonedAsUtcMs - date.getTime();
}

function zonedLocalTimeToUtc(
  localTime: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  },
  timeZone: string
) {
  const localAsUtcMs = Date.UTC(
    localTime.year,
    localTime.month - 1,
    localTime.day,
    localTime.hour,
    localTime.minute,
    localTime.second
  );
  let utcMs = localAsUtcMs;

  for (let index = 0; index < 3; index += 1) {
    const offsetMs = getTimeZoneOffsetMs(new Date(utcMs), timeZone);
    const nextUtcMs = localAsUtcMs - offsetMs;
    if (Math.abs(nextUtcMs - utcMs) < 1000) {
      utcMs = nextUtcMs;
      break;
    }
    utcMs = nextUtcMs;
  }

  return new Date(utcMs);
}

export function parseDateTimeLocalInTimeZone(
  value: string,
  timeZone?: string | null
) {
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);

  if (!match) return null;

  const localTime = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };

  if (
    localTime.month < 1 ||
    localTime.month > 12 ||
    localTime.day < 1 ||
    localTime.day > 31 ||
    localTime.hour < 0 ||
    localTime.hour > 23 ||
    localTime.minute < 0 ||
    localTime.minute > 59 ||
    localTime.second < 0 ||
    localTime.second > 59
  ) {
    return null;
  }

  const utcDate = zonedLocalTimeToUtc(localTime, normalizeUserTimeZone(timeZone));
  const parts = getZonedDateTimeParts(utcDate, normalizeUserTimeZone(timeZone));

  if (
    parts.year !== localTime.year ||
    parts.month !== localTime.month ||
    parts.day !== localTime.day ||
    parts.hour !== localTime.hour ||
    parts.minute !== localTime.minute ||
    parts.second !== localTime.second
  ) {
    return null;
  }

  return utcDate;
}
