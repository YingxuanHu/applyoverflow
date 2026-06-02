"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { CreateTrackedApplicationForm } from "@/components/dashboard/create-tracked-application-form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ApplicationsOverviewBar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="surface-panel overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5 sm:px-5">
        <div className="flex w-full flex-wrap items-center justify-between gap-2 pr-0 sm:w-auto sm:justify-start sm:pr-2">
          <p className="text-sm font-semibold text-foreground">Add application</p>
          <div className="flex items-center gap-2">
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
