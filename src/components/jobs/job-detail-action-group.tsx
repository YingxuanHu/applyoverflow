"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";

import { JobCardActions } from "@/components/jobs/job-card-actions";
import { Button } from "@/components/ui/button";
import { MarkAppliedButton } from "@/components/jobs/mark-applied-button";

type JobDetailActionGroupProps = {
  applyHref: string | null;
  initialApplied: boolean;
  initialSaved: boolean;
  jobId: string;
};

export function JobDetailActionGroup({
  applyHref,
  initialApplied,
  initialSaved,
  jobId,
}: JobDetailActionGroupProps) {
  const [isApplied, setIsApplied] = useState(initialApplied);
  const [isSaved, setIsSaved] = useState(initialSaved);

  return (
    <div className="flex w-full shrink-0 flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
      {isApplied ? (
        <span className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 text-[13px] font-medium text-emerald-700 dark:text-emerald-300 sm:h-8">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          Applied
        </span>
      ) : (
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
          <JobCardActions
            key={`${jobId}-${isSaved ? "saved" : "unsaved"}`}
            align="end"
            compact
            initialSaved={isSaved}
            jobId={jobId}
            onSavedChange={setIsSaved}
          />
          <MarkAppliedButton jobId={jobId} applied={isApplied} onApplied={() => {
            setIsApplied(true);
            setIsSaved(false);
          }} />
        </div>
      )}

      {applyHref ? (
        <Button
          className="h-11 w-full rounded-full px-4 sm:h-8 sm:w-auto"
          render={<a href={applyHref} rel="noreferrer" target="_blank" />}
          size="sm"
        >
          Apply
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      ) : (
        <Button className="h-11 w-full rounded-full px-4 sm:h-8 sm:w-auto" disabled size="sm" type="button">
          Apply unavailable
        </Button>
      )}
    </div>
  );
}
