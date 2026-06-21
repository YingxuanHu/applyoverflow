"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { RefreshCw, Sparkles, X } from "lucide-react";

import { JobCardActions } from "@/components/jobs/job-card-actions";
import { JobSummaryCard } from "@/components/jobs/job-summary-card";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/components/ui/notification-provider";
import type { TopPickCardData } from "@/lib/queries/top-picks";
import { cn } from "@/lib/utils";

type TopPicksStatus = {
  lastComputedAt: string | null;
  profileVersion?: number | null;
  stale: boolean;
  validCount: number;
  hasProfileSnapshot: boolean;
  refreshing?: boolean;
};

type TopPicksListProps = {
  initialPicks: TopPickCardData[];
  referenceNow: string;
  compact?: boolean;
};

const TOP_PICKS_AUTO_REFRESH_RETRY_MS = 15 * 60_000;

export function TopPicksList({
  initialPicks,
  referenceNow,
  compact = false,
}: TopPicksListProps) {
  const { notify } = useNotifications();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const sourceHref = search ? `${pathname}?${search}` : pathname;
  const [picks, setPicks] = useState(initialPicks);
  const [pendingFeedbackJobId, setPendingFeedbackJobId] = useState<string | null>(null);

  useEffect(() => {
    setPicks(initialPicks);
  }, [initialPicks]);

  function handleSavedChange(jobId: string, saved: boolean) {
    setPicks((current) =>
      current.map((pick) =>
        pick.job.id === jobId ? { ...pick, job: { ...pick.job, isSaved: saved } } : pick
      )
    );
  }

  function markNotInterested(jobId: string) {
    if (pendingFeedbackJobId) return;

    setPendingFeedbackJobId(jobId);
    fetch("/api/jobs/top-picks/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, feedbackType: "NOT_INTERESTED" }),
    })
      .then((response) => {
        if (!response.ok) throw new Error("feedback failed");
        setPicks((current) => current.filter((pick) => pick.job.id !== jobId));
        notify({
          title: "Removed from top picks",
          message: "Future recommendations will account for this feedback.",
          tone: "success",
        });
      })
      .catch((error) => {
        console.error(error);
        notify({
          title: "Could not save feedback",
          message: "Try again in a moment.",
          tone: "error",
        });
      })
      .finally(() => setPendingFeedbackJobId(null));
  }

  if (picks.length === 0) {
    return (
      <div className="empty-state flex min-h-[180px] flex-col items-center justify-center px-4 py-10 text-center">
        <p className="text-sm font-medium text-foreground">No top picks ready yet</p>
        <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
          Recommendations are generated from your saved profile. You can keep browsing jobs while this finishes.
        </p>
      </div>
    );
  }

  return (
    <ul className={compact ? "grid gap-2 lg:grid-cols-2" : "object-list"}>
      {picks.map((pick) => (
        <li className={compact ? "" : "object-row"} key={pick.id}>
          <TopPickCard
            compact={compact}
            onNotInterested={() => markNotInterested(pick.job.id)}
            onSavedChange={(saved) => handleSavedChange(pick.job.id, saved)}
            pendingFeedback={pendingFeedbackJobId === pick.job.id}
            pick={pick}
            referenceNow={referenceNow}
            sourceHref={sourceHref}
          />
        </li>
      ))}
    </ul>
  );
}

function TopPickCard({
  compact,
  onNotInterested,
  onSavedChange,
  pendingFeedback,
  pick,
  referenceNow,
  sourceHref,
}: {
  compact?: boolean;
  onNotInterested: () => void;
  onSavedChange: (saved: boolean) => void;
  pendingFeedback: boolean;
  pick: TopPickCardData;
  referenceNow: string;
  sourceHref?: string;
}) {
  return (
    <div className={cn("space-y-3", compact && "rounded-md border border-border/60 p-3")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/[0.08] px-2 py-0.5 text-xs font-medium text-primary">
              <Sparkles className="h-3 w-3" />
              {pick.score}% match
            </span>
            <span className="text-xs text-muted-foreground">Rank #{pick.rank}</span>
          </div>
          {pick.matchReasons.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {pick.matchReasons.slice(0, compact ? 2 : 3).map((reason) => (
                <li
                  className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
                  key={reason}
                >
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {pick.concerns.length > 0 && !compact ? (
          <p className="max-w-sm text-xs leading-5 text-muted-foreground">
            {pick.concerns[0]}
          </p>
        ) : null}
      </div>

      <JobSummaryCard
        footerActions={
          <div className="grid gap-1.5">
            <JobCardActions
              align="end"
              compact
              initialSaved={pick.job.isSaved}
              jobId={pick.job.id}
              onSavedChange={onSavedChange}
            />
            <Button
              className="h-8 rounded-full px-3 text-[13px] font-medium"
              disabled={pendingFeedback}
              onClick={onNotInterested}
              size="sm"
              type="button"
              variant="ghost"
            >
              <X className="h-3.5 w-3.5" />
              Not interested
            </Button>
          </div>
        }
        job={pick.job}
        referenceNow={referenceNow}
        scrollMemoryKeyPrefix="autoapplication.top-picks.scroll"
        sourceHref={sourceHref}
      />
    </div>
  );
}

export function TopPicksRefreshButton({
  compact,
  disabled,
}: {
  compact?: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const { notify } = useNotifications();
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    if (refreshing || disabled) return;

    setRefreshing(true);
    try {
      const response = await fetch("/api/jobs/top-picks/refresh", { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "refresh failed");
      }

      const body = await response.json().catch(() => null);
      notify({
        title: body?.status === "running" ? "Refresh already running" : "Generating top picks",
        message: "This runs in the background, so you can keep browsing.",
        tone: "info",
      });

      const status = await waitForRefreshToSettle();
      router.refresh();

      if (status) {
        notify({
          title: "Top picks refreshed",
          message:
            status.validCount > 0
              ? `${status.validCount.toLocaleString()} recommendations are ready.`
              : "Refresh finished. More profile signal may improve matches.",
          tone: "success",
        });
      } else {
        notify({
          title: "Still generating",
          message: "The refresh is taking longer than usual. The page will use cached picks until it finishes.",
          tone: "info",
        });
      }
    } catch (error) {
      console.error(error);
      notify({
        title: "Could not refresh picks",
        message: error instanceof Error ? error.message : "Try again later.",
        tone: "error",
      });
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Button
      className={cn(
        "inline-flex items-center justify-center gap-2",
        compact ? "h-8 rounded-full px-3 text-xs" : undefined
      )}
      disabled={disabled || refreshing}
      onClick={refresh}
      size={compact ? "sm" : "default"}
      type="button"
      variant="outline"
    >
      <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
      {refreshing ? "Refreshing" : "Refresh picks"}
    </Button>
  );
}

export function TopPicksAutoRefresh({
  enabled,
  storageKey,
}: {
  enabled: boolean;
  storageKey: string;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const key = `applyoverflow.top-picks.refresh:${storageKey}`;
    const previousAttempt = window.sessionStorage.getItem(key);
    if (previousAttempt) {
      const previousMs = Date.parse(previousAttempt);
      if (
        Number.isFinite(previousMs) &&
        Date.now() - previousMs < TOP_PICKS_AUTO_REFRESH_RETRY_MS
      ) {
        return;
      }
    }

    window.sessionStorage.setItem(key, new Date().toISOString());
    fetch("/api/jobs/top-picks/refresh", { method: "POST" })
      .then((response) => {
        if (!response.ok) return null;
        return waitForRefreshToSettle();
      })
      .then((status) => {
        if (status) router.refresh();
      })
      .catch((error) => {
        console.error("Top picks background refresh failed", error);
      });
  }, [enabled, router, storageKey]);

  return null;
}

async function waitForRefreshToSettle() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const response = await fetch("/api/jobs/top-picks/status", {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const status = (await response.json()) as TopPicksStatus;
    if (!status.refreshing) return status;
  }
  return null;
}
