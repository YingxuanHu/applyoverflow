"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { splitFilterValues } from "@/lib/filter-values";

type FilterOption = {
  label: string;
  value: string;
};

type JobsFilterDropdownFieldProps = {
  className?: string;
  columnsClassName?: string;
  emptyLabel: string;
  name: string;
  options: FilterOption[];
  selected?: string;
  title: string;
};

export function JobsFilterDropdownField({
  className,
  columnsClassName,
  emptyLabel,
  name,
  options,
  selected,
  title,
}: JobsFilterDropdownFieldProps) {
  const initialValues = useMemo(() => splitFilterValues(selected), [selected]);
  const [selectedValues, setSelectedValues] = useState(initialValues);

  useEffect(() => {
    setSelectedValues(initialValues);
  }, [initialValues]);

  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const selectedLabels = collectSelectedLabels(selectedValues, options);
  const summary = getFilterSummaryText(selectedLabels, emptyLabel);

  const toggleOption = (optionValue: string) => {
    const optionValues = splitFilterValues(optionValue);
    if (optionValues.length === 0) return;

    setSelectedValues((current) => {
      const next = new Set(current);
      const checked = optionValues.every((value) => next.has(value));
      for (const value of optionValues) {
        if (checked) next.delete(value);
        else next.add(value);
      }
      return [...next];
    });
  };

  return (
    <details className={`group rounded-[12px] border border-border/60 bg-card transition open:border-border/80 open:bg-muted/45 ${className ?? ""}`}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.13em] text-muted-foreground">{title}</p>
          <p className="mt-0.5 truncate text-xs text-foreground">{summary}</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedLabels.length > 0 ? (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full border border-border/70 bg-background/80 px-1.5 text-[11px] font-medium text-foreground">
              {selectedLabels.length}
            </span>
          ) : null}
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-90" />
        </div>
      </summary>

      <div className="border-t border-border/60 px-2 py-2">
        {selectedLabels.length > 0 ? (
          <div className="mb-2 flex justify-end">
            <button
              className="text-xs font-medium text-muted-foreground transition hover:text-foreground"
              onClick={() => setSelectedValues([])}
              type="button"
            >
              Clear filter
            </button>
          </div>
        ) : null}
        <div className={`grid gap-1 ${columnsClassName ?? ""}`}>
          {options.map((option) => {
            const optionValues = splitFilterValues(option.value);
            const checked =
              optionValues.length > 0 && optionValues.every((value) => selectedSet.has(value));

            return (
              <label
                className="flex min-h-8 cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-xs text-foreground transition hover:bg-card"
                key={option.label}
              >
                <input
                  checked={checked}
                  className="size-3.5 shrink-0 rounded border-border/70 bg-card"
                  name={name}
                  onChange={() => toggleOption(option.value)}
                  type="checkbox"
                  value={option.value}
                />
                <span className="min-w-0 truncate">{option.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    </details>
  );
}

export function JobsTextFilterField({
  defaultValue,
  name,
  placeholder,
  title,
}: {
  defaultValue: string | undefined;
  name: string;
  placeholder: string;
  title: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [hasValue, setHasValue] = useState(Boolean(defaultValue?.trim()));

  return (
    <div className="rounded-[12px] border border-border/60 bg-card p-3 sm:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <FilterFieldLabel>{title}</FilterFieldLabel>
        {hasValue ? (
          <button
            className="mb-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            onClick={() => {
              if (inputRef.current) inputRef.current.value = "";
              setHasValue(false);
            }}
            type="button"
          >
            Clear filter
          </button>
        ) : null}
      </div>
      <Input
        className="h-9 rounded-[10px] px-2.5 text-xs"
        defaultValue={defaultValue ?? ""}
        name={hasValue ? name : undefined}
        onChange={(event) => setHasValue(Boolean(event.target.value.trim()))}
        placeholder={placeholder}
        ref={inputRef}
      />
    </div>
  );
}

function collectSelectedLabels(current: string[], options: FilterOption[]) {
  const remaining = new Set(current);
  const labels: string[] = [];

  for (const option of options) {
    const optionValues = splitFilterValues(option.value);
    if (optionValues.length > 0 && optionValues.every((value) => remaining.has(value))) {
      labels.push(option.label);
      for (const value of optionValues) {
        remaining.delete(value);
      }
    }
  }

  return labels.concat([...remaining]);
}

function FilterFieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.13em] text-muted-foreground">
      {children}
    </label>
  );
}

function getFilterSummaryText(selectedLabels: string[], emptyLabel: string) {
  if (selectedLabels.length === 0) return emptyLabel;
  if (selectedLabels.length <= 2) return selectedLabels.join(", ");
  return `${selectedLabels[0]}, ${selectedLabels[1]} +${selectedLabels.length - 2}`;
}
