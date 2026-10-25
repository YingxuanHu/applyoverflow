"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/components/ui/notification-provider";
import { AUTO_APPLY_HREF } from "@/lib/navigation/jobs-workspace";

export function QueueApplicationButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const { notify } = useNotifications();
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  async function queue() {
    if (running.current) return;
    running.current = true; setPending(true);
    try {
      const response = await fetch("/api/applications/auto-apply", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "queue", id: jobId }),
      });
      if (response.status === 401) {
        router.push(`/sign-in?callbackUrl=${encodeURIComponent(`/jobs/${jobId}`)}`);
        return;
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not queue this application.");
      router.push(`${AUTO_APPLY_HREF}?application=${encodeURIComponent(result.id)}`);
    } catch (cause) {
      notify({ title: "Application not queued", message: cause instanceof Error ? cause.message : "Please try again.", tone: "error" });
    } finally { running.current = false; setPending(false); }
  }
  return <Button type="button" variant="outline" size="sm" className="h-10" disabled={pending} onClick={() => void queue()}>
    {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <WandSparkles className="size-4" aria-hidden />}
    {pending ? "Adding to review..." : "Prepare application"}
  </Button>;
}
