"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { LoaderCircle, RefreshCw, Sparkles, X } from "lucide-react";

import { JobFeedMasterDetail } from "@/components/jobs/job-feed-master-detail";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/components/ui/notification-provider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { TopPickCardData } from "@/lib/queries/top-picks";
import { cn } from "@/lib/utils";
import { TOP_PICK_FEEDBACK_OPTIONS, type TopPickFeedbackType } from "@/lib/top-picks/feedback-options";
import { HiddenPicks } from "@/components/jobs/hidden-picks";

type TopPicksStatus = {
  lastComputedAt: string | null;
  profileVersion?: number | null;
  stale: boolean;
  validCount: number;
  hasProfileSnapshot: boolean;
  profileReady?: boolean;
  canRefresh?: boolean;
  missingProfileSignals?: string[];
  profileReadinessMessage?: string;
  refreshing?: boolean;
};

type TopPicksEmptyState = {
  title: string;
  message: string;
  actionHref?: string;
  actionLabel?: string;
};

type TopPicksListProps = {
  profileSkills?: string[];
  viewerId: string;
  initialPicks: TopPickCardData[];
  referenceNow: string;
  emptyState?: TopPicksEmptyState;
};

const TOP_PICKS_AUTO_REFRESH_RETRY_MS = 15 * 60_000;

type TopPicksRefreshContextValue = {
  isInitialLoad: boolean;
};

const TopPicksRefreshContext = createContext<TopPicksRefreshContextValue>({
  isInitialLoad: false,
});

function useTopPicksRefreshState() {
  return useContext(TopPicksRefreshContext);
}

export function TopPicksRefreshCoordinator({
  children,
  initialLoad,
  refreshEnabled,
  refreshInProgress = false,
  storageKey,
}: {
  children: ReactNode;
  initialLoad: boolean;
  refreshEnabled: boolean;
  refreshInProgress?: boolean;
  storageKey: string;
}) {
  const router = useRouter();
  const [isInitialLoad, setIsInitialLoad] = useState(initialLoad);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    setIsInitialLoad(initialLoad);
    if (!refreshEnabled) return;

    let cancelled = false;
    let retryTimer: number | undefined;
    const key = `applyoverflow.top-picks.refresh:${storageKey}`;
    const previousAttempt = window.sessionStorage.getItem(key);
    const previousMs = previousAttempt
      ? Date.parse(previousAttempt)
      : Number.NaN;
    const shouldStartRefresh =
      !Number.isFinite(previousMs) ||
      Date.now() - previousMs >= TOP_PICKS_AUTO_REFRESH_RETRY_MS;

    async function refresh() {
      try {
        if (shouldStartRefresh) {
          window.sessionStorage.setItem(key, new Date().toISOString());
          const response = await fetch("/api/jobs/top-picks/refresh", {
            method: "POST",
          });
          if (!response.ok) throw new Error("top picks refresh failed");
        } else if (!initialLoad && !refreshInProgress) {
          return;
        }

        const status = await waitForRefreshToSettle();
        if (cancelled) return;

        if (status) {
          router.refresh();
          if (initialLoad) setIsInitialLoad(false);
          return;
        }

        if (initialLoad || refreshInProgress) {
          retryTimer = window.setTimeout(() => {
            setRetryCount((current) => current + 1);
          }, 5_000);
        }
      } catch (error) {
        console.error("Top picks background refresh failed", error);
        if (!cancelled && initialLoad) setIsInitialLoad(false);
      }
    }

    void refresh();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [initialLoad, refreshEnabled, refreshInProgress, retryCount, router, storageKey]);

  return (
    <TopPicksRefreshContext.Provider value={{ isInitialLoad }}>
      {children}
    </TopPicksRefreshContext.Provider>
  );
}

export function TopPicksList({
  profileSkills,
  viewerId,
  emptyState,
  initialPicks,
  referenceNow,
}: TopPicksListProps) {
  const { notify } = useNotifications();
  const { isInitialLoad } = useTopPicksRefreshState();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const sourceHref = search ? `${pathname}?${search}` : pathname;
  const [picks, setPicks] = useState(initialPicks);
  const [dismissed, setDismissed] = useState<TopPickCardData | null>(null);
  const [feedbackType, setFeedbackType] = useState<TopPickFeedbackType>("NOT_INTERESTED");
  const [pendingFeedbackJobId, setPendingFeedbackJobId] = useState<
    string | null
  >(null);

  useEffect(() => {
    setPicks(initialPicks);
  }, [initialPicks]);

  function handleSavedChange(jobId: string, saved: boolean) {
    setPicks((current) =>
      current.map((pick) =>
        pick.job.id === jobId
          ? { ...pick, job: { ...pick.job, isSaved: saved } }
          : pick,
      ),
    );
  }

  function markNotInterested(jobId: string) {
    if (pendingFeedbackJobId) return;

    setPendingFeedbackJobId(jobId);
    fetch("/api/jobs/top-picks/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, feedbackType }),
    })
      .then((response) => {
        if (!response.ok) throw new Error("feedback failed");
        setDismissed(picks.find((pick) => pick.job.id === jobId) ?? null);
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

  const feedbackControls = <HiddenPicks dismissed={dismissed} onRestore={(jobId, restored) => {
    if (dismissed?.job.id === jobId) {
      if (restored) setPicks((current) => current.some((pick) => pick.job.id === jobId) ? current : [...current, dismissed].sort((a, b) => a.rank - b.rank));
      setDismissed(null);
    }
  }} />;

  if (picks.length === 0) {
    if (isInitialLoad) {
      return (
        <div><div
          aria-live="polite"
          className="empty-state flex min-h-[180px] flex-col items-center justify-center px-4 py-10 text-center"
          role="status"
        >
          <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
          <p className="mt-3 text-sm font-medium text-foreground">
            Finding your top matches
          </p>
          <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
            Ranking live jobs against your profile and preferences.
          </p>
        </div>{feedbackControls}</div>
      );
    }

    const state = emptyState ?? {
      title: "No top picks ready yet",
      message:
        "Refresh picks to generate recommendations from your saved profile, or keep browsing jobs while the background refresh finishes.",
    };

    return (
      <div><div className="empty-state flex min-h-[180px] flex-col items-center justify-center px-4 py-10 text-center">
        <p className="text-sm font-medium text-foreground">{state.title}</p>
        <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
          {state.message}
        </p>
        {state.actionHref && state.actionLabel ? (
          <Button
            className="mt-4 h-9 rounded-full px-4 text-sm"
            render={<Link href={state.actionHref} />}
            variant="outline"
          >
            {state.actionLabel}
          </Button>
        ) : null}
      </div>{feedbackControls}</div>
    );
  }

  return (
    <div className="space-y-3">
    {feedbackControls}
    <JobFeedMasterDetail
      profileSkills={profileSkills}
      key={sourceHref}
      viewerId={viewerId}
      entries={picks.map((pick) => ({
        id: pick.id,
        job: pick.job,
        listMeta: (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            {getTopPickMatchLabel(pick.score)}
          </span>
        ),
        detailMeta: (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[0.08] px-2.5 py-1 text-xs font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                {getTopPickMatchLabel(pick.score)}
              </span>
              <span className="text-xs text-muted-foreground">Pick #{pick.rank}</span>
            </div>
            {pick.matchReasons.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {pick.matchReasons.slice(0, 3).map((reason) => (
                  <span
                    className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
                    key={reason}
                  >
                    {reason}
                  </span>
                ))}
              </div>
            ) : null}
            {pick.concerns.length > 0 ? (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{pick.concerns[0]}</p>
            ) : null}
          </div>
        ),
        detailActions: (
          <div className="flex items-center gap-1">
          <select aria-label="Reason for hiding this pick" className="h-10 max-w-36 rounded-md border border-border bg-background px-2 text-xs" value={feedbackType} onChange={(event) => setFeedbackType(event.target.value as TopPickFeedbackType)}>
            {TOP_PICK_FEEDBACK_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <TopPickDismissButton
            disabled={pendingFeedbackJobId !== null}
            onDismiss={() => markNotInterested(pick.job.id)}
          />
          </div>
        ),
      }))}
      onSavedChange={handleSavedChange}
      referenceNow={referenceNow}
      sourceHref={sourceHref}
    />
    </div>
  );
}

export function TopPicksStatusSummary({
  canRefresh,
  rankedPickLabel,
  refreshedLabel,
  refreshHelp,
  showInlineProfileHelp,
}: {
  canRefresh?: boolean;
  rankedPickLabel: string;
  refreshedLabel: string;
  refreshHelp: string;
  showInlineProfileHelp: boolean;
}) {
  const { isInitialLoad } = useTopPicksRefreshState();

  if (isInitialLoad) {
    return (
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[1.75rem] font-semibold tracking-tight text-foreground sm:text-[2.35rem]">
            Loading your picks
          </p>
          <p className="mt-2 inline-flex items-center gap-2 text-sm text-muted-foreground sm:text-[15px]">
            <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
            Matching roles to your profile
          </p>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground sm:text-sm">
            Your ranked recommendations will appear automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <p className="text-[1.75rem] font-semibold tracking-tight text-foreground sm:text-[2.35rem]">
          {rankedPickLabel}
        </p>
        {showInlineProfileHelp ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
            {refreshHelp}
          </p>
        ) : (
          <>
          <p className="mt-2 text-sm text-muted-foreground sm:text-[15px]">
            {refreshedLabel}
          </p>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground sm:text-sm">
            {refreshHelp}
          </p>
          </>
        )}
      </div>
      {canRefresh === false ? (
        <Button
          className="inline-flex items-center justify-center"
          render={<Link href="/profile" />}
          variant="outline"
        >
          Complete profile
        </Button>
      ) : (
        <TopPicksRefreshButton />
      )}
    </div>
  );
}

function TopPickDismissButton({
  disabled,
  onDismiss,
}: {
  disabled: boolean;
  onDismiss: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Not interested"
            className="size-10 rounded-[12px]"
            disabled={disabled}
            onClick={onDismiss}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="h-4 w-4" />
          </Button>
        }
      />
      <TooltipContent>Not interested</TooltipContent>
    </Tooltip>
  );
}

function getTopPickMatchLabel(score: number) {
  if (score >= 90) return "Best fit";
  if (score >= 80) return "Strong fit";
  if (score >= 70) return "Good fit";
  return "Worth reviewing";
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
      const response = await fetch("/api/jobs/top-picks/refresh", {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "refresh failed");
      }

      const body = await response.json().catch(() => null);
      if (body?.status === "needs_profile") {
        notify({
          title: "Complete your profile first",
          message:
            body?.refresh?.profileReadinessMessage ??
            "Top Picks need target roles, skills, or recent experience before they can refresh.",
          tone: "info",
        });
        router.refresh();
        return;
      }

      notify({
        title:
          body?.status === "running"
            ? "Refresh already running"
            : "Generating top picks",
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
          message:
            "The refresh is taking longer than usual. The page will use cached picks until it finishes.",
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
        compact ? "h-8 rounded-full px-3 text-xs" : undefined,
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
