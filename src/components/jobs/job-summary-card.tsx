"use client";

import Link from "next/link";
import {
  BriefcaseBusiness,
  Building2,
  Check,
  CircleDollarSign,
  ExternalLink,
  MapPin,
} from "lucide-react";
import {
  formatDisplayLabel,
  formatPostedAge,
  formatSalary,
  getDeadlineUrgencyAt,
  getExpiringSoonMetaAt,
} from "@/lib/job-display";
import {
  getNormalizedRoleCategoryLabel,
  ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD,
} from "@/lib/job-metadata";
import {
  buildJobDetailHref,
  buildJobsReturnAnchorHash,
} from "@/lib/jobs/return-navigation";
import { rememberScrollAnchorForHref } from "@/components/navigation/scroll-position-memory";
import { cn } from "@/lib/utils";
import type { JobCardData } from "@/types";

type JobSummaryCardProps = {
  job: JobCardData;
  referenceNow?: string;
  footerActions?: React.ReactNode;
  sourceHref?: string;
  scrollMemoryKeyPrefix?: string;
};

export function JobSummaryCard({
  job,
  referenceNow,
  footerActions,
  sourceHref,
  scrollMemoryKeyPrefix,
}: JobSummaryCardProps) {
  const deadlineUrgency = getDeadlineUrgencyAt(job.deadline, referenceNow);
  const expiringSoon = getExpiringSoonMetaAt(job.deadline, referenceNow);
  const salaryLabel = formatSalary(
    job.salaryMin,
    job.salaryMax,
    job.salaryCurrency
  );
  const summary = job.shortSummary?.trim();
  const roleLabel =
    (job.normalizedRoleCategoryConfidence ?? 0) >= ROLE_CATEGORY_FILTER_CONFIDENCE_THRESHOLD
      ? getNormalizedRoleCategoryLabel(job.normalizedRoleCategory)
      : null;

  // Lifecycle cue shown in the secondary row for non-LIVE jobs
  const lifecycleCue = getLifecycleCue(job.status);
  const anchorId = buildJobsReturnAnchorHash(job.id).slice(1);

  return (
    <article
      data-job-card-id={job.id}
      id={anchorId || undefined}
      className={cn(
        "flex min-w-0 flex-col items-start justify-between gap-3 sm:flex-row sm:gap-3",
        (job.status === "EXPIRED" || job.status === "REMOVED") && "opacity-60"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={buildJobDetailHref(job.id, sourceHref, job.id)}
            onClick={() => {
              if (!scrollMemoryKeyPrefix) return;
              rememberScrollAnchorForHref({
                storageKeyPrefix: scrollMemoryKeyPrefix,
                href: sourceHref,
                anchorId: job.id,
              });
            }}
            className="mobile-list-title inline-block max-w-full text-base font-semibold text-foreground transition hover:underline sm:truncate"
          >
            {job.title}
          </Link>
          {lifecycleCue ? (
            <span className={`text-xs font-medium ${lifecycleCue.color}`}>
              {lifecycleCue.label}
            </span>
          ) : null}
          {job.hasApplied ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/[0.08] px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <Check className="h-3 w-3" aria-hidden="true" />
              Applied
            </span>
          ) : null}
          {expiringSoon ? (
            <span className="rounded-full border border-destructive/20 bg-destructive/[0.06] px-2 py-0.5 text-xs font-medium text-destructive">
              {expiringSoon.label}
            </span>
          ) : null}
        </div>

        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted-foreground sm:gap-x-4 sm:text-sm">
          <MetaField
            emphasis
            icon={<Building2 className="h-3.5 w-3.5" />}
            value={job.company}
          />
          <MetaField
            icon={<MapPin className="h-3.5 w-3.5" />}
            value={job.location}
          />
          <MetaField
            icon={<BriefcaseBusiness className="h-3.5 w-3.5" />}
            value={formatDisplayLabel(job.workMode)}
          />
          {salaryLabel ? (
            <MetaField
              icon={<CircleDollarSign className="h-3.5 w-3.5" />}
              value={salaryLabel}
            />
          ) : null}
        </div>

        {summary ? (
          <p className="mt-2 hidden max-w-3xl text-[13px] leading-5 text-muted-foreground sm:line-clamp-2 sm:text-sm">
            {summary}
          </p>
        ) : null}

        <p className="mt-2 truncate text-xs leading-5 text-muted-foreground sm:mt-3">
          Posted {formatPostedAge(job.postedAt, referenceNow)}
          {roleLabel ? (
            <>
              <Sep />
              {roleLabel}
            </>
          ) : null}
          {!expiringSoon && deadlineUrgency ? (
            <>
              <Sep />
              <span className={deadlineUrgency.color}>
                {deadlineUrgency.label}
              </span>
            </>
          ) : null}
        </p>
      </div>

      {job.primaryExternalLink || footerActions ? (
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:flex-col sm:items-end">
          {job.primaryExternalLink ? (
            <a
              className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full border border-border/70 bg-card px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex-none"
              href={job.primaryExternalLink.href}
              rel="noreferrer"
              target="_blank"
            >
              <span className="truncate">Posting</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
          {footerActions ? (
            <div className="min-w-0 flex-1 [&_button]:w-full [&_button_span]:truncate sm:flex-none sm:[&_button]:w-auto">
              {footerActions}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Sep() {
  return <span className="mx-1.5 text-border">·</span>;
}

function MetaField({
  emphasis,
  icon,
  value,
}: {
  emphasis?: boolean;
  icon: React.ReactNode;
  value: string;
}) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
      <span className="shrink-0 text-muted-foreground/70">{icon}</span>
      <span className={cn("max-w-[16rem] truncate sm:max-w-none", emphasis && "font-semibold text-foreground")}>
        {value}
      </span>
    </span>
  );
}

/**
 * Returns a lifecycle label + color for non-primary lifecycle states.
 * Returns null for LIVE.
 */
function getLifecycleCue(status: string): { label: string; color: string } | null {
  switch (status) {
    case "AGING":
      return { label: "Aging", color: "text-amber-500" };
    case "STALE":
      return { label: "Stale", color: "text-amber-600" };
    case "EXPIRED":
    case "REMOVED":
      // User-facing: EXPIRED and REMOVED are two internal lifecycle stages but
      // mean the same thing to users (the posting is no longer accepting
      // applications). Showing one combined "Expired/Closed" label keeps the
      // distinction in the data while removing the user confusion. DB enum
      // values stay EXPIRED and REMOVED.
      return { label: "Expired/Closed", color: "text-destructive" };
    default:
      return null;
  }
}
