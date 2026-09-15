"use client";

import { useState } from "react";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { useNotifications } from "@/components/ui/notification-provider";

export function MarkAppliedButton({ jobId, applied, onApplied }: {
  jobId: string;
  applied: boolean;
  onApplied: () => void;
}) {
  const router = useRouter();
  const { notify } = useNotifications();
  const [pending, setPending] = useState(false);

  async function markApplied() {
    if (applied || pending) return;
    setPending(true);
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/mark-applied`, { method: "POST" });
      if (!response.ok) throw new Error("Could not mark applied");
      onApplied();
      notify({ title: "Marked as applied", message: "This job is now tracked in Applications.", tone: "success" });
      router.refresh();
    } catch {
      notify({ title: "Could not mark applied", message: "Please try again.", tone: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Button className="h-10" size="sm" variant="outline" type="button" disabled={applied || pending} onClick={markApplied}>
      {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
      {applied ? "Applied" : pending ? "Saving..." : "Mark applied"}
    </Button>
  );
}
