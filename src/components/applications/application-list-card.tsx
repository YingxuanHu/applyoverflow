"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { addTag, updateApplicationHeader } from "@/app/applications/[id]/actions";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useNotifications } from "@/components/ui/notification-provider";
import {
  formatTrackerDate,
  TRACKED_STATUS_LABEL,
  trackedStatusClass,
} from "@/lib/tracker-ui";
import type { TrackedApplicationStatus } from "@/generated/prisma/client";

type Tag = { id: string; name: string };

type CanonicalJobSummary = {
  location: string | null;
  workMode: string | null;
} | null;

type ApplicationListCardData = {
  id: string;
  status: TrackedApplicationStatus;
  company: string;
  roleTitle: string;
  roleUrl: string | null;
  deadline: Date | null;
  notes: string | null;
  canonicalJobId: string | null;
  canonicalJob: CanonicalJobSummary;
  tags: { tag: Tag }[];
};

const INITIAL_STATE = { error: null as string | null, success: null as string | null };

export function ApplicationListCard({ application }: { application: ApplicationListCardData }) {
  const [editing, setEditing] = useState(false);
  const [companyDraft, setCompanyDraft] = useState(application.company);
  const [roleTitleDraft, setRoleTitleDraft] = useState(application.roleTitle);
  const [roleUrlDraft, setRoleUrlDraft] = useState(application.roleUrl ?? "");
  const [state, formAction, isPending] = useActionState(updateApplicationHeader, INITIAL_STATE);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const [tagState, tagAction, tagPending] = useActionState(addTag, INITIAL_STATE);
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
        message: error instanceof Error ? error.message : "Could not delete this application.",
        tone: "error",
      });
    } finally {
      setDeletePending(false);
    }
  }

  // Toast for add-tag results, mirroring the update-header flow.
  useEffect(() => {
    if (tagState.success) {
      notify({ title: "Tag added", message: tagState.success, tone: "success" });
      setTagDialogOpen(false);
    } else if (tagState.error) {
      notify({ title: "Couldn't add tag", message: tagState.error, tone: "error" });
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
  }, [editing, application.company, application.roleTitle, application.roleUrl]);

  // Fire a toast when the action completes; close the editor on success.
  useEffect(() => {
    if (state.success) {
      notify({ title: "Application updated", message: state.success, tone: "success" });
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
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Job title
              </label>
              <Input
                autoFocus
                className="h-9 text-base font-semibold"
                onChange={(event) => setRoleTitleDraft(event.target.value)}
                placeholder="Job title"
                value={roleTitleDraft}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Company
              </label>
              <Input
                className="h-9 font-semibold"
                onChange={(event) => setCompanyDraft(event.target.value)}
                placeholder="Company name"
                value={companyDraft}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                Job link
              </label>
              <Input
                className="h-9"
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
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/applications/${application.id}`}
                className="inline-block max-w-full truncate text-base font-semibold text-foreground transition hover:underline"
              >
                {application.roleTitle}
              </Link>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${trackedStatusClass(application.status)}`}
              >
                {TRACKED_STATUS_LABEL[application.status]}
              </span>
              {application.canonicalJob ? (
                <span className="text-xs text-muted-foreground">Feed-linked</span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{application.company}</span>
              {application.canonicalJob?.location
                ? ` · ${application.canonicalJob.location}`
                : ""}
              {application.canonicalJob?.workMode
                ? ` · ${application.canonicalJob.workMode.toLowerCase()}`
                : ""}
            </p>
            {application.roleUrl ? (
              <a
                className="mt-0.5 inline-block text-xs text-foreground underline underline-offset-2 hover:text-muted-foreground"
                href={application.roleUrl}
                rel="noreferrer"
                target="_blank"
              >
                Posting
              </a>
            ) : null}
            <p className="mt-2 text-sm text-muted-foreground">
              Deadline: {formatTrackerDate(application.deadline)}
            </p>
            {application.notes ? (
              <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{application.notes}</p>
            ) : null}
            {application.tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {application.tags.map(({ tag }) => (
                  <span
                    key={tag.id}
                    className="rounded-full border border-border/70 px-2.5 py-0.5 text-xs text-muted-foreground"
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Right column: a single "…" dropdown collects Edit / Add tag /
          Delete into one menu, eliminating the alignment + font-size
          mismatch between Edit and Delete and consolidating per-row
          actions in one place. Open job stays as a direct link above when
          the application is feed-linked. */}
      <div className="flex shrink-0 flex-col items-end gap-2 text-right">
        {application.canonicalJobId ? (
          <Link
            href={`/jobs/${application.canonicalJobId}`}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Open job
          </Link>
        ) : null}
        {!editing ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Application actions"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px]">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTagDialogOpen(true)}>
                Add tag
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDeleteDialogOpen(true)}
                variant="destructive"
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

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
    </div>
  );
}
