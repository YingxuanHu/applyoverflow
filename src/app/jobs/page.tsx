import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { JobsSearchForm } from "@/components/jobs/jobs-search-form";
import { JobsAutoRefresh } from "@/components/jobs/jobs-auto-refresh";
import { JobsFeedList } from "@/components/jobs/jobs-feed-list";
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
import { serializeJobCardData } from "@/lib/job-serialization";
import { getIngestionStatus } from "@/lib/queries/ingestion";
import {
  getJobs,
  normalizeJobSortBy,
  type JobFilterParams,
  type JobSearchScope,
  type JobSortBy,
} from "@/lib/queries/jobs";

type JobsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const CATEGORY_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "Auto-apply", value: "AUTO_SUBMIT_READY" },
  { label: "Manual", value: "MANUAL_ONLY" },
];

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

  const [resolvedSearchParams, profileSettings] = await Promise.all([
    searchParams,
    prisma.userProfile.findUnique({
      where: { id: viewerProfileId },
      select: { salaryCurrency: true },
    }),
  ]);
  const defaultSalaryCurrency =
    normalizeSalaryCurrency(profileSettings?.salaryCurrency) ?? "USD";
  const filters = parseJobFilters(resolvedSearchParams, defaultSalaryCurrency);

  const [jobsResult, ingestionStatus] = await Promise.all([
    getJobs(filters, { viewerProfileId }),
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
  const headlineCount = hasScopedResults
    ? jobsResult.total ?? jobsResult.data.length
    : jobsResult.summary.liveJobCount;
  const activeFilterChips = buildActiveFilterChips(filters, resolvedSearchParams);
  const currentSortLabel = getSortLabel(filters.sortBy);
  const currentPage = jobsResult.page;
  const totalPages =
    jobsResult.total !== null ? Math.max(1, Math.ceil(jobsResult.total / jobsResult.pageSize)) : null;
  const navigationKey = buildSearchParamSignature(resolvedSearchParams);
  const clearFiltersHref = "/jobs?reset=1";
  const searchFormHiddenFields = buildSearchFormHiddenFields(filters);

  return (
    <div className="app-page space-y-6">
      <SearchParamMemory basePath="/jobs" storageKey="autoapplication.jobs.filters" />
      <JobsAutoRefresh initialLastUpdatedAt={ingestionStatus.lastUpdatedAt} />

      <header className="page-header">
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="page-description">
            Review the live job pool first, then move the strongest matches into your wishlist or application flow.
          </p>
        </div>
      </header>

      <section className="surface-panel p-4 sm:p-5">
        <div>
          <p className="text-[2rem] font-semibold tracking-tight text-foreground sm:text-[2.5rem]">
            {headlineCount.toLocaleString()} {hasScopedResults ? "matching jobs" : "live jobs"}
          </p>
          {ingestionStatus.lastUpdatedAt ? (
            <p className="mt-2 text-sm text-muted-foreground sm:text-[15px]">
              Updated {formatPostedAge(ingestionStatus.lastUpdatedAt)}
              {ingestionStatus.activeSourceCount > 0
                ? ` · ${ingestionStatus.activeSourceCount} connector${ingestionStatus.activeSourceCount !== 1 ? "s" : ""} active`
                : ""}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm sm:text-[15px]">
            <span className="text-foreground">
              <span className="font-medium">{jobsResult.summary.addedTodayCount.toLocaleString()}</span>{" "}
              first seen today
            </span>
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">
                {(
                  jobsResult.summary.expiredTodayCount +
                  jobsResult.summary.removedTodayCount
                ).toLocaleString()}
              </span>{" "}
              expired/closed today
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

        <div className="mt-5 space-y-4 border-t border-border/60 pt-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                <JobsSearchForm
                  hiddenFields={searchFormHiddenFields}
                  initialScope={filters.searchScope ?? "all"}
                  initialValues={buildSearchFormInitialValues(filters)}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <details className="group relative" name="jobs-toolbar-dropdown">
                    <summary className="inline-flex h-10 list-none items-center gap-2 rounded-xl border border-border/70 bg-background/70 px-4 text-sm font-medium text-foreground transition hover:bg-muted/70 [&::-webkit-details-marker]:hidden">
                      <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                      Filters
                      {activeFilterCount > 0 ? (
                        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-foreground px-1.5 text-[11px] font-medium text-background">
                          {activeFilterCount}
                        </span>
                      ) : null}
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition group-open:rotate-180" />
                    </summary>

                    <div className="absolute right-0 top-[calc(100%+0.6rem)] z-30 w-[min(36rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] origin-top-right overflow-hidden rounded-xl border border-border/70 bg-background/96 shadow-[0_24px_60px_rgba(15,23,42,0.18)] backdrop-blur">
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
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Add filters here. Search chips stay editable below the toolbar.
                              </p>
                            </div>
                            {activeFilterCount > 0 ? (
                              <span className="inline-flex h-6 items-center rounded-full border border-border/70 bg-muted/40 px-2 text-[11px] font-medium text-foreground">
                                {activeFilterCount} active
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="grid max-h-[min(68vh,30rem)] gap-2 overflow-y-auto p-3 sm:grid-cols-2 sm:p-3.5">
                          <FilterToggleField
                            name="expiry"
                            selected={filters.expiry}
                            value="soon"
                          />

                          <FilterDropdownField
                            clearHref={buildJobsHref(resolvedSearchParams, {
                              page: undefined,
                              submissionCategory: undefined,
                            })}
                            emptyLabel="All apply types"
                            name="submissionCategory"
                            options={CATEGORY_OPTIONS}
                            selected={filters.submissionCategory}
                            title="Apply type"
                          />

                          <FilterDropdownField
                            clearHref={buildJobsHref(resolvedSearchParams, {
                              page: undefined,
                              careerStage: undefined,
                              experienceLevel: undefined,
                            })}
                            className="sm:col-span-2"
                            columnsClassName="sm:grid-cols-2"
                            emptyLabel="All stages"
                            name="careerStage"
                            options={NORMALIZED_CAREER_STAGE_OPTIONS}
                            selected={filters.careerStage}
                            title="Career stage"
                          />

                          <FilterDropdownField
                            clearHref={buildJobsHref(resolvedSearchParams, {
                              page: undefined,
                              roleCategory: undefined,
                            })}
                            className="sm:col-span-2"
                            columnsClassName="sm:grid-cols-2"
                            emptyLabel="Any role category"
                            name="roleCategory"
                            options={NORMALIZED_ROLE_CATEGORY_OPTIONS}
                            selected={filters.roleCategory}
                            title="Role category"
                          />

                          <FilterDropdownField
                            clearHref={buildJobsHref(resolvedSearchParams, {
                              page: undefined,
                              industry: undefined,
                            })}
                            className="sm:col-span-2"
                            columnsClassName="sm:grid-cols-2"
                            emptyLabel="Any industry"
                            name="industry"
                            options={NORMALIZED_INDUSTRY_OPTIONS}
                            selected={filters.industry}
                            title="Industry"
                          />

                          <FilterDropdownField
                            clearHref={buildJobsHref(resolvedSearchParams, {
                              page: undefined,
                              workMode: undefined,
                            })}
                            columnsClassName="sm:grid-cols-2"
                            emptyLabel="Any work mode"
                            name="workMode"
                            options={WORK_MODE_OPTIONS}
                            selected={filters.workMode}
                            title="Work mode"
                          />

                          <FilterDropdownField
                            clearHref={buildJobsHref(resolvedSearchParams, {
                              page: undefined,
                              employmentType: undefined,
                            })}
                            columnsClassName="sm:grid-cols-2"
                            emptyLabel="Any type"
                            name="employmentType"
                            options={NORMALIZED_EMPLOYMENT_TYPE_OPTIONS}
                            selected={filters.employmentType}
                            title="Employment type"
                          />

                          <FilterDropdownField
                            clearHref={buildJobsHref(resolvedSearchParams, {
                              page: undefined,
                              posted: undefined,
                            })}
                            columnsClassName="sm:grid-cols-2"
                            emptyLabel="Any posted date"
                            name="posted"
                            options={POSTED_OPTIONS}
                            selected={filters.posted}
                            title="Posted"
                          />

                          <SalaryRangeField
                            salaryCurrency={filters.salaryCurrency ?? "USD"}
                            salaryMax={filters.salaryMax}
                            salaryMin={filters.salaryMin}
                          />
                        </div>

                        <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/15 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                          <div>
                            <p className="text-xs font-medium text-foreground">Apply filters</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              Filters keep your search and sort, and reset the page.
                            </p>
                          </div>
                          <Button className="h-8 px-3 text-xs" size="sm" type="submit">
                            Apply filters
                          </Button>
                        </div>
                      </form>
                    </div>
                  </details>

                  <details className="group relative self-start lg:self-auto" name="jobs-toolbar-dropdown">
                    <summary className="inline-flex h-10 list-none items-center gap-2 rounded-xl border border-border/70 bg-background/70 px-4 text-sm font-medium text-foreground transition hover:bg-muted/70 [&::-webkit-details-marker]:hidden">
                      <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                      Sort
                      <span className="text-muted-foreground">{currentSortLabel}</span>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition group-open:rotate-180" />
                    </summary>

                    <div className="absolute right-0 top-[calc(100%+0.75rem)] z-30 w-56 rounded-2xl border border-border/70 bg-background/96 p-2 shadow-[0_24px_60px_rgba(15,23,42,0.14)] backdrop-blur">
                      <div className="space-y-1">
                        {SORT_OPTIONS.map((option) => {
                          const active =
                            (!option.value && (!filters.sortBy || filters.sortBy === "relevance")) ||
                            filters.sortBy === option.value;

                          return (
                            <Link
                              className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm transition ${
                                active
                                  ? "bg-foreground text-background"
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

              {activeFilterChips.length > 0 ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {activeFilterChips.map((chip) => (
                      <Link
                        aria-label={`Remove ${chip.label}`}
                        className="inline-flex h-8 max-w-full items-center gap-2 rounded-full border border-border/70 bg-background/65 pl-3 pr-1.5 text-xs text-muted-foreground transition hover:border-border hover:bg-muted/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        href={chip.href}
                        key={chip.key}
                      >
                        <span className="min-w-0 truncate">{chip.label}</span>
                        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted/80 text-foreground">
                          <X className="h-3.5 w-3.5" />
                        </span>
                      </Link>
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

      <section className="surface-panel p-3 sm:p-4 lg:p-5">
        {jobCards.length === 0 ? (
          <div className="py-16 text-center">
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

function parseJobFilters(
  searchParams: Record<string, string | string[] | undefined>,
  defaultSalaryCurrency: NonNullable<JobFilterParams["salaryCurrency"]>
): JobFilterParams {
  const pageValue = getSearchParam(searchParams, "page");
  const parsedPage = pageValue ? Number.parseInt(pageValue, 10) : undefined;
  const rawSubmissionCategory = getMultiSearchParam(searchParams, "submissionCategory");
  const selectedSearchScope = normalizeSearchScopeParam(getSearchParam(searchParams, "searchScope"));
  const rawSearch = normalizeTextParam(getSearchParam(searchParams, "search"));
  const rawCareerStage =
    getMultiSearchParam(searchParams, "careerStage") ||
    getMultiSearchParam(searchParams, "experienceLevel");
  let search = rawSearch;
  let titleSearch = normalizeTextParam(getSearchParam(searchParams, "titleSearch"));
  let companySearch = normalizeTextParam(getSearchParam(searchParams, "companySearch"));
  let locationSearch = normalizeTextListParam(getMultiSearchParam(searchParams, "locationSearch"));

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
    searchScope: selectedSearchScope,
    titleSearch,
    companySearch,
    locationSearch,
    location: normalizeTextParam(getSearchParam(searchParams, "location")),
    source: normalizeTextParam(getSearchParam(searchParams, "source")),
    region: getMultiSearchParam(searchParams, "region"),
    workMode: getMultiSearchParam(searchParams, "workMode"),
    employmentType: normalizeEmploymentTypeFilterValue(getMultiSearchParam(searchParams, "employmentType")),
    industry: normalizeIndustryFilterValue(getMultiSearchParam(searchParams, "industry")),
    roleCategory: normalizeRoleCategoryFilterValue(getMultiSearchParam(searchParams, "roleCategory")),
    roleFamily: normalizeTextParam(getMultiSearchParam(searchParams, "roleFamily")),
    salaryMin,
    salaryMax,
    salaryCurrency:
      normalizeSalaryCurrency(getSearchParam(searchParams, "salaryCurrency")) ??
      defaultSalaryCurrency,
    careerStage: normalizeCareerStageFilterValue(rawCareerStage),
    expiry: getSearchParam(searchParams, "expiry"),
    posted: getSearchParam(searchParams, "posted"),
    submissionCategory: normalizeSubmissionCategoryFilter(rawSubmissionCategory),
    status: getSearchParam(searchParams, "status"),
    sortBy: normalizeSortByParam(getSearchParam(searchParams, "sortBy")),
    page: parsedPage && parsedPage > 0 ? parsedPage : undefined,
  };
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
  if (value === "title" || value === "company" || value === "location") {
    return value;
  }
  return undefined;
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

function normalizeSubmissionCategoryFilter(value?: string) {
  const categories = splitFilterValues(value).map((entry) =>
    entry === "AUTO_FILL_REVIEW" ? "MANUAL_ONLY" : entry
  );
  const unique = [...new Set(categories)];
  return unique.length > 0 ? unique.join(",") : undefined;
}

function getPositiveNumber(value?: string) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed;
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
  if (Object.prototype.hasOwnProperty.call(overrides, "careerStage") && !overrides.careerStage) {
    params.delete("experienceLevel");
  }

  const legacyCareerStage = params.get("experienceLevel");
  if (legacyCareerStage && !params.has("careerStage")) {
    const normalized = normalizeCareerStageFilterValue(legacyCareerStage);
    if (normalized) params.set("careerStage", normalized);
    params.delete("experienceLevel");
  }
}

function normalizeSearchParamsForHref(params: URLSearchParams) {
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
    "submissionCategory",
    "roleFamily",
    "careerStage",
    "experienceLevel",
    "expiry",
    "posted",
    "status",
  ];

  return keys.filter((key) => {
    const value = filters[key];
    return value !== undefined && value !== "";
  }).length;
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
  add("submissionCategory", filters.submissionCategory);
  add("location", filters.location);
  add("source", filters.source);
  add("roleFamily", filters.roleFamily);
  add("roleCategory", filters.roleCategory);
  add("careerStage", filters.careerStage);
  add("workMode", filters.workMode);
  add("employmentType", filters.employmentType);
  add("region", filters.region);
  add("industry", filters.industry);
  add("salaryMin", filters.salaryMin);
  add("salaryMax", filters.salaryMax);
  if (filters.salaryMin || filters.salaryMax) {
    add("salaryCurrency", filters.salaryCurrency);
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
  add("locationSearch", filters.locationSearch);
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
      className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
        checked
          ? "border-border bg-muted/45 text-foreground"
          : "border-border/60 bg-muted/15 text-foreground hover:bg-muted/35"
      }`}
    >
      <span>Expiring soon</span>
      <input
        className="size-4 shrink-0 rounded border-border/70 bg-background/80 accent-foreground"
        defaultChecked={checked}
        name={name}
        type="checkbox"
        value={value}
      />
    </label>
  );
}

function SalaryRangeField({
  salaryCurrency,
  salaryMax,
  salaryMin,
}: {
  salaryCurrency: NonNullable<JobFilterParams["salaryCurrency"]>;
  salaryMax: number | undefined;
  salaryMin: number | undefined;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/15 p-2.5 sm:col-span-2">
      <FilterFieldLabel>Salary range</FilterFieldLabel>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem]">
        <Input
          className="h-8 rounded-md px-2 text-xs"
          defaultValue={salaryMin ? String(salaryMin) : ""}
          inputMode="numeric"
          min={0}
          name="salaryMin"
          placeholder="Minimum, e.g. 90000"
          type="number"
        />
        <Input
          className="h-8 rounded-md px-2 text-xs"
          defaultValue={salaryMax ? String(salaryMax) : ""}
          inputMode="numeric"
          min={0}
          name="salaryMax"
          placeholder="Maximum, e.g. 160000"
          type="number"
        />
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
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
    </div>
  );
}

function FilterDropdownField({
  className,
  clearHref,
  columnsClassName,
  emptyLabel,
  name,
  options,
  selected,
  title,
}: {
  className?: string;
  clearHref: string;
  columnsClassName?: string;
  emptyLabel: string;
  name: string;
  options: Array<{ label: string; value: string }>;
  selected: string | undefined;
  title: string;
}) {
  const selectedLabels = collectSelectedLabels(selected, options);
  const summary = getFilterSummaryText(selectedLabels, emptyLabel);

  return (
    <details className={`group rounded-lg border border-border/60 bg-muted/15 transition open:border-border/80 open:bg-muted/25 ${className ?? ""}`}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.13em] text-muted-foreground">{title}</p>
          <p className="mt-0.5 truncate text-xs text-foreground">{summary}</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedLabels.length > 0 ? (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full border border-border/70 bg-background/80 px-1.5 text-[11px] font-medium text-foreground">
              {selectedLabels.length}
            </span>
          ) : null}
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-90" />
        </div>
      </summary>

      <div className="border-t border-border/60 px-2 py-2">
        {selectedLabels.length > 0 ? (
          <div className="mb-2 flex justify-end">
            <Link
              className="text-xs font-medium text-muted-foreground transition hover:text-foreground"
              href={clearHref}
            >
              Clear filter
            </Link>
          </div>
        ) : null}
        <div className={`grid gap-1 ${columnsClassName ?? ""}`}>
          {options.map((option) => (
            <FilterDropdownOption
              checked={hasFilterValue(selected, option.value)}
              key={option.label}
              label={option.label}
              name={name}
              value={option.value}
            />
          ))}
        </div>
      </div>
    </details>
  );
}

function FilterDropdownOption({
  checked,
  label,
  name,
  value,
}: {
  checked: boolean;
  label: string;
  name: string;
  value: string;
}) {
  return (
    <label className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground transition hover:bg-background/65">
      <input
        className="size-3.5 shrink-0 rounded border-border/70 bg-background/80 accent-foreground"
        defaultChecked={checked}
        name={name}
        type="checkbox"
        value={value}
      />
      <span className="min-w-0 truncate">{label}</span>
    </label>
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

type ActiveFilterChip = {
  key: string;
  label: string;
  href: string;
};

function buildActiveFilterChips(
  filters: JobFilterParams,
  currentParams: Record<string, string | string[] | undefined>
) {
  const chips: ActiveFilterChip[] = [];
  const add = (key: string, label: string, href: string) => {
    chips.push({ key, label, href });
  };
  const removeParamHref = (param: string) =>
    buildJobsHref(currentParams, { page: undefined, [param]: undefined });

  if (filters.search) {
    add(
      "search",
      `Search: ${filters.search}`,
      buildJobsHref(currentParams, {
        page: undefined,
        search: undefined,
        searchScope: undefined,
      })
    );
  }
  if (filters.titleSearch) {
    add(
      "titleSearch",
      `Title search: ${filters.titleSearch}`,
      buildScopedSearchRemoveHref(currentParams, "titleSearch", "title")
    );
  }
  if (filters.companySearch) {
    add(
      "companySearch",
      `Company search: ${filters.companySearch}`,
      buildScopedSearchRemoveHref(currentParams, "companySearch", "company")
    );
  }
  if (filters.locationSearch) {
    for (const location of splitFilterValues(filters.locationSearch)) {
      add(
        `locationSearch:${location.toLowerCase()}`,
        `Location: ${location}`,
        buildLocationSearchRemoveHref(currentParams, location)
      );
    }
  }

  addSelectedOptionChips(chips, currentParams, "submissionCategory", filters.submissionCategory, CATEGORY_OPTIONS, "Apply type");
  if (filters.location) add("location", `Location filter: ${filters.location}`, removeParamHref("location"));
  if (filters.roleFamily) add("roleFamily", `Legacy role/category: ${filters.roleFamily}`, removeParamHref("roleFamily"));
  if (filters.source) add("source", `Source: ${filters.source}`, removeParamHref("source"));
  addSelectedOptionChips(chips, currentParams, "careerStage", filters.careerStage, NORMALIZED_CAREER_STAGE_OPTIONS, "Career");
  addSelectedOptionChips(chips, currentParams, "roleCategory", filters.roleCategory, NORMALIZED_ROLE_CATEGORY_OPTIONS, "Role");
  addSelectedOptionChips(chips, currentParams, "workMode", filters.workMode, WORK_MODE_OPTIONS, "Work");
  addSelectedOptionChips(chips, currentParams, "employmentType", filters.employmentType, NORMALIZED_EMPLOYMENT_TYPE_OPTIONS, "Type");
  addRawValueChips(chips, currentParams, "region", filters.region, "Region");
  addSelectedOptionChips(chips, currentParams, "industry", filters.industry, NORMALIZED_INDUSTRY_OPTIONS, "Industry");
  addSelectedOptionChips(chips, currentParams, "posted", filters.posted, POSTED_OPTIONS, "Posted");
  addSelectedOptionChips(chips, currentParams, "expiry", filters.expiry, EXPIRY_OPTIONS, "Deadline");
  addSelectedOptionChips(chips, currentParams, "status", filters.status, STATUS_OPTIONS, "Status");

  if (filters.salaryMin) {
    add(
      "salaryMin",
      `Min salary: ${filters.salaryCurrency ?? "USD"} ${Number(filters.salaryMin).toLocaleString()}`,
      removeParamHref("salaryMin")
    );
  }
  if (filters.salaryMax) {
    add(
      "salaryMax",
      `Max salary: ${filters.salaryCurrency ?? "USD"} ${Number(filters.salaryMax).toLocaleString()}`,
      removeParamHref("salaryMax")
    );
  }

  return chips;
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

  if (normalizeSearchScopeParam(getSearchParam(currentParams, "searchScope")) === legacyScope) {
    overrides.search = undefined;
    overrides.searchScope = undefined;
  }

  return buildJobsHref(currentParams, overrides);
}

function addSelectedOptionChips(
  chips: ActiveFilterChip[],
  currentParams: Record<string, string | string[] | undefined>,
  param: string,
  current: string | undefined,
  options: Array<{ label: string; value: string }>,
  prefix: string
) {
  const remaining = new Set(splitFilterValues(current));

  for (const option of options) {
    const optionValues = splitFilterValues(option.value);
    if (optionValues.length === 0 || !optionValues.every((value) => remaining.has(value))) {
      continue;
    }
    chips.push({
      key: `${param}:${option.value}`,
      label: `${prefix}: ${option.label}`,
      href: buildRemoveFilterValueHref(currentParams, param, option.value),
    });
    for (const value of optionValues) {
      remaining.delete(value);
    }
  }

  for (const value of remaining) {
    chips.push({
      key: `${param}:${value}`,
      label: `${prefix}: ${value}`,
      href: buildRemoveFilterValueHref(currentParams, param, value),
    });
  }
}

function addRawValueChips(
  chips: ActiveFilterChip[],
  currentParams: Record<string, string | string[] | undefined>,
  param: string,
  current: string | undefined,
  prefix: string
) {
  for (const value of splitFilterValues(current)) {
    chips.push({
      key: `${param}:${value}`,
      label: `${prefix}: ${value}`,
      href: buildRemoveFilterValueHref(currentParams, param, value),
    });
  }
}

function buildRemoveFilterValueHref(
  currentParams: Record<string, string | string[] | undefined>,
  param: string,
  value: string
) {
  const removeValues = new Set(splitFilterValues(value).map((entry) => entry.toLowerCase()));
  const nextValue = splitFilterValues(getMultiSearchParam(currentParams, param))
    .filter((entry) => !removeValues.has(entry.toLowerCase()))
    .join(",");

  return buildJobsHref(currentParams, {
    page: undefined,
    [param]: nextValue || undefined,
  });
}

function collectSelectedLabels(
  current: string | undefined,
  options: Array<{ label: string; value: string }>
) {
  const remaining = new Set(splitFilterValues(current));
  const labels: string[] = [];

  for (const option of options) {
    const optionValues = splitFilterValues(option.value);
    if (optionValues.length > 0 && optionValues.every((value) => remaining.has(value))) {
      labels.push(option.label);
      for (const value of optionValues) {
        remaining.delete(value);
      }
    }
  }

  return labels.concat([...remaining]);
}

function getFilterSummaryText(selectedLabels: string[], emptyLabel: string) {
  if (selectedLabels.length === 0) return emptyLabel;
  if (selectedLabels.length <= 2) return selectedLabels.join(", ");
  return `${selectedLabels[0]}, ${selectedLabels[1]} +${selectedLabels.length - 2}`;
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
