import { buildJobsSearchHref } from "@/lib/jobs/search-navigation";
import { JobsFilterPanel } from "@/components/jobs/jobs-filter-panel";
import Link from "next/link";
import { redirect } from "next/navigation";

import { JobsActiveFilterChips } from "@/components/jobs/jobs-active-filter-chips";
import { JobsFilterDropdownField } from "@/components/jobs/jobs-filter-field";
import { JobsSectionTabs } from "@/components/jobs/jobs-section-tabs";
import { JobsSearchForm } from "@/components/jobs/jobs-search-form";
import {
  TopPicksList,
  TopPicksRefreshCoordinator,
  TopPicksStatusSummary,
} from "@/components/jobs/top-picks";
import { PaginationControls } from "@/components/navigation/pagination-controls";
import { ScrollPositionMemory } from "@/components/navigation/scroll-position-memory";
import { Button } from "@/components/ui/button";
import { getOptionalCurrentProfileId } from "@/lib/current-user";
import { splitFilterValues } from "@/lib/filter-values";
import { EXPERIENCE_LEVEL_GROUP_OPTIONS } from "@/lib/job-metadata";
import { formatPostedAge } from "@/lib/job-display";
import { normalizeJobsStateQuery } from "@/lib/jobs/search-state";
import { parseJobFilters, parseTopPicksFilters } from "@/lib/jobs/search-params";
import { splitLocationSearchValues } from "@/lib/location-search";
import { getTopPicksForUser } from "@/lib/queries/top-picks";
import type { JobSearchScope } from "@/lib/queries/jobs";

type TopPicksPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const WORK_MODE_OPTIONS = [
  { label: "Remote", value: "REMOTE" },
  { label: "Hybrid", value: "HYBRID" },
  { label: "On-site", value: "ONSITE" },
  { label: "Flexible", value: "FLEXIBLE" },
];

type HiddenField = { name: string; value: string };

type TopPicksFilters = {
  searchScope: JobSearchScope;
  titleSearch?: string;
  companySearch?: string;
  locationSearch?: string;
  workMode?: string;
  experienceLevel?: string;
};

type ActiveFilterGroup = {
  key: string;
  label: string;
  items: Array<{
    key: string;
    label: string;
    href: string;
  }>;
};

function buildTopPicksHref(current: Record<string, string | string[] | undefined>, overrides: Record<string, string | undefined>) {
  return buildJobsSearchHref(current, overrides, "/jobs/top-picks");
}

function hasActiveSearch(filters: TopPicksFilters) {
  return Boolean(
    filters.titleSearch || filters.companySearch || filters.locationSearch,
  );
}

function buildSearchFormInitialValues(
  filters: TopPicksFilters,
): Record<JobSearchScope, string> {
  return {
    all: "",
    title: filters.titleSearch ?? "",
    company: filters.companySearch ?? "",
    location: filters.locationSearch ?? "",
  };
}

function buildHiddenFields(
  entries: Array<readonly [name: string, value: string | undefined]>,
): HiddenField[] {
  return entries.flatMap(([name, value]) => (value ? [{ name, value }] : []));
}

function buildSearchFormHiddenFields(filters: TopPicksFilters) {
  return buildHiddenFields([
    ["workMode", filters.workMode],
    ["experienceLevel", filters.experienceLevel],
  ]);
}

function buildFilterPanelHiddenFields(filters: TopPicksFilters) {
  return buildHiddenFields([
    ["titleSearch", filters.titleSearch],
    ["companySearch", filters.companySearch],
    ["locationSearch", filters.locationSearch],
    ["searchScope", hasActiveSearch(filters) ? filters.searchScope : undefined],
  ]);
}

function getRefreshedLabel(status: {
  lastComputedAt: string | null;
  profileReady?: boolean;
  refreshing?: boolean;
}) {
  if (status.profileReady === false) return "Profile needs more detail";
  if (status.refreshing) return "Refreshing now";
  if (!status.lastComputedAt) return "Not generated yet";

  const refreshedAt = new Date(status.lastComputedAt);
  const now = new Date();
  if (refreshedAt.toDateString() === now.toDateString()) return "Updated today";

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (refreshedAt.toDateString() === yesterday.toDateString())
    return "Updated yesterday";

  return `Updated ${formatPostedAge(status.lastComputedAt)}`;
}

function getRefreshHelpText(status: {
  canRefresh?: boolean;
  hasProfileSnapshot: boolean;
  lastComputedAt: string | null;
  missingProfileSignals?: string[];
  profileReady?: boolean;
  profileReadinessMessage?: string;
  stale: boolean;
  refreshing?: boolean;
  validCount: number;
}) {
  if (status.profileReady === false || status.canRefresh === false) {
    return (
      status.profileReadinessMessage ??
      "Add target roles, recent experience, skills, or saved jobs in your profile before generating Top Picks."
    );
  }
  if (status.refreshing) {
    return "A background refresh is running. Cached picks stay visible while newer matches are prepared.";
  }
  if (!status.hasProfileSnapshot || !status.lastComputedAt) {
    return "Refresh picks to generate recommendations from your saved profile. You can keep browsing jobs while it runs.";
  }
  if (status.stale) {
    return "Refresh recommended. Your profile, feedback, or the job pool changed since these picks were generated.";
  }
  if (status.validCount > 0) {
    return "Cached recommendations. Refresh checks for fresher matches without blocking this page.";
  }
  return "No qualifying matches were found for your current profile and requirements.";
}

function getTopPicksEmptyState(
  status: {
    stale?: boolean;
    lastComputedAt?: string | null;
    canRefresh?: boolean;
    missingProfileSignals?: string[];
    profileReady?: boolean;
    profileReadinessMessage?: string;
    refreshing?: boolean;
  },
  hasScopedResults: boolean,
) {
  if (status.profileReady === false || status.canRefresh === false) {
    const missing = status.missingProfileSignals?.length
      ? ` Missing: ${status.missingProfileSignals.join(", ")}.`
      : "";

    return {
      title: "Complete your profile to generate picks",
      message: `${
        status.profileReadinessMessage ??
        "Top Picks need enough profile signal before recommendations can be generated."
      }${missing}`,
      actionHref: "/profile",
      actionLabel: "Complete profile",
    };
  }

  if (hasScopedResults) {
    return {
      title: "No picks match these filters",
      message:
        "Try clearing a filter, lowering the minimum score, or browsing all jobs.",
    };
  }

  if (!status.stale && !status.refreshing && status.lastComputedAt) {
    return {
      title: "No qualifying picks right now",
      message: "No jobs met your current profile and match requirements in this refresh.",
    };
  }

  return {
    title: "No top picks ready yet",
    message: status.refreshing
      ? "Recommendations are being generated from your saved profile. You can keep browsing jobs while this finishes."
      : "Refresh picks to generate recommendations from your saved profile, or keep browsing jobs while the background refresh finishes.",
  };
}

function buildActiveFilterGroups(
  filters: TopPicksFilters,
  currentParams: Record<string, string | string[] | undefined>,
) {
  const groups: ActiveFilterGroup[] = [];
  const addGroup = (
    key: string,
    label: string,
    items: ActiveFilterGroup["items"],
  ) => {
    if (items.length > 0) groups.push({ key, label, items });
  };

  if (filters.titleSearch) {
    addGroup("titleSearch", "Title search", [
      {
        key: "titleSearch",
        label: filters.titleSearch,
        href: buildTopPicksHref(currentParams, {
          field: undefined,
          page: undefined,
          q: undefined,
          search: undefined,
          searchScope: undefined,
          titleSearch: undefined,
        }),
      },
    ]);
  }
  if (filters.companySearch) {
    addGroup("companySearch", "Company search", [
      {
        key: "companySearch",
        label: filters.companySearch,
        href: buildTopPicksHref(currentParams, {
          field: undefined,
          page: undefined,
          q: undefined,
          search: undefined,
          searchScope: undefined,
          companySearch: undefined,
        }),
      },
    ]);
  }
  if (filters.locationSearch) {
    addGroup(
      "locationSearch",
      "Location",
      splitLocationSearchValues(filters.locationSearch).map((location) => ({
        key: `locationSearch:${location.toLowerCase()}`,
        label: location,
        href: buildRemoveFilterValueHref(
          currentParams,
          "locationSearch",
          location,
        ),
      })),
    );
  }

  addSelectedOptionGroup(
    groups,
    currentParams,
    "workMode",
    filters.workMode,
    WORK_MODE_OPTIONS,
    "Work mode",
  );
  addSelectedOptionGroup(
    groups,
    currentParams,
    "experienceLevel",
    filters.experienceLevel,
    EXPERIENCE_LEVEL_GROUP_OPTIONS,
    "Experience",
  );

  return groups;
}

function addSelectedOptionGroup(
  groups: ActiveFilterGroup[],
  currentParams: Record<string, string | string[] | undefined>,
  param: string,
  current: string | undefined,
  options: Array<{ label: string; value: string }>,
  label: string,
) {
  const remaining = new Set(splitFilterValues(current));
  const items: ActiveFilterGroup["items"] = [];

  for (const option of options) {
    const optionValues = splitFilterValues(option.value);
    if (
      optionValues.length === 0 ||
      !optionValues.every((value) => remaining.has(value))
    ) {
      continue;
    }
    items.push({
      key: `${param}:${option.value}`,
      label: option.label,
      href: buildRemoveFilterValueHref(currentParams, param, option.value),
    });
    for (const value of optionValues) remaining.delete(value);
  }

  for (const value of remaining) {
    items.push({
      key: `${param}:${value}`,
      label: value,
      href: buildRemoveFilterValueHref(currentParams, param, value),
    });
  }

  if (items.length > 0) groups.push({ key: param, label, items });
}

function buildRemoveFilterValueHref(
  currentParams: Record<string, string | string[] | undefined>,
  param: string,
  value: string,
) {
  const canonical = new URLSearchParams(normalizeJobsStateQuery(currentParams));
  const key = param === "experienceLevel" ? "careerStage" : param;
  const split = key === "locationSearch" ? splitLocationSearchValues : splitFilterValues;
  const removed = new Set(split(value).map((entry) => entry.toLowerCase()));
  const next = split(canonical.get(key)).filter((entry) => !removed.has(entry.toLowerCase())).join(key === "locationSearch" ? ";" : ",");
  return buildTopPicksHref(currentParams, { page: undefined, [key]: next || undefined });
}

export default async function JobsTopPicksPage({
  searchParams,
}: TopPicksPageProps) {
  const userId = await getOptionalCurrentProfileId();
  if (!userId) redirect("/sign-in");

  const resolvedSearchParams = await searchParams;
  const page = parseJobFilters(resolvedSearchParams).page ?? 1;
  const filters = parseTopPicksFilters(resolvedSearchParams);
  const result = await getTopPicksForUser(userId, {
    page,
    titleSearch: filters.titleSearch,
    companySearch: filters.companySearch,
    locationSearch: filters.locationSearch,
    workMode: filters.workMode,
    experienceLevel: filters.experienceLevel,
  });
  const referenceNow = new Date().toISOString();
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const showPagination = result.total > result.pageSize;
  if (result.total > 0 && result.page > totalPages) {
    redirect(
      buildTopPicksHref(resolvedSearchParams, {
        page: totalPages > 1 ? String(totalPages) : undefined,
      }),
    );
  }
  const activeFilterGroups = buildActiveFilterGroups(
    filters,
    resolvedSearchParams,
  );
  const activeFilterCount = activeFilterGroups.reduce(
    (count, group) => count + group.items.length,
    0,
  );
  const hasScopedResults = activeFilterCount > 0 || hasActiveSearch(filters);
  const shouldLoadInitialPicks =
    result.total === 0 &&
    result.status.validCount === 0 &&
    (result.status.stale || result.status.refreshing) &&
    result.status.canRefresh !== false &&
    result.status.profileReady !== false;
  const shouldRefreshTopPicks =
    result.status.canRefresh !== false &&
    result.status.profileReady !== false &&
    (result.status.stale || result.status.refreshing);
  const rankedPickLabel =
    result.total === 0 && result.status.profileReady === false
      ? "Complete your profile"
      : result.total === 0
        ? "No ranked picks"
        : result.total === 1
          ? "1 ranked pick"
          : `${result.total.toLocaleString()} ranked picks`;
  const refreshedLabel = getRefreshedLabel(result.status);
  const refreshHelp = getRefreshHelpText(result.status);
  const showInlineProfileHelp =
    result.status.profileReady === false || result.status.canRefresh === false;
  const emptyState = getTopPicksEmptyState(result.status, hasScopedResults);
  const searchFormInitialValues = buildSearchFormInitialValues(filters);
  const searchFormStateKey = JSON.stringify({
    scope: filters.searchScope ?? "title",
    values: searchFormInitialValues,
  });
  const searchFormHiddenFields = buildSearchFormHiddenFields(filters);
  const filterPanelHiddenFields = buildFilterPanelHiddenFields(filters);

  return (
    <TopPicksRefreshCoordinator
      refreshInProgress={result.status.refreshing}
      initialLoad={shouldLoadInitialPicks}
      refreshEnabled={shouldRefreshTopPicks}
      storageKey={`page:${userId}:${result.status.profileVersion ?? "new"}:${result.status.lastComputedAt ?? "none"}`}
    >
      <div className="app-page app-page-workspace space-y-6">
        <ScrollPositionMemory
          defaultScrollTop="top"
          restoreSavedPosition={false}
          storageKeyPrefix="autoapplication.top-picks.scroll"
        />
        <header className="page-header items-center justify-start gap-x-10 gap-y-3">
          <div>
            <h1 className="page-title">Jobs</h1>
          </div>
          <JobsSectionTabs active="top-picks" />
        </header>

        <section aria-label="Picks search" className="border-b border-border/60 pb-4">
          <TopPicksStatusSummary
            canRefresh={
              result.status.canRefresh !== false &&
              result.status.profileReady !== false
            }
            rankedPickLabel={rankedPickLabel}
            refreshedLabel={refreshedLabel}
            refreshHelp={refreshHelp}
            showInlineProfileHelp={showInlineProfileHelp}
          />

          {!showInlineProfileHelp ? <div className="mt-4 space-y-3 border-t border-border/60 pt-3 sm:mt-5 sm:space-y-4 sm:pt-4">
            <div className="flex min-w-0 flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
              <JobsSearchForm
                basePath="/jobs/top-picks"
                hiddenFields={searchFormHiddenFields}
                initialScope={filters.searchScope}
                initialValues={searchFormInitialValues}
                key={searchFormStateKey}
              />

              <div className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap">
                <JobsFilterPanel activeCount={activeFilterCount} basePath="/jobs/top-picks" formId="picks-filter-form" key={JSON.stringify(filters)}>
                  {filterPanelHiddenFields.map((field) => (
                    <input
                      key={`${field.name}:${field.value}`}
                      name={field.name}
                      type="hidden"
                      value={field.value}
                    />
                  ))}
                  <div className="grid gap-2">
                    <JobsFilterDropdownField
                      columnsClassName="sm:grid-cols-2"
                      emptyLabel="Any work mode"
                      name="workMode"
                      options={WORK_MODE_OPTIONS}
                      selected={filters.workMode}
                      title="Work mode"
                    />
                    <JobsFilterDropdownField
                      columnsClassName="sm:grid-cols-2"
                      emptyLabel="Any level"
                      name="experienceLevel"
                      options={EXPERIENCE_LEVEL_GROUP_OPTIONS}
                      selected={filters.experienceLevel}
                      title="Experience"
                    />
                  </div>

                </JobsFilterPanel>

                {hasScopedResults ? (
                  <Button
                    className="h-10 rounded-[14px] px-4 text-sm"
                    render={<Link href="/jobs/top-picks" />}
                    variant="outline"
                  >
                    Clear all
                  </Button>
                ) : null}
              </div>
            </div>

            {activeFilterGroups.length > 0 ? (
              <JobsActiveFilterChips
                clearHref="/jobs/top-picks"
                groups={activeFilterGroups}
              />
            ) : null}
          </div> : null}
        </section>

        {!showInlineProfileHelp ? <section>
          {showPagination ? (
            <PaginationControls
              ariaLabel="Top picks top pagination"
              basePath="/jobs/top-picks"
              currentPage={result.page}
              getPageHref={(page) =>
                buildTopPicksHref(resolvedSearchParams, {
                  page: page > 1 ? String(page) : undefined,
                })
              }
              hasNextPage={result.hasNextPage}
              placement="top"
              separator={false}
              searchParams={resolvedSearchParams}
              totalPages={totalPages}
            />
          ) : null}

          <TopPicksList
            profileSkills={result.profileSkills}
            viewerId={userId}
            emptyState={emptyState}
            initialPicks={result.data}
            referenceNow={referenceNow}
          />

          {showPagination ? (
            <PaginationControls
              ariaLabel="Top picks bottom pagination"
              basePath="/jobs/top-picks"
              currentPage={result.page}
              getPageHref={(page) =>
                buildTopPicksHref(resolvedSearchParams, {
                  page: page > 1 ? String(page) : undefined,
                })
              }
              hasNextPage={result.hasNextPage}
              searchParams={resolvedSearchParams}
              totalPages={totalPages}
            />
          ) : null}
        </section> : null}
      </div>
    </TopPicksRefreshCoordinator>
  );
}
