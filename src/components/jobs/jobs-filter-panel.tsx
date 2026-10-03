"use client";

import { useRef, useState, type ReactNode, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  countActiveJobFilters,
  parseJobFilters,
} from "@/lib/jobs/search-params";
import { normalizeJobsStateQuery } from "@/lib/jobs/search-state";
import { showJobsLoadingPopup } from "./jobs-navigation-pending-boundary";

export function JobsFilterPanel({
  children,
  activeCount,
  basePath = "/jobs",
  formId,
  utilities,
}: {
  children: ReactNode;
  activeCount: number;
  basePath?: "/jobs" | "/jobs/top-picks";
  formId: string;
  utilities?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [draftCount, setDraftCount] = useState(activeCount);
  const formRef = useRef<HTMLFormElement>(null);

  function readParams(form: HTMLFormElement) {
    return new URLSearchParams(
      [...new FormData(form)].map(([key, value]) => [key, String(value)]),
    );
  }

  function validateSalary(form: HTMLFormElement) {
    const min = form.elements.namedItem("salaryMin") as HTMLInputElement | null;
    const max = form.elements.namedItem("salaryMax") as HTMLInputElement | null;
    max?.setCustomValidity(
      min?.value && max.value && Number(min.value) > Number(max.value)
        ? "Maximum salary must be at least the minimum salary."
        : "",
    );
  }

  function updateDraft() {
    // Controlled multi-selects commit their checkbox state after this event.
    requestAnimationFrame(() => {
      if (!formRef.current) return;
      validateSalary(formRef.current);
      setDraftCount(
        countActiveJobFilters(parseJobFilters(readParams(formRef.current))),
      );
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    validateSalary(form);
    if (!form.reportValidity()) return;
    const params = readParams(form);
    params.delete("page");
    const query = normalizeJobsStateQuery(params, { includePage: false });
    const href = query ? `${basePath}?${query}` : `${basePath}?reset=1`;
    setOpen(false);
    showJobsLoadingPopup(href);
    router.push(href);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSession((value) => value + 1);
          setDraftCount(activeCount);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button className="h-11 w-full gap-2 sm:w-auto" variant="outline" />
        }
      >
        <SlidersHorizontal className="size-4 text-muted-foreground" />
        Filters
        {activeCount > 0 ? (
          <span className="min-w-5 rounded-full bg-primary px-1.5 text-[11px] text-primary-foreground">
            {activeCount}
          </span>
        ) : null}
      </DialogTrigger>
      <DialogContent
        className="flex max-h-[min(88dvh,48rem)] flex-col gap-0 overflow-hidden rounded-lg p-0 sm:max-w-xl"
        aria-describedby={undefined}
      >
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-4 pr-12">
          <DialogTitle>
            {basePath === "/jobs" ? "Refine jobs" : "Refine picks"}
          </DialogTitle>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {draftCount} selected
          </span>
        </div>
        <form
          action={basePath}
          id={formId}
          key={session}
          method="get"
          ref={formRef}
          className="flex min-h-0 flex-1 flex-col"
          onChange={updateDraft}
          onClick={updateDraft}
          onSubmit={submit}
        >
          <div className="min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-4">
            {children}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-muted/30 p-3 sm:px-4">
            <div>{utilities}</div>
            <div className="flex gap-2">
              <DialogClose render={<Button variant="ghost" type="button" />}>
                Cancel
              </DialogClose>
              <Button type="submit">Apply filters</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
