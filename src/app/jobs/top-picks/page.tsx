import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ChevronDown,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";

import { JobsActiveFilterChips } from "@/components/jobs/jobs-active-filter-chips";
import { JobsFilterDropdownField } from "@/components/jobs/jobs-filter-field";
import { JobsSectionTabs } from "@/components/jobs/jobs-section-tabs";
import { JobsSearchForm } from "@/components/jobs/jobs-search-form";
import {
  TopPicksAutoRefresh,
  TopPicksList,
  TopPicksRefreshButton,
} from "@/components/jobs/top-picks";
import { PaginationControls } from "@/components/navigation/pagination-controls";
import { ScrollPositionMemory } from "@/components/navigation/scroll-position-memory";
import { Button } from "@/components/ui/button";
import { getOptionalCurrentProfileId } from "@/lib/current-user";
import { normalizeTextParam, splitFilterValues } from "@/lib/filter-values";
import { EXPERIENCE_LEVEL_GROUP_OPTIONS } from "@/lib/job-metadata";
import { formatPostedAge } from "@/lib/job-display";
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
    if (key === "reset" || key === "minScore") continue;
    const normalized = Array.isArray(value) ? value.filter(Boolean).join(",") : value;
    if (normalized) params.set(key, normalized);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  if (!hasSearchParams(params)) {
    params.delete("searchScope");
  }
  const query = params.toString();
  return query ? `/jobs/top-picks?${query}` : "/jobs/top-picks";
}

function parseTopPicksFilters(
  searchParams: Record<string, string | string[] | undefined>
): TopPicksFilters {
  const aliasField = getSearchParam(searchParams, "field");
  const aliasQuery = normalizeTextParam(getSearchParam(searchParams, "q"));
  const selectedSearchScope = normalizeSearchScopeParam(
    getSearchParam(searchParams, "searchScope") ?? aliasField
  );
  const rawSearch = normalizeTextParam(getSearchParam(searchParams, "search")) ?? aliasQuery;
  let titleSearch = normalizeTextParam(getSearchParam(searchParams, "titleSearch"));
  let companySearch = normalizeTextParam(getSearchParam(searchParams, "companySearch"));
  let locationSearch = normalizeTextListParam(
    getMultiSearchParam(searchParams, "locationSearch") ??
      getMultiSearchParam(searchParams, "location")
  );

  if (rawSearch && selectedSearchScope === "company") {
    companySearch = companySearch ?? rawSearch;
  } else if (rawSearch && selectedSearchScope === "location") {
    locationSearch = normalizeTextListParam(
      [locationSearch, rawSearch].filter(Boolean).join(",")
    );
  } else if (rawSearch) {
    titleSearch = titleSearch ?? rawSearch;
  }

  return {
    searchScope: inferEffectiveSearchScope({
      companySearch,
      locationSearch,
      selectedSearchScope,
      titleSearch,
    }),
    titleSearch,
    companySearch,
    locationSearch,
    workMode: normalizeFilterValueList(getMultiSearchParam(searchParams, "workMode")),
    experienceLevel: normalizeFilterValueList(
      getMultiSearchParam(searchParams, "experienceLevel") ??
        getMultiSearchParam(searchParams, "careerStage")
    ),
  };
}

function getMultiSearchParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = searchParams[key];
  if (Array.isArray(value)) return value.filter(Boolean).join(",");
  return value;
}

function normalizeTextListParam(value?: string) {
  const values = splitFilterValues(value)
    .map((entry) => entry.slice(0, 80))
    .filter(Boolean);
  return values.length > 0 ? values.join(",") : undefined;
}

function normalizeFilterValueList(value?: string | null) {
  const values = splitFilterValues(value);
  return values.length > 0 ? values.join(",") : undefined;
}

function normalizeSearchScopeParam(value?: string): JobSearchScope {
  if (value === "all" || value === "title" || value === "company" || value === "location") {
    return value;
  }
  return "title";
}

function inferEffectiveSearchScope({
  companySearch,
  locationSearch,
  selectedSearchScope,
  titleSearch,
}: {
  companySearch?: string;
  locationSearch?: string;
  selectedSearchScope: JobSearchScope;
  titleSearch?: string;
}) {
  if (selectedSearchScope && selectedSearchScope !== "all") return selectedSearchScope;
  if (companySearch) return "company";
  if (locationSearch) return "location";
  if (titleSearch) return "title";
  return "title";
}

function hasActiveSearch(filters: TopPicksFilters) {
  return Boolean(filters.titleSearch || filters.companySearch || filters.locationSearch);
}

function hasSearchParams(params: URLSearchParams) {
  return Boolean(
    normalizeTextParam(params.get("search") ?? undefined) ||
      normalizeTextParam(params.get("titleSearch") ?? undefined) ||
      normalizeTextParam(params.get("companySearch") ?? undefined) ||
      normalizeTextParam(params.get("locationSearch") ?? undefined)
  );
}

function buildSearchFormInitialValues(filters: TopPicksFilters): Record<JobSearchScope, string> {
  return {
    all: "",
    title: filters.titleSearch ?? "",
    company: filters.companySearch ?? "",
    location: filters.locationSearch ?? "",
  };
}

function buildHiddenFields(entries: Array<readonly [name: string, value: string | undefined]>): HiddenField[] {
  return entries.flatMap(([name, value]) =>
    value ? [{ name, value }] : []
  );
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
  if (refreshedAt.toDateString() === yesterday.toDateString()) return "Updated yesterday";

  return `Updated ${formatPostedAge(status.lastComputedAt)}`;
}

function formatInlineStatusHelp(text: string) {
  const trimmed = text.trim().replace(/\.+$/, "");
  return trimmed ? trimmed.charAt(0).toLowerCase() + trimmed.slice(1) : "";
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
    return status.profileReadinessMessage ??
      "Add target roles, recent experience, skills, or saved jobs in your profile before generating Top Picks.";
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
  return "No cached recommendations matched the current filters.";
}

function getTopPicksEmptyState(status: {
  canRefresh?: boolean;
  missingProfileSignals?: string[];
  profileReady?: boolean;
  profileReadinessMessage?: string;
  refreshing?: boolean;
}, hasScopedResults: boolean) {
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
      message: "Try clearing a filter, lowering the minimum score, or browsing all jobs.",
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
  currentParams: Record<string, string | string[] | undefined>
) {
  const groups: ActiveFilterGroup[] = [];
  const addGroup = (
    key: string,
    label: string,
    items: ActiveFilterGroup["items"]
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
      splitFilterValues(filters.locationSearch).map((location) => ({
        key: `locationSearch:${location.toLowerCase()}`,
        label: location,
        href: buildRemoveFilterValueHref(currentParams, "locationSearch", location),
      }))
    );
  }

  addSelectedOptionGroup(
    groups,
    currentParams,
    "workMode",
    filters.workMode,
    WORK_MODE_OPTIONS,
    "Work mode"
  );
  addSelectedOptionGroup(
    groups,
    currentParams,
    "experienceLevel",
    filters.experienceLevel,
    EXPERIENCE_LEVEL_GROUP_OPTIONS,
    "Experience"
  );

  return groups;
}

function addSelectedOptionGroup(
  groups: ActiveFilterGroup[],
  currentParams: Record<string, string | string[] | undefined>,
  param: string,
  current: string | undefined,
  options: Array<{ label: string; value: string }>,
  label: string
) {
  const remaining = new Set(splitFilterValues(current));
  const items: ActiveFilterGroup["items"] = [];

  for (const option of options) {
    const optionValues = splitFilterValues(option.value);
    if (optionValues.length === 0 || !optionValues.every((value) => remaining.has(value))) {
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
  value: string
) {
  const removeValues = new Set(splitFilterValues(value).map((entry) => entry.toLowerCase()));
  const rawValue = getMultiSearchParam(currentParams, param);
  const nextValue = splitFilterValues(rawValue)
    .filter((entry) => !removeValues.has(entry.toLowerCase()))
    .join(",");
  const overrides: Record<string, string | undefined> = {
    page: undefined,
    [param]: nextValue || undefined,
  };

  if (param === "locationSearch") {
    overrides.location = undefined;
    const searchScope = normalizeSearchScopeParam(getSearchParam(currentParams, "searchScope"));
    const aliasScope = normalizeSearchScopeParam(getSearchParam(currentParams, "field"));
    if (searchScope === "location" || aliasScope === "location") {
      overrides.field = undefined;
      overrides.q = undefined;
      overrides.search = undefined;
      overrides.searchScope = nextValue ? "location" : undefined;
    }
  }

  return buildTopPicksHref(currentParams, overrides);
}

export default async function JobsTopPicksPage({
  searchParams,
}: TopPicksPageProps) {
  const userId = await getOptionalCurrentProfileId();
  if (!userId) redirect("/sign-in");

  const resolvedSearchParams = await searchParams;
  const page = parsePositiveInt(getSearchParam(resolvedSearchParams, "page"));
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
      })
    );
  }
  const activeFilterGroups = buildActiveFilterGroups(filters, resolvedSearchParams);
  const activeFilterCount = activeFilterGroups.reduce(
    (count, group) => count + group.items.length,
    0
  );
  const hasScopedResults = activeFilterCount > 0 || hasActiveSearch(filters);
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
  const inlineProfileHelp = showInlineProfileHelp
    ? formatInlineStatusHelp(refreshHelp)
    : "";
  const emptyState = getTopPicksEmptyState(result.status, hasScopedResults);
  const searchFormInitialValues = buildSearchFormInitialValues(filters);
  const searchFormStateKey = JSON.stringify({
    scope: filters.searchScope ?? "title",
    values: searchFormInitialValues,
  });
  const searchFormHiddenFields = buildSearchFormHiddenFields(filters);
  const filterPanelHiddenFields = buildFilterPanelHiddenFields(filters);

  return (
    <div className="app-page space-y-5">
      <ScrollPositionMemory
        defaultScrollTop="top"
        restoreSavedPosition={false}
        storageKeyPrefix="autoapplication.top-picks.scroll"
      />
      <TopPicksAutoRefresh
        enabled={
          result.status.canRefresh !== false &&
          result.status.profileReady !== false &&
          (result.status.stale || result.status.validCount === 0)
        }
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
      </header>

      <JobsSectionTabs active="top-picks" />

      <section className="surface-panel p-3.5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[1.75rem] font-semibold tracking-tight text-foreground sm:text-[2.35rem]">
                {rankedPickLabel}
              </p>
              <p className="mt-2 text-sm text-muted-foreground sm:text-[15px]">
                {refreshedLabel}
                {inlineProfileHelp ? (
                  <span className="text-muted-foreground/90"> ({inlineProfileHelp})</span>
                ) : null}
              </p>
              {!showInlineProfileHelp ? (
                <p className="mt-1 max-w-3xl text-xs text-muted-foreground sm:text-sm">
                  {refreshHelp}
                </p>
              ) : null}
            </div>
            {result.status.canRefresh === false ||
            result.status.profileReady === false ? (
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

          <div className="mt-4 space-y-3 border-t border-border/60 pt-3 sm:mt-5 sm:space-y-4 sm:pt-4">
            <div className="flex min-w-0 flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
              <JobsSearchForm
                hiddenFields={searchFormHiddenFields}
                initialScope={filters.searchScope}
                initialValues={searchFormInitialValues}
                key={searchFormStateKey}
              />

              <div className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap">
                <details className="group static sm:relative" name="top-picks-toolbar-dropdown">
                  <summary className="inline-flex h-10 w-full list-none items-center justify-center gap-2 rounded-[14px] border border-border/70 bg-card px-3 text-sm font-medium text-foreground transition hover:bg-muted sm:w-auto sm:px-4 [&::-webkit-details-marker]:hidden">
                    <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                    Filters
                    {activeFilterCount > 0 ? (
                      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-medium text-primary-foreground">
                        {activeFilterCount}
                      </span>
                    ) : null}
                    <ChevronDown className="h-4 w-4 text-muted-foreground transition group-open:rotate-180" />
                  </summary>

                  <div className="fixed inset-x-2 bottom-3 z-40 flex max-h-[calc(100dvh-1.5rem)] origin-bottom overflow-hidden rounded-[20px] border border-border/70 bg-popover shadow-[0_24px_60px_rgba(0,0,0,0.24)] backdrop-blur sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-[calc(100%+0.6rem)] sm:max-h-[min(76dvh,26rem)] sm:w-[min(32rem,calc(100vw-2rem))] sm:max-w-[calc(100vw-2rem)] sm:origin-top-right">
                    <form className="flex max-h-[calc(100dvh-1.5rem)] min-h-0 w-full flex-col sm:max-h-[min(76dvh,26rem)]" method="get">
                      {filterPanelHiddenFields.map((field) => (
                        <input
                          key={`${field.name}:${field.value}`}
                          name={field.name}
                          type="hidden"
                          value={field.value}
                        />
                      ))}

                      <div className="shrink-0 border-b border-border/60 px-3.5 py-3 sm:px-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-foreground">Refine picks</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Filters narrow the cached recommendations on this page.
                            </p>
                          </div>
                          {activeFilterCount > 0 ? (
                            <span className="inline-flex h-6 items-center rounded-full border border-border/70 bg-muted/40 px-2 text-[11px] font-medium text-foreground">
                              {activeFilterCount} active
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid min-h-0 flex-1 gap-2 overflow-y-auto p-3 sm:p-3.5">
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

                      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-muted/45 px-3.5 py-3 sm:px-4">
                        <Button className="h-9 px-4 text-sm" size="sm" type="submit">
                          Apply filters
                        </Button>
                        <Button
                          className="h-9 px-4 text-sm"
                          render={<Link href="/jobs/top-picks" />}
                          size="sm"
                          variant="ghost"
                        >
                          Clear
                        </Button>
                      </div>
                    </form>
                  </div>
                </details>

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
          </div>
      </section>

      <section>
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
              searchParams={resolvedSearchParams}
              totalPages={totalPages}
            />
          ) : null}

          <TopPicksList
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
      </section>
    </div>
  );
}
