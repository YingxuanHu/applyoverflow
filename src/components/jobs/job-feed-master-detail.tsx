"use client";

import { ReportJobDetails } from "@/components/jobs/report-job-details";

import Link from "next/link";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  ChevronDown,
  CircleDollarSign,
  ExternalLink,
  MapPin,
} from "lucide-react";

import { JobCardActions } from "@/components/jobs/job-card-actions";
import { MarkAppliedButton } from "@/components/jobs/mark-applied-button";
import { CompanyLogo } from "@/components/company-logo";
import { JobDescriptionContent } from "@/components/jobs/job-description-content";
import { Button } from "@/components/ui/button";
import {
  formatDisplayLabel,
  formatPostedAge,
  formatSalary,
  getDeadlineUrgencyAt,
} from "@/lib/job-display";
import { needsDescriptionRepair, resolveFeedDescription } from "@/lib/jobs/description-quality";
import { buildJobDetailHref } from "@/lib/jobs/return-navigation";
import { feedPositionKey, jobIdFromHash, parseFeedPosition, type FeedPosition } from "@/lib/jobs/feed-continuity";
import { groupFeedEntries } from "@/lib/jobs/feed-groups";
import { cn } from "@/lib/utils";
import type { JobCardData } from "@/types";

export type JobFeedEntry = {
  id: string;
  job: JobCardData;
  listMeta?: ReactNode;
  detailMeta?: ReactNode;
  detailActions?: ReactNode;
};

type JobFeedMasterDetailProps = {
  profileSkills?: string[];
  viewerId: string;
  entries: JobFeedEntry[];
  referenceNow: string;
  sourceHref?: string;
  onSavedChange?: (jobId: string, saved: boolean) => void;
};

export function JobFeedMasterDetail({
  profileSkills,
  viewerId,
  entries,
  onSavedChange,
  referenceNow,
  sourceHref,
}: JobFeedMasterDetailProps) {
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(
    entries[0]?.id ?? null,
  );
  const detailPanelRef = useRef<HTMLElement>(null);
  const listPanelRef = useRef<HTMLElement>(null);
  const positionRef = useRef<FeedPosition | null>(null);
  const [restoredDetailTop, setRestoredDetailTop] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const storageKey = feedPositionKey(viewerId, sourceHref ?? "/jobs");
  const entriesRef = useRef(entries);
  useEffect(() => { entriesRef.current = entries; }, [entries]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const restore = () => {
      let saved: FeedPosition | null = null;
      try { saved = parseFeedPosition(sessionStorage.getItem(storageKey)); } catch { /* Storage may be disabled. */ }
      const linked = jobIdFromHash(location.hash);
      const entry = entriesRef.current.find((item) => item.job.id === (linked ?? saved?.jobId)) ?? entriesRef.current[0];
      if (!entry) return;
      const sameJob = saved?.jobId === entry.job.id;
      positionRef.current = { jobId: entry.job.id, listTop: saved?.listTop ?? 0, detailTop: sameJob ? saved?.detailTop ?? 0 : 0, savedAt: Date.now() };
      setSelectedEntryId(entry.id);
      setRestoredDetailTop(positionRef.current.detailTop);
      const scroller = listPanelRef.current?.querySelector<HTMLElement>("[data-job-list-scroll]");
      if (scroller) scroller.scrollTop = saved?.listTop ?? 0;
    };
    const persist = () => {
      if (!positionRef.current) return;
      try {
        const keys = Object.keys(sessionStorage).filter((key) => key.startsWith("job-position:"));
        if (keys.length >= 30 && !sessionStorage.getItem(storageKey)) sessionStorage.removeItem(keys[0]);
        sessionStorage.setItem(storageKey, JSON.stringify({ ...positionRef.current, savedAt: Date.now() }));
      } catch { /* Navigation still works without persistence. */ }
    };
    const schedulePersist = () => { clearTimeout(timer); timer = setTimeout(persist, 150); };
    restore();
    window.addEventListener("hashchange", restore);
    window.addEventListener("pagehide", persist);
    const root = listPanelRef.current?.parentElement;
    root?.addEventListener("scroll", schedulePersist, true);
    root?.addEventListener("click", schedulePersist);
    return () => {
      clearTimeout(timer);
      persist();
      window.removeEventListener("hashchange", restore);
      window.removeEventListener("pagehide", persist);
      root?.removeEventListener("scroll", schedulePersist, true);
      root?.removeEventListener("click", schedulePersist);
    };
  }, [storageKey]);
  const [descriptions] = useState(() => new Map<string, string>());
  const returnToList = () => {
    const selected = listPanelRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    selected?.scrollIntoView({ block: "center" });
    selected?.focus({ preventScroll: true });
  };

  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ?? entries[0] ?? null;
  const groups = groupFeedEntries(entries).map((group) => {
    const expanded = expandedGroups.has(group[0].id);
    const representative = group.find((entry) => entry.id === selectedEntry?.id) ?? group[0];
    return { id: group[0].id, group, expanded, visible: expanded ? group : [representative] };
  });
  const visibleEntries = groups.flatMap((group) => group.visible);

  if (!selectedEntry) return null;

  const selectEntry = (entryId: string, moveToDetail = true) => {
    setSelectedEntryId(entryId);
    const jobId = entries.find((entry) => entry.id === entryId)?.job.id;
    if (jobId) {
      positionRef.current = { jobId, listTop: positionRef.current?.listTop ?? 0, detailTop: 0, savedAt: positionRef.current?.savedAt ?? 0 };
      setRestoredDetailTop(0);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#job-${jobId}`);
    }

    if (!moveToDetail || !window.matchMedia("(max-width: 1023px)").matches) return;

    window.requestAnimationFrame(() => {
      const detailPanel = detailPanelRef.current;
      if (!detailPanel) return;

      detailPanel.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
      detailPanel.focus({ preventScroll: true });
    });
  };

  return (
    <div className="grid min-w-0 gap-4 lg:h-[min(52rem,calc(100dvh-8rem))] lg:grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)] lg:items-stretch">
      <section
        ref={listPanelRef}
        aria-label="Jobs on this page"
        className="overflow-hidden rounded-[16px] border border-border/60 bg-card lg:flex lg:h-full lg:min-h-0 lg:flex-col"
      >
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 sm:px-5">
          <p className="text-sm font-medium text-foreground">
            {entries.length} job{entries.length === 1 ? "" : "s"} on this page
          </p>
          <p className="text-xs text-muted-foreground">Select a job to review</p>
        </div>
        <div data-job-list-scroll onScroll={(event) => { if (positionRef.current) positionRef.current.listTop = event.currentTarget.scrollTop; }} onKeyDown={(event) => {
          const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
          if (!keys.includes(event.key) || !(event.target instanceof HTMLElement) || !event.target.hasAttribute("data-job-entry")) return;
          event.preventDefault();
          const current = visibleEntries.findIndex((entry) => entry.id === selectedEntry.id);
          const index = event.key === "Home" ? 0 : event.key === "End" ? visibleEntries.length - 1 : Math.max(0, Math.min(visibleEntries.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
          selectEntry(visibleEntries[index].id, false);
          const button = event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-job-entry]")[index];
          button?.focus({ preventScroll: true });
          if (button) {
            const list = event.currentTarget;
            const rowRect = button.getBoundingClientRect();
            const listRect = list.getBoundingClientRect();
            if (rowRect.top < listRect.top) list.scrollTop += rowRect.top - listRect.top;
            else if (rowRect.bottom > listRect.bottom) list.scrollTop += rowRect.bottom - listRect.bottom;
          }
        }} className="max-h-[40rem] divide-y divide-border/55 overflow-y-auto lg:min-h-0 lg:max-h-none lg:flex-1">
          {groups.map(({ id, group, expanded, visible }) => <div key={id}>
          <div id={`job-group-${id}`} className="divide-y divide-border/55">
          {visible.map((entry) => (
            <JobFeedListRow
              active={entry.id === selectedEntry.id}
              entry={entry}
              key={entry.id}
              onSelect={() => selectEntry(entry.id)}
              referenceNow={referenceNow}
            />
          ))}
          </div>
          {group.length > 1 ? <button type="button" aria-expanded={expanded} aria-controls={`job-group-${id}`} onClick={() => setExpandedGroups((previous) => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          })} className="flex w-full items-center justify-between gap-2 px-5 pb-3 pt-1 text-left text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <span>{expanded ? "Collapse postings" : `${group.length - 1} other posting${group.length > 2 ? "s" : ""} on this page`}</span>
            <ChevronDown aria-hidden="true" className={cn("size-3.5 shrink-0", expanded && "rotate-180")} />
          </button> : null}
          </div>)}
        </div>
      </section>

      <JobFeedDetailPanel
        profileSkills={profileSkills}
        entry={selectedEntry}
        key={selectedEntry.id}
        panelRef={detailPanelRef}
        descriptions={descriptions}
        onBack={returnToList}
        onSavedChange={onSavedChange}
        referenceNow={referenceNow}
        sourceHref={sourceHref}
        initialScrollTop={restoredDetailTop}
        onDetailScroll={(top) => { if (positionRef.current) positionRef.current.detailTop = top; }}
      />
    </div>
  );
}

function JobFeedListRow({
  active,
  entry,
  onSelect,
  referenceNow,
}: {
  active: boolean;
  entry: JobFeedEntry;
  onSelect: () => void;
  referenceNow: string;
}) {
  const { job } = entry;
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod);
  const deadlineUrgency = getDeadlineUrgencyAt(job.deadline, referenceNow);

  return (
    <button
      data-job-entry={entry.id}
      aria-current={active ? "true" : undefined}
      className={cn(
        "relative block w-full border-l-2 px-4 py-4 text-left transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:px-5",
        active
          ? "border-l-primary bg-primary/[0.055]"
          : "border-l-transparent hover:bg-muted/45",
      )}
      onClick={onSelect}
      type="button"
    >
      <div className="flex min-w-0 items-start gap-3">
        <CompanyLogo company={job.company} domain={job.companyDomain} />
        <div className="min-w-0 flex-1">
        {entry.listMeta ? <div className="mb-2">{entry.listMeta}</div> : null}
        <p className="truncate text-sm font-semibold text-foreground sm:text-[15px]">
          {job.title}
        </p>
        <p className="mt-1 truncate text-sm text-foreground/80">{job.company}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <RowMeta icon={<MapPin className="h-3.5 w-3.5" />} value={job.location} />
        {job.workMode !== "UNKNOWN" ? (
          <RowMeta
            icon={<BriefcaseBusiness className="h-3.5 w-3.5" />}
            value={formatDisplayLabel(job.workMode)}
          />
        ) : null}
        {salary ? (
          <RowMeta
            icon={<CircleDollarSign className="h-3.5 w-3.5" />}
            value={salary}
          />
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>Posted {formatPostedAge(job.postedAt, referenceNow)}</span>
        {deadlineUrgency ? (
          <span className={deadlineUrgency.color}>{deadlineUrgency.label}</span>
        ) : null}
        {job.hasApplied ? (
          <span className="font-medium text-emerald-600 dark:text-emerald-400">Applied</span>
        ) : null}
      </div>
    </button>
  );
}

function JobFeedDetailPanel({
  profileSkills,
  initialScrollTop,
  onDetailScroll,
  entry,
  onSavedChange,
  panelRef,
  descriptions,
  onBack,
  referenceNow,
  sourceHref,
}: {
  profileSkills?: string[];
  initialScrollTop: number;
  onDetailScroll: (top: number) => void;
  entry: JobFeedEntry;
  onSavedChange?: (jobId: string, saved: boolean) => void;
  panelRef: RefObject<HTMLElement | null>;
  descriptions: Map<string, string>;
  onBack: () => void;
  referenceNow: string;
  sourceHref?: string;
}) {
  const { job } = entry;
  const [description, setDescription] = useState<string | null>(() => resolveFeedDescription(job, descriptions.get(job.id)));
  const [descriptionError, setDescriptionError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [markedApplied, setMarkedApplied] = useState(false);
  const hasApplied = job.hasApplied || markedApplied;
  const scrollRef = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  useEffect(() => {
    if (description === null) return;
    if (scrollRef.current) scrollRef.current.scrollTop = initialScrollTop;
    restoredRef.current = true;
  }, [description, initialScrollTop]);
  useEffect(() => {
    if ((job.description && !needsDescriptionRepair(job)) || descriptions.has(job.id)) {
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Description unavailable");
        const payload = await response.json() as { description?: string };
        if (controller.signal.aborted) return;
        const text = payload.description ?? "";
        if (descriptions.size >= 10) descriptions.delete(descriptions.keys().next().value!);
        descriptions.set(job.id, text);
        setDescription(text);
      })
      .catch(() => { if (!controller.signal.aborted) setDescriptionError(true); });
    return () => controller.abort();
  }, [job, descriptions, retry]);
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod);
  const deadlineUrgency = getDeadlineUrgencyAt(job.deadline, referenceNow);
  const postingHref = job.primaryExternalLink?.href ?? job.sourcePostingLink?.href;
  const descriptionText = resolveFeedDescription(job, description) ?? "";

  return (
    <aside
      aria-label={`Details for ${job.title}`}
      className="surface-panel flex min-h-[40rem] min-w-0 scroll-mt-20 flex-col overflow-hidden lg:h-full lg:min-h-0"
      ref={panelRef}
      tabIndex={-1}
    >
      <div className="shrink-0 border-b border-border/60 px-4 py-4 sm:px-5 sm:py-5">
        <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground lg:hidden">
          <ArrowLeft className="h-4 w-4" /> Back to jobs
        </button>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <CompanyLogo company={job.company} domain={job.companyDomain} size="md" />
            <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold leading-snug tracking-normal text-foreground [overflow-wrap:anywhere] sm:text-2xl">
              {job.title}
            </h2>
            <p className="mt-1.5 text-sm font-medium text-foreground/80 [overflow-wrap:anywhere]">{job.company}</p>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="h-4 w-4 shrink-0" />{job.location}</p>
            </div>
          </div>

          <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
            {postingHref ? (
              <Button
                className="h-10 rounded-[12px] px-3.5"
                render={<a href={postingHref} rel="noreferrer" target="_blank" />}
                size="sm"
              >
                Posting
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            ) : null}
            <MarkAppliedButton
              jobId={job.id}
              applied={hasApplied}
              onApplied={() => {
                setMarkedApplied(true);
                onSavedChange?.(job.id, false);
              }}
            />
            <JobCardActions
              align="end"
              iconOnly
              initialSaved={hasApplied ? false : job.isSaved}
              jobId={job.id}
              key={`${job.id}:${!hasApplied && job.isSaved ? "saved" : "unsaved"}`}
              onSavedChange={(saved) => onSavedChange?.(job.id, saved)}
            />
            {entry.detailActions}
          </div>
        </div>

      </div>

      <div ref={scrollRef} onScroll={(event) => { if (restoredRef.current) onDetailScroll(event.currentTarget.scrollTop); }} data-description-scroll className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
        {entry.detailMeta ? <div className="mb-4">{entry.detailMeta}</div> : null}
        <div className="mb-5 grid grid-cols-2 gap-x-4 gap-y-3 border-b border-border/60 pb-4 text-sm 2xl:grid-cols-4">
          <DetailField
            icon={<CalendarClock className="h-3.5 w-3.5" />}
            label="Posted"
            value={formatPostedAge(job.postedAt, referenceNow)}
          />
          <DetailField
            icon={<CircleDollarSign className="h-3.5 w-3.5" />}
            label="Salary"
            value={salary || "Not listed"}
          />
          <DetailField
            icon={<BriefcaseBusiness className="h-3.5 w-3.5" />}
            label="Work style"
            value={job.workMode === "UNKNOWN" ? "Not listed" : formatDisplayLabel(job.workMode)}
          />
          <DetailField
            icon={<Building2 className="h-3.5 w-3.5" />}
            label="Status"
            value={deadlineUrgency?.label ?? (hasApplied ? "Applied" : "Open")}
            valueClassName={deadlineUrgency?.color}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-foreground">Job description</p>
          <Link
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
            href={buildJobDetailHref(job.id, sourceHref, job.id)}
          >
            Full page
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
        <ReportJobDetails key={job.id} jobId={job.id} />
        {descriptionError ? (
          <p role="alert" className="mt-4 text-sm">Could not load the description. <button type="button" className="text-primary underline" onClick={() => { setDescriptionError(false); setRetry((value) => value + 1); }}>Try again</button></p>
        ) : null}
        {description === null && !descriptionError ? (
          <p role="status" className="mt-4 animate-pulse text-sm text-muted-foreground">Loading description...</p>
        ) : descriptionText.trim() ? (
          <div className="mt-4 pb-2">
            <JobDescriptionContent description={descriptionText} profileSkills={profileSkills} />
          </div>
        ) : !descriptionError ? (
          <p className="mt-4 text-sm text-muted-foreground">
            A full description is not available for this posting.
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function RowMeta({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-muted-foreground/70">{icon}</span>
      <span className="max-w-[14rem] truncate">{value}</span>
    </span>
  );
}

function DetailField({
  icon,
  label,
  value,
  valueClassName,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className={cn("mt-1 break-words text-sm leading-5 text-foreground", valueClassName)}>{value}</p>
    </div>
  );
}
