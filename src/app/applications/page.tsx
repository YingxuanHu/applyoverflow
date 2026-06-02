import Link from "next/link";
import { redirect } from "next/navigation";
import { X } from "lucide-react";

import { ApplicationListCard } from "@/components/applications/application-list-card";
import {
  ApplicationRemindersSummary,
  type ApplicationReminderGroup,
} from "@/components/applications/application-reminders-summary";
import { ApplicationsSearchField } from "@/components/applications/applications-search-field";
import { ApplicationsOverviewBar } from "@/components/applications/applications-overview-bar";
import { SearchParamMemory } from "@/components/navigation/search-param-memory";
import { Button } from "@/components/ui/button";
import { getOptionalSessionUser } from "@/lib/current-user";
import {
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

function parseStatusFilter(rawValue?: string) {
  const value = String(rawValue ?? "ALL").toUpperCase();
  if (
    value === "ALL" ||
    value === "WISHLIST" ||
    value === "PREPARING" ||
    value === "APPLIED" ||
    value === "SCREEN" ||
    value === "INTERVIEW" ||
    value === "OFFER" ||
    value === "REJECTED" ||
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

function normalizeTextParam(value?: string) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

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

  const data = await getTrackedDashboardData({
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
  });
  const expiredCount = data.applications.filter(
    (application) => application.canonicalJob?.status === "EXPIRED"
  ).length;
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

  return (
    <div className="app-page space-y-6">
      <SearchParamMemory
        basePath="/applications"
        stateParamKeys={APPLICATION_STATE_PARAM_KEYS}
        storageKey="autoapplication.applications.filters"
      />
      <div className="page-header">
        <div>
          <h1 className="page-title">Applications</h1>
          <p className="page-description">
            Track feed submissions and manual applications in one workflow.
          </p>
        </div>
      </div>

      <ApplicationsOverviewBar
        shownCount={data.applications.length}
        totalCount={data.totalApplicationCount}
        activeCount={data.activeCount}
        expiredCount={expiredCount}
      />

      <ApplicationRemindersSummary groups={reminderGroups} />

      <section className="surface-panel p-3.5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Your applications</h2>
            <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
              Jobs submitted from the feed appear here automatically.
            </p>
          </div>
        </div>

        <form
          method="GET"
          className="toolbar-panel mt-3 grid min-w-0 items-end gap-2 sm:mt-4 sm:grid-cols-2 sm:gap-3 lg:grid-cols-[minmax(18rem,1fr)_9rem_12rem_auto] xl:grid-cols-[minmax(24rem,1fr)_9rem_12.5rem_auto]"
        >
          <ApplicationsSearchField
            initialScope={selectedSearchScope}
            initialValues={buildSearchFormInitialValues(searchValues)}
          />

          <label className="grid gap-1.5 text-sm">
            <span className="control-label hidden sm:block">
              Status
            </span>
            <select
              name="status"
              defaultValue={status}
              className="h-10 rounded-[14px] border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
            >
              <option value="ALL">All statuses</option>
              <option value="WISHLIST">Wishlist</option>
              <option value="PREPARING">Preparing</option>
              <option value="APPLIED">Applied</option>
              <option value="SCREEN">Screen</option>
              <option value="INTERVIEW">Interview</option>
              <option value="OFFER">Offer</option>
              <option value="REJECTED">Rejected</option>
              <option value="WITHDRAWN">Withdrawn</option>
            </select>
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="control-label hidden sm:block">
              Sort
            </span>
            <select
              name="sort"
              defaultValue={sort}
              className="h-10 rounded-[14px] border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
            >
              <option value="UPDATED_DESC">Updated (newest)</option>
              <option value="UPDATED_ASC">Updated (oldest)</option>
              <option value="DEADLINE_ASC">Deadline (earliest)</option>
              <option value="DEADLINE_DESC">Deadline (latest)</option>
              <option value="COMPANY_ASC">Company (A-Z)</option>
              <option value="COMPANY_DESC">Company (Z-A)</option>
            </select>
          </label>

          <div className="grid grid-cols-2 items-end gap-2 sm:col-span-2 lg:col-span-1 lg:flex lg:justify-end lg:gap-3 lg:pl-1">
            {selectedTags.length > 0 ? (
              <input type="hidden" name="tags" value={selectedTags.join(",")} />
            ) : null}
            <Button
              className={`h-10 min-w-0 px-4 lg:min-w-24 ${hasActiveFilters ? "" : "col-span-2 lg:col-span-1"}`}
              type="submit"
            >
              Apply
            </Button>
            {hasActiveFilters ? (
              <Button
                className="h-10 min-w-0 px-4 lg:min-w-20"
                render={<Link href="/applications?reset=1" />}
                variant="outline"
              >
                Clear
              </Button>
            ) : null}
          </div>
        </form>

        {activeSearchChips.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {activeSearchChips.map((chip) => (
              <Link
                aria-label={`Remove ${chip.label}`}
                className="inline-flex h-8 max-w-full items-center gap-2 rounded-full border border-border/70 bg-card pl-3 pr-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                href={chip.href}
                key={chip.key}
              >
                <span className="min-w-0 truncate">{chip.label}</span>
                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                  <X className="h-3.5 w-3.5" />
                </span>
              </Link>
            ))}
          </div>
        ) : null}

        {data.userTags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {data.userTags.map((tag) => {
              const active = selectedTags.includes(tag.name);
              return (
                <Link
                  key={tag.id}
                  href={buildApplicationsHref(params, {
                    tags: toggleTag(selectedTags, tag.name).join(",") || undefined,
                  })}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border/70 bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {tag.name}
                </Link>
              );
            })}
          </div>
        ) : null}

        <div className="mt-4">
          {data.applications.length === 0 ? (
            <div className="empty-state">
              <p className="text-sm font-medium text-foreground">
                No applications in this view
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a manual entry or use the jobs feed to start building your tracker.
              </p>
            </div>
          ) : (
            <ul className="object-list mt-4">
              {data.applications.map((application) => (
                <li
                  key={application.id}
                  className="object-row"
                  id={`application-${application.id}`}
                >
                  <ApplicationListCard application={application} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
