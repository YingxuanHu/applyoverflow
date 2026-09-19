"use client";

import { useId } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  HISTORY_MONTHS,
  historyDateText,
  historyDatesSchema,
  type ProfileHistory,
  type ProfileHistoryDates,
} from "@/lib/profile-history";

export function HistoryDatesFields({
  value,
  onChange,
  currentLabel,
}: {
  value: ProfileHistory;
  onChange: (value: ProfileHistory) => void;
  currentLabel: string;
}) {
  const id = useId();
  if (!value.dates)
    return (
      <div className="space-y-2">
        <label htmlFor={`${id}-text`} className="block text-sm font-medium">
          Dates
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={`${id}-text`}
            className="min-w-40 flex-1"
            maxLength={100}
            placeholder="Date range (optional)"
            value={value.time}
            onChange={(event) => onChange({ time: event.target.value })}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange({
                ...value,
                dates: { start: "", end: "", current: false },
              })
            }
          >
            <CalendarDays className="size-4" />
            Set dates
          </Button>
        </div>
      </div>
    );
  const dates = value.dates;
  const setDates = (patch: Partial<ProfileHistoryDates>) =>
    onChange({ ...value, dates: { ...dates, ...patch } });
  const validation = historyDatesSchema.safeParse(dates);
  return (
    <fieldset
      className="min-w-0 space-y-3"
      aria-describedby={!validation.success ? `${id}-error` : undefined}
    >
      <legend className="mb-2 text-sm font-medium">Dates</legend>
      {value.time && (
        <p className="break-words text-xs text-muted-foreground">
          Previous date text: {value.time}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {(["start", "end"] as const).map((key) => {
          const [year = "", month = ""] = dates[key].split("-");
          const disabled = key === "end" && dates.current;
          const label = key === "start" ? "Start" : "End";
          return (
            <div className="min-w-0 space-y-1.5" key={key}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
                <select
                  aria-label={`${label} month`}
                  value={month}
                  disabled={disabled}
                  className="h-10 min-w-0 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                  onChange={(event) =>
                    setDates({
                      [key]: event.target.value
                        ? `${year}-${event.target.value}`
                        : year,
                    })
                  }
                >
                  <option value="">Month unknown</option>
                  {HISTORY_MONTHS.map((name, index) => (
                    <option
                      key={name}
                      value={String(index + 1).padStart(2, "0")}
                    >
                      {name}
                    </option>
                  ))}
                </select>
                <Input
                  aria-label={`${label} year`}
                  inputMode="numeric"
                  placeholder="Year"
                  maxLength={4}
                  disabled={disabled}
                  value={year}
                  onChange={(event) =>
                    setDates({
                      [key]: month
                        ? `${event.target.value}-${month}`
                        : event.target.value,
                    })
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={dates.current}
            onChange={(event) =>
              setDates({ current: event.target.checked, end: "" })
            }
          />
          {currentLabel}
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            onChange({ time: historyDateText(value), dates: undefined })
          }
        >
          Use date text
        </Button>
      </div>
      {!validation.success && (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          Check the years (1900-2199) and date order. Months are optional.
        </p>
      )}
    </fieldset>
  );
}
