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
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  addResumeLibraryEntry,
  applyResumeEntryRewrite,
  archiveResumeBuild,
  createResumeBuild,
  dismissResumeEntryRewrite,
  duplicateResumeBuild,
  generateResumeBuildPdf,
  generateResumeEntryVariation,
  syncResumeLibraryFromProfile,
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
import { useActionToast } from "@/components/ui/use-action-toast";
import {
  RESUME_BUILD_SECTION_ORDER,
  displayResumeEntryType,
  type ResumeLibraryEntryTypeValue,
} from "@/lib/resume-builder";

type ResumeVariation = {
  id: string;
  name: string;
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

function SyncFromProfileButton({ hasEntries }: { hasEntries: boolean }) {
  const [state, action, pending] = useActionState(syncResumeLibraryFromProfile, emptyState());
  useActionToast(state, {
    successTitle: "Resume content refreshed",
    errorTitle: "Could not refresh resume content",
  });

  return (
    <form action={action}>
      <ActionRefresh success={state.success} />
      <Button disabled={pending} size="sm" type="submit" variant="outline">
        {pending ? "Refreshing..." : hasEntries ? "Refresh from profile" : "Load profile content"}
      </Button>
    </form>
  );
}

function AddEntryForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addResumeLibraryEntry, emptyState());
  useActionToast(state, { successTitle: "Content added", errorTitle: "Could not add content" });

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm" type="button" variant="outline">
        <ListPlus />
        Add standalone entry
      </Button>
    );
  }

  return (
    <form action={action} className="grid gap-3 border-y border-border/70 py-4 sm:grid-cols-2">
      <ActionRefresh success={state.success} />
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Section
        <select
          className="h-9 rounded-[8px] border border-input bg-card px-2.5 text-sm text-foreground"
          defaultValue="EXPERIENCE"
          name="type"
        >
          <option value="EDUCATION">Education</option>
          <option value="EXPERIENCE">Experience</option>
          <option value="PROJECT">Project</option>
          <option value="SKILL">Skills</option>
        </select>
      </label>
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
  onClose,
}: {
  entry: ResumeEntry;
  baseVariation: ResumeVariation;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(generateResumeEntryVariation, emptyState());
  useActionToast(state, { successTitle: "AI rewrite ready", errorTitle: "Could not generate rewrite" });
  useEffect(() => {
    if (state.success) onClose();
  }, [onClose, state.success]);

  return (
    <form action={action} className="grid gap-3 border-t border-border/60 pt-4">
      <ActionRefresh success={state.success} />
      <input name="entryId" type="hidden" value={entry.id} />
      <input name="variationId" type="hidden" value={baseVariation.id} />
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        What should this entry emphasize?
        <textarea
          className="min-h-24 rounded-[8px] border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
          name="instruction"
          placeholder="For a software engineering role, emphasize architecture, reliability, and the engineering decisions behind this work."
          required
        />
      </label>
      <p className="text-xs leading-5 text-muted-foreground">
        AI uses this entry together with your Application profile as evidence. It preserves the facts, metrics, bullet count, and comparable length, and never changes your profile.
      </p>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose} size="xs" type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={pending} size="xs" type="submit">
          <Sparkles />
          {pending ? "Writing..." : "Create rewrite"}
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
  useActionToast(state, { successTitle: "Resume entry updated", errorTitle: "Could not update resume entry" });
  useEffect(() => {
    if (state.success) onClose();
  }, [onClose, state.success]);

  return (
    <form action={action} className="grid gap-3 border-t border-border/60 pt-4 sm:grid-cols-2">
      <ActionRefresh success={state.success} />
      <input name="entryId" type="hidden" value={entry.id} />
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Title
        <Input defaultValue={entry.title} name="title" required />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Organization or role
        <Input defaultValue={entry.organization ?? ""} name="organization" />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Dates
        <Input defaultValue={entry.dateRange ?? ""} name="dateRange" />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Location
        <Input defaultValue={entry.location ?? ""} name="location" />
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
        Bullets
        <textarea
          className="min-h-32 rounded-[8px] border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
          defaultValue={baseVariation?.bullets.join("\n") ?? ""}
          name="bullets"
          placeholder="One bullet per line"
        />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
        Technologies
        <Input defaultValue={entry.technologies.join(", ")} name="technologies" placeholder="TypeScript, PostgreSQL" />
      </label>
      <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
        This saves a resume-only working copy. Your Application profile remains unchanged.
      </p>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button onClick={onClose} size="xs" type="button" variant="ghost">Cancel</Button>
        <Button disabled={pending} size="xs" type="submit">
          <Pencil />
          {pending ? "Saving..." : "Save entry"}
        </Button>
      </div>
    </form>
  );
}

function RewriteAction({ variationId }: { variationId: string }) {
  const [state, action, pending] = useActionState(applyResumeEntryRewrite, emptyState());
  useActionToast(state, { successTitle: "AI rewrite applied", errorTitle: "Could not apply rewrite" });

  return (
    <form action={action}>
      <ActionRefresh success={state.success} />
      <input name="variationId" type="hidden" value={variationId} />
      <Button disabled={pending} size="xs" type="submit">
        <Check />
        {pending ? "Applying..." : "Use rewrite"}
      </Button>
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

function EntryDetails({
  entry,
  selected,
  onToggleBullet,
}: {
  entry: ResumeEntry;
  selected: SelectionState[string] | undefined;
  onToggleBullet: (bulletId: string) => void;
}) {
  const baseVariation = defaultVariation(entry);
  const pendingRewrites = entry.variations.filter(
    (variation) => variation.approvalStatus === "PENDING" && variation.source === "AI_GENERATED"
  );
  const [composer, setComposer] = useState<"manual" | "ai" | null>(null);

  return (
    <div className="mt-3 grid gap-4 border-t border-border/60 pt-4">
      {entry.technologies.length > 0 ? (
        <p className="text-xs text-muted-foreground">{entry.technologies.join(" · ")}</p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">Current working copy</p>
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
              Edit entry
            </DropdownMenuItem>
            {hasEditableCopy(entry) && baseVariation ? (
              <DropdownMenuItem className="cursor-pointer" onClick={() => setComposer("ai")}>
                <Sparkles />
                Rewrite with AI
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {baseVariation?.bullets.length ? (
        <div className="grid gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            {selected ? "Bullets in this draft" : "Bullets"}
          </p>
          {baseVariation.bullets.map((bullet, index) => {
            const id = String(index);
            return selected ? (
              <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground" key={id}>
                <input
                  checked={selected.includedBulletIds.includes(id)}
                  className="mt-1 h-3.5 w-3.5 rounded border-border accent-primary"
                  onChange={() => onToggleBullet(id)}
                  type="checkbox"
                />
                {bullet}
              </label>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground" key={id}>- {bullet}</p>
            );
          })}
        </div>
      ) : null}

      {composer === "manual" ? (
        <ManualEntryEditor
          baseVariation={baseVariation}
          entry={entry}
          onClose={() => setComposer(null)}
        />
      ) : null}
      {composer === "ai" && baseVariation ? (
        <RevisionRequest
          baseVariation={baseVariation}
          entry={entry}
          onClose={() => setComposer(null)}
        />
      ) : null}

      {pendingRewrites.map((proposal) => (
        <div className="border-t border-border/60 pt-4" key={proposal.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium text-foreground">AI rewrite ready</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Review the wording, then use it or dismiss it.</p>
            </div>
            <div className="flex items-center gap-1">
              <DismissRewriteAction variationId={proposal.id} />
              <RewriteAction variationId={proposal.id} />
            </div>
          </div>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div className="border-l-2 border-border pl-3">
              <p className="text-xs font-medium text-muted-foreground">Current wording</p>
              <ul className="mt-2 grid gap-1 text-xs leading-5 text-muted-foreground">
                {(baseVariation?.bullets ?? []).map((bullet, index) => <li key={index}>- {bullet}</li>)}
              </ul>
            </div>
            <div className="border-l-2 border-primary pl-3">
              <p className="text-xs font-medium text-primary">AI rewrite</p>
              <ul className="mt-2 grid gap-1 text-xs leading-5 text-muted-foreground">
                {proposal.bullets.map((bullet, index) => <li key={index}>- {bullet}</li>)}
              </ul>
            </div>
          </div>
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

  // A rewrite can arrive through a server refresh while this client component
  // keeps its selection state. Resolve selected entries against the current
  // working copy at render time so saving a draft cannot retain the old text.
  const effectiveSelection = useMemo<SelectionState>(() => {
    const next: SelectionState = {};
    for (const entry of entries) {
      const selected = selection[entry.id];
      if (!selected) continue;
      const variation = defaultVariation(entry);
      if (!variation) continue;
      next[entry.id] =
        selected.variationId === variation.id
          ? selected
          : { variationId: variation.id, includedBulletIds: bulletIds(variation) };
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
      if (!currentSelection) return current;
      const variation = defaultVariation(entry);
      if (!variation) return current;
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
              Build focused, one-page-ready resumes from your application profile. Your profile remains the source of truth; each draft is a frozen selection using the unified Apply Overflow LaTeX layout.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button render={<Link href="/profile" />} size="sm" variant="outline">
              Edit application profile
            </Button>
            <SyncFromProfileButton hasEntries={entries.length > 0} />
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

        {entries.length === 0 ? (
          <div className="border-b border-dashed border-border/80 py-10 text-center">
            <p className="text-sm font-medium text-foreground">Start with Application profile</p>
            <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">Profile resume uploads automatically extract and merge education, experience, projects, and skills. Then refresh this workspace to select them.</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button render={<Link href="/profile" />} size="sm">Open application profile</Button>
              <SyncFromProfileButton hasEntries={false} />
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border/70">
            {sectionConfig.map((section) => {
              const sectionEntries = entriesBySection.get(section.type) ?? [];
              return (
                <section className="py-6" key={section.type}>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-foreground">{section.title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{sectionEntries.length} available</span>
                  </div>
                  {sectionEntries.length === 0 ? (
                    <p className="mt-4 text-sm text-muted-foreground">No {section.title.toLowerCase()} content yet. Refresh from profile or add an entry below.</p>
                  ) : (
                    <div className="mt-4 divide-y divide-border/60 border-y border-border/60">
                      {sectionEntries.map((entry) => {
                        const selected = effectiveSelection[entry.id];
                        const variation =
                          entry.variations.find(
                            (candidate) =>
                              candidate.id === selected?.variationId &&
                              candidate.approvalStatus === "APPROVED"
                          ) ?? defaultVariation(entry);
                        const expanded = openEntryId === entry.id;
                        return (
                          <article className="py-3" key={entry.id}>
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
                                  {entry.sourceProfileKey ? <Badge variant="secondary">Profile linked</Badge> : null}
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">{[entry.organization, entry.dateRange, entry.location].filter(Boolean).join(" · ") || displayResumeEntryType(entry.type)}</p>
                                {!expanded && variation?.bullets[0] ? <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">{variation.bullets[0]}</p> : null}
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
        )}
      </section>

      <section className="border-y border-border/70 py-6" id="resume-draft">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            <h2 className="text-base font-semibold text-foreground">Save a resume draft</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">The build records exactly which working copies and bullets you selected. Generating a PDF uses the unified moderncv structure without modifying the profile.</p>
            <AddEntryForm />
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
