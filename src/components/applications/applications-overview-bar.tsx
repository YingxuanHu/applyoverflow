"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { CreateTrackedApplicationForm } from "@/components/dashboard/create-tracked-application-form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ApplicationsOverviewBarProps = {
  shownCount: number;
  totalCount: number;
  activeCount: number;
  expiredCount: number;
};

export function ApplicationsOverviewBar({
  shownCount,
  totalCount,
  activeCount,
  expiredCount,
}: ApplicationsOverviewBarProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="surface-panel overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5 sm:px-5">
        <div className="flex w-full items-center justify-between gap-2 pr-0 sm:w-auto sm:justify-start sm:pr-2">
          <p className="text-sm font-semibold text-foreground">Applications overview</p>
          <Button
            type="button"
            size="sm"
            variant={isOpen ? "secondary" : "outline"}
            aria-expanded={isOpen}
            aria-controls="manual-application-form"
            aria-label={isOpen ? "Hide add application form" : "Show add application form"}
            onClick={() => setIsOpen((value) => !value)}
            className="h-8 rounded-full px-2.5 text-xs"
          >
            <Plus className={cn("size-4 transition-transform", isOpen && "rotate-45")} />
            <span>{isOpen ? "Close" : "Add"}</span>
          </Button>
        </div>

        <div className="grid w-full grid-cols-4 gap-2 text-left sm:ml-auto sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end sm:gap-x-6 sm:gap-y-2 sm:text-right">
          <StatsPill count={shownCount} label="shown" />
          <StatsPill count={totalCount} label="total" />
          <StatsPill count={activeCount} label="active" />
          <StatsPill count={expiredCount} label="expired" />
        </div>
      </div>

      {isOpen ? (
        <div
          id="manual-application-form"
          className="border-t border-border/70 bg-muted/35 px-4 py-4 sm:px-5"
        >
          <CreateTrackedApplicationForm />
        </div>
      ) : null}
    </section>
  );
}

function StatsPill({ count, label }: { count: number; label: string }) {
  return (
    <p className="min-w-0 rounded-[12px] bg-muted/35 px-2.5 py-2 text-xs text-muted-foreground sm:bg-transparent sm:px-0 sm:py-0 sm:text-sm">
      <span className="block truncate text-lg font-semibold leading-none text-foreground sm:inline sm:text-xl sm:leading-normal">
        {count}
      </span>
      <span className="mt-0.5 block truncate sm:ml-1 sm:mt-0 sm:inline">{label}</span>
    </p>
  );
}
