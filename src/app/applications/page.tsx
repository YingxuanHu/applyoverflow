import { redirect } from "next/navigation";

import { type ApplicationReminderGroup } from "@/components/applications/application-reminders-summary";
import { ApplicationsPageClient } from "@/components/applications/applications-page-client";
import { ScrollPositionMemory } from "@/components/navigation/scroll-position-memory";
import { SearchParamMemory } from "@/components/navigation/search-param-memory";
import type { TrackedApplicationStatus } from "@/generated/prisma/client";
import { getOptionalSessionUser } from "@/lib/current-user";
import { normalizeTextParam } from "@/lib/filter-values";
import {
  getTrackedApplicationFlowApplications,
  getTrackedDashboardData,
  type TrackerSearchScope,
  type TrackerSortFilter,
} from "@/lib/queries/tracker";

type ApplicationsSearchParams = {
  status?: string;
  sort?: string;
  tags?: string;
  search?: string;
  searchScope?: string;
  titleSearch?: string;
  companySearch?: string;
  locationSearch?: string;
  tagSearch?: string;
  reminderSearch?: string;
};

function parseStatusFilter(rawValue?: string): TrackedApplicationStatus | "ALL" {
  const value = String(rawValue ?? "ALL").toUpperCase();
  if (
    value === "ALL" ||
    value === "WISHLIST" ||
    value === "APPLIED" ||
    value === "SCREEN" ||
    value === "INTERVIEW" ||
    value === "OFFER" ||
    value === "ACCEPTED" ||
    value === "REJECTED" ||
    value === "DECLINED" ||
    value === "WITHDRAWN"
  ) {
    return value;
  }
  return "ALL";
}

function parseSortFilter(rawValue?: string): TrackerSortFilter {
  const value = String(rawValue ?? "UPDATED_DESC").toUpperCase();
  if (
    value === "UPDATED_ASC" ||
    value === "DEADLINE_ASC" ||
    value === "DEADLINE_DESC" ||
    value === "COMPANY_ASC" ||
    value === "COMPANY_DESC"
  ) {
    return value;
  }
  return "UPDATED_DESC";
}

const APPLICATION_SEARCH_PARAM_KEYS = [
  "search",
  "titleSearch",
  "companySearch",
  "locationSearch",
  "tagSearch",
  "reminderSearch",
] as const;
const APPLICATION_STATE_PARAM_KEYS = [
  "status",
  "sort",
  "tags",
  "searchScope",
  ...APPLICATION_SEARCH_PARAM_KEYS,
] as const;

function parseSearchScope(rawValue?: string): TrackerSearchScope {
  if (
    rawValue === "title" ||
    rawValue === "company" ||
    rawValue === "location" ||
    rawValue === "tag" ||
    rawValue === "reminder"
  ) {
    return rawValue;
  }
  return "all";
}

function hasApplicationSearchParams(params: URLSearchParams) {
  return APPLICATION_SEARCH_PARAM_KEYS.some((key) =>
    Boolean(params.get(key)?.trim())
  );
}

function buildApplicationsHref(
  currentParams: ApplicationsSearchParams,
  overrides: Record<string, string | undefined>
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(currentParams)) {
    if (
      key === "reset" ||
      key === "deadline" ||
      value === undefined ||
      value === ""
    ) continue;
    if (key === "searchScope" && parseSearchScope(value) === "all") continue;
    params.set(key, value);
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }

  if (!hasApplicationSearchParams(params)) {
    params.delete("searchScope");
  }

  const query = params.toString();
  return query ? `/applications?${query}` : "/applications";
}

function buildSearchFormInitialValues(input: {
  search?: string;
  titleSearch?: string;
  companySearch?: string;
  locationSearch?: string;
  tagSearch?: string;
  reminderSearch?: string;
}): Record<TrackerSearchScope, string> {
  return {
    all: input.search ?? "",
    title: input.titleSearch ?? "",
    company: input.companySearch ?? "",
    location: input.locationSearch ?? "",
    tag: input.tagSearch ?? "",
    reminder: input.reminderSearch ?? "",
  };
}

type ActiveApplicationChip = {
  key: string;
  label: string;
  href: string;
};

function buildActiveApplicationSearchChips(
  currentParams: ApplicationsSearchParams,
  input: {
    search?: string;
    titleSearch?: string;
    companySearch?: string;
    locationSearch?: string;
    tagSearch?: string;
    reminderSearch?: string;
  }
) {
  const chips: ActiveApplicationChip[] = [];
  const add = (
    key: keyof typeof input,
    label: string,
    legacyScope?: Exclude<TrackerSearchScope, "all">
  ) => {
    const overrides: Record<string, string | undefined> = { [key]: undefined };
    if (legacyScope && parseSearchScope(currentParams.searchScope) === legacyScope) {
      overrides.search = undefined;
      overrides.searchScope = undefined;
    }
    chips.push({
      key,
      label,
      href: buildApplicationsHref(currentParams, overrides),
    });
  };

  if (input.search) add("search", `Search: ${input.search}`);
  if (input.titleSearch) {
    add("titleSearch", `Title search: ${input.titleSearch}`, "title");
  }
  if (input.companySearch) {
    add("companySearch", `Company search: ${input.companySearch}`, "company");
  }
  if (input.locationSearch) {
    add("locationSearch", `Location search: ${input.locationSearch}`, "location");
  }
  if (input.tagSearch) add("tagSearch", `Tag search: ${input.tagSearch}`, "tag");
  if (input.reminderSearch) {
    add("reminderSearch", `Reminder search: ${input.reminderSearch}`, "reminder");
  }
  return chips;
}

function toggleTag(selectedTags: string[], tag: string) {
  return selectedTags.includes(tag)
    ? selectedTags.filter((value) => value !== tag)
    : [...selectedTags, tag].sort((left, right) => left.localeCompare(right));
}

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<ApplicationsSearchParams>;
}) {
  const sessionUser = await getOptionalSessionUser();
  if (!sessionUser) {
    redirect("/sign-in");
  }

  const params = await searchParams;
  const status = parseStatusFilter(params.status);
  const sort = parseSortFilter(params.sort);
  const selectedSearchScope = parseSearchScope(params.searchScope);
  const rawSearch = normalizeTextParam(params.search);
  let search = rawSearch;
  let titleSearch = normalizeTextParam(params.titleSearch);
  let companySearch = normalizeTextParam(params.companySearch);
  let locationSearch = normalizeTextParam(params.locationSearch);
  let tagSearch = normalizeTextParam(params.tagSearch);
  let reminderSearch = normalizeTextParam(params.reminderSearch);

  if (rawSearch && selectedSearchScope === "title") {
    titleSearch = titleSearch ?? rawSearch;
    search = undefined;
  } else if (rawSearch && selectedSearchScope === "company") {
    companySearch = companySearch ?? rawSearch;
    search = undefined;
  } else if (rawSearch && selectedSearchScope === "location") {
    locationSearch = locationSearch ?? rawSearch;
    search = undefined;
  } else if (rawSearch && selectedSearchScope === "tag") {
    tagSearch = tagSearch ?? rawSearch;
    search = undefined;
  } else if (rawSearch && selectedSearchScope === "reminder") {
    reminderSearch = reminderSearch ?? rawSearch;
    search = undefined;
  }

  const selectedTags = String(params.tags ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  // The list data honors the active search/status/sort/tag filters; the flow
  // dataset is fetched independently so the funnel always summarizes the full
  // history (the chart's own time-range control narrows it).
  const [data, flowApplications] = await Promise.all([
    getTrackedDashboardData({
      status: status as Parameters<typeof getTrackedDashboardData>[0]["status"],
      sort,
      tags: selectedTags,
      search,
      searchScope: selectedSearchScope,
      titleSearch,
      companySearch,
      locationSearch,
      tagSearch,
      reminderSearch,
    }),
    getTrackedApplicationFlowApplications(),
  ]);
  const hasActiveFilters =
    status !== "ALL" ||
    sort !== "UPDATED_DESC" ||
    Boolean(search) ||
    Boolean(titleSearch) ||
    Boolean(companySearch) ||
    Boolean(locationSearch) ||
    Boolean(tagSearch) ||
    Boolean(reminderSearch) ||
    selectedTags.length > 0;
  const searchValues = {
    search,
    titleSearch,
    companySearch,
    locationSearch,
    tagSearch,
    reminderSearch,
  };
  const activeSearchChips = buildActiveApplicationSearchChips(params, searchValues);
  const userTagFilters = data.userTags.map((tag) => ({
    id: tag.id,
    name: tag.name,
    active: selectedTags.includes(tag.name),
    href: buildApplicationsHref(params, {
      tags: toggleTag(selectedTags, tag.name).join(",") || undefined,
    }),
  }));
  const now = data.loadedAt.getTime();
  const reminderGroups: ApplicationReminderGroup[] = data.applications
    .map((application) => {
      const reminders = application.events
        .filter(
          (event) =>
            !event.reminderNotifiedAt ||
            !event.reminderAt ||
            event.reminderAt.getTime() >= now
        )
        .sort((left, right) => {
          const leftTime = left.reminderAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
          const rightTime = right.reminderAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
          if (leftTime !== rightTime) return leftTime - rightTime;
          return right.timestamp.getTime() - left.timestamp.getTime();
        });

      return {
        applicationId: application.id,
        canonicalJobId: application.canonicalJobId,
        company: application.company,
        roleTitle: application.roleTitle,
        reminders,
      };
    })
    .filter((group) => group.reminders.length > 0);
  const clientStateKey = JSON.stringify({
    companySearch,
    locationSearch,
    reminderSearch,
    search,
    selectedTags,
    sort,
    status,
    tagSearch,
    titleSearch,
  });

  return (
    <div className="app-page space-y-6">
      <SearchParamMemory
        basePath="/applications"
        stateParamKeys={APPLICATION_STATE_PARAM_KEYS}
        storageKey="autoapplication.applications.filters"
      />
      <ScrollPositionMemory storageKeyPrefix="autoapplication.applications.scroll" />
      <div className="page-header">
        <div>
          <h1 className="page-title">Applications</h1>
          <p className="page-description">
            Track feed submissions and manual applications in one workflow.
          </p>
        </div>
      </div>

      <ApplicationsPageClient
        applications={data.applications}
        flowApplications={flowApplications}
        filters={{
          activeSearchChips,
          hasActiveFilters,
          searchValues: buildSearchFormInitialValues(searchValues),
          selectedSearchScope,
          selectedTags,
          sort,
          status,
          userTagFilters,
        }}
        key={clientStateKey}
        reminderGroups={reminderGroups}
        stateKey={clientStateKey}
        totalApplicationCount={data.totalApplicationCount}
      />
    </div>
  );
}
