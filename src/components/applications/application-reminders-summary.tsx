"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useState } from "react";
import { CalendarClock, ChevronDown, Pencil, Trash2 } from "lucide-react";

import {
  deleteTimelineEvent,
  updateTimelineEvent,
} from "@/app/applications/[id]/actions";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useNotifications } from "@/components/ui/notification-provider";

type ActionState = {
  error: string | null;
  success: string | null;
};

type Reminder = {
  id: string;
  note: string | null;
  timestamp: Date;
  reminderAt: Date | null;
  reminderNotifiedAt: Date | null;
};

export type ApplicationReminderGroup = {
  applicationId: string;
  canonicalJobId: string | null;
  company: string;
  roleTitle: string;
  reminders: Reminder[];
};

const INITIAL_STATE: ActionState = {
  error: null,
  success: null,
};

function formatReminderDate(date: Date | null) {
  if (!date) return "No notification time";
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toDateTimeLocalInputValue(date: Date | null) {
  if (!date) return "";
  const value = new Date(date);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function useActionToast(state: ActionState, successTitle: string) {
  const { notify } = useNotifications();

  useEffect(() => {
    if (state.success) {
      notify({ title: successTitle, message: state.success, tone: "success" });
    } else if (state.error) {
      notify({ title: "Request failed", message: state.error, tone: "error" });
    }
  }, [notify, state.error, state.success, successTitle]);
}

function ReminderSummaryItem({
  applicationId,
  reminder,
}: {
  applicationId: string;
  reminder: Reminder;
}) {
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState(reminder.note ?? "");
  const [timeDraft, setTimeDraft] = useState(toDateTimeLocalInputValue(reminder.reminderAt));
  const [updateState, updateAction, updatePending] = useActionState(
    updateTimelineEvent,
    INITIAL_STATE
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteTimelineEvent,
    INITIAL_STATE
  );
  useActionToast(updateState, "Reminder saved");
  useActionToast(deleteState, "Reminder deleted");

  function dispatchDelete() {
    const payload = new FormData();
    payload.set("applicationId", applicationId);
    payload.set("eventId", reminder.id);
    setDeleteOpen(false);
    startTransition(() => deleteAction(payload));
  }

  if (editing) {
    return (
      <form
        action={async (formData) => {
          await updateAction(formData);
          setEditing(false);
        }}
        className="rounded-[12px] border border-border/70 bg-card p-2.5"
      >
        <input name="applicationId" type="hidden" value={applicationId} />
        <input name="eventId" type="hidden" value={reminder.id} />
        <input name="type" type="hidden" value="REMINDER" />
        <Textarea
          className="min-h-[64px] resize-y text-sm"
          name="note"
          onChange={(event) => setNoteDraft(event.target.value)}
          placeholder="Reminder"
          required
          rows={3}
          value={noteDraft}
        />
        <Input
          className="mt-2 h-8 text-xs"
          name="reminderAt"
          onChange={(event) => setTimeDraft(event.target.value)}
          type="datetime-local"
          value={timeDraft}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button className="h-7 px-2.5 text-xs" disabled={updatePending} size="sm" type="submit">
            {updatePending ? "Saving..." : "Save"}
          </Button>
          <Button
            className="h-7 px-2.5 text-xs"
            disabled={updatePending}
            onClick={() => {
              setNoteDraft(reminder.note ?? "");
              setTimeDraft(toDateTimeLocalInputValue(reminder.reminderAt));
              setEditing(false);
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="group px-1.5 py-2">
      <div className="flex items-start gap-2.5">
        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/45" />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm leading-5 text-foreground/85">
            {reminder.note || "Reminder"}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <CalendarClock className="h-3 w-3" />
            {formatReminderDate(reminder.reminderAt)}
            {reminder.reminderNotifiedAt ? " · sent" : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            aria-label="Edit reminder"
            className="h-7 w-7 px-0 text-muted-foreground"
            onClick={() => setEditing(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            aria-label="Delete reminder"
            className="h-7 w-7 px-0 text-muted-foreground hover:text-destructive"
            disabled={deletePending}
            onClick={() => setDeleteOpen(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ConfirmActionDialog
        confirmLabel={deletePending ? "Deleting..." : "Delete"}
        description="Delete this reminder?"
        destructive
        onConfirm={dispatchDelete}
        onOpenChange={setDeleteOpen}
        open={deleteOpen}
        pending={deletePending}
        title="Delete reminder?"
      />
    </div>
  );
}

function ApplicationReminderGroupRow({
  group,
}: {
  group: ApplicationReminderGroup;
}) {
  const [expanded, setExpanded] = useState(false);
  const firstReminder = group.reminders[0];
  const additionalCount = Math.max(0, group.reminders.length - 1);

  return (
    <article className="py-1.5 first:pt-0 last:pb-0">
      <div className="grid min-w-0 gap-3 rounded-[12px] px-2 py-2 transition hover:bg-muted/45 md:grid-cols-[minmax(12rem,0.75fr)_minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <Link
            className="block truncate text-sm font-medium text-foreground transition hover:underline"
            href={`/applications/${group.applicationId}`}
          >
            {group.roleTitle}
          </Link>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {group.company}
          </p>
        </div>

        <div className="min-w-0">
          <p className="truncate text-sm text-foreground/80">
            {firstReminder?.note || "Reminder"}
          </p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <CalendarClock className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {formatReminderDate(firstReminder?.reminderAt ?? null)}
              {firstReminder?.reminderNotifiedAt ? " · sent" : ""}
            </span>
          </p>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 md:justify-end">
          {additionalCount > 0 ? (
            <span className="rounded-full border border-border/70 bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
              +{additionalCount}
            </span>
          ) : null}
          <Button
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse reminders" : "Expand reminders"}
            className="h-8 w-8 px-0 text-muted-foreground"
            onClick={() => setExpanded((current) => !current)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${
                expanded ? "rotate-180" : ""
              }`}
            />
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-1.5 rounded-[12px] border border-border/60 bg-card px-2 py-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1.5 py-1">
            <p className="text-xs font-medium text-muted-foreground">
              {group.reminders.length} reminder{group.reminders.length === 1 ? "" : "s"}
            </p>
            {group.canonicalJobId ? (
              <Link
                className="text-xs font-medium text-muted-foreground transition hover:text-foreground"
                href={`/jobs/${group.canonicalJobId}`}
              >
                Open job
              </Link>
            ) : null}
          </div>
          <div className="divide-y divide-border/50">
            {group.reminders.map((reminder) => (
              <ReminderSummaryItem
                applicationId={group.applicationId}
                key={reminder.id}
                reminder={reminder}
              />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function ApplicationRemindersSummary({
  groups,
}: {
  groups: ApplicationReminderGroup[];
}) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <section className="surface-panel p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Reminders</h2>
          <p className="mt-1 text-sm text-muted-foreground">Upcoming follow-ups from your tracker.</p>
        </div>
      </div>

      <div className="mt-3 divide-y divide-border/60">
        {groups.map((group) => (
          <ApplicationReminderGroupRow group={group} key={group.applicationId} />
        ))}
      </div>
    </section>
  );
}
