"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useState,
} from "react";
import { CalendarPlus } from "lucide-react";
import {
  addTimelineEvent,
  updateApplicationStatus,
} from "@/app/applications/[id]/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useNotifications } from "@/components/ui/notification-provider";
import { TRACKED_STATUS_LABEL, trackedStatusClass } from "@/lib/tracker-ui";
import { cn } from "@/lib/utils";
import type { TrackedApplicationStatus } from "@/generated/prisma/client";

const INITIAL_STATE = {
  error: null as string | null,
  success: null as string | null,
};

export function ApplicationQuickActions({
  id,
  roleTitle,
  status,
}: {
  id: string;
  roleTitle: string;
  status: TrackedApplicationStatus;
}) {
  const [state, action, pending] = useActionState(
    updateApplicationStatus,
    INITIAL_STATE,
  );
  const [reminderOpen, setReminderOpen] = useState(false);
  const { notify } = useNotifications();
  useEffect(() => {
    if (state.error)
      notify({
        title: "Status not changed",
        message: state.error,
        tone: "error",
      });
    if (state.success)
      notify({
        title: "Application updated",
        message: state.success,
        tone: "success",
      });
  }, [state, notify]);

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="relative">
          <select
            aria-label={`Status for ${roleTitle}`}
            disabled={pending}
            aria-busy={pending}
            className={cn(
              "h-9 w-32 rounded-lg border border-input px-2 text-xs font-medium disabled:opacity-60",
              trackedStatusClass(status),
            )}
            value={status === "PREPARING" ? "WISHLIST" : status}
            onChange={(event) => {
              const form = new FormData();
              form.set("applicationId", id);
              form.set("status", event.target.value);
              startTransition(() => action(form));
            }}
          >
            {Object.entries(TRACKED_STATUS_LABEL)
              .filter(([value]) => value !== "PREPARING")
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
        </div>
        <span role="status" className="sr-only">
          {pending ? "Saving status" : ""}
        </span>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          title="Schedule reminder"
          aria-label={`Schedule reminder for ${roleTitle}`}
          onClick={() => setReminderOpen(true)}
        >
          <CalendarPlus className="size-4" />
        </Button>
      </div>
      <Dialog open={reminderOpen} onOpenChange={setReminderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Schedule reminder</DialogTitle>
          <DialogDescription className="break-words pr-4">
            {roleTitle}
          </DialogDescription>
          {reminderOpen ? (
            <ReminderForm
              applicationId={id}
              onSaved={() => setReminderOpen(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReminderForm({
  applicationId,
  onSaved,
}: {
  applicationId: string;
  onSaved: () => void;
}) {
  const [state, action, pending] = useActionState(
    addTimelineEvent,
    INITIAL_STATE,
  );
  const [reminderAt, setReminderAt] = useState("");
  const [note, setNote] = useState("");
  const id = useId();
  const { notify } = useNotifications();
  useEffect(() => {
    if (state.success) {
      notify({
        title: "Reminder scheduled",
        message: state.success,
        tone: "success",
      });
      onSaved();
    }
  }, [state, notify, onSaved]);

  function preset(days: number) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(9, 0, 0, 0);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    setReminderAt(date.toISOString().slice(0, 16));
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="type" value="REMINDER" />
      <input
        type="hidden"
        name="timeZone"
        value={Intl.DateTimeFormat().resolvedOptions().timeZone}
      />
      <div className="grid gap-2 text-sm">
        <label htmlFor={`${id}-note`}>Next step</label>
        <Textarea
          id={`${id}-note`}
          name="note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          required
          maxLength={1000}
          rows={3}
          placeholder="Follow up with the recruiter"
          disabled={pending}
        />
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => preset(1)}
          disabled={pending}
        >
          Tomorrow
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => preset(7)}
          disabled={pending}
        >
          In a week
        </Button>
      </div>
      <div className="grid min-w-0 gap-2 text-sm">
        <label htmlFor={`${id}-time`}>Reminder time</label>
        <Input
          id={`${id}-time`}
          name="reminderAt"
          type="datetime-local"
          required
          disabled={pending}
          className="min-w-0 max-w-full"
          value={reminderAt}
          onChange={(event) => setReminderAt(event.target.value)}
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        <CalendarPlus className="size-4" />
        {pending ? "Scheduling..." : "Schedule reminder"}
      </Button>
    </form>
  );
}
