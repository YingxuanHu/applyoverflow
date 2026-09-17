"use client";

import Link from "next/link";
import { CalendarClock, CalendarPlus, ExternalLink, FileText, Pencil, Tag as TagIcon, Trash2 } from "lucide-react";
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useRouter } from "next/navigation";

import {
  addTag,
  updateApplicationHeader,
} from "@/app/applications/[id]/actions";
import { CompanyLogo } from "@/components/company-logo";
import { resolveCompanyLogoDomain } from "@/lib/company-logo";
import { ApplicationQuickActions, ApplicationReminderDialog } from "@/components/applications/application-quick-actions";
import {
  applicationAttention,
  type ApplicationWorkItem,
} from "@/lib/applications/work-queue";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  ActionsMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useNotifications } from "@/components/ui/notification-provider";
import { formatTrackerDate } from "@/lib/tracker-ui";
import type { TrackedApplicationStatus } from "@/generated/prisma/client";

type Tag = { id: string; name: string };

type CanonicalJobSummary = {
  company?: string;
  location: string | null;
  workMode: string | null;
  companyRecord?: { name?: string; domain: string | null; careersUrl?: string | null } | null;
  applyUrl?: string;
} | null;

type ApplicationListCardData = ApplicationWorkItem & {
  id: string;
  status: TrackedApplicationStatus;
  company: string;
  roleTitle: string;
  roleUrl: string | null;
  deadline: Date | null;
  canonicalJobId: string | null;
  canonicalJob: CanonicalJobSummary;
  tags: { tag: Tag }[];
};

const INITIAL_STATE = {
  error: null as string | null,
  success: null as string | null,
};

const subscribeToHydration = () => () => {};
function ReminderTime({ value }: { value: Date | string }) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const date = new Date(value);
  return (
    <time dateTime={date.toISOString()}>
      {date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        ...(hydrated ? {} : { timeZone: "UTC", timeZoneName: "short" }),
      })}
    </time>
  );
}

export function ApplicationListCard({
  application,
  referenceNow,
  referenceDay,
}: {
  application: ApplicationListCardData;
  referenceNow: number;
  referenceDay: number;
}) {
  const fieldId = useId();
  const attention = applicationAttention(application, referenceNow, referenceDay);
  const [editing, setEditing] = useState(false);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [companyDraft, setCompanyDraft] = useState(application.company);
  const [roleTitleDraft, setRoleTitleDraft] = useState(application.roleTitle);
  const [roleUrlDraft, setRoleUrlDraft] = useState(application.roleUrl ?? "");
  const [state, formAction, isPending] = useActionState(
    updateApplicationHeader,
    INITIAL_STATE,
  );
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const [tagState, tagAction, tagPending] = useActionState(
    addTag,
    INITIAL_STATE,
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const router = useRouter();
  const { notify } = useNotifications();

  async function handleDelete() {
    if (deletePending) return;
    setDeletePending(true);
    try {
      const response = await fetch(`/api/applications/${application.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Could not delete this application.");
      }
      notify({
        title: "Application deleted",
        message: "Removed from your applications.",
        tone: "success",
      });
      setDeleteDialogOpen(false);
      router.refresh();
    } catch (error) {
      notify({
        title: "Couldn't delete",
        message:
          error instanceof Error
            ? error.message
            : "Could not delete this application.",
        tone: "error",
      });
    } finally {
      setDeletePending(false);
    }
  }

  // Toast for add-tag results, mirroring the update-header flow.
  useEffect(() => {
    if (tagState.success) {
      notify({
        title: "Tag added",
        message: tagState.success,
        tone: "success",
      });
      setTagDialogOpen(false);
    } else if (tagState.error) {
      notify({
        title: "Couldn't add tag",
        message: tagState.error,
        tone: "error",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagState]);

  function handleAddTagSubmit() {
    const name = tagInputRef.current?.value?.trim() ?? "";
    if (!name) return;
    const formData = new FormData();
    formData.set("applicationId", application.id);
    formData.set("name", name);
    startTransition(() => tagAction(formData));
  }

  // Reset drafts whenever the upstream values change OR when editing toggles
  // back on, so re-opening the editor starts from current persisted values.
  useEffect(() => {
    if (!editing) {
      setCompanyDraft(application.company);
      setRoleTitleDraft(application.roleTitle);
      setRoleUrlDraft(application.roleUrl ?? "");
    }
  }, [
    editing,
    application.company,
    application.roleTitle,
    application.roleUrl,
  ]);

  // Fire a toast when the action completes; close the editor on success.
  useEffect(() => {
    if (state.success) {
      notify({
        title: "Application updated",
        message: state.success,
        tone: "success",
      });
      setEditing(false);
    } else if (state.error) {
      notify({ title: "Couldn't update", message: state.error, tone: "error" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function handleSave() {
    if (isPending) return;
    const formData = new FormData();
    formData.set("applicationId", application.id);
    formData.set("company", companyDraft);
    formData.set("roleTitle", roleTitleDraft);
    formData.set("roleUrl", roleUrlDraft);
    startTransition(() => {
      formAction(formData);
    });
  }

  function handleCancel() {
    setCompanyDraft(application.company);
    setRoleTitleDraft(application.roleTitle);
    setRoleUrlDraft(application.roleUrl ?? "");
    setEditing(false);
  }

  return (
    <>
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3">
        <div className="min-w-0">
          {editing ? (
            <div className="space-y-2">
              <div className="space-y-1">
                <label
                  className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground"
                  htmlFor={`${fieldId}-role-title`}
                >
                  Job title
                </label>
                <Input
                  autoFocus
                  className="h-9 text-base font-semibold"
                  id={`${fieldId}-role-title`}
                  onChange={(event) => setRoleTitleDraft(event.target.value)}
                  placeholder="Job title"
                  value={roleTitleDraft}
                />
              </div>
              <div className="space-y-1">
                <label
                  className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground"
                  htmlFor={`${fieldId}-company`}
                >
                  Company
                </label>
                <Input
                  className="h-9 font-semibold"
                  id={`${fieldId}-company`}
                  onChange={(event) => setCompanyDraft(event.target.value)}
                  placeholder="Company name"
                  value={companyDraft}
                />
              </div>
              <div className="space-y-1">
                <label
                  className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground"
                  htmlFor={`${fieldId}-role-url`}
                >
                  Job link
                </label>
                <Input
                  className="h-9"
                  id={`${fieldId}-role-url`}
                  onChange={(event) => setRoleUrlDraft(event.target.value)}
                  placeholder="https://..."
                  type="url"
                  value={roleUrlDraft}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  className="h-8 px-3 text-xs"
                  disabled={isPending}
                  onClick={handleSave}
                  size="sm"
                  type="button"
                >
                  {isPending ? "Saving..." : "Save"}
                </Button>
                <Button
                  className="h-8 px-3 text-xs"
                  disabled={isPending}
                  onClick={handleCancel}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex min-w-0 items-start gap-3">
                <CompanyLogo
                  company={application.company}
                  domain={
                    application.canonicalJob?.company?.trim().toLowerCase() ===
                    application.company.trim().toLowerCase()
                      ? resolveCompanyLogoDomain({ company: application.company, companyRecord: application.canonicalJob.companyRecord, sourceUrls: [application.canonicalJob.applyUrl] })
                      : null
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Link
                      href={`/applications/${application.id}`}
                      className="mobile-list-title block text-base font-semibold text-foreground transition hover:underline sm:truncate"
                      title={application.roleTitle}
                    >
                      {application.roleTitle}
                    </Link>
                  </div>
                  <p
                    className="mobile-meta-line text-sm text-muted-foreground"
                    title={[
                      application.company,
                      application.canonicalJob?.location,
                      application.canonicalJob?.workMode?.toLowerCase(),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  >
                    <span className="font-semibold text-foreground">
                      {application.company}
                    </span>
                    {application.canonicalJob?.location
                      ? ` · ${application.canonicalJob.location}`
                      : ""}
                    {application.canonicalJob?.workMode &&
                    application.canonicalJob.workMode !== "UNKNOWN"
                      ? ` · ${application.canonicalJob.workMode.toLowerCase()}`
                      : ""}
                  </p>
                </div>
              </div>
              {application.deadline ? (
                <p
                  className={`mt-2 text-xs ${attention.deadlineOverdue ? "text-destructive" : attention.deadlineSoon ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
                >
                  Deadline: {formatTrackerDate(application.deadline)}
                  {attention.deadlineOverdue ? " (passed)" : null}
                </p>
              ) : null}
              {attention.nextReminder ? (
                <p
                  className="mt-2 flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground"
                  title={new Date(
                    attention.nextReminder.reminderAt!,
                  ).toISOString()}
                >
                  <CalendarClock className="mt-0.5 size-3.5 shrink-0" />
                  <span className="line-clamp-2">
                    <ReminderTime value={attention.nextReminder.reminderAt!} />:{" "}
                    {attention.nextReminder.note || "Reminder"}
                  </span>
                </p>
              ) : attention.followUp && !attention.deadlineOverdue ? (
                <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                  No update in {attention.quietDays} days
                </p>
              ) : null}
              {application.tags.length > 0 ? (
                <div className="mt-3 flex min-w-0 flex-wrap gap-1.5">
                  {application.tags.map(({ tag }) => (
                    <span
                      key={tag.id}
                      className="max-w-48 truncate rounded-full border border-border/70 px-2.5 py-0.5 text-xs text-muted-foreground"
                      title={tag.name}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex min-w-0 items-start justify-end gap-1">
          {!editing ? (
            <ApplicationQuickActions
              id={application.id}
              roleTitle={application.roleTitle}
              status={application.status}
            />
          ) : null}
          <div>
            {!editing ? (
              <DropdownMenu>
                <ActionsMenuTrigger label={`Actions for ${application.roleTitle}`} />
                <DropdownMenuContent align="end" className="min-w-[200px]">
                  <DropdownMenuItem onClick={() => setReminderOpen(true)}>
                    <CalendarPlus aria-hidden="true" /> Schedule reminder
                  </DropdownMenuItem>
                  {application.canonicalJobId ? (
                    <DropdownMenuItem render={<Link href={`/jobs/${application.canonicalJobId}`} />}>
                      <FileText aria-hidden="true" /> Open job details
                    </DropdownMenuItem>
                  ) : null}
                  {application.roleUrl ? (
                    <DropdownMenuItem render={<a href={application.roleUrl} target="_blank" rel="noreferrer" />}>
                      <ExternalLink aria-hidden="true" /> Original posting
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setEditing(true)}>
                    <Pencil aria-hidden="true" /> Edit application
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTagDialogOpen(true)}>
                    <TagIcon aria-hidden="true" /> Add tag
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setDeleteDialogOpen(true)}
                    variant="destructive"
                  >
                    <Trash2 aria-hidden="true" /> Delete application
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </div>

      <ApplicationReminderDialog id={application.id} roleTitle={application.roleTitle} open={reminderOpen} onOpenChange={setReminderOpen} />

      {/* Add-tag dialog. Tiny modal with a single text input + Save. */}
      <ConfirmActionDialog
        cancelLabel="Cancel"
        confirmLabel={tagPending ? "Adding..." : "Add tag"}
        description={
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Tags help you filter and group applications.
            </p>
            <Input
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAddTagSubmit();
                }
              }}
              placeholder="Tag name"
              ref={tagInputRef}
            />
          </div>
        }
        onConfirm={handleAddTagSubmit}
        onOpenChange={setTagDialogOpen}
        open={tagDialogOpen}
        pending={tagPending}
        title="Add tag"
      />

      {/* Delete confirmation — mirrors the previous DeleteApplicationButton
          dialog but lives inside the card so the dropdown can drive it. */}
      <ConfirmActionDialog
        confirmLabel={deletePending ? "Deleting..." : "Delete"}
        description="Delete this job from your applications?"
        destructive
        onConfirm={handleDelete}
        onOpenChange={setDeleteDialogOpen}
        open={deleteDialogOpen}
        pending={deletePending}
        title="Delete application?"
      />
    </>
  );
}
