import { buildJobsSearchHref as buildJobsHref } from "@/lib/jobs/search-navigation";
import { JobsFilterPanel } from "@/components/jobs/jobs-filter-panel";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
} from "lucide-react";

import { JobsActiveFilterChips } from "@/components/jobs/jobs-active-filter-chips";
import { JobsSearchForm } from "@/components/jobs/jobs-search-form";
import {
  JobsFilterDropdownField,
  JobsTextFilterField,
} from "@/components/jobs/jobs-filter-field";
import { JobsAutoRefresh } from "@/components/jobs/jobs-auto-refresh";
import { JobsBoardActivity } from "@/components/jobs/jobs-board-activity";
import { JobsFeedList } from "@/components/jobs/jobs-feed-list";
import { JobsSavedFiltersControl } from "@/components/jobs/jobs-saved-filters-control";
import { JobsSectionTabs } from "@/components/jobs/jobs-section-tabs";
import { UserTimeZoneCookie } from "@/components/jobs/user-time-zone-cookie";
import { JobsSearchCountProvider, JobsSearchCountHeadline, JobsSearchPagination } from "@/components/jobs/jobs-search-count";
import { ScrollPositionMemory } from "@/components/navigation/scroll-position-memory";
import { SearchParamMemory } from "@/components/navigation/search-param-memory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getOptionalCurrentUserProfile } from "@/lib/current-user";
import {
  normalizeSalaryCurrency,
  SALARY_COMPARISON_CURRENCIES,
} from "@/lib/currency-conversion";
import { splitFilterValues } from "@/lib/filter-values";
import {
  EXPERIENCE_LEVEL_GROUP_OPTIONS,
  NORMALIZED_EMPLOYMENT_TYPE_GROUP_OPTIONS,
  NORMALIZED_INDUSTRY_OPTIONS,
  NORMALIZED_ROLE_CATEGORY_OPTIONS,
} from "@/lib/job-metadata";
import {
  normalizeJobsStateQuery,
  JOBS_SEARCH_STATE_STORAGE_KEY,
  JOBS_SAVED_FILTER_PARAM_KEYS,
} from "@/lib/jobs/search-state";
import { serializeJobCardData } from "@/lib/job-serialization";
import { normalizeSkills } from "@/lib/profile";
import { SavedSearches } from "@/components/jobs/saved-searches";
import { parseJobFilters, countActiveJobFilters } from "@/lib/jobs/search-params";
import { splitLocationSearchValues } from "@/lib/location-search";
import { getIngestionStatus } from "@/lib/queries/ingestion";
import { jobCountCacheKey } from "@/lib/queries/job-count-cache";
import {
  getJobs,
  type JobFilterParams,
  type JobSearchScope,
  type JobSortBy,
} from "@/lib/queries/jobs";
import {
  normalizeUserTimeZone,
  USER_TIME_ZONE_COOKIE,
} from "@/lib/time-zone";

type JobsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const WORK_MODE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Remote", value: "REMOTE" },
  { label: "Hybrid", value: "HYBRID" },
  { label: "On-site", value: "ONSITE" },
  { label: "Flexible", value: "FLEXIBLE" },
];

const POSTED_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Past 24 hours", value: "1d" },
  { label: "Past 3 days", value: "3d" },
  { label: "Past week", value: "7d" },
  { label: "Past 2 weeks", value: "14d" },
  { label: "Past month", value: "30d" },
];

const STATUS_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Live", value: "LIVE" },
  { label: "Aging", value: "AGING" },
  { label: "Stale", value: "STALE" },
  { label: "Expired", value: "EXPIRED" },
];

const EXPIRY_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Expiring soon", value: "soon" },
];

const SORT_OPTIONS: Array<{ label: string; value: JobSortBy | undefined }> = [
  { label: "Recommended", value: undefined },
  { label: "Newest", value: "newest" },
  { label: "Expiring soon", value: "deadline" },
  { label: "Company A-Z", value: "company" },
];
const JOBS_FILTER_FORM_ID = "jobs-filter-form";

export default async function JobsPage({ searchParams }: JobsPageProps) {
  // Note: `await searchParams` below already makes this page dynamic. We
  // previously also called `connection()` here, but that was redundant and
  // added a second opt-out marker that confused the runtime's cache
  // heuristics. Dropping it lets the in-process TTL caches in getJobs /
  // getIngestionStatus do their job on repeat tab/filter navigation.
  const currentProfile = await getOptionalCurrentUserProfile();
  if (!currentProfile) {
    redirect("/sign-in");
  }
  const viewerProfileId = currentProfile.id;
  const authUserId = currentProfile.authUserId;

  const resolvedSearchParams = await searchParams;
  const cookieStore = await cookies();

  const userTimeZone = normalizeUserTimeZone(
    cookieStore.get(USER_TIME_ZONE_COOKIE)?.value
  );
  const defaultSalaryCurrency =
    normalizeSalaryCurrency(currentProfile.salaryCurrency) ?? "USD";
  const filters = parseJobFilters(resolvedSearchParams, defaultSalaryCurrency);

  const [jobsResult, ingestionStatus] = await Promise.all([
    getJobs(filters, { viewerProfileId, authUserId, userTimeZone, deferExactTotal: true }),
    getIngestionStatus(),
  ]);
  const renderReferenceNow = new Date().toISOString();

  const jobCards = jobsResult.data.map((job) =>
    serializeJobCardData({
      ...job,
      eligibility: job.eligibility
        ? {
            submissionCategory: job.eligibility.submissionCategory,
            reasonCode: job.eligibility.reasonCode,
            reasonDescription: job.eligibility.reasonDescription,
          }
        : null,
      description: job.description,
      isSaved: job.isSaved,
      hasApplied: job.hasApplied,
    })
  );

  const activeFilterCount = countActiveFilters(filters);
  const hasScopedResults = activeFilterCount > 0 || hasActiveSearch(filters) || Boolean(filters.discoveredSince);
  const activeFilterGroups = buildActiveFilterGroups(filters, resolvedSearchParams);
  const currentSortLabel = getSortLabel(filters.sortBy);
  const currentPage = jobsResult.page;
  const totalPages =
    jobsResult.total !== null ? Math.max(1, Math.ceil(jobsResult.total / jobsResult.pageSize)) : null;
  const showPagination =
    currentPage > 1 || jobsResult.hasNextPage || (totalPages !== null && totalPages > 1);
  const pageJumpError = getPageJumpError(
    getSearchParam(resolvedSearchParams, "page"),
    totalPages
  );
  const searchFormInitialValues = buildSearchFormInitialValues(filters);
  const searchFormStateKey = JSON.stringify({
    scope: filters.searchScope ?? "all",
    values: searchFormInitialValues,
  });

  if (totalPages !== null && currentPage > totalPages) {
    redirect(
      buildJobsHref(resolvedSearchParams, {
        page: totalPages > 1 ? String(totalPages) : undefined,
      })
    );
  }

  const navigationKey = buildSearchParamSignature(resolvedSearchParams);
  const clearFiltersHref = "/jobs?reset=1";
  const searchFormHiddenFields = buildSearchFormHiddenFields(filters);
  const savedFilterStorageKey = `${JOBS_SEARCH_STATE_STORAGE_KEY}:${viewerProfileId}`;

  return (
    <JobsSearchCountProvider key={jobCountCacheKey(filters, viewerProfileId, currentProfile.feedStateVersion)} initialTotal={jobsResult.total} pending={jobsResult.countPending ?? false} query={navigationKey} page={currentPage} pageSize={jobsResult.pageSize}>
    <div className="app-page app-page-workspace space-y-6">
      <UserTimeZoneCookie
        cookieName={USER_TIME_ZONE_COOKIE}
        currentTimeZone={userTimeZone}
      />
      <SearchParamMemory
        basePath="/jobs"
        normalizer="jobs"
        persistence="local"
        stateParamKeys={JOBS_SAVED_FILTER_PARAM_KEYS}
        storageKey={savedFilterStorageKey}
      />
      <ScrollPositionMemory
        defaultScrollTop="top"
        restoreSavedPosition={false}
        storageKeyPrefix="autoapplication.jobs.scroll"
      />
      <JobsAutoRefresh initialLastUpdatedAt={ingestionStatus.lastUpdatedAt} />

      <header className="page-header items-center justify-start gap-x-10 gap-y-3">
        <div>
          <h1 className="page-title">Jobs</h1>
        </div>
        <JobsSectionTabs active="jobs" />
      </header>

      <section aria-label="Job search" className="border-b border-border/60 pb-4">
          <JobsBoardActivity
            addedToday={jobsResult.summary.addedTodayCount}
            closedToday={jobsResult.summary.expiredTodayCount + jobsResult.summary.removedTodayCount}
            updatedAt={ingestionStatus.lastUpdatedAt}
          >
            <JobsSearchCountHeadline scoped={hasScopedResults} liveJobCount={jobsResult.summary.liveJobCount} />
          </JobsBoardActivity>

          <div className="mt-3 space-y-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex min-w-0 flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
                  <JobsSearchForm
                    filterFormId={JOBS_FILTER_FORM_ID}
                    hiddenFields={searchFormHiddenFields}
                    initialScope={filters.searchScope ?? "all"}
                    initialValues={searchFormInitialValues}
                    key={searchFormStateKey}
                  />

                  <div className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap">
                    <JobsFilterPanel
                      activeCount={activeFilterCount}
                      formId={JOBS_FILTER_FORM_ID}
                      key={navigationKey}
                      utilities={<JobsSavedFiltersControl storageKey={savedFilterStorageKey} />}
                    >
                      {buildFilterPanelHiddenFields(filters).map((field) => (
                        <input
                          key={`${field.name}:${field.value}`}
                          name={field.name}
                          type="hidden"
                          value={field.value}
                        />
                      ))}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <FilterToggleField
                          label="Expiring soon"
                          name="expiry"
                          selected={filters.expiry}
                          value="soon"
                        />

                        <FilterToggleField
                          label="Hide applied jobs"
                          name="hideApplied"
                          selected={filters.hideApplied ? "1" : undefined}
                          value="1"
                        />

                        <JobsFilterDropdownField
                          className="sm:col-span-2"
                          columnsClassName="sm:grid-cols-2"
                          emptyLabel="All levels"
                          name="careerStage"
                          options={EXPERIENCE_LEVEL_GROUP_OPTIONS}
                          selected={filters.careerStage}
                          title="Experience level"
                        />

                        <JobsFilterDropdownField
                          className="sm:col-span-2"
                          columnsClassName="sm:grid-cols-2"
                          emptyLabel="Any job function"
                          name="jobFunction"
                          options={NORMALIZED_ROLE_CATEGORY_OPTIONS}
                          selected={filters.roleCategory}
                          title="Job function"
                        />

                        <JobsTextFilterField
                          defaultValue={filters.locationSearch}
                          key={`location:${filters.locationSearch ?? ""}`}
                          name="locationSearch"
                          placeholder="Toronto, ON; Seattle, WA"
                          title="Location"
                        />

                        <JobsFilterDropdownField
                          className="sm:col-span-2"
                          columnsClassName="sm:grid-cols-2"
                          emptyLabel="Any company industry"
                          name="industry"
                          options={NORMALIZED_INDUSTRY_OPTIONS}
                          selected={filters.industry}
                          title="Company industry"
                        />

                        <JobsFilterDropdownField
                          className="sm:col-span-2"
                          columnsClassName="sm:grid-cols-2"
                          emptyLabel="Any work mode"
                          name="workMode"
                          options={WORK_MODE_OPTIONS}
                          selected={filters.workMode}
                          title="Work mode"
                        />

                        <JobsFilterDropdownField
                          className="sm:col-span-2"
                          columnsClassName="sm:grid-cols-2"
                          emptyLabel="Any type"
                          name="employmentType"
                          options={NORMALIZED_EMPLOYMENT_TYPE_GROUP_OPTIONS}
                          selected={filters.employmentType}
                          title="Employment type"
                        />

                        <JobsFilterDropdownField
                          className="sm:col-span-2"
                          columnsClassName="sm:grid-cols-2"
                          emptyLabel="Any posted date"
                          single
                          name="posted"
                          options={POSTED_OPTIONS}
                          selected={filters.posted}
                          title="Posted"
                        />

                        <SalaryRangeField
                          includeUnknownSalary={Boolean(filters.includeUnknownSalary)}
                          salaryCurrency={filters.salaryCurrency ?? "USD"}
                          salaryMax={filters.salaryMax}
                          salaryMin={filters.salaryMin}
                        />
                      </div>

                    </JobsFilterPanel>

                  <details className="group static self-start sm:relative lg:self-auto" name="jobs-toolbar-dropdown">
                    <summary className="inline-flex h-11 w-full list-none items-center justify-center gap-2 rounded-[14px] border border-border/70 bg-card px-3 text-sm font-medium text-foreground transition hover:bg-muted sm:w-auto sm:px-4 [&::-webkit-details-marker]:hidden">
                      <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                      Sort
                      <span className="truncate text-muted-foreground">{currentSortLabel}</span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition group-open:rotate-180" />
                    </summary>

                    <div className="fixed inset-x-2 bottom-3 z-40 rounded-[18px] border border-border/70 bg-popover p-2 shadow-[0_18px_44px_rgba(0,0,0,0.24)] backdrop-blur sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-[calc(100%+0.75rem)] sm:w-56">
                      <div className="space-y-1">
                        {SORT_OPTIONS.map((option) => {
                          const active =
                            (!option.value && (!filters.sortBy || filters.sortBy === "relevance")) ||
                            filters.sortBy === option.value;

                          return (
                            <Link
                              className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm transition ${
                                active
                                  ? "bg-primary text-primary-foreground"
                                  : "text-foreground hover:bg-muted/70"
                              }`}
                              href={buildJobsHref(resolvedSearchParams, {
                                page: undefined,
                                sortBy: option.value,
                              })}
                              key={option.label}
                            >
                              <span>{option.label}</span>
                              {active ? <Check className="h-4 w-4" /> : null}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </details>

                </div>
              </div>

              {activeFilterGroups.length > 0 ? (
                <JobsActiveFilterChips
                  clearHref={clearFiltersHref}
                  groups={activeFilterGroups}
                />
              ) : null}
            </div>
          </div>
          <SavedSearches query={navigationKey} />
          </div>
      </section>

      {filters.discoveredSince ? <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">Discovered after {new Date(filters.discoveredSince).toLocaleString("en-CA", { timeZone: userTimeZone })}<Link className="text-primary underline" href={buildJobsHref(resolvedSearchParams, { discoveredSince: undefined, page: undefined })}>Show all matches</Link></p> : null}
      <section>
          {showPagination ? (
            <JobsSearchPagination
              ariaLabel="Jobs top pagination"
              basePath="/jobs"
              currentPage={currentPage}
              hasNextPage={jobsResult.hasNextPage}
              pageError={pageJumpError}
              placement="top"
              separator={false}
              searchParams={resolvedSearchParams}
            />
          ) : null}

          {jobCards.length === 0 ? (
            <div className="empty-state">
              <p className="text-sm font-medium text-foreground">
                {currentPage > 1 ? "No jobs on this page" : hasScopedResults ? "No jobs match these filters" : "No jobs available right now"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {currentPage > 1 ? "Try a previous page or return to the first page." : hasScopedResults
                  ? "Try widening your search or clearing filters."
                  : "The live pool is refreshing. Check back in a moment."}
              </p>
              {currentPage > 1 ? (
                <Button className="mt-4" render={<Link href={buildJobsHref(resolvedSearchParams, { page: undefined })} />} size="sm" variant="outline">
                  First page
                </Button>
              ) : hasScopedResults ? (
                <Button className="mt-4" render={<Link href={clearFiltersHref} />} size="sm" variant="outline">
                  Clear filters
                </Button>
              ) : null}
            </div>
          ) : (
            <JobsFeedList
              profileSkills={normalizeSkills(currentProfile.skillsJson).map((skill) => skill.name)}
              viewerId={viewerProfileId}
              initialJobs={jobCards}
              key={navigationKey}
              referenceNow={renderReferenceNow}
            />
          )}

          {showPagination ? (
            <JobsSearchPagination
              ariaLabel="Jobs bottom pagination"
              basePath="/jobs"
              currentPage={currentPage}
              hasNextPage={jobsResult.hasNextPage}
              pageError={pageJumpError}
              searchParams={resolvedSearchParams}
            />
          ) : null}
      </section>
    </div>
    </JobsSearchCountProvider>
  );
}

function getPageJumpError(rawPage: string | undefined, totalPages: number | null) {
  if (rawPage === undefined) return null;
  const trimmed = rawPage.trim();
  const parsed = Number(trimmed);
  const invalid =
    !trimmed ||
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    (totalPages !== null && parsed > totalPages);

  if (!invalid) return null;

  return totalPages !== null
    ? `Enter a page from 1 to ${totalPages.toLocaleString()}.`
    : "Enter page 1 or higher.";
}

function getSearchParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function buildSearchParamSignature(
  searchParams: Record<string, string | string[] | undefined>
) {
  const params = new URLSearchParams();

  for (const key of Object.keys(searchParams).sort()) {
    const value = searchParams[key];
    const normalizedValue = Array.isArray(value) ? value.filter(Boolean).join(",") : value;
    if (normalizedValue) {
      params.set(key, normalizedValue);
    }
  }

  return params.toString();
}

const countActiveFilters = countActiveJobFilters;

function hasActiveSearch(filters: JobFilterParams) {
  return Boolean(
    filters.search ||
      filters.titleSearch ||
      filters.companySearch ||
      filters.locationSearch
  );
}

function buildSearchFormInitialValues(filters: JobFilterParams): Record<JobSearchScope, string> {
  return {
    all: filters.search ?? "",
    title: filters.titleSearch ?? "",
    company: filters.companySearch ?? "",
    location: filters.locationSearch ?? "",
  };
}

type HiddenField = { name: string; value: string };
type HiddenFieldInput = readonly [name: string, value: string | number | undefined];

function buildHiddenFields(entries: HiddenFieldInput[]): HiddenField[] {
  return entries.flatMap(([name, value]) =>
    value !== undefined && value !== "" ? [{ name, value: String(value) }] : []
  );
}

function buildSearchFormHiddenFields(filters: JobFilterParams) {
  const includeSalaryFields = filters.salaryMin || filters.salaryMax;

  return buildHiddenFields([
    ["discoveredSince", filters.discoveredSince],
    ["submissionCategory", filters.submissionCategory],
    ["status", filters.status],
    ["sortBy", filters.sortBy],
    ["location", filters.location],
    ["source", filters.source],
    ["jobFunction", filters.roleCategory],
    ["roleFamily", filters.roleFamily],
    ["careerStage", filters.careerStage],
    ["workMode", filters.workMode],
    ["employmentType", filters.employmentType],
    ["region", filters.region],
    ["industry", filters.industry],
    ["salaryMin", filters.salaryMin],
    ["salaryMax", filters.salaryMax],
    ["salaryCurrency", includeSalaryFields ? filters.salaryCurrency : undefined],
    ["includeUnknownSalary", includeSalaryFields && filters.includeUnknownSalary ? "1" : undefined],
    ["expiry", filters.expiry],
    ["posted", filters.posted],
    ["hideApplied", filters.hideApplied ? "1" : undefined],
  ]);
}

function buildFilterPanelHiddenFields(filters: JobFilterParams) {
  return buildHiddenFields([
    ["discoveredSince", filters.discoveredSince],
    ["submissionCategory", filters.submissionCategory],
    ["roleFamily", filters.roleFamily],
    ["sortBy", filters.sortBy],
    // Preserve legacy/admin params from shared URLs without exposing them as
    // primary user-facing filter controls.
    ["location", filters.location],
    ["source", filters.source],
    ["status", filters.status],
    ["region", filters.region],
  ]);
}

function FilterFieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.13em] text-muted-foreground">
      {children}
    </label>
  );
}

function FilterToggleField({
  label,
  name,
  selected,
  value,
}: {
  label: string;
  name: string;
  selected: string | undefined;
  value: string;
}) {
  const checked = hasFilterValue(selected, value);

  return (
    <label
      className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-[12px] border px-3 py-2.5 text-sm font-medium transition ${
        checked
          ? "border-primary/40 bg-accent text-foreground"
          : "border-border/60 bg-card text-foreground hover:bg-muted"
      }`}
    >
      <span>{label}</span>
      <input
        className="size-4 shrink-0 rounded border-border/70 bg-card"
        defaultChecked={checked}
        name={name}
        type="checkbox"
        value={value}
      />
    </label>
  );
}

function SalaryRangeField({
  includeUnknownSalary,
  salaryCurrency,
  salaryMax,
  salaryMin,
}: {
  includeUnknownSalary: boolean;
  salaryCurrency: NonNullable<JobFilterParams["salaryCurrency"]>;
  salaryMax: number | undefined;
  salaryMin: number | undefined;
}) {
  return (
    <div className="rounded-[12px] border border-border/60 bg-card p-3 sm:col-span-2">
      <FilterFieldLabel>Annual salary range</FilterFieldLabel>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem]">
        <Input
          className="h-9 rounded-[10px] px-2.5 text-xs"
          aria-label="Minimum annual salary"
          defaultValue={salaryMin ? String(salaryMin) : ""}
          inputMode="numeric"
          min={0}
          name="salaryMin"
          placeholder="Minimum, e.g. 90000"
          type="number"
        />
        <Input
          className="h-9 rounded-[10px] px-2.5 text-xs"
          aria-label="Maximum annual salary"
          defaultValue={salaryMax ? String(salaryMax) : ""}
          inputMode="numeric"
          min={0}
          name="salaryMax"
          placeholder="Maximum, e.g. 160000"
          type="number"
        />
        <select
          aria-label="Salary currency"
          className="h-9 rounded-[10px] border border-input bg-card px-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/25"
          defaultValue={salaryCurrency}
          name="salaryCurrency"
        >
          {SALARY_COMPARISON_CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </div>
      <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
        <input
          className="size-3.5 shrink-0 rounded border-border/70 bg-card"
          defaultChecked={includeUnknownSalary}
          name="includeUnknownSalary"
          type="checkbox"
          value="1"
        />
        Include jobs with missing salary or currency
      </label>
    </div>
  );
}

function hasFilterValue(current: string | undefined, optionValue: string) {
  const currentValues = new Set(splitFilterValues(current));
  const optionValues = splitFilterValues(optionValue);
  return optionValues.length > 0 && optionValues.every((value) => currentValues.has(value));
}

function getSortLabel(sortBy?: string) {
  if (sortBy === "newest") return "Newest";
  if (sortBy === "deadline") return "Expiring soon";
  if (sortBy === "company") return "Company A-Z";
  return "Recommended";
}

type ActiveFilterGroup = {
  key: string;
  label: string;
  items: Array<{
    key: string;
    label: string;
    href: string;
  }>;
};

function buildActiveFilterGroups(
  filters: JobFilterParams,
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
  const removeParamHref = (param: string) =>
    buildJobsHref(currentParams, { page: undefined, [param]: undefined });

  if (filters.search) {
    addGroup(
      "search",
      "Search",
      [
        {
          key: "search",
          label: filters.search,
          href: buildJobsHref(currentParams, {
            field: undefined,
            page: undefined,
            q: undefined,
            search: undefined,
            searchScope: undefined,
          }),
        },
      ]
    );
  }
  if (filters.titleSearch) {
    addGroup(
      "titleSearch",
      "Title search",
      [
        {
          key: "titleSearch",
          label: filters.titleSearch,
          href: buildScopedSearchRemoveHref(currentParams, "titleSearch"),
        },
      ]
    );
  }
  if (filters.companySearch) {
    addGroup(
      "companySearch",
      "Company search",
      [
        {
          key: "companySearch",
          label: filters.companySearch,
          href: buildScopedSearchRemoveHref(currentParams, "companySearch"),
        },
      ]
    );
  }
  if (filters.locationSearch) {
    addGroup(
      "locationSearch",
      "Location",
      splitLocationSearchValues(filters.locationSearch).map((location) => ({
        key: `locationSearch:${location.toLowerCase()}`,
        label: location,
        href: buildLocationSearchRemoveHref(currentParams, location),
      }))
    );
  }

  if (filters.location) {
    addGroup("location", "Location filter", [
      { key: "location", label: filters.location, href: removeParamHref("location") },
    ]);
  }
  if (filters.roleFamily) {
    addGroup("roleFamily", "Legacy role", [
      { key: "roleFamily", label: filters.roleFamily, href: removeParamHref("roleFamily") },
    ]);
  }
  if (filters.source) {
    addGroup("source", "Source", [
      { key: "source", label: filters.source, href: removeParamHref("source") },
    ]);
  }
  addSelectedOptionGroup(groups, currentParams, "careerStage", filters.careerStage, EXPERIENCE_LEVEL_GROUP_OPTIONS, "Experience");
  addSelectedOptionGroup(groups, currentParams, "jobFunction", filters.roleCategory, NORMALIZED_ROLE_CATEGORY_OPTIONS, "Job Function");
  addSelectedOptionGroup(groups, currentParams, "workMode", filters.workMode, WORK_MODE_OPTIONS, "Work mode");
  addSelectedOptionGroup(groups, currentParams, "employmentType", filters.employmentType, NORMALIZED_EMPLOYMENT_TYPE_GROUP_OPTIONS, "Employment type");
  addRawValueGroup(groups, currentParams, "region", filters.region, "Region");
  addSelectedOptionGroup(groups, currentParams, "industry", filters.industry, NORMALIZED_INDUSTRY_OPTIONS, "Company industry");
  addSelectedOptionGroup(groups, currentParams, "posted", filters.posted, POSTED_OPTIONS, "Date posted");
  addSelectedOptionGroup(groups, currentParams, "expiry", filters.expiry, EXPIRY_OPTIONS, "Deadline");
  addSelectedOptionGroup(groups, currentParams, "status", filters.status, STATUS_OPTIONS, "Status");
  if (filters.submissionCategory) {
    addGroup("submissionCategory", "Application", [{ key: "submissionCategory", label: filters.submissionCategory.replaceAll("_", " ").toLowerCase(), href: removeParamHref("submissionCategory") }]);
  }
  if (filters.hideApplied) {
    addGroup("hideApplied", "Applications", [
      { key: "hideApplied", label: "Not applied", href: removeParamHref("hideApplied") },
    ]);
  }

  const salaryItems: ActiveFilterGroup["items"] = [];
  if (filters.salaryMin) {
    salaryItems.push({
      key: "salaryMin",
      label: `Min ${filters.salaryCurrency ?? "USD"} ${Number(filters.salaryMin).toLocaleString()}`,
      href: removeParamHref("salaryMin"),
    });
  }
  if (filters.salaryMax) {
    salaryItems.push({
      key: "salaryMax",
      label: `Max ${filters.salaryCurrency ?? "USD"} ${Number(filters.salaryMax).toLocaleString()}`,
      href: removeParamHref("salaryMax"),
    });
  }
  if (filters.includeUnknownSalary && (filters.salaryMin || filters.salaryMax)) {
    salaryItems.push({
      key: "includeUnknownSalary",
      label: "Include missing",
      href: removeParamHref("includeUnknownSalary"),
    });
  }
  addGroup("salary", "Salary", salaryItems);

  return groups;
}

function buildLocationSearchRemoveHref(
  currentParams: Record<string, string | string[] | undefined>,
  location: string
) {
  const values = splitLocationSearchValues(parseJobFilters(currentParams).locationSearch);
  return buildJobsHref(currentParams, {
    page: undefined,
    locationSearch: values.filter((entry) => entry.toLowerCase() !== location.toLowerCase()).join(";") || undefined,
  });
}

function buildScopedSearchRemoveHref(
  currentParams: Record<string, string | string[] | undefined>,
  param: "titleSearch" | "companySearch" | "locationSearch"
) {
  return buildJobsHref(currentParams, { page: undefined, [param]: undefined });
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
    for (const value of optionValues) {
      remaining.delete(value);
    }
  }

  for (const value of remaining) {
    items.push({
      key: `${param}:${value}`,
      label: value,
      href: buildRemoveFilterValueHref(currentParams, param, value),
    });
  }

  if (items.length > 0) {
    groups.push({ key: param, label, items });
  }
}

function addRawValueGroup(
  groups: ActiveFilterGroup[],
  currentParams: Record<string, string | string[] | undefined>,
  param: string,
  current: string | undefined,
  label: string
) {
  const items = splitFilterValues(current).map((value) => ({
      key: `${param}:${value}`,
      label: value,
      href: buildRemoveFilterValueHref(currentParams, param, value),
  }));

  if (items.length > 0) {
    groups.push({ key: param, label, items });
  }
}

function buildRemoveFilterValueHref(
  currentParams: Record<string, string | string[] | undefined>,
  param: string,
  value: string
) {
  const removeValues = new Set(splitFilterValues(value).map((entry) => entry.toLowerCase()));
  const sourceParam = param;
  const canonicalParams = new URLSearchParams(normalizeJobsStateQuery(currentParams));
  const currentValue = canonicalParams.get(sourceParam) ?? undefined;
  const nextValue = splitFilterValues(currentValue)
    .filter((entry) => !removeValues.has(entry.toLowerCase()))
    .join(",");

  const overrides: Record<string, string | undefined> = {
    page: undefined,
    [sourceParam]: nextValue || undefined,
  };
  if (param === "jobFunction") {
    overrides.roleCategory = undefined;
  }

  return buildJobsHref(currentParams, overrides);
}
