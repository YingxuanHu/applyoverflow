"use client";

import type { ApplicationFlowData, ApplicationFlowRange } from "@/lib/application-flow";

import { ApplicationFlowChart, type FlowSelection } from "./application-flow-chart";

const RANGE_OPTIONS: { value: ApplicationFlowRange; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

type ApplicationFlowSectionProps = {
  id?: string;
  data: ApplicationFlowData;
  range: ApplicationFlowRange;
  onRangeChange: (range: ApplicationFlowRange) => void;
  selected: FlowSelection | null;
  onSelect: (selection: FlowSelection) => void;
};

export function ApplicationFlowSection({
  id,
  data,
  range,
  onRangeChange,
  selected,
  onSelect,
}: ApplicationFlowSectionProps) {
  const isEmpty = data.totalCount === 0;

  return (
    <section
      id={id}
      aria-label="Application flow"
      className="mt-4 rounded-[16px] border border-border/60 bg-muted/15 p-3 sm:p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold text-foreground">Application Flow</h2>

        <div
          role="group"
          aria-label="Chart time range"
          className="inline-flex shrink-0 items-center gap-0.5 self-start rounded-full border border-border/60 bg-card p-0.5 sm:self-auto"
        >
          {RANGE_OPTIONS.map((option) => {
            const isCurrent = option.value === range;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isCurrent}
                onClick={() => onRangeChange(option.value)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${
                  isCurrent
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 rounded-[12px] border border-border/55 bg-card p-2 sm:p-3">
        {isEmpty ? (
          <div className="flex h-[280px] items-center justify-center px-4 text-center text-sm text-muted-foreground">
            No application activity yet.
          </div>
        ) : (
          <ApplicationFlowChart data={data} selected={selected} onSelect={onSelect} />
        )}
      </div>
    </section>
  );
}
