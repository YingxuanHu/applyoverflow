import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";

import { JobsSectionTabs } from "@/components/jobs/jobs-section-tabs";
import {
  TopPicksAutoRefresh,
  TopPicksList,
  TopPicksRefreshButton,
} from "@/components/jobs/top-picks";
import { ScrollPositionMemory } from "@/components/navigation/scroll-position-memory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getOptionalCurrentProfileId } from "@/lib/current-user";
import { EXPERIENCE_LEVEL_GROUP_OPTIONS } from "@/lib/job-metadata";
import { formatPostedAge } from "@/lib/job-display";
import { getTopPicksForUser } from "@/lib/queries/top-picks";

type TopPicksPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const WORK_MODE_OPTIONS = [
  { label: "Any work mode", value: "" },
  { label: "Remote", value: "REMOTE" },
  { label: "Hybrid", value: "HYBRID" },
  { label: "On-site", value: "ONSITE" },
  { label: "Flexible", value: "FLEXIBLE" },
];

function getSearchParam(
  params: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInt(value?: string, fallback = 1) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildTopPicksHref(
  currentParams: Record<string, string | string[] | undefined>,
  overrides: Record<string, string | undefined>
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(currentParams)) {
    const normalized = Array.isArray(value) ? value.filter(Boolean).join(",") : value;
    if (normalized) params.set(key, normalized);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const query = params.toString();
  return query ? `/jobs/top-picks?${query}` : "/jobs/top-picks";
}

export default async function JobsTopPicksPage({
  searchParams,
}: TopPicksPageProps) {
  const userId = await getOptionalCurrentProfileId();
  if (!userId) redirect("/sign-in");

  const resolvedSearchParams = await searchParams;
  const page = parsePositiveInt(getSearchParam(resolvedSearchParams, "page"));
  const location = getSearchParam(resolvedSearchParams, "location")?.trim() || null;
  const workMode = getSearchParam(resolvedSearchParams, "workMode")?.trim() || null;
  const experienceLevel =
    getSearchParam(resolvedSearchParams, "experienceLevel")?.trim() || null;
  const minScore =
    parsePositiveInt(getSearchParam(resolvedSearchParams, "minScore"), 0) || undefined;
  const result = await getTopPicksForUser(userId, {
    page,
    location,
    workMode,
    experienceLevel,
    minScore,
  });
  const referenceNow = new Date().toISOString();
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const rankedPickSummary =
    result.total === 0
      ? "No cached recommendations ready yet."
      : result.total === 1
        ? "Showing 1 cached recommendation."
        : `Showing ${result.total.toLocaleString()} cached recommendations.`;
  const refreshedLabel = result.status.lastComputedAt
    ? `Refreshed ${formatPostedAge(result.status.lastComputedAt)}`
    : "Refresh picks after completing your profile to generate recommendations.";

  return (
    <div className="app-page space-y-5">
      <ScrollPositionMemory storageKeyPrefix="autoapplication.top-picks.scroll" />
      <TopPicksAutoRefresh
        enabled={result.status.stale || result.status.validCount === 0}
        storageKey={`page:${result.status.profileVersion ?? "new"}:${result.status.lastComputedAt ?? "none"}`}
      />
      <header className="page-header">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="page-title">Top picks for you</h1>
          </div>
          <p className="page-description">
            Ranked from your profile, preferences, skills, location, salary target,
            and recent job activity.
          </p>
        </div>
        <TopPicksRefreshButton />
      </header>

      <JobsSectionTabs active="top-picks" />

      <section className="surface-panel overflow-hidden">
        <div className="border-b border-border/60 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-base font-semibold text-foreground">Ranked picks</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {rankedPickSummary} {refreshedLabel}
                {result.status.stale ? " Refresh recommended." : ""}
              </p>
            </div>
            {result.status.validCount > 0 ? (
              <span className="inline-flex w-fit rounded-full border border-border/70 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                Cached recommendations
              </span>
            ) : null}
          </div>
        </div>
        <form
          className="grid gap-4 p-4 sm:p-5 md:grid-cols-[1.4fr_1fr_1fr_0.7fr_auto]"
          method="get"
        >
          <label className="grid gap-1.5 text-xs font-medium uppercase tracking-[0.13em] text-muted-foreground">
            Location
            <Input
              className="h-11 rounded-[14px] text-sm normal-case tracking-normal"
              defaultValue={location ?? ""}
              name="location"
              placeholder="City, country, or region"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium uppercase tracking-[0.13em] text-muted-foreground">
            Work mode
            <select
              className="h-11 rounded-[14px] border border-input bg-card px-3 text-sm normal-case tracking-normal text-foreground"
              defaultValue={workMode ?? ""}
              name="workMode"
            >
              {WORK_MODE_OPTIONS.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium uppercase tracking-[0.13em] text-muted-foreground">
            Experience
            <select
              className="h-11 rounded-[14px] border border-input bg-card px-3 text-sm normal-case tracking-normal text-foreground"
              defaultValue={experienceLevel ?? ""}
              name="experienceLevel"
            >
              <option value="">Any level</option>
              {EXPERIENCE_LEVEL_GROUP_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium uppercase tracking-[0.13em] text-muted-foreground">
            Min score
            <Input
              className="h-11 rounded-[14px] text-sm normal-case tracking-normal"
              defaultValue={minScore ? String(minScore) : ""}
              min={0}
              max={100}
              name="minScore"
              placeholder="0"
              type="number"
            />
          </label>
          <div className="flex items-end gap-2">
            <Button className="h-11 w-full rounded-[14px] px-5 md:w-auto" type="submit">
              Apply
            </Button>
            <Button
              className="h-11 w-full rounded-[14px] px-5 md:w-auto"
              render={<Link href="/jobs/top-picks" />}
              variant="outline"
            >
              Clear
            </Button>
          </div>
        </form>
      </section>

      <section>
        <TopPicksList
          initialPicks={result.data}
          referenceNow={referenceNow}
        />

        {result.total > result.pageSize ? (
          <div className="mt-5 flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Page {result.page} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <PaginationLink
                disabled={result.page <= 1}
                href={buildTopPicksHref(resolvedSearchParams, {
                  page: result.page > 1 ? String(result.page - 1) : undefined,
                })}
              >
                Previous
              </PaginationLink>
              <PaginationLink
                disabled={!result.hasNextPage}
                href={buildTopPicksHref(resolvedSearchParams, {
                  page: result.hasNextPage ? String(result.page + 1) : undefined,
                })}
              >
                Next
              </PaginationLink>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function PaginationLink({
  children,
  disabled,
  href,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  href: string;
}) {
  if (disabled) {
    return (
      <span className="inline-flex h-8 items-center rounded-lg border border-input px-3 text-sm text-muted-foreground opacity-40">
        {children}
      </span>
    );
  }

  return (
    <Link
      className="inline-flex h-8 items-center rounded-lg border border-input/80 bg-background/70 px-3 text-sm text-foreground hover:bg-muted"
      href={href}
    >
      {children}
    </Link>
  );
}
