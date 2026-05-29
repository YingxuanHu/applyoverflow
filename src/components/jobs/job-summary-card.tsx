import Link from "next/link";
import {
  Bot,
  BriefcaseBusiness,
  Building2,
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
  getSubmissionMeta,
  shouldShowSubmissionMeta,
} from "@/lib/job-display";
import { cn } from "@/lib/utils";
import type { JobCardData } from "@/types";

type JobSummaryCardProps = {
  job: JobCardData;
  referenceNow?: string;
  footerActions?: React.ReactNode;
};

export function JobSummaryCard({
  job,
  referenceNow,
  footerActions,
}: JobSummaryCardProps) {
  const deadlineUrgency = getDeadlineUrgencyAt(job.deadline, referenceNow);
  const expiringSoon = getExpiringSoonMetaAt(job.deadline, referenceNow);
  const showSubmissionMeta = shouldShowSubmissionMeta(job);
  const submissionMeta = getSubmissionMeta(job);
  const salaryLabel = formatSalary(
    job.salaryMin,
    job.salaryMax,
    job.salaryCurrency
  );
  const summary = job.shortSummary?.trim();

  // Lifecycle cue shown in the secondary row for non-LIVE jobs
  const lifecycleCue = getLifecycleCue(job.status);

  return (
    <article
      className={cn(
        "flex flex-wrap items-start justify-between gap-3",
        (job.status === "EXPIRED" || job.status === "REMOVED") && "opacity-60"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/jobs/${job.id}`}
            className="inline-block max-w-full truncate text-base font-semibold text-foreground transition hover:underline"
          >
            {job.title}
          </Link>
          {showSubmissionMeta ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
              title="Auto-apply ready"
            >
              <Bot className="h-3 w-3" aria-hidden="true" />
              {submissionMeta.label}
            </span>
          ) : null}
          {lifecycleCue ? (
            <span className={`text-xs font-medium ${lifecycleCue.color}`}>
              {lifecycleCue.label}
            </span>
          ) : null}
          {expiringSoon ? (
            <span className="rounded-full border border-destructive/20 bg-destructive/[0.06] px-2 py-0.5 text-xs font-medium text-destructive">
              {expiringSoon.label}
            </span>
          ) : null}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
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
          <p className="mt-2 line-clamp-2 max-w-3xl text-sm text-muted-foreground">
            {summary}
          </p>
        ) : null}

        <p className="mt-3 text-xs text-muted-foreground">
          Posted {formatPostedAge(job.postedAt, referenceNow)}
          <Sep />
          {job.roleFamily}
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
        <div className="flex w-full shrink-0 flex-wrap items-start justify-start gap-2 sm:w-auto sm:justify-end">
          {job.primaryExternalLink ? (
            <a
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-background/75 px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
              href={job.primaryExternalLink.href}
              rel="noreferrer"
              target="_blank"
            >
              Posting
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
          {footerActions}
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
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-muted-foreground/70">{icon}</span>
      <span className={cn("truncate", emphasis && "font-semibold text-foreground")}>
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
