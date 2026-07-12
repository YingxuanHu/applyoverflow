"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";

import { JobCardActions } from "@/components/jobs/job-card-actions";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/components/ui/notification-provider";

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
  const router = useRouter();
  const { notify } = useNotifications();
  const [isApplied, setIsApplied] = useState(initialApplied);
  const [isSaved, setIsSaved] = useState(initialSaved);
  const [isMarkingApplied, setIsMarkingApplied] = useState(false);

  function markApplied() {
    if (isApplied || isMarkingApplied) return;

    setIsMarkingApplied(true);
    fetch(`/api/jobs/${jobId}/mark-applied`, { method: "POST" })
      .then((response) => {
        if (!response.ok) throw new Error("mark applied failed");
        setIsApplied(true);
        setIsSaved(false);
        notify({
          title: "Marked as applied",
          message: "This job is now tracked in Applications.",
          tone: "success",
        });
        router.refresh();
      })
      .catch((error) => {
        console.error(error);
        notify({
          title: "Could not mark applied",
          message: "Try again from the job page.",
          tone: "error",
        });
      })
      .finally(() => {
        setIsMarkingApplied(false);
      });
  }

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
          <Button
            className="h-10 rounded-full border border-border/60 bg-background/75 px-3 text-[13px] font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground sm:h-8"
            disabled={isMarkingApplied}
            onClick={markApplied}
            size="sm"
            type="button"
            variant="ghost"
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            {isMarkingApplied ? "Saving..." : "Mark applied"}
          </Button>
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
