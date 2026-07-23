"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileText,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  addResumeLibraryEntry,
  applyResumeEntryRewrite,
  archiveResumeBuild,
  createResumeBuild,
  deleteResumeEntryVariation,
  dismissResumeEntryRewrite,
  duplicateResumeEntryVariation,
  duplicateResumeBuild,
  generateResumeBuildPdf,
  generateResumeEntryVariation,
  importResumeLibraryFromProfile,
  renameResumeEntryVariation,
  setDefaultResumeEntryVariation,
  updateResumeLibraryEntry,
} from "@/app/profile/resume-builder-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/components/ui/use-action-toast";
import {
  RESUME_BUILD_SECTION_ORDER,
  displayResumeEntryType,
  type ResumeLibraryEntryTypeValue,
} from "@/lib/resume-builder";

type ResumeVariation = {
  id: string;
  name: string;
  sourceVariationId: string | null;
  rewrittenBulletIndexes: number[];
  summary: string | null;
  bullets: string[];
  targetRoleTags: string[];
  source: "USER" | "IMPORTED" | "AI_GENERATED";
  approvalStatus: "APPROVED" | "PENDING" | "REJECTED";
  isDefault: boolean;
};

type ResumeEntry = {
  id: string;
  type: ResumeLibraryEntryTypeValue;
  title: string;
  organization: string | null;
  dateRange: string | null;
  location: string | null;
  summary: string | null;
  technologies: string[];
  sourceProfileKey: string | null;
  variations: ResumeVariation[];
};

type ResumeBuild = {
  id: string;
  name: string;
  status: "DRAFT" | "ARCHIVED";
  updatedAtLabel: string;
  itemCount: number;
  targetJobLabel: string | null;
  outputDocument: { title: string; href: string } | null;
};

type SavedJob = { id: string; label: string };

type ResumeBuilderProps = {
  entries: ResumeEntry[];
  builds: ResumeBuild[];
  savedJobs: SavedJob[];
};

type SelectionState = Record<string, { variationId: string; includedBulletIds: string[] }>;

const emptyState = () => ({ error: null, success: null });

const sectionConfig: Array<{
  type: (typeof RESUME_BUILD_SECTION_ORDER)[number];
  title: string;
  description: string;
}> = [
  {
    type: "EDUCATION",
    title: "Education",
    description: "Choose the degrees and programs that support this application.",
  },
  {
    type: "EXPERIENCE",
    title: "Experience",
    description: "Select the roles and current wording that best show relevant judgment.",
  },
  {
    type: "PROJECT",
    title: "Projects",
    description: "Add only the work that reinforces the story of this resume.",
  },
  {
    type: "SKILL",
    title: "Skills",
    description: "Keep this compact and relevant to the selected experience.",
  },
];

function defaultVariation(entry: ResumeEntry) {
  return (
    entry.variations.find(
      (variation) => variation.approvalStatus === "APPROVED" && variation.isDefault
    ) ?? entry.variations.find((variation) => variation.approvalStatus === "APPROVED") ?? null
  );
}

function approvedVariation(entry: ResumeEntry, variationId: string | undefined) {
  return (
    entry.variations.find(
      (variation) => variation.id === variationId && variation.approvalStatus === "APPROVED"
    ) ?? null
  );
}

function activeVariation(entry: ResumeEntry, selected: SelectionState[string] | undefined) {
  return approvedVariation(entry, selected?.variationId) ?? defaultVariation(entry);
}

function bulletIds(variation: ResumeVariation | null) {
  return variation?.bullets.map((_, index) => String(index)) ?? [];
}

function hasEditableCopy(entry: ResumeEntry) {
  return entry.type === "EXPERIENCE" || entry.type === "PROJECT";
}

function ActionRefresh({ success }: { success: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (success) router.refresh();
  }, [router, success]);
  return null;
}

function ImportFromProfileButton({ hasEntries }: { hasEntries: boolean }) {
  const [state, action, pending] = useActionState(importResumeLibraryFromProfile, emptyState());
  useActionToast(state, {
    successTitle: "Profile content imported",
    errorTitle: "Could not import profile content",
  });

  return (
    <form action={action}>
      <ActionRefresh success={state.success} />
      <Button disabled={pending} size="sm" type="submit" variant="outline">
        {pending ? "Importing..." : hasEntries ? "Import new profile entries" : "Import profile content"}
      </Button>
    </form>
  );
}

function AddEntryForm({ type }: { type: ResumeLibraryEntryTypeValue }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addResumeLibraryEntry, emptyState());
  useActionToast(state, { successTitle: "Content added", errorTitle: "Could not add content" });
  const sectionName = displayResumeEntryType(type).replace(/s$/, "");

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm" type="button" variant="outline">
        <ListPlus />
        Add {sectionName.toLowerCase()}
      </Button>
    );
  }

  return (
    <form action={action} className="mt-4 grid gap-3 border-t border-dashed border-border/70 pt-4 sm:grid-cols-2">
      <ActionRefresh success={state.success} />
      <input name="type" type="hidden" value={type} />
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Title
        <Input name="title" required />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Organization, school, or role
        <Input name="organization" />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Dates
        <Input name="dateRange" placeholder="2022 - Present" />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
        Verified bullets
        <textarea
          className="min-h-24 rounded-[8px] border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
          name="bullets"
          placeholder="One bullet per line"
        />
      </label>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button onClick={() => setOpen(false)} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={pending} size="sm" type="submit">
          {pending ? "Saving..." : "Add entry"}
        </Button>
      </div>
    </form>
  );
}

function RevisionRequest({
  entry,
  baseVariation,
  selectedBulletIds,
  onClose,
}: {
  entry: ResumeEntry;
  baseVariation: ResumeVariation;
  selectedBulletIds: string[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(generateResumeEntryVariation, emptyState());
  const [scope, setScope] = useState<"selected" | "entire">("selected");
  useActionToast(state, { successTitle: "AI rewrite ready", errorTitle: "Could not generate rewrite" });
  useEffect(() => {
    if (state.success) onClose();
  }, [onClose, state.success]);

  return (
    <form action={action} className="grid gap-4 border-t border-border/60 pt-4">
      <ActionRefresh success={state.success} />
      <input name="entryId" type="hidden" value={entry.id} />
      <input name="variationId" type="hidden" value={baseVariation.id} />
      {(scope === "entire" ? bulletIds(baseVariation) : selectedBulletIds).map((bulletId) => (
        <input key={bulletId} name="selectedBulletId" type="hidden" value={bulletId} />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Rewrite scope</span>
        <Button
          onClick={() => setScope("selected")}
          size="xs"
          type="button"
          variant={scope === "selected" ? "secondary" : "ghost"}
        >
          Selected bullets ({selectedBulletIds.length})
        </Button>
        <Button
          onClick={() => setScope("entire")}
          size="xs"
          type="button"
          variant={scope === "entire" ? "secondary" : "ghost"}
        >
          Entire entry
        </Button>
      </div>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        What should this version emphasize?
        <textarea
          className="min-h-24 rounded-[8px] border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
          name="instruction"
          placeholder="For a software engineering role, emphasize architecture, reliability, and the engineering decisions behind this work."
          required
        />
      </label>
      <p className="text-xs leading-5 text-muted-foreground">
        AI uses this entry and your Application profile as evidence. It only changes the selected bullets, preserves the verified facts, and creates a separate version without changing your profile.
      </p>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose} size="xs" type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={pending || (scope === "selected" && selectedBulletIds.length === 0)} size="xs" type="submit">
          <Sparkles />
          {pending ? "Writing..." : "Create AI version"}
        </Button>
      </div>
    </form>
  );
}

function ManualEntryEditor({
  entry,
  baseVariation,
  onClose,
}: {
  entry: ResumeEntry;
  baseVariation: ResumeVariation | null;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(updateResumeLibraryEntry, emptyState());
  const [bullets, setBullets] = useState(() => baseVariation?.bullets ?? []);
  useActionToast(state, { successTitle: "Resume entry updated", errorTitle: "Could not update resume entry" });
  useEffect(() => {
    if (state.success) onClose();
  }, [onClose, state.success]);

  function updateBullet(index: number, value: string) {
    setBullets((current) => current.map((bullet, currentIndex) => currentIndex === index ? value : bullet));
  }

  function removeBullet(index: number) {
    setBullets((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  return (
    <form action={action} className="grid gap-3 border-t border-border/60 pt-4 sm:grid-cols-2">
      <ActionRefresh success={state.success} />
      <input name="entryId" type="hidden" value={entry.id} />
      <input name="bulletEditor" type="hidden" value="true" />
      <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
        New version name
        <Input defaultValue={`Manual edit ${baseVariation ? `of ${baseVariation.name}` : ""}`.trim()} name="versionName" required />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
        Context
        <textarea
          className="min-h-20 rounded-[8px] border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
          defaultValue={entry.summary ?? baseVariation?.summary ?? ""}
          name="summary"
          placeholder="Optional context for this entry"
        />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
        Bullets for this version
        <span className="text-xs font-normal leading-5 text-muted-foreground">Edit or remove individual bullets here. Saving always creates a separate resume-only version.</span>
      </label>
      <div className="grid gap-3 sm:col-span-2">
        {bullets.map((bullet, index) => (
          <div className="grid gap-2 rounded-[8px] border border-border/70 bg-card/40 p-3 sm:grid-cols-[minmax(0,1fr)_auto]" key={`${index}-${bullet}`}>
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              Bullet {index + 1}
              <Textarea
                aria-label={`Bullet ${index + 1}`}
                className="min-h-20 resize-y text-sm"
                name="bullet"
                onChange={(event) => updateBullet(index, event.target.value)}
                value={bullet}
              />
            </label>
            <Button
              className="self-end text-muted-foreground hover:text-destructive"
              onClick={() => removeBullet(index)}
              size="icon-xs"
              title={`Delete bullet ${index + 1}`}
              type="button"
              variant="ghost"
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <div>
          <Button
            disabled={bullets.length >= 20}
            onClick={() => setBullets((current) => [...current, ""])}
            size="xs"
            type="button"
            variant="outline"
          >
            <Plus />
            Add bullet
          </Button>
        </div>
      </div>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
        Technologies
        <Input defaultValue={entry.technologies.join(", ")} name="technologies" placeholder="TypeScript, PostgreSQL" />
      </label>
      <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
        The role details stay stable. This saves separate resume-only wording and technologies, so your Application profile and other versions remain unchanged.
      </p>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button onClick={onClose} size="xs" type="button" variant="ghost">Cancel</Button>
        <Button disabled={pending} size="xs" type="submit">
          <Pencil />
          {pending ? "Saving..." : "Save new version"}
        </Button>
      </div>
    </form>
  );
}

function RewriteReviewForm({
  proposal,
  sourceVariation,
}: {
  proposal: ResumeVariation;
  sourceVariation: ResumeVariation | null;
}) {
  const [state, action, pending] = useActionState(applyResumeEntryRewrite, emptyState());
  useActionToast(state, { successTitle: "AI version added", errorTitle: "Could not add AI version" });
  const editableIndexes = new Set(
    proposal.rewrittenBulletIndexes.length > 0
      ? proposal.rewrittenBulletIndexes
      : proposal.bullets.map((_, index) => index)
  );

  return (
    <form action={action} className="grid gap-4">
      <ActionRefresh success={state.success} />
      <input name="variationId" type="hidden" value={proposal.id} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground sm:max-w-md sm:flex-1">
          New version name
          <Input defaultValue={proposal.name} name="versionName" required />
        </label>
        <div className="flex items-center gap-1">
          <DismissRewriteAction variationId={proposal.id} />
          <Button disabled={pending} size="xs" type="submit">
            <Check />
            {pending ? "Saving..." : "Save new version"}
          </Button>
        </div>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Edit the proposed wording before saving. Only the bullets selected for this AI request are editable; the rest are preserved exactly in the new version.
      </p>
      <div className="grid gap-3">
        {proposal.bullets.map((bullet, index) => {
          const editable = editableIndexes.has(index);
          const sourceBullet = sourceVariation?.bullets[index] ?? "Source version unavailable.";
          return (
            <div className="grid gap-3 rounded-[8px] border border-border/70 bg-card/30 p-3 md:grid-cols-2" key={`${proposal.id}-${index}`}>
              <div className="border-l-2 border-border pl-3">
                <p className="text-xs font-medium text-muted-foreground">Original bullet {index + 1}</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{sourceBullet}</p>
              </div>
              <div className="border-l-2 border-primary pl-3">
                <p className="text-xs font-medium text-primary">
                  {editable ? `Proposed bullet ${index + 1}` : `Unchanged bullet ${index + 1}`}
                </p>
                {editable ? (
                  <Textarea
                    className="mt-2 min-h-20 resize-y text-sm"
                    defaultValue={bullet}
                    name="bullet"
                  />
                ) : (
                  <>
                    <input name="bullet" type="hidden" value={bullet} />
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{bullet}</p>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </form>
  );
}

function DismissRewriteAction({ variationId }: { variationId: string }) {
  const [state, action, pending] = useActionState(dismissResumeEntryRewrite, emptyState());
  useActionToast(state, { successTitle: "AI rewrite dismissed", errorTitle: "Could not dismiss rewrite" });

  return (
    <form action={action}>
      <ActionRefresh success={state.success} />
      <input name="variationId" type="hidden" value={variationId} />
      <Button disabled={pending} size="xs" type="submit" variant="ghost">
        Dismiss
      </Button>
    </form>
  );
}

function VersionAction({
  variationId,
  type,
}: {
  variationId: string;
  type: "duplicate" | "default" | "delete";
}) {
  const actionFn =
    type === "duplicate"
      ? duplicateResumeEntryVariation
      : type === "default"
        ? setDefaultResumeEntryVariation
        : deleteResumeEntryVariation;
  const [state, action, pending] = useActionState(actionFn, emptyState());
  const labels = {
    duplicate: "Version duplicated",
    default: "Default version updated",
    delete: "Version deleted",
  } as const;
  useActionToast(state, { successTitle: labels[type], errorTitle: `Could not ${type} version` });

  return (
    <form action={action}>
      <ActionRefresh success={state.success} />
      <input name="variationId" type="hidden" value={variationId} />
      <Button
        className={type === "delete" ? "text-destructive hover:text-destructive" : undefined}
        disabled={pending}
        onClick={(event) => {
          if (type === "delete" && !window.confirm("Delete this version? Existing resume drafts keep their frozen snapshot.")) {
            event.preventDefault();
          }
        }}
        size="xs"
        title={type === "duplicate" ? "Duplicate version" : type === "default" ? "Set default version" : "Delete version"}
        type="submit"
        variant="ghost"
      >
        {type === "duplicate" ? <Copy /> : type === "delete" ? <Trash2 /> : <Check />}
        {pending
          ? "Saving..."
          : type === "duplicate"
            ? "Duplicate"
            : type === "default"
              ? "Set default"
              : "Delete"}
      </Button>
    </form>
  );
}

function RenameVersionForm({ variation }: { variation: ResumeVariation }) {
  const [state, action, pending] = useActionState(renameResumeEntryVariation, emptyState());
  useActionToast(state, { successTitle: "Version renamed", errorTitle: "Could not rename version" });

  return (
    <form action={action} className="flex min-w-0 flex-1 items-end gap-2">
      <ActionRefresh success={state.success} />
      <input name="variationId" type="hidden" value={variation.id} />
      <label className="grid min-w-0 flex-1 gap-1 text-xs font-medium text-muted-foreground">
        Version name
        <Input defaultValue={variation.name} name="name" required />
      </label>
      <Button disabled={pending} size="xs" type="submit" variant="outline">
        {pending ? "Saving..." : "Rename"}
      </Button>
    </form>
  );
}

function EntryDetails({
  entry,
  selected,
  onToggleBullet,
  onSelectVariation,
}: {
  entry: ResumeEntry;
  selected: SelectionState[string] | undefined;
  onToggleBullet: (bulletId: string) => void;
  onSelectVariation: (variationId: string) => void;
}) {
  const baseVariation = activeVariation(entry, selected);
  const approvedVariations = entry.variations.filter(
    (variation) => variation.approvalStatus === "APPROVED"
  );
  const pendingRewrites = entry.variations.filter(
    (variation) => variation.approvalStatus === "PENDING" && variation.source === "AI_GENERATED"
  );
  const [composer, setComposer] = useState<"manual" | "ai" | null>(null);
  const [manageVersions, setManageVersions] = useState(false);
  const [rewriteSelection, setRewriteSelection] = useState<{ variationId: string | null; bulletIds: string[] }>({
    variationId: null,
    bulletIds: [],
  });
  const rewriteBulletIds = rewriteSelection.variationId === baseVariation?.id
    ? rewriteSelection.bulletIds
    : [];

  function toggleRewriteBullet(bulletId: string) {
    setRewriteSelection((current) => {
      const currentIds = current.variationId === baseVariation?.id ? current.bulletIds : [];
      return {
        variationId: baseVariation?.id ?? null,
        bulletIds: currentIds.includes(bulletId)
          ? currentIds.filter((id) => id !== bulletId)
          : [...currentIds, bulletId],
      };
    });
  }

  return (
    <div className="mt-4 grid gap-5 border-t border-border/70 bg-muted/10 px-4 py-5 sm:px-5">
      <div className="flex flex-col gap-3 border-b border-border/60 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-1">
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Version for this resume
            <select
              className="h-9 min-w-52 rounded-[8px] border border-input bg-card px-2.5 text-sm text-foreground"
              onChange={(event) => onSelectVariation(event.target.value)}
              value={baseVariation?.id ?? ""}
            >
              {approvedVariations.map((variation) => (
                <option key={variation.id} value={variation.id}>
                  {variation.name}{variation.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs leading-5 text-muted-foreground">
            Each resume can use a different version of this entry.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Actions for ${entry.title}`}
            className="inline-flex size-7 items-center justify-center rounded-[10px] text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem className="cursor-pointer" onClick={() => setComposer("manual")}>
              <Pencil />
              Edit as new version
            </DropdownMenuItem>
            {hasEditableCopy(entry) && baseVariation ? (
              <DropdownMenuItem className="cursor-pointer" onClick={() => setComposer("ai")}>
                <Sparkles />
                Create AI version
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem className="cursor-pointer" onClick={() => setManageVersions((current) => !current)}>
              <Copy />
              Manage versions
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {manageVersions && baseVariation ? (
        <div className="flex flex-col gap-3 border-b border-border/60 pb-5 sm:flex-row sm:items-end">
          <RenameVersionForm variation={baseVariation} />
          <div className="flex flex-wrap gap-1">
            <VersionAction type="duplicate" variationId={baseVariation.id} />
            {!baseVariation.isDefault ? <VersionAction type="default" variationId={baseVariation.id} /> : null}
            <VersionAction type="delete" variationId={baseVariation.id} />
          </div>
        </div>
      ) : null}

      {entry.technologies.length > 0 ? (
        <p className="text-xs text-muted-foreground">{entry.technologies.join(" · ")}</p>
      ) : null}

      {baseVariation?.bullets.length ? (
        <div className="grid gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Include bullets in this resume
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            Use the separate Rewrite checkbox to target specific bullets for AI. Your resume selection never changes the AI rewrite scope.
          </p>
          {baseVariation.bullets.map((bullet, index) => {
            const id = String(index);
            return (
              <div className="grid gap-2 rounded-[8px] border border-border/60 bg-card/20 p-3 sm:grid-cols-[minmax(0,1fr)_auto]" key={id}>
                <label className="flex min-w-0 flex-1 items-start gap-2 text-xs leading-5 text-muted-foreground">
                  <input
                    checked={selected?.includedBulletIds.includes(id) ?? false}
                    className="mt-1 h-3.5 w-3.5 rounded border-border accent-primary"
                    onChange={() => onToggleBullet(id)}
                    type="checkbox"
                  />
                  <span>{bullet}</span>
                </label>
                {hasEditableCopy(entry) ? (
                  <label className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <input
                      aria-label={`Rewrite bullet ${index + 1}`}
                      checked={rewriteBulletIds.includes(id)}
                      className="h-3.5 w-3.5 rounded border-border accent-primary"
                      onChange={() => toggleRewriteBullet(id)}
                      type="checkbox"
                    />
                    Rewrite
                  </label>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {composer === "manual" ? (
        <ManualEntryEditor
          baseVariation={baseVariation}
          entry={entry}
          key={baseVariation?.id ?? "empty"}
          onClose={() => setComposer(null)}
        />
      ) : null}
      {composer === "ai" && baseVariation ? (
        <RevisionRequest
          baseVariation={baseVariation}
          entry={entry}
          key={baseVariation.id}
          selectedBulletIds={rewriteBulletIds}
          onClose={() => setComposer(null)}
        />
      ) : null}

      {pendingRewrites.map((proposal) => (
        <div className="grid gap-4 border-t border-border/60 pt-5" key={proposal.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-foreground">AI version ready</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Compare every bullet, correct the AI wording where needed, then save a separate version.</p>
            </div>
          </div>
          <RewriteReviewForm
            proposal={proposal}
            sourceVariation={entry.variations.find((variation) => variation.id === proposal.sourceVariationId) ?? null}
          />
        </div>
      ))}
    </div>
  );
}

function BuildAction({ build, type }: { build: ResumeBuild; type: "archive" | "duplicate" }) {
  const actionFn = type === "archive" ? archiveResumeBuild : duplicateResumeBuild;
  const [state, action, pending] = useActionState(actionFn, emptyState());
  useActionToast(state, {
    successTitle: type === "archive" ? "Build archived" : "Build duplicated",
    errorTitle: "Could not update build",
  });

  return (
    <form action={action}>
      <ActionRefresh success={state.success} />
      <input name="buildId" type="hidden" value={build.id} />
      <Button
        disabled={pending}
        size="icon-xs"
        title={type === "archive" ? "Archive build" : "Duplicate build"}
        type="submit"
        variant="ghost"
      >
        {type === "archive" ? <Archive /> : <Copy />}
      </Button>
    </form>
  );
}

function GeneratePdfAction({ build }: { build: ResumeBuild }) {
  const [state, action, pending] = useActionState(generateResumeBuildPdf, emptyState());
  useActionToast(state, { successTitle: "Resume PDF generated", errorTitle: "Could not generate PDF" });

  return (
    <form action={action}>
      <ActionRefresh success={state.success} />
      <input name="buildId" type="hidden" value={build.id} />
      <Button disabled={pending || build.status !== "DRAFT"} size="xs" type="submit" variant="outline">
        <FileText />
        {pending ? "Generating..." : build.outputDocument ? "Regenerate PDF" : "Generate PDF"}
      </Button>
    </form>
  );
}

export function ResumeBuilder({ entries, builds, savedJobs }: ResumeBuilderProps) {
  const [selection, setSelection] = useState<SelectionState>({});
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [state, buildAction, pending] = useActionState(createResumeBuild, emptyState());
  useActionToast(state, { successTitle: "Resume draft saved", errorTitle: "Could not save resume draft" });

  // A version can be added or deleted through a server refresh while this client
  // component keeps its selection state. Preserve an explicitly selected version
  // whenever it remains available, so drafts can use different versions per entry.
  const effectiveSelection = useMemo<SelectionState>(() => {
    const next: SelectionState = {};
    for (const entry of entries) {
      const selected = selection[entry.id];
      if (!selected) continue;
      const variation = approvedVariation(entry, selected.variationId) ?? defaultVariation(entry);
      if (!variation) continue;
      const validBulletIds = selected.includedBulletIds.filter(
        (bulletId) => Number(bulletId) >= 0 && Number(bulletId) < variation.bullets.length
      );
      next[entry.id] = {
        variationId: variation.id,
        includedBulletIds:
          selected.variationId === variation.id ? validBulletIds : bulletIds(variation),
      };
    }
    return next;
  }, [entries, selection]);

  const entriesBySection = useMemo(
    () =>
      new Map(
        sectionConfig.map((section) => [
          section.type,
          entries.filter((entry) => entry.type === section.type),
        ])
      ),
    [entries]
  );
  const orderedEntries = useMemo(
    () => sectionConfig.flatMap((section) => entriesBySection.get(section.type) ?? []),
    [entriesBySection]
  );
  const selectedEntries = useMemo(
    () =>
      orderedEntries
        .filter((entry) => effectiveSelection[entry.id])
        .map((entry, sortOrder) => ({ entry, ...effectiveSelection[entry.id], sortOrder })),
    [effectiveSelection, orderedEntries]
  );
  const selectionJson = JSON.stringify(
    selectedEntries.map(({ entry, variationId, includedBulletIds, sortOrder }) => ({
      entryId: entry.id,
      variationId,
      includedBulletIds,
      sortOrder,
    }))
  );

  function toggleEntry(entry: ResumeEntry) {
    setSelection((current) => {
      if (current[entry.id]) {
        const next = { ...current };
        delete next[entry.id];
        return next;
      }
      const variation = defaultVariation(entry);
      if (!variation) return current;
      return {
        ...current,
        [entry.id]: { variationId: variation.id, includedBulletIds: bulletIds(variation) },
      };
    });
  }

  function toggleBullet(entry: ResumeEntry, bulletId: string) {
    setSelection((current) => {
      const currentSelection = current[entry.id];
      const variation = activeVariation(entry, currentSelection);
      if (!variation) return current;
      if (!currentSelection) {
        return {
          ...current,
          [entry.id]: { variationId: variation.id, includedBulletIds: [bulletId] },
        };
      }
      const selected =
        currentSelection.variationId === variation.id
          ? currentSelection
          : { variationId: variation.id, includedBulletIds: bulletIds(variation) };
      const includedBulletIds = selected.includedBulletIds.includes(bulletId)
        ? selected.includedBulletIds.filter((id) => id !== bulletId)
        : [...selected.includedBulletIds, bulletId];
      return { ...current, [entry.id]: { ...selected, includedBulletIds } };
    });
  }

  function selectVariation(entry: ResumeEntry, variationId: string) {
    const variation = approvedVariation(entry, variationId);
    if (!variation) return;
    setSelection((current) => {
      const currentSelection = current[entry.id];
      return {
        ...current,
        [entry.id]: {
          variationId: variation.id,
          includedBulletIds:
            currentSelection?.variationId === variation.id
              ? currentSelection.includedBulletIds.filter((id) => Number(id) < variation.bullets.length)
              : bulletIds(variation),
        },
      };
    });
  }

  return (
    <div className="space-y-8">
      <header className="border-b border-border/70 pb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Sparkles className="h-4 w-4" />
              <span className="text-xs font-semibold uppercase tracking-[0.14em]">Documents workspace</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">Resume builder</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Build focused resumes from stable profile context. Importing copies new background information here; every edit and version stays in this workspace, and every draft records its own frozen selection.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button render={<Link href="/profile" />} size="sm" variant="outline">
              Edit application profile
            </Button>
            <ImportFromProfileButton hasEntries={entries.length > 0} />
          </div>
        </div>
      </header>

      <section aria-labelledby="resume-sections-heading">
        <div className="flex flex-col gap-1 border-b border-border/70 pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground" id="resume-sections-heading">Select resume content</h2>
            <p className="mt-1 text-sm text-muted-foreground">The generated document always follows this order.</p>
          </div>
          <span className="text-sm text-muted-foreground">{selectedEntries.length} selected</span>
        </div>

        <div className="mt-5 grid gap-8">
          {sectionConfig.map((section) => {
            const sectionEntries = entriesBySection.get(section.type) ?? [];
            return (
              <section className="border-y border-border/70 py-6" key={section.type}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">{section.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{sectionEntries.length} available</span>
                    <AddEntryForm type={section.type} />
                  </div>
                </div>
                {sectionEntries.length === 0 ? (
                  <p className="mt-5 text-sm text-muted-foreground">
                    No {section.title.toLowerCase()} entries yet. Import from your profile or add a resume-only entry here.
                  </p>
                ) : (
                  <div className="mt-5 grid gap-3">
                    {sectionEntries.map((entry) => {
                      const selected = effectiveSelection[entry.id];
                      const variation = activeVariation(entry, selected);
                      const expanded = openEntryId === entry.id;
                      return (
                        <article
                          className="rounded-[8px] border border-border/70 bg-card/30 px-4 py-4 transition-colors hover:border-border sm:px-5"
                          key={entry.id}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              aria-label={`Include ${entry.title}`}
                              checked={Boolean(selected)}
                              className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-primary"
                              onChange={() => toggleEntry(entry)}
                              type="checkbox"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-sm font-medium text-foreground">{entry.title}</h4>
                                {entry.sourceProfileKey ? <Badge variant="secondary">Imported from profile</Badge> : null}
                                {variation ? <Badge variant="outline">{variation.name}</Badge> : null}
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {[entry.organization, entry.dateRange, entry.location].filter(Boolean).join(" · ") || displayResumeEntryType(entry.type)}
                              </p>
                              {!expanded && variation?.bullets[0] ? (
                                <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">{variation.bullets[0]}</p>
                              ) : null}
                            </div>
                            <Button
                              onClick={() => setOpenEntryId(expanded ? null : entry.id)}
                              size="icon-xs"
                              title={expanded ? "Collapse entry" : "Review entry"}
                              type="button"
                              variant="ghost"
                            >
                              {expanded ? <ChevronUp /> : <ChevronDown />}
                            </Button>
                          </div>
                          {expanded ? (
                            <EntryDetails
                              entry={entry}
                              onSelectVariation={(variationId) => selectVariation(entry, variationId)}
                              onToggleBullet={(bulletId) => toggleBullet(entry, bulletId)}
                              selected={selected}
                            />
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </section>

      <section className="border-y border-border/70 py-6" id="resume-draft">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            <h2 className="text-base font-semibold text-foreground">Save a resume draft</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">The build records the exact entry versions and bullets you selected. Generating a PDF uses the unified moderncv structure without modifying the profile.</p>
          </div>
          <form action={buildAction} className="border-t border-border/70 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <ActionRefresh success={state.success} />
            <input name="selectionJson" type="hidden" value={selectionJson} />
            <div className="grid gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Draft details</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Education, experience, projects, and skills appear in the unified template order.</p>
              </div>
              <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                Resume name
                <Input name="name" placeholder="Backend engineering resume" required />
              </label>
              <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                Saved job
                <select className="h-9 min-w-0 rounded-[8px] border border-input bg-card px-2.5 text-sm text-foreground" defaultValue="" name="targetJobId">
                  <option value="">General resume</option>
                  {savedJobs.map((job) => <option key={job.id} value={job.id}>{job.label}</option>)}
                </select>
              </label>
              <div className="border-l-2 border-primary/50 pl-3 text-xs leading-5 text-muted-foreground">
                Unified moderncv layout based on the approved Apply Overflow template.
              </div>
              <Button disabled={pending || selectedEntries.length === 0} size="sm" type="submit">
                {pending ? "Saving..." : "Save resume draft"}
              </Button>
            </div>
          </form>
        </div>
      </section>

      {builds.length > 0 ? (
        <section aria-labelledby="saved-builds-heading">
          <div className="flex items-end justify-between gap-3 border-b border-border/70 pb-3">
            <div>
              <h2 className="text-base font-semibold text-foreground" id="saved-builds-heading">Saved resume drafts</h2>
              <p className="mt-1 text-sm text-muted-foreground">Generate a PDF when the selection is ready. New drafts do not overwrite an existing output.</p>
            </div>
            <span className="text-sm text-muted-foreground">{builds.length}</span>
          </div>
          <div className="divide-y divide-border/60">
            {builds.map((build) => (
              <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between" key={build.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium text-foreground">{build.name}</span><Badge variant={build.status === "ARCHIVED" ? "secondary" : "outline"}>{build.status === "ARCHIVED" ? "Archived" : "Draft"}</Badge></div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{[build.targetJobLabel, `${build.itemCount} entries`, build.updatedAtLabel].filter(Boolean).join(" · ")}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <GeneratePdfAction build={build} />
                  {build.outputDocument ? <Button render={<Link href={build.outputDocument.href} />} size="xs" variant="ghost"><Download />Download</Button> : null}
                  <BuildAction build={build} type="duplicate" />
                  {build.status === "DRAFT" ? <BuildAction build={build} type="archive" /> : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
