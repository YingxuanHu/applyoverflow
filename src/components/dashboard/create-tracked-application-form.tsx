"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useNotifications } from "@/components/ui/notification-provider";

function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <Button className="w-full sm:w-auto" type="submit" disabled={pending}>
      {pending ? "Saving..." : "Add application"}
    </Button>
  );
}

export function CreateTrackedApplicationForm() {
  const router = useRouter();
  const { notify } = useNotifications();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }

    const form = event.currentTarget;
    const formData = new FormData(form);
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: formData.get("company"),
          roleTitle: formData.get("roleTitle"),
          roleUrl: formData.get("roleUrl"),
          status: formData.get("status"),
          deadline: formData.get("deadline"),
          reminder: formData.get("reminder"),
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        error?: string;
        success?: string;
      } | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Could not add application.");
      }

      form.reset();
      notify({
        title: "Application added",
        message: data?.success ?? "Tracked application added.",
        tone: "success",
      });
      router.refresh();
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Could not add application.";
      setError(message);
      notify({
        title: "Could not add application",
        message,
        tone: "error",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-3" onSubmit={handleSubmit}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Company
          </span>
          <Input name="company" required />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Role
          </span>
          <Input name="roleTitle" required />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1.5 sm:col-span-2 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Posting URL
          </span>
          <Input name="roleUrl" type="url" placeholder="https://..." />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Status
          </span>
          <select
            name="status"
            defaultValue="APPLIED"
            className="h-9 rounded-lg border border-input/80 bg-background/70 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="WISHLIST">Wishlist</option>
            <option value="PREPARING">Preparing</option>
            <option value="APPLIED">Applied</option>
            <option value="SCREEN">Screen</option>
            <option value="INTERVIEW">Interview</option>
            <option value="OFFER">Offer</option>
            <option value="REJECTED">Rejected</option>
            <option value="WITHDRAWN">Withdrawn</option>
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Deadline
          </span>
          <Input name="deadline" type="date" />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Reminder
          </span>
          <Textarea
            name="reminder"
            rows={1}
            className="h-9 min-h-9 resize-y py-2"
            placeholder="Follow up, prepare portfolio, email recruiter..."
          />
        </label>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Jobs submitted from the feed will also appear here automatically.
        </p>
        <SubmitButton pending={pending} />
      </div>
    </form>
  );
}
