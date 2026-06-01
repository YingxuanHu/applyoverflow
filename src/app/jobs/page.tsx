import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { JobsSearchForm } from "@/components/jobs/jobs-search-form";
import {
  JobsFilterDropdownField,
  JobsTextFilterField,
} from "@/components/jobs/jobs-filter-field";
import { JobsAutoRefresh } from "@/components/jobs/jobs-auto-refresh";
import { JobsFeedList } from "@/components/jobs/jobs-feed-list";
import { UserTimeZoneCookie } from "@/components/jobs/user-time-zone-cookie";
import { SearchParamMemory } from "@/components/navigation/search-param-memory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getOptionalCurrentProfileId } from "@/lib/current-user";
import {
  normalizeSalaryCurrency,
  SALARY_COMPARISON_CURRENCIES,
} from "@/lib/currency-conversion";
import { prisma } from "@/lib/db";
import {
  NORMALIZED_CAREER_STAGE_OPTIONS,
  NORMALIZED_EMPLOYMENT_TYPE_OPTIONS,
  NORMALIZED_INDUSTRY_OPTIONS,
  NORMALIZED_ROLE_CATEGORY_OPTIONS,
  normalizeCareerStageFilterValue,
  normalizeEmploymentTypeFilterValue,
  normalizeIndustryFilterValue,
  normalizeRoleCategoryFilterValue,
} from "@/lib/job-metadata";
import { formatPostedAge } from "@/lib/job-display";
import {
  hasJobsStateParamsRecord,
  JOBS_SEARCH_STATE_COOKIE,
  JOBS_SEARCH_STATE_PREFERENCE_KEY,
  JOBS_SEARCH_STATE_STORAGE_KEY,
  JOBS_STATE_PARAM_KEYS,
  resolveJobsStateSource,
} from "@/lib/jobs/search-state";
import { serializeJobCardData } from "@/lib/job-serialization";
import { getIngestionStatus } from "@/lib/queries/ingestion";
import {
  getJobs,
  normalizeJobSortBy,
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
  { label: "Best match", value: undefined },
  { label: "Newest", value: "newest" },
  { label: "Expiry date", value: "deadline" },
  { label: "Company name", value: "company" },
];

export default async function JobsPage({ searchParams }: JobsPageProps) {
  // Note: `await searchParams` below already makes this page dynamic. We
  // previously also called `connection()` here, but that was redundant and
  // added a second opt-out marker that confused the runtime's cache
  // heuristics. Dropping it lets the in-process TTL caches in getJobs /
  // getIngestionStatus do their job on repeat tab/filter navigation.
  const viewerProfileId = await getOptionalCurrentProfileId();
  if (!viewerProfileId) {
    redirect("/sign-in");
  }

  const resolvedSearchParams = await searchParams;
  const isResetRequest = getSearchParam(resolvedSearchParams, "reset") === "1";
  const hasUrlJobsState = hasJobsStateParamsRecord(resolvedSearchParams);
  const cookieStore = await cookies();
  const sessionJobsQuery = decodeJobsStateCookie(
    cookieStore.get(JOBS_SEARCH_STATE_COOKIE)?.value
  );

  const [profileSettings, savedSearchPreference] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { id: viewerProfileId },
      select: { salaryCurrency: true },
    }),
    !isResetRequest && !hasUrlJobsState
      ? prisma.userPreference.findUnique({
          where: {
            userId_key: {
              key: JOBS_SEARCH_STATE_PREFERENCE_KEY,
              userId: viewerProfileId,
            },
          },
          select: { value: true },
        })
      : Promise.resolve(null),
  ]);

  if (isResetRequest) {
    await prisma.userPreference.deleteMany({
      where: {
        key: JOBS_SEARCH_STATE_PREFERENCE_KEY,
        userId: viewerProfileId,
      },
    });
  } else if (!hasUrlJobsState) {
    const restoredState = resolveJobsStateSource({
      savedPreferenceValue: savedSearchPreference?.value,
      sessionQuery: sessionJobsQuery,
      urlParams: resolvedSearchParams,
    });

    if (restoredState.query) {
      redirect(`/jobs?${restoredState.query}`);
    }
  }

  const userTimeZone = normalizeUserTimeZone(
    cookieStore.get(USER_TIME_ZONE_COOKIE)?.value
  );
  const defaultSalaryCurrency =
    normalizeSalaryCurrency(profileSettings?.salaryCurrency) ?? "USD";
  const filters = parseJobFilters(resolvedSearchParams, defaultSalaryCurrency);

  const [jobsResult, ingestionStatus] = await Promise.all([
    getJobs(filters, { viewerProfileId, userTimeZone }),
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
    })
  );

  const activeFilterCount = countActiveFilters(filters);
  const hasScopedResults = activeFilterCount > 0 || hasActiveSearch(filters);
  const visibleResultFloor = Math.max(
    jobsResult.data.length,
    (jobsResult.page - 1) * jobsResult.pageSize + jobsResult.data.length
  );
  const headlineCountLabel =
    hasScopedResults &&
    jobsResult.hasNextPage &&
    (jobsResult.total === null || jobsResult.total <= visibleResultFloor)
      ? `${visibleResultFloor.toLocaleString()}+`
      : (hasScopedResults
          ? (jobsResult.total ?? jobsResult.data.length)
          : jobsResult.summary.liveJobCount
        ).toLocaleString();
  const activeFilterGroups = buildActiveFilterGroups(filters, resolvedSearchParams);
  const currentSortLabel = getSortLabel(filters.sortBy);
  const currentPage = jobsResult.page;
  const totalPages =
    jobsResult.total !== null ? Math.max(1, Math.ceil(jobsResult.total / jobsResult.pageSize)) : null;
  const navigationKey = buildSearchParamSignature(resolvedSearchParams);
  const clearFiltersHref = "/jobs?reset=1";
  const searchFormHiddenFields = buildSearchFormHiddenFields(filters);

  return (
    <div className="app-page space-y-6">
      <UserTimeZoneCookie
        cookieName={USER_TIME_ZONE_COOKIE}
        currentTimeZone={userTimeZone}
      />
      <SearchParamMemory
        basePath="/jobs"
        cookieName={JOBS_SEARCH_STATE_COOKIE}
        persistEndpoint="/api/preferences/jobs-search-state"
        stateParamKeys={JOBS_STATE_PARAM_KEYS}
        storageKey={JOBS_SEARCH_STATE_STORAGE_KEY}
      />
      <JobsAutoRefresh initialLastUpdatedAt={ingestionStatus.lastUpdatedAt} />

      <header className="page-header">
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="page-description">
            Review the live job pool first, then move the strongest matches into your wishlist or application flow.
          </p>
        </div>
      </header>

      <section className="surface-panel p-3.5 sm:p-6">
        <div>
          <p className="text-[1.75rem] font-semibold tracking-tight text-foreground sm:text-[2.5rem]">
            {headlineCountLabel} {hasScopedResults ? "matching jobs" : "live jobs"}
          </p>
          {ingestionStatus.lastUpdatedAt ? (
            <p className="mt-2 text-sm text-muted-foreground sm:text-[15px]">
              Updated {formatPostedAge(ingestionStatus.lastUpdatedAt)}
              {ingestionStatus.activeSourceCount > 0
                ? (
                    <span className="hidden sm:inline">
                      {" "}
                      · {ingestionStatus.activeSourceCount} connector{ingestionStatus.activeSourceCount !== 1 ? "s" : ""} active
                    </span>
                  )
                : null}
            </p>
          ) : null}
          <div className="mt-2 grid grid-cols-2 gap-2 text-[13px] sm:flex sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1 sm:text-[15px]">
            <span className="text-foreground">
              <span className="font-medium">{jobsResult.summary.addedTodayCount.toLocaleString()}</span>{" "}
              <span className="text-muted-foreground sm:text-foreground">new today</span>
            </span>
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">
                {(
                  jobsResult.summary.expiredTodayCount +
                  jobsResult.summary.removedTodayCount
                ).toLocaleString()}
              </span>{" "}
              closed today
            </span>
          </div>
          {hasScopedResults &&
          jobsResult.total !== null &&
          ingestionStatus.liveJobCount > jobsResult.total ? (
            <p className="mt-1 text-xs text-muted-foreground">
              From {ingestionStatus.liveJobCount.toLocaleString()} total live jobs in the pool
            </p>
          ) : null}
        </div>

        <div className="mt-4 space-y-3 border-t border-border/60 pt-3 sm:mt-5 sm:space-y-4 sm:pt-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex min-w-0 flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
                <JobsSearchForm
                  hiddenFields={searchFormHiddenFields}
                  initialScope={filters.searchScope ?? "all"}
                  initialValues={buildSearchFormInitialValues(filters)}
                />

                <div className="grid w-full grid-cols-2 items-center gap-2 sm:flex sm:w-auto sm:flex-wrap">
                  <details className="group static sm:relative" name="jobs-toolbar-dropdown">
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

                    <div className="fixed inset-x-2 bottom-3 z-40 max-h-[min(82dvh,36rem)] origin-bottom overflow-hidden rounded-[20px] border border-border/70 bg-popover shadow-[0_24px_60px_rgba(0,0,0,0.24)] backdrop-blur sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-[calc(100%+0.6rem)] sm:w-[min(36rem,calc(100vw-2rem))] sm:max-w-[calc(100vw-2rem)] sm:origin-top-right">
                      <form method="get">
                        {buildFilterPanelHiddenFields(filters).map((field) => (
                          <input
                            key={`${field.name}:${field.value}`}
                            name={field.name}
                            type="hidden"
                            value={field.value}
                          />
                        ))}

                        <div className="border-b border-border/60 px-3.5 py-3 sm:px-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <p className="text-sm font-medium text-foreground">Refine jobs</p>
                              <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">
                                Jobs must match all active filter sections. Multiple options in one section use OR.
                              </p>
                            </div>
                            {activeFilterCount > 0 ? (
                              <span className="inline-flex h-6 items-center rounded-full border border-border/70 bg-muted/40 px-2 text-[11px] font-medium text-foreground">
                                {activeFilterCount} active
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="grid max-h-[min(68dvh,30rem)] gap-2 overflow-y-auto p-3 sm:grid-cols-2 sm:p-3.5">
                          <FilterToggleField
                            name="expiry"
                            selected={filters.expiry}
                            value="soon"
                          />

                          <JobsFilterDropdownField
                            clearHref={buildJobsHref(resolvedSearchParams, {
                              page: undefined,
                              careerStage: undefined,
                              experienceLevel: undefined,
                            })}
                            className="sm:col-span-2"
                            columnsClassName="sm:grid-cols-2"
                            emptyLabel="All levels"
                            name="careerStage"
                            options={NORMALIZED_CAREER_STAGE_OPTIONS}
                            selected={filters.careerStage}
                            title="Experience level"
                          />

                          <JobsFilterDropdownField
                            clearHref={buildJobsHref(resolvedSearchParams, {
                              page: undefined,
                              jobFunction: undefined,
                              roleCategory: undefined,
                            })}
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
                            placeholder="City, country, or region"
                            title="Location"
                          />

                          <JobsFilterDropdownField
                            clearHref={buildJobsHref(resolvedSearchParams, {
                              page: undefined,
                              industry: undefined,
                            })}
                            className="sm:col-span-2"
                            columnsClassName="sm:grid-cols-2"
                            emptyLabel="Any company industry"
                            name="industry"
                            options={NORMALIZED_INDUSTRY_OPTIONS}
                            selected={filters.industry}
                            title="Company industry"
                          />

                          <JobsFilterDropdownField
                            clearHref={buildJobsHref(resolvedSearchParams, {
                              page: undefined,
                              workMode: undefined,
                            })}
                            className="sm:col-span-2"
                            columnsClassName="sm:grid-cols-2"
                            emptyLabel="Any work mode"
                            name="workMode"
                            options={WORK_MODE_OPTIONS}
                            selected={filters.workMode}
                            title="Work mode"
                          />

                          <JobsFilterDropdownField
                            clearHref={buildJobsHref(resolvedSearchParams, {
                              page: undefined,
                              employmentType: undefined,
                            })}
                            className="sm:col-span-2"
                            columnsClassName="sm:grid-cols-2"
                            emptyLabel="Any type"
                            name="employmentType"
                            options={NORMALIZED_EMPLOYMENT_TYPE_OPTIONS}
                            selected={filters.employmentType}
                            title="Employment type"
                          />

                          <JobsFilterDropdownField
                            clearHref={buildJobsHref(resolvedSearchParams, {
                              page: undefined,
                              posted: undefined,
                            })}
                            className="sm:col-span-2"
                            columnsClassName="sm:grid-cols-2"
                            emptyLabel="Any posted date"
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

                        <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/45 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                          <div className="hidden sm:block">
                            <p className="text-xs font-medium text-foreground">Apply filters</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              Filters keep your search and sort, and reset the page.
                            </p>
                          </div>
                          <Button className="h-10 w-full px-3 text-sm sm:h-8 sm:w-auto sm:text-xs" size="sm" type="submit">
                            Apply filters
                          </Button>
                        </div>
                      </form>
                    </div>
                  </details>

                  <details className="group static self-start sm:relative lg:self-auto" name="jobs-toolbar-dropdown">
                    <summary className="inline-flex h-10 w-full list-none items-center justify-center gap-2 rounded-[14px] border border-border/70 bg-card px-3 text-sm font-medium text-foreground transition hover:bg-muted sm:w-auto sm:px-4 [&::-webkit-details-marker]:hidden">
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
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {activeFilterGroups.map((group) => (
                      <div
                        className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-full border border-border/70 bg-card py-1 pl-3 pr-1.5 text-xs text-muted-foreground"
                        key={group.key}
                      >
                        <span className="font-semibold text-foreground">{group.label}:</span>
                        {group.items.map((item) => (
                          <Link
                            aria-label={`Remove ${group.label}: ${item.label}`}
                            className="inline-flex h-6 max-w-full items-center gap-1 rounded-full px-1.5 transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                            href={item.href}
                            key={item.key}
                          >
                            <span className="min-w-0 truncate">{item.label}</span>
                            <X className="h-3 w-3 shrink-0" />
                          </Link>
                        ))}
                      </div>
                    ))}
                  </div>
                  <Button
                    className="h-8 shrink-0 rounded-full px-3 text-xs sm:ml-3"
                    render={<Link href={clearFiltersHref} />}
                    size="sm"
                    variant="outline"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear all
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section>
        {jobCards.length === 0 ? (
          <div className="empty-state">
            <p className="text-sm font-medium text-foreground">
              {hasScopedResults ? "No jobs match these filters" : "No jobs available right now"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {hasScopedResults
                ? "Try widening your search or clearing filters."
                : "The live pool is refreshing. Check back in a moment."}
            </p>
            {hasScopedResults ? (
              <Button className="mt-4" render={<Link href={clearFiltersHref} />} size="sm" variant="outline">
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : (
          <JobsFeedList
            initialJobs={jobCards}
            key={navigationKey}
            referenceNow={renderReferenceNow}
          />
        )}

        {(currentPage > 1 || jobsResult.hasNextPage || (totalPages !== null && totalPages > 1)) ? (
          <div className="mt-5 flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {totalPages !== null ? `Page ${currentPage} of ${totalPages}` : `Page ${currentPage}`}
            </p>
            <div className="flex items-center gap-2">
              <PaginationLink
                disabled={currentPage <= 1}
                href={buildJobsHref(resolvedSearchParams, {
                  page: currentPage > 1 ? String(currentPage - 1) : undefined,
                })}
              >
                Previous
              </PaginationLink>
              <PaginationLink
                disabled={totalPages !== null ? currentPage >= totalPages : !jobsResult.hasNextPage}
                href={buildJobsHref(resolvedSearchParams, {
                  page:
                    totalPages !== null
                      ? currentPage < totalPages
                        ? String(currentPage + 1)
                        : undefined
                      : jobsResult.hasNextPage
                        ? String(currentPage + 1)
                        : undefined,
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
      <span className="inline-flex h-7 items-center rounded-md border border-input px-2.5 text-sm text-muted-foreground opacity-40">
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

function decodeJobsStateCookie(value?: string) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function parseJobFilters(
  searchParams: Record<string, string | string[] | undefined>,
  defaultSalaryCurrency: NonNullable<JobFilterParams["salaryCurrency"]>
): JobFilterParams {
  const pageValue = getSearchParam(searchParams, "page");
  const parsedPage = pageValue ? Number.parseInt(pageValue, 10) : undefined;
  const aliasField = getSearchParam(searchParams, "field");
  const aliasQuery = normalizeTextParam(getSearchParam(searchParams, "q"));
  const selectedSearchScope = normalizeSearchScopeParam(
    getSearchParam(searchParams, "searchScope") ?? aliasField
  );
  const rawSearch =
    normalizeTextParam(getSearchParam(searchParams, "search")) ??
    (selectedSearchScope === "all" ? aliasQuery : undefined);
  const rawCareerStage =
    getMultiSearchParam(searchParams, "careerStage") ||
    getMultiSearchParam(searchParams, "experienceLevel");
  const rawJobFunction =
    getMultiSearchParam(searchParams, "function") ||
    getMultiSearchParam(searchParams, "jobFunction") ||
    getMultiSearchParam(searchParams, "roleCategory");
  let search = rawSearch;
  let titleSearch = normalizeTextParam(getSearchParam(searchParams, "titleSearch"));
  let companySearch = normalizeTextParam(getSearchParam(searchParams, "companySearch"));
  let locationSearch = normalizeTextListParam(getMultiSearchParam(searchParams, "locationSearch"));

  if (aliasQuery && selectedSearchScope === "title" && !titleSearch) {
    titleSearch = aliasQuery;
  } else if (aliasQuery && selectedSearchScope === "company" && !companySearch) {
    companySearch = aliasQuery;
  } else if (aliasQuery && selectedSearchScope === "location" && !locationSearch) {
    locationSearch = normalizeTextListParam([locationSearch, aliasQuery].filter(Boolean).join(","));
  }

  if (rawSearch && selectedSearchScope === "title") {
    titleSearch = titleSearch ?? rawSearch;
    search = undefined;
  } else if (rawSearch && selectedSearchScope === "company") {
    companySearch = companySearch ?? rawSearch;
    search = undefined;
  } else if (rawSearch && selectedSearchScope === "location") {
    locationSearch = normalizeTextListParam([locationSearch, rawSearch].filter(Boolean).join(","));
    search = undefined;
  } else if (search) {
    titleSearch = undefined;
    companySearch = undefined;
    locationSearch = undefined;
  }
  const effectiveSearchScope = inferEffectiveSearchScope({
    companySearch,
    locationSearch,
    search,
    selectedSearchScope,
    titleSearch,
  });
  const parsedSalaryMin = getPositiveNumber(getSearchParam(searchParams, "salaryMin"));
  const parsedSalaryMax = getPositiveNumber(getSearchParam(searchParams, "salaryMax"));
  const salaryMin =
    parsedSalaryMin && parsedSalaryMax && parsedSalaryMin > parsedSalaryMax
      ? parsedSalaryMax
      : parsedSalaryMin;
  const salaryMax =
    parsedSalaryMin && parsedSalaryMax && parsedSalaryMin > parsedSalaryMax
      ? parsedSalaryMin
      : parsedSalaryMax;

  return {
    search,
    searchScope: effectiveSearchScope,
    titleSearch,
    companySearch,
    locationSearch,
    location: normalizeTextParam(getSearchParam(searchParams, "location")),
    source: normalizeTextParam(getSearchParam(searchParams, "source")),
    region: getMultiSearchParam(searchParams, "region"),
    workMode: getMultiSearchParam(searchParams, "workMode"),
    employmentType: normalizeEmploymentTypeFilterValue(getMultiSearchParam(searchParams, "employmentType")),
    industry: normalizeIndustryFilterValue(getMultiSearchParam(searchParams, "industry")),
    roleCategory: normalizeRoleCategoryFilterValue(rawJobFunction),
    roleFamily: normalizeTextParam(getMultiSearchParam(searchParams, "roleFamily")),
    salaryMin,
    salaryMax,
    salaryCurrency:
      normalizeSalaryCurrency(getSearchParam(searchParams, "salaryCurrency")) ??
      defaultSalaryCurrency,
    includeUnknownSalary: normalizeBooleanParam(getSearchParam(searchParams, "includeUnknownSalary")),
    careerStage: normalizeCareerStageFilterValue(rawCareerStage),
    expiry: getSearchParam(searchParams, "expiry"),
    posted: getSearchParam(searchParams, "posted") ?? getSearchParam(searchParams, "datePosted"),
    submissionCategory: undefined,
    status: getSearchParam(searchParams, "status"),
    sortBy: normalizeSortByParam(
      getSearchParam(searchParams, "sortBy") ?? getSearchParam(searchParams, "sort")
    ),
    page: parsedPage && parsedPage > 0 ? parsedPage : undefined,
    debugFilters: getSearchParam(searchParams, "debugFilters") === "1",
  };
}

function inferEffectiveSearchScope({
  companySearch,
  locationSearch,
  search,
  selectedSearchScope,
  titleSearch,
}: {
  companySearch?: string;
  locationSearch?: string;
  search?: string;
  selectedSearchScope: JobFilterParams["searchScope"];
  titleSearch?: string;
}) {
  if (search) return "all";
  if (selectedSearchScope && selectedSearchScope !== "all") return selectedSearchScope;
  if (titleSearch) return "title";
  if (companySearch) return "company";
  if (locationSearch) return "location";
  return "all";
}

function normalizeTextParam(value?: string) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

function normalizeTextListParam(value?: string) {
  const values = splitFilterValues(value)
    .map((entry) => entry.slice(0, 80))
    .filter(Boolean);
  return values.length > 0 ? values.join(",") : undefined;
}

function normalizeSearchScopeParam(value?: string): JobFilterParams["searchScope"] {
  if (value === "all") {
    return "all";
  }
  if (value === "title" || value === "company" || value === "location") {
    return value;
  }
  return "all";
}

function getSearchParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function getMultiSearchParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string
) {
  const value = searchParams[key];
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(",");
  }
  return value;
}

function getPositiveNumber(value?: string) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed;
}

function normalizeBooleanParam(value?: string) {
  return value === "1" || value === "true" || value === "on";
}

const SEARCH_PARAM_KEYS = ["search", "titleSearch", "companySearch", "locationSearch"] as const;

function hasSearchParamsRecord(
  searchParams: Record<string, string | string[] | undefined>
) {
  return SEARCH_PARAM_KEYS.some((key) => normalizeTextParam(getSearchParam(searchParams, key)));
}

function hasSearchParams(params: URLSearchParams) {
  return SEARCH_PARAM_KEYS.some((key) => normalizeTextParam(params.get(key) ?? undefined));
}

function buildJobsHref(
  currentParams: Record<string, string | string[] | undefined>,
  overrides: Record<string, string | undefined>
) {
  const params = new URLSearchParams();
  const currentHasSearch = hasSearchParamsRecord(currentParams);
  let currentHadValues = false;

  for (const [key, value] of Object.entries(currentParams)) {
    if (key === "reset") continue;
    const normalizedValue = Array.isArray(value) ? value.filter(Boolean).join(",") : value;
    if (key === "searchScope" && (!currentHasSearch || !normalizeSearchScopeParam(normalizedValue))) {
      continue;
    }
    if (key === "sortBy") {
      currentHadValues = currentHadValues || Boolean(normalizedValue);
      const normalizedSort = normalizeSortByParam(normalizedValue);
      if (normalizedSort) params.set(key, normalizedSort);
      continue;
    }
    if (normalizedValue) {
      currentHadValues = true;
      params.set(key, normalizedValue);
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (key === "sortBy") {
      const normalizedSort = normalizeSortByParam(value);
      if (normalizedSort) params.set(key, normalizedSort);
      else params.delete(key);
      continue;
    }
    if (value) params.set(key, value);
    else params.delete(key);
  }

  normalizeSearchParamsForHref(params);
  normalizeMetadataParamsForHref(params, overrides);

  if (!params.get("salaryMin") && !params.get("salaryMax")) {
    params.delete("salaryCurrency");
    params.delete("includeUnknownSalary");
  }

  if (!hasSearchParams(params)) {
    params.delete("searchScope");
  }

  const queryString = params.toString();
  if (!queryString && currentHadValues) {
    return "/jobs?reset=1";
  }
  return queryString ? `/jobs?${queryString}` : "/jobs";
}

function normalizeMetadataParamsForHref(
  params: URLSearchParams,
  overrides: Record<string, string | undefined>
) {
  const functionAlias = params.get("function");
  if (functionAlias && !params.has("jobFunction") && !params.has("roleCategory")) {
    params.set("jobFunction", functionAlias);
  }
  params.delete("function");

  const datePostedAlias = params.get("datePosted");
  if (datePostedAlias && !params.has("posted")) {
    params.set("posted", datePostedAlias);
  }
  params.delete("datePosted");

  if (Object.prototype.hasOwnProperty.call(overrides, "careerStage") && !overrides.careerStage) {
    params.delete("experienceLevel");
  }

  if (
    (Object.prototype.hasOwnProperty.call(overrides, "jobFunction") && !overrides.jobFunction) ||
    (Object.prototype.hasOwnProperty.call(overrides, "roleCategory") && !overrides.roleCategory)
  ) {
    params.delete("jobFunction");
    params.delete("roleCategory");
  }

  const legacyRoleCategory = params.get("roleCategory");
  const jobFunction = params.get("jobFunction") ?? legacyRoleCategory;
  if (jobFunction) {
    const normalized = normalizeRoleCategoryFilterValue(jobFunction);
    if (normalized) params.set("jobFunction", normalized);
    else params.delete("jobFunction");
    params.delete("roleCategory");
  }

  const legacyCareerStage = params.get("experienceLevel");
  if (legacyCareerStage && !params.has("careerStage")) {
    const normalized = normalizeCareerStageFilterValue(legacyCareerStage);
    if (normalized) params.set("careerStage", normalized);
    params.delete("experienceLevel");
  }
}

function normalizeSearchParamsForHref(params: URLSearchParams) {
  const sortAlias = normalizeSortByParam(params.get("sort") ?? undefined);
  if (sortAlias && !params.has("sortBy")) {
    params.set("sortBy", sortAlias);
  }
  params.delete("sort");

  const aliasQuery = normalizeTextParam(params.get("q") ?? undefined);
  if (aliasQuery && !normalizeTextParam(params.get("search") ?? undefined)) {
    const aliasScope = normalizeSearchScopeParam(params.get("field") ?? undefined);
    if (aliasScope === "title") {
      params.set("titleSearch", aliasQuery);
    } else if (aliasScope === "company") {
      params.set("companySearch", aliasQuery);
    } else if (aliasScope === "location") {
      const locationSearch = normalizeTextListParam(
        [params.get("locationSearch"), aliasQuery].filter(Boolean).join(",")
      );
      if (locationSearch) params.set("locationSearch", locationSearch);
    } else {
      params.set("search", aliasQuery);
    }
  }
  params.delete("q");
  params.delete("field");

  const search = normalizeTextParam(params.get("search") ?? undefined);
  if (!search) return;

  const searchScope = normalizeSearchScopeParam(params.get("searchScope") ?? undefined);
  if (searchScope === "title") {
    if (!normalizeTextParam(params.get("titleSearch") ?? undefined)) {
      params.set("titleSearch", search);
    }
    params.delete("search");
    params.delete("searchScope");
    return;
  }
  if (searchScope === "company") {
    if (!normalizeTextParam(params.get("companySearch") ?? undefined)) {
      params.set("companySearch", search);
    }
    params.delete("search");
    params.delete("searchScope");
    return;
  }
  if (searchScope === "location") {
    const locationSearch = normalizeTextListParam(
      [params.get("locationSearch"), search].filter(Boolean).join(",")
    );
    if (locationSearch) params.set("locationSearch", locationSearch);
    params.delete("search");
    params.delete("searchScope");
    return;
  }

  params.delete("titleSearch");
  params.delete("companySearch");
  params.delete("locationSearch");
  params.delete("searchScope");
}

function buildSearchParamSignature(
  searchParams: Record<string, string | string[] | undefined>
) {
  const params = new URLSearchParams();
  const currentHasSearch = hasSearchParamsRecord(searchParams);

  for (const key of Object.keys(searchParams).sort()) {
    const value = searchParams[key];
    const normalizedValue = Array.isArray(value) ? value.filter(Boolean).join(",") : value;
    if (key === "searchScope" && (!currentHasSearch || !normalizeSearchScopeParam(normalizedValue))) {
      continue;
    }
    if (normalizedValue) {
      params.set(key, normalizedValue);
    }
  }

  return params.toString();
}

function countActiveFilters(filters: JobFilterParams) {
  const keys: Array<keyof JobFilterParams> = [
    "location",
    "source",
    "region",
    "workMode",
    "employmentType",
    "industry",
    "roleCategory",
    "salaryMin",
    "salaryMax",
    "roleFamily",
    "careerStage",
    "experienceLevel",
    "expiry",
    "posted",
    "status",
  ];

  return keys.filter((key) => {
    if (key === "salaryMin" || key === "salaryMax") {
      return false;
    }
    const value = filters[key];
    return value !== undefined && value !== "";
  }).length + (filters.salaryMin || filters.salaryMax ? 1 : 0);
}

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

function buildSearchFormHiddenFields(filters: JobFilterParams) {
  const fields: Array<{ name: string; value: string }> = [];
  const add = (name: string, value: string | number | undefined) => {
    if (value !== undefined && value !== "") {
      fields.push({ name, value: String(value) });
    }
  };

  add("status", filters.status);
  add("sortBy", filters.sortBy);
  add("location", filters.location);
  add("source", filters.source);
  add("jobFunction", filters.roleCategory);
  add("careerStage", filters.careerStage);
  add("workMode", filters.workMode);
  add("employmentType", filters.employmentType);
  add("region", filters.region);
  add("industry", filters.industry);
  add("salaryMin", filters.salaryMin);
  add("salaryMax", filters.salaryMax);
  if (filters.salaryMin || filters.salaryMax) {
    add("salaryCurrency", filters.salaryCurrency);
    if (filters.includeUnknownSalary) add("includeUnknownSalary", "1");
  }
  add("expiry", filters.expiry);
  add("posted", filters.posted);

  return fields;
}

function buildFilterPanelHiddenFields(filters: JobFilterParams) {
  const fields: Array<{ name: string; value: string }> = [];
  const add = (name: string, value: string | number | undefined) => {
    if (value !== undefined && value !== "") {
      fields.push({ name, value: String(value) });
    }
  };

  add("sortBy", filters.sortBy);
  add("search", filters.search);
  add("titleSearch", filters.titleSearch);
  add("companySearch", filters.companySearch);
  if (hasActiveSearch(filters)) add("searchScope", filters.searchScope);

  // Preserve legacy/admin params if someone arrived with a shared URL, but
  // do not expose these as primary user-facing filter controls.
  add("location", filters.location);
  add("source", filters.source);
  add("status", filters.status);
  add("region", filters.region);

  return fields;
}

function FilterFieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.13em] text-muted-foreground">
      {children}
    </label>
  );
}

function FilterToggleField({
  name,
  selected,
  value,
}: {
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
      <span>Expiring soon</span>
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
      <FilterFieldLabel>Salary range</FilterFieldLabel>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem]">
        <Input
          className="h-9 rounded-[10px] px-2.5 text-xs"
          defaultValue={salaryMin ? String(salaryMin) : ""}
          inputMode="numeric"
          min={0}
          name="salaryMin"
          placeholder="Minimum, e.g. 90000"
          type="number"
        />
        <Input
          className="h-9 rounded-[10px] px-2.5 text-xs"
          defaultValue={salaryMax ? String(salaryMax) : ""}
          inputMode="numeric"
          min={0}
          name="salaryMax"
          placeholder="Maximum, e.g. 160000"
          type="number"
        />
        <select
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
        Include jobs with missing salary
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
  if (sortBy === "deadline") return "Expiry date";
  if (sortBy === "company") return "Company name";
  return "Best match";
}

function normalizeSortByParam(value?: string) {
  const sortBy = normalizeJobSortBy(value);
  return sortBy === "relevance" ? undefined : sortBy;
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
          href: buildScopedSearchRemoveHref(currentParams, "titleSearch", "title"),
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
          href: buildScopedSearchRemoveHref(currentParams, "companySearch", "company"),
        },
      ]
    );
  }
  if (filters.locationSearch) {
    addGroup(
      "locationSearch",
      "Location",
      splitFilterValues(filters.locationSearch).map((location) => ({
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
  addSelectedOptionGroup(groups, currentParams, "careerStage", filters.careerStage, NORMALIZED_CAREER_STAGE_OPTIONS, "Experience");
  addSelectedOptionGroup(groups, currentParams, "jobFunction", filters.roleCategory, NORMALIZED_ROLE_CATEGORY_OPTIONS, "Job Function");
  addSelectedOptionGroup(groups, currentParams, "workMode", filters.workMode, WORK_MODE_OPTIONS, "Work mode");
  addSelectedOptionGroup(groups, currentParams, "employmentType", filters.employmentType, NORMALIZED_EMPLOYMENT_TYPE_OPTIONS, "Employment type");
  addRawValueGroup(groups, currentParams, "region", filters.region, "Region");
  addSelectedOptionGroup(groups, currentParams, "industry", filters.industry, NORMALIZED_INDUSTRY_OPTIONS, "Company industry");
  addSelectedOptionGroup(groups, currentParams, "posted", filters.posted, POSTED_OPTIONS, "Date posted");
  addSelectedOptionGroup(groups, currentParams, "expiry", filters.expiry, EXPIRY_OPTIONS, "Deadline");
  addSelectedOptionGroup(groups, currentParams, "status", filters.status, STATUS_OPTIONS, "Status");

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
  const currentLocationSearch = getMultiSearchParam(currentParams, "locationSearch");
  const isLegacyLocationSearch =
    normalizeSearchScopeParam(getSearchParam(currentParams, "searchScope")) === "location";
  const legacySearch = isLegacyLocationSearch ? getSearchParam(currentParams, "search") : undefined;
  const nextValue = splitFilterValues([currentLocationSearch, legacySearch].filter(Boolean).join(","))
    .filter((entry) => entry.toLowerCase() !== location.toLowerCase())
    .join(",");
  const overrides: Record<string, string | undefined> = {
    page: undefined,
    locationSearch: nextValue || undefined,
  };

  if (isLegacyLocationSearch) {
    overrides.search = undefined;
    overrides.searchScope = nextValue ? "location" : undefined;
  }

  return buildJobsHref(currentParams, overrides);
}

function buildScopedSearchRemoveHref(
  currentParams: Record<string, string | string[] | undefined>,
  param: "titleSearch" | "companySearch" | "locationSearch",
  legacyScope: "title" | "company" | "location"
) {
  const overrides: Record<string, string | undefined> = {
    page: undefined,
    [param]: undefined,
  };

  const searchScope = normalizeSearchScopeParam(getSearchParam(currentParams, "searchScope"));
  const aliasScope = normalizeSearchScopeParam(getSearchParam(currentParams, "field"));

  if (searchScope === legacyScope || aliasScope === legacyScope) {
    overrides.field = undefined;
    overrides.q = undefined;
    overrides.search = undefined;
    overrides.searchScope = undefined;
  }

  return buildJobsHref(currentParams, overrides);
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
  const sourceParam = param === "jobFunction" ? "jobFunction" : param;
  const rawValue =
    param === "jobFunction"
      ? getMultiSearchParam(currentParams, "jobFunction") ||
        getMultiSearchParam(currentParams, "roleCategory")
      : getMultiSearchParam(currentParams, sourceParam);
  const currentValue =
    param === "jobFunction" ? normalizeRoleCategoryFilterValue(rawValue) : rawValue;
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

function splitFilterValues(value?: string) {
  if (!value) return [];
  const seen = new Set<string>();
  const values: string[] = [];

  for (const entry of value.split(",")) {
    const trimmed = entry.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(trimmed);
  }

  return values;
}
