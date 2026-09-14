"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { TopPickCardData } from "@/lib/queries/top-picks";

type HiddenPick = { jobId: string; job: { title: string; company: string } };

export function HiddenPicks({
  dismissed,
  onRestore,
}: {
  dismissed: TopPickCardData | null;
  onRestore: (id: string, restored: boolean) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<HiddenPick[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setOpen(true);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/jobs/top-picks/feedback", {
        cache: "no-store",
      });
      if (!response.ok) throw new Error();
      setRows((await response.json()).data);
    } catch {
      setError("Could not load hidden picks. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function restore(jobId: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/jobs/top-picks/feedback", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!response.ok) throw new Error();
      const payload = await response.json();
      setRows(
        (current) => current?.filter((row) => row.jobId !== jobId) ?? null,
      );
      onRestore(jobId, payload.restored === true);
      router.refresh();
    } catch {
      setError("Could not restore this pick. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="status">
          {dismissed ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              Hidden: {dismissed.job.title}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void restore(dismissed.job.id)}
              >
                <RotateCcw className="size-3.5" /> Undo
              </Button>
            </span>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => (open ? setOpen(false) : void load())}
          aria-expanded={open}
        >
          {open ? "Close hidden picks" : "Hidden picks"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {open ? (
        <section
          aria-label="Hidden picks"
          className="mt-2 max-h-72 overflow-y-auto border-y border-border"
        >
          {busy && !rows ? (
            <p className="py-3" role="status">
              Loading hidden picks...
            </p>
          ) : null}
          {rows?.length === 0 ? (
            <p className="py-3 text-muted-foreground">No hidden picks.</p>
          ) : null}
          {rows?.map((row) => (
            <div
              key={row.jobId}
              className="flex items-center justify-between gap-3 border-b border-border/50 py-3"
            >
              <span className="min-w-0 break-words">
                {row.job.title}
                <span className="block text-xs text-muted-foreground">
                  {row.job.company}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void restore(row.jobId)}
              >
                <RotateCcw className="size-3.5" /> Restore
              </Button>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
