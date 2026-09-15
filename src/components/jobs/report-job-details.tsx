"use client";

import { useId, useState, type FormEvent } from "react";
import { Flag, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { JOB_REPORT_CATEGORIES } from "@/lib/jobs/data-report";

export function ReportJobDetails({ jobId }: { jobId: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/report`, {
        signal: AbortSignal.timeout(20_000),
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: form.get("category"), details: form.get("details") }),
      });
      if (!response.ok) {
        if (response.status === 401) throw new Error("Your session expired. Sign in again before submitting.");
        if (response.status === 429) throw new Error("Report limit reached. Please try again later.");
        throw new Error("Could not submit your report. Please try again.");
      }
      const payload = await response.json() as { status: string };
      setResult(payload.status === "OPEN" ? "Report received for review." : "This issue has already been reviewed.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not submit your report.");
    } finally { setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
    <DialogTrigger className="inline-flex min-h-9 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
      <Flag className="h-3.5 w-3.5" aria-hidden="true" /> Report incorrect details
    </DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
      <DialogTitle className="pr-6">Report job details</DialogTitle>
      <DialogDescription>Reports are checked against the source. Do not include personal or application information.</DialogDescription>
      {result ? <p role="status" className="py-4">{result}</p> : <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-category`} className="block text-sm font-medium">Issue</label>
          <select name="category" id={`${id}-category`} required className="h-10 w-full rounded-lg border border-input bg-background px-3">
            {Object.entries(JOB_REPORT_CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-details`} className="block text-sm font-medium">What looks incorrect?</label>
          <textarea name="details" id={`${id}-details`} required minLength={5} maxLength={500} rows={4} className="w-full resize-y rounded-lg border border-input bg-background p-3" />
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end"><Button disabled={busy} type="submit">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />} Submit report</Button></div>
      </form>}
    </DialogContent>
  </Dialog>;
}
