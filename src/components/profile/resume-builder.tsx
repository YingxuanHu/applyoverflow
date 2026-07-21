"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Archive, ChevronDown, ChevronUp, Copy, ListPlus, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";

import {
  addResumeEntryVariation,
  addResumeLibraryEntry,
  archiveResumeBuild,
  createResumeBuild,
  duplicateResumeBuild,
  setDefaultResumeEntryVariation,
  syncResumeLibraryFromProfile,
} from "@/app/profile/resume-builder-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActionToast } from "@/components/ui/use-action-toast";
import { displayResumeEntryType, type ResumeLibraryEntryTypeValue } from "@/lib/resume-builder";

type ResumeVariation = {
  id: string;
  name: string;
  summary: string | null;
  bullets: string[];
  targetRoleTags: string[];
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
  variations: ResumeVariation[];
};

type ResumeBuild = {
  id: string;
  name: string;
  status: "DRAFT" | "ARCHIVED";
  updatedAtLabel: string;
  itemCount: number;
  templateName: string | null;
  targetJobLabel: string | null;
};

type ResumeTemplate = { id: string; title: string };
type SavedJob = { id: string; label: string };

type ResumeBuilderProps = {
  entries: ResumeEntry[];
  builds: ResumeBuild[];
  templates: ResumeTemplate[];
  savedJobs: SavedJob[];
};

type SelectionState = Record<string, { variationId: string; includedBulletIds: string[] }>;

const emptyState = () => ({ error: null, success: null });

function defaultVariation(entry: ResumeEntry) {
  return entry.variations.find((variation) => variation.isDefault) ?? entry.variations[0] ?? null;
}

function bulletIds(variation: ResumeVariation | null) {
  return variation?.bullets.map((_, index) => String(index)) ?? [];
}

function EntryTypeBadge({ type }: { type: ResumeLibraryEntryTypeValue }) {
  return (
    <Badge className="font-normal" variant="secondary">
      {displayResumeEntryType(type)}
    </Badge>
  );
}

function SyncFromProfileButton({ hasEntries }: { hasEntries: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(syncResumeLibraryFromProfile, emptyState());
  useActionToast(state, {
    successTitle: "Resume library updated",
    errorTitle: "Could not update resume library",
  });

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  return (
    <form action={action}>
      <Button disabled={pending} size="sm" type="submit" variant="outline">
        {pending ? "Updating..." : hasEntries ? "Refresh from profile" : "Add profile content"}
      </Button>
    </form>
  );
}

function AddEntryForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addResumeLibraryEntry, emptyState());
  useActionToast(state, { successTitle: "Resume content added", errorTitle: "Could not add content" });

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="sm" type="button" variant="outline">
        <ListPlus />
        Add content
      </Button>
    );
  }

  return (
    <form action={action} className="mt-3 grid gap-2 border-t border-border/70 pt-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Section
        <select className="h-9 rounded-[10px] border border-input bg-card px-2.5 text-sm text-foreground" defaultValue="EXPERIENCE" name="type">
          <option value="EXPERIENCE">Experience</option>
          <option value="PROJECT">Project</option>
          <option value="EDUCATION">Education</option>
          <option value="SKILL">Skills</option>
          <option value="CUSTOM">Additional</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Title
        <Input name="title" required />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Organization or school
        <Input name="organization" />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Dates
        <Input name="dateRange" placeholder="2022 - Present" />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-2">
        Verified details or bullets
        <textarea className="min-h-20 rounded-[10px] border border-input bg-card px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25" name="bullets" placeholder="One bullet per line" />
      </label>
      <div className="flex items-center justify-end gap-2 sm:col-span-2">
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

function VariationEditor({ entry }: { entry: ResumeEntry }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addResumeEntryVariation, emptyState());
  useActionToast(state, { successTitle: "Variation saved", errorTitle: "Could not save variation" });

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} size="xs" type="button" variant="ghost">
        Add variation
      </Button>
    );
  }

  return (
    <form action={action} className="mt-2 grid gap-2 border-t border-border/60 pt-2">
      <input name="entryId" type="hidden" value={entry.id} />
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Variation name
          <Input name="name" placeholder="Backend focus" required />
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted-foreground">
          Role tags
          <Input name="targetRoleTags" placeholder="Backend, platform" />
        </label>
      </div>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Approved bullets
        <textarea className="min-h-18 rounded-[10px] border border-input bg-card px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25" defaultValue={entry.summary ?? ""} name="bullets" />
      </label>
      <div className="flex justify-end gap-2">
        <Button onClick={() => setOpen(false)} size="xs" type="button" variant="ghost">Cancel</Button>
        <Button disabled={pending} size="xs" type="submit">{pending ? "Saving..." : "Save variation"}</Button>
      </div>
    </form>
  );
}

function DefaultVariationButton({ variationId, isDefault }: { variationId: string; isDefault: boolean }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(setDefaultResumeEntryVariation, emptyState());
  useActionToast(state, { successTitle: "Default variation updated", errorTitle: "Could not update variation" });
  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  if (isDefault) return <Badge variant="outline">Default</Badge>;
  return (
    <form action={action}>
      <input name="variationId" type="hidden" value={variationId} />
      <Button disabled={pending} size="xs" type="submit" variant="ghost">Make default</Button>
    </form>
  );
}

function LibraryEntry({ entry }: { entry: ResumeEntry }) {
  const [expanded, setExpanded] = useState(false);
  const variation = defaultVariation(entry);
  return (
    <article className="border-b border-border/60 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-medium text-foreground">{entry.title}</h4>
            <EntryTypeBadge type={entry.type} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {[entry.organization, entry.dateRange, entry.location].filter(Boolean).join(" · ") || "Master content"}
          </p>
        </div>
        <Button onClick={() => setExpanded((value) => !value)} size="icon-xs" title={expanded ? "Collapse entry" : "Expand entry"} type="button" variant="ghost">
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </Button>
      </div>
      {expanded ? (
        <div className="mt-3 grid gap-3">
          {entry.technologies.length > 0 ? <p className="text-xs text-muted-foreground">{entry.technologies.join(" · ")}</p> : null}
          {entry.variations.map((candidate) => (
            <div className="rounded-[10px] bg-muted/45 px-3 py-2" key={candidate.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-foreground">{candidate.name}</span>
                  {candidate.targetRoleTags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                </div>
                <DefaultVariationButton isDefault={candidate.isDefault} variationId={candidate.id} />
              </div>
              {candidate.bullets.length > 0 ? (
                <ul className="mt-2 grid gap-1 text-xs leading-5 text-muted-foreground">
                  {candidate.bullets.slice(0, 3).map((bullet, index) => <li key={index}>- {bullet}</li>)}
                </ul>
              ) : null}
            </div>
          ))}
          <VariationEditor entry={entry} />
        </div>
      ) : null}
      {!expanded && variation?.bullets[0] ? <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">{variation.bullets[0]}</p> : null}
    </article>
  );
}

function BuildAction({ build, type }: { build: ResumeBuild; type: "archive" | "duplicate" }) {
  const router = useRouter();
  const actionFn = type === "archive" ? archiveResumeBuild : duplicateResumeBuild;
  const [state, action, pending] = useActionState(actionFn, emptyState());
  useActionToast(state, { successTitle: type === "archive" ? "Build archived" : "Build duplicated", errorTitle: "Could not update build" });
  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);
  return (
    <form action={action}>
      <input name="buildId" type="hidden" value={build.id} />
      <Button disabled={pending} size="icon-xs" title={type === "archive" ? "Archive build" : "Duplicate build"} type="submit" variant="ghost">
        {type === "archive" ? <Archive /> : <Copy />}
      </Button>
    </form>
  );
}

export function ResumeBuilder({ entries, builds, templates, savedJobs }: ResumeBuilderProps) {
  const router = useRouter();
  const [selection, setSelection] = useState<SelectionState>({});
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [state, buildAction, pending] = useActionState(createResumeBuild, emptyState());
  useActionToast(state, { successTitle: "Resume draft saved", errorTitle: "Could not save resume draft" });
  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selection[entry.id]).map((entry, sortOrder) => ({
      entry,
      ...selection[entry.id],
      sortOrder,
    })),
    [entries, selection]
  );
  const selectionJson = JSON.stringify(selectedEntries.map(({ entry, variationId, includedBulletIds, sortOrder }) => ({
    entryId: entry.id,
    variationId,
    includedBulletIds,
    sortOrder,
  })));

  function toggleEntry(entry: ResumeEntry) {
    setSelection((current) => {
      if (current[entry.id]) {
        const remaining = { ...current };
        delete remaining[entry.id];
        return remaining;
      }
      const variation = defaultVariation(entry);
      if (!variation) return current;
      return { ...current, [entry.id]: { variationId: variation.id, includedBulletIds: bulletIds(variation) } };
    });
  }

  function selectVariation(entry: ResumeEntry, variationId: string) {
    const variation = entry.variations.find((candidate) => candidate.id === variationId) ?? null;
    if (!variation) return;
    setSelection((current) => ({
      ...current,
      [entry.id]: { variationId, includedBulletIds: bulletIds(variation) },
    }));
  }

  function toggleBullet(entryId: string, bulletId: string) {
    setSelection((current) => {
      const selected = current[entryId];
      if (!selected) return current;
      const includedBulletIds = selected.includedBulletIds.includes(bulletId)
        ? selected.includedBulletIds.filter((id) => id !== bulletId)
        : [...selected.includedBulletIds, bulletId];
      return { ...current, [entryId]: { ...selected, includedBulletIds } };
    });
  }

  return (
    <section className="border-y border-border/70 py-5 sm:py-6" id="resume-builder">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Resume builder</h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose approved content and variations, then save an exact draft for a role. Your original profile stays unchanged.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SyncFromProfileButton hasEntries={entries.length > 0} />
          <AddEntryForm />
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="mt-5 border border-dashed border-border/80 py-8 text-center">
          <p className="text-sm font-medium text-foreground">Start with your application profile</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Add verified experience, projects, education, or skills to the master library, then select the versions you want in each resume.</p>
        </div>
      ) : (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-2">
              <div>
                <h4 className="text-sm font-medium text-foreground">Master content</h4>
                <p className="mt-0.5 text-xs text-muted-foreground">Verified facts and approved variations.</p>
              </div>
              <span className="text-xs text-muted-foreground">{entries.length} entries</span>
            </div>
            <div>{entries.map((entry) => <LibraryEntry entry={entry} key={entry.id} />)}</div>
          </div>

          <form action={buildAction} className="min-w-0 border-t border-border/70 pt-4 xl:border-t-0 xl:border-l xl:pl-5 xl:pt-0">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-medium text-foreground">New resume draft</h4>
                <p className="mt-0.5 text-xs text-muted-foreground">Manual choices are saved as a frozen snapshot.</p>
              </div>
              <span className="text-xs text-muted-foreground">{selectedEntries.length} selected</span>
            </div>
            <input name="selectionJson" type="hidden" value={selectionJson} />
            <div className="mt-3 grid gap-3">
              <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                Resume name
                <Input name="name" placeholder="Backend engineering resume" required />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                  Saved job
                  <select className="h-9 min-w-0 rounded-[10px] border border-input bg-card px-2.5 text-sm text-foreground" defaultValue="" name="targetJobId">
                    <option value="">General resume</option>
                    {savedJobs.map((job) => <option key={job.id} value={job.id}>{job.label}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                  Template
                  <select className="h-9 min-w-0 rounded-[10px] border border-input bg-card px-2.5 text-sm text-foreground" defaultValue="" name="templateId">
                    <option value="">No template selected</option>
                    {templates.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}
                  </select>
                </label>
              </div>
              <div className="border-y border-border/70 py-2">
                {entries.map((entry) => {
                  const selected = selection[entry.id];
                  const variation = entry.variations.find((candidate) => candidate.id === selected?.variationId) ?? null;
                  const expanded = openEntryId === entry.id;
                  return (
                    <div className="border-b border-border/60 py-2 last:border-b-0" key={entry.id}>
                      <div className="flex items-center gap-2">
                        <input aria-label={`Include ${entry.title}`} checked={Boolean(selected)} className="h-4 w-4 rounded border-border accent-primary" onChange={() => toggleEntry(entry)} type="checkbox" />
                        <button className="min-w-0 flex-1 text-left text-sm font-medium text-foreground" onClick={() => selected && setOpenEntryId(expanded ? null : entry.id)} type="button">
                          <span className="truncate">{entry.title}</span>
                        </button>
                        <span className="text-xs text-muted-foreground">{displayResumeEntryType(entry.type)}</span>
                      </div>
                      {selected && variation ? (
                        <div className="mt-2 grid gap-2 pl-6">
                          <select aria-label={`Variation for ${entry.title}`} className="h-8 min-w-0 rounded-[8px] border border-input bg-card px-2 text-xs text-foreground" onChange={(event) => selectVariation(entry, event.target.value)} value={variation.id}>
                            {entry.variations.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}{candidate.isDefault ? " (default)" : ""}</option>)}
                          </select>
                          {variation.bullets.length > 0 ? (
                            <button className="w-fit text-xs text-primary hover:underline" onClick={() => setOpenEntryId(expanded ? null : entry.id)} type="button">
                              {expanded ? "Hide bullet choices" : `Choose bullets (${selected.includedBulletIds.length}/${variation.bullets.length})`}
                            </button>
                          ) : null}
                          {expanded ? (
                            <div className="grid gap-1.5">
                              {variation.bullets.map((bullet, index) => {
                                const id = String(index);
                                return <label className="flex items-start gap-2 text-xs leading-5 text-muted-foreground" key={id}><input checked={selected.includedBulletIds.includes(id)} className="mt-1 h-3.5 w-3.5 rounded border-border accent-primary" onChange={() => toggleBullet(entry.id, id)} type="checkbox" />{bullet}</label>;
                              })}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <Button disabled={pending || selectedEntries.length === 0} size="sm" type="submit">
                {pending ? "Saving..." : "Save resume draft"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {builds.length > 0 ? (
        <div className="mt-6 border-t border-border/70 pt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-medium text-foreground">Saved builds</h4>
              <p className="mt-0.5 text-xs text-muted-foreground">Snapshots stay intact when master content changes.</p>
            </div>
            <span className="text-xs text-muted-foreground">{builds.length}</span>
          </div>
          <div className="grid divide-y divide-border/60">
            {builds.map((build) => (
              <div className="flex items-center justify-between gap-3 py-2.5" key={build.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium text-foreground">{build.name}</span><Badge variant={build.status === "ARCHIVED" ? "secondary" : "outline"}>{build.status === "ARCHIVED" ? "Archived" : "Draft"}</Badge></div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{[build.targetJobLabel, build.templateName, `${build.itemCount} entries`, build.updatedAtLabel].filter(Boolean).join(" · ")}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1"><BuildAction build={build} type="duplicate" />{build.status === "DRAFT" ? <BuildAction build={build} type="archive" /> : null}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
