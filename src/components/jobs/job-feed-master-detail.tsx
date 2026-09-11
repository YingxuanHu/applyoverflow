"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CircleDollarSign,
  ExternalLink,
  MapPin,
} from "lucide-react";

import { JobCardActions } from "@/components/jobs/job-card-actions";
import { JobMetaRow } from "@/components/jobs/job-meta-row";
import { Button } from "@/components/ui/button";
import {
  formatDisplayLabel,
  formatPostedAge,
  formatSalary,
  getDeadlineUrgencyAt,
} from "@/lib/job-display";
import { buildJobDetailHref } from "@/lib/jobs/return-navigation";
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
  entries: JobFeedEntry[];
  referenceNow: string;
  sourceHref?: string;
  onSavedChange?: (jobId: string, saved: boolean) => void;
};

export function JobFeedMasterDetail({
  entries,
  onSavedChange,
  referenceNow,
  sourceHref,
}: JobFeedMasterDetailProps) {
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(
    entries[0]?.id ?? null,
  );

  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ?? entries[0] ?? null;

  if (!selectedEntry) return null;

  return (
    <div className="grid min-w-0 gap-4 lg:h-[min(46rem,calc(100dvh-10rem))] lg:grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)] lg:items-stretch">
      <section
        aria-label="Jobs on this page"
        className="overflow-hidden rounded-[16px] border border-border/60 bg-card lg:flex lg:h-full lg:flex-col"
      >
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 sm:px-5">
          <p className="text-sm font-medium text-foreground">
            {entries.length} job{entries.length === 1 ? "" : "s"} on this page
          </p>
          <p className="text-xs text-muted-foreground">Select a job to review</p>
        </div>
        <div className="max-h-[34rem] divide-y divide-border/55 overflow-y-auto lg:min-h-0 lg:max-h-none lg:flex-1">
          {entries.map((entry) => (
            <JobFeedListRow
              active={entry.id === selectedEntry.id}
              entry={entry}
              key={entry.id}
              onSelect={() => setSelectedEntryId(entry.id)}
              referenceNow={referenceNow}
            />
          ))}
        </div>
      </section>

      <JobFeedDetailPanel
        entry={selectedEntry}
        key={selectedEntry.id}
        onSavedChange={onSavedChange}
        referenceNow={referenceNow}
        sourceHref={sourceHref}
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
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency);
  const deadlineUrgency = getDeadlineUrgencyAt(job.deadline, referenceNow);

  return (
    <button
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
      <div className="min-w-0">
        {entry.listMeta ? <div className="mb-2">{entry.listMeta}</div> : null}
        <p className="truncate text-sm font-semibold text-foreground sm:text-[15px]">
          {job.title}
        </p>
        <p className="mt-1 truncate text-sm text-foreground/80">{job.company}</p>
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
  entry,
  onSavedChange,
  referenceNow,
  sourceHref,
}: {
  entry: JobFeedEntry;
  onSavedChange?: (jobId: string, saved: boolean) => void;
  referenceNow: string;
  sourceHref?: string;
}) {
  const { job } = entry;
  const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency);
  const deadlineUrgency = getDeadlineUrgencyAt(job.deadline, referenceNow);
  const postingHref = job.primaryExternalLink?.href ?? job.sourcePostingLink?.href;
  const description = job.description.trim();

  return (
    <aside
      aria-label={`Details for ${job.title}`}
      className="surface-panel flex min-h-[35rem] min-w-0 flex-col overflow-hidden lg:h-full"
    >
      <div className="shrink-0 border-b border-border/60 px-4 py-4 sm:px-5 sm:py-5">
        {entry.detailMeta ? <div className="mb-3">{entry.detailMeta}</div> : null}
        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold leading-snug tracking-tight text-foreground sm:text-2xl">
              {job.title}
            </h2>
            <p className="mt-1.5 text-sm font-medium text-foreground/80">{job.company}</p>
            <JobMetaRow
              className="mt-3"
              company={job.company}
              geoScope={job.geoScope}
              location={job.location}
              primaryExternalLink={null}
              salaryCurrency={job.salaryCurrency}
              salaryMax={job.salaryMax}
              salaryMin={job.salaryMin}
              variant="detail"
              workMode={job.workMode}
            />
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:justify-end">
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
            <JobCardActions
              align="end"
              iconOnly
              initialSaved={job.isSaved}
              jobId={job.id}
              key={`${job.id}:${job.isSaved ? "saved" : "unsaved"}`}
              onSavedChange={(saved) => onSavedChange?.(job.id, saved)}
            />
            {entry.detailActions}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/60 pt-4 text-sm sm:grid-cols-4">
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
            value={deadlineUrgency?.label ?? (job.hasApplied ? "Applied" : "Open")}
            valueClassName={deadlineUrgency?.color}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
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
        {description ? (
          <div className="mt-4 whitespace-pre-wrap text-sm leading-6 text-foreground/82">
            {description}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            A full description is not available for this posting.
          </p>
        )}
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
      <p className={cn("mt-1 truncate text-sm text-foreground", valueClassName)}>{value}</p>
    </div>
  );
}
