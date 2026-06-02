"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";

import { ApplicationFlowSection } from "@/components/applications/application-flow-section";
import { type FlowSelection } from "@/components/applications/application-flow-chart";
import { ApplicationListCard } from "@/components/applications/application-list-card";
import {
  ApplicationRemindersSummary,
  type ApplicationReminderGroup,
} from "@/components/applications/application-reminders-summary";
import { ApplicationsOverviewBar } from "@/components/applications/applications-overview-bar";
import { ApplicationsSearchField } from "@/components/applications/applications-search-field";
import { Button } from "@/components/ui/button";
import type { TrackedApplicationStatus } from "@/generated/prisma/client";
import {
  buildApplicationFlowData,
  type ApplicationFlowRange,
  type FlowApplication,
} from "@/lib/application-flow";
import type { TrackerSearchScope, TrackerSortFilter } from "@/lib/queries/tracker";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

type ApplicationListItem = ComponentProps<typeof ApplicationListCard>["application"];

type SearchValues = Record<TrackerSearchScope, string>;

type ActiveApplicationChip = {
  key: string;
  label: string;
  href: string;
};

type UserTagFilter = {
  id: string;
  name: string;
  active: boolean;
  href: string;
};

type ApplicationsPageClientProps = {
  applications: ApplicationListItem[];
  flowApplications: FlowApplication[];
  reminderGroups: ApplicationReminderGroup[];
  totalApplicationCount: number;
  filters: {
    status: TrackedApplicationStatus | "ALL";
    sort: TrackerSortFilter;
    selectedSearchScope: TrackerSearchScope;
    selectedTags: string[];
    hasActiveFilters: boolean;
    searchValues: SearchValues;
    activeSearchChips: ActiveApplicationChip[];
    userTagFilters: UserTagFilter[];
  };
};

const APPLICATIONS_PAGE_SIZE = 50;

type SelectedFlow = {
  selection: FlowSelection;
  label: string;
  applicationIds: string[];
};

export function ApplicationsPageClient({
  applications,
  flowApplications,
  reminderGroups,
  totalApplicationCount,
  filters,
}: ApplicationsPageClientProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [showFlow, setShowFlow] = useState(false);
  const [flowRange, setFlowRange] = useState<ApplicationFlowRange>("all");
  const [selectedFlow, setSelectedFlow] = useState<SelectedFlow | null>(null);
  // Captured once so the chart's relative time-range windows stay stable across
  // re-renders (only recomputed when the range or dataset changes).
  const [nowMs] = useState(() => Date.now());

  const flowData = useMemo(
    () => buildApplicationFlowData(flowApplications, { range: flowRange, now: nowMs }),
    [flowApplications, flowRange, nowMs]
  );

  // Final visible list = server-filtered applications ∩ selected flow ids.
  const displayedApplications = useMemo(() => {
    if (!selectedFlow) return applications;
    const ids = new Set(selectedFlow.applicationIds);
    return applications.filter((application) => ids.has(application.id));
  }, [applications, selectedFlow]);

  const totalMatchingApplications = displayedApplications.length;
  const pageCount = Math.max(1, Math.ceil(totalMatchingApplications / APPLICATIONS_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, pageCount);
  const paginatedApplications = useMemo(() => {
    const start = (safeCurrentPage - 1) * APPLICATIONS_PAGE_SIZE;
    return displayedApplications.slice(start, start + APPLICATIONS_PAGE_SIZE);
  }, [displayedApplications, safeCurrentPage]);

  function handleFlowRangeChange(range: ApplicationFlowRange) {
    setFlowRange(range);
    setSelectedFlow(null);
    setCurrentPage(1);
  }

  function handleFlowSelect(selection: FlowSelection) {
    setSelectedFlow((previous) => {
      if (
        previous &&
        previous.selection.type === selection.type &&
        previous.selection.id === selection.id
      ) {
        return null;
      }
      if (selection.type === "node") {
        const node = flowData.nodes.find((item) => item.id === selection.id);
        if (!node) return previous;
        return { selection, label: node.label, applicationIds: node.applicationIds };
      }
      const link = flowData.links.find((item) => item.id === selection.id);
      if (!link) return previous;
      return { selection, label: link.pathLabel, applicationIds: link.applicationIds };
    });
    setCurrentPage(1);
  }

  function clearFlowFilter() {
    setSelectedFlow(null);
    setCurrentPage(1);
  }

  return (
    <>
      <ApplicationsOverviewBar />

      <ApplicationRemindersSummary groups={reminderGroups} />

      <section className="surface-panel p-3.5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Your applications</h2>
            <p className="mt-1 hidden text-sm text-muted-foreground sm:block">
              Jobs submitted from the feed appear here automatically.
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
            <CountStat count={totalMatchingApplications} label="shown" />
            <CountStat count={totalApplicationCount} label="total" />
            <Button
              type="button"
              size="sm"
              variant={showFlow ? "secondary" : "outline"}
              aria-expanded={showFlow}
              aria-controls="application-flow-panel"
              onClick={() => setShowFlow((value) => !value)}
              className="h-8 rounded-full px-2.5 text-xs"
            >
              <ChevronDown className={cn("size-4 transition-transform", showFlow && "rotate-180")} />
              <span>{showFlow ? "Hide flow" : "View flow"}</span>
            </Button>
          </div>
        </div>

        {showFlow ? (
          <ApplicationFlowSection
            id="application-flow-panel"
            data={flowData}
            range={flowRange}
            onRangeChange={handleFlowRangeChange}
            selected={selectedFlow?.selection ?? null}
            onSelect={handleFlowSelect}
          />
        ) : null}

        {selectedFlow ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-primary/30 bg-primary/10 py-1 pl-3 pr-1.5 text-xs text-foreground">
              <span className="shrink-0 text-muted-foreground">Filtered by:</span>
              <span className="min-w-0 truncate font-medium">{selectedFlow.label}</span>
              <button
                type="button"
                onClick={clearFlowFilter}
                aria-label="Clear flow filter"
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-foreground transition hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        ) : null}

        <form
          method="GET"
          className="toolbar-panel mt-3 grid min-w-0 items-end gap-2 sm:mt-4 sm:grid-cols-2 sm:gap-3 lg:grid-cols-[minmax(18rem,1fr)_9rem_12rem_auto] xl:grid-cols-[minmax(24rem,1fr)_9rem_12.5rem_auto]"
        >
          <ApplicationsSearchField
            initialScope={filters.selectedSearchScope}
            initialValues={filters.searchValues}
          />

          <label className="grid gap-1.5 text-sm">
            <span className="control-label hidden sm:block">Status</span>
            <div className="relative min-w-0">
              <select
                name="status"
                defaultValue={filters.status}
                className="h-10 w-full min-w-0 appearance-none rounded-[14px] border border-input bg-card py-0 pl-3.5 pr-12 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
              >
                <option value="ALL">All statuses</option>
                <option value="WISHLIST">Wishlist</option>
                <option value="APPLIED">Applied</option>
                <option value="SCREEN">Screen</option>
                <option value="INTERVIEW">Interview</option>
                <option value="OFFER">Offer</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="REJECTED">Rejected</option>
                <option value="DECLINED">Declined</option>
                <option value="WITHDRAWN">Closed</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="control-label hidden sm:block">Sort</span>
            <div className="relative min-w-0">
              <select
                name="sort"
                defaultValue={filters.sort}
                className="h-10 w-full min-w-0 appearance-none rounded-[14px] border border-input bg-card py-0 pl-3.5 pr-12 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
              >
                <option value="UPDATED_DESC">Updated (newest)</option>
                <option value="UPDATED_ASC">Updated (oldest)</option>
                <option value="DEADLINE_ASC">Deadline (earliest)</option>
                <option value="DEADLINE_DESC">Deadline (latest)</option>
                <option value="COMPANY_ASC">Company (A-Z)</option>
                <option value="COMPANY_DESC">Company (Z-A)</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </label>

          <div className="grid grid-cols-2 items-end gap-2 sm:col-span-2 lg:col-span-1 lg:flex lg:justify-end lg:gap-3 lg:pl-1">
            {filters.selectedTags.length > 0 ? (
              <input type="hidden" name="tags" value={filters.selectedTags.join(",")} />
            ) : null}
            <Button
              className={`h-10 min-w-0 px-4 lg:min-w-24 ${
                filters.hasActiveFilters ? "" : "col-span-2 lg:col-span-1"
              }`}
              type="submit"
            >
              Apply
            </Button>
            {filters.hasActiveFilters ? (
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

        {filters.activeSearchChips.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {filters.activeSearchChips.map((chip) => (
              <Link
                aria-label={`Remove ${chip.label}`}
                className="group inline-flex h-8 max-w-full items-center gap-2 rounded-full border border-border/70 bg-card pl-3 pr-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                href={chip.href}
                key={chip.key}
              >
                <span className="min-w-0 truncate">{chip.label}</span>
                <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition group-hover:bg-foreground group-hover:text-background">
                  <X className="h-3.5 w-3.5" />
                </span>
              </Link>
            ))}
          </div>
        ) : null}

        {filters.userTagFilters.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {filters.userTagFilters.map((tag) => (
              <Link
                key={tag.id}
                href={tag.href}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  tag.active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/70 bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {tag.name}
              </Link>
            ))}
          </div>
        ) : null}

        <div className="mt-4">
          {paginatedApplications.length === 0 ? (
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
              {paginatedApplications.map((application) => (
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

        {totalMatchingApplications > APPLICATIONS_PAGE_SIZE ? (
          <PaginationControls
            currentPage={safeCurrentPage}
            onPageChange={setCurrentPage}
            pageCount={pageCount}
          />
        ) : null}
      </section>
    </>
  );
}

function CountStat({
  count,
  label,
}: {
  count: number;
  label: string;
}) {
  return (
    <p className="inline-flex min-w-0 items-baseline gap-1 rounded-full bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground sm:bg-transparent sm:px-0">
      <span className="text-sm font-semibold leading-none text-foreground">
        {count}
      </span>
      <span>{label}</span>
    </p>
  );
}

function getPaginationItems(currentPage: number, pageCount: number) {
  const pages = new Set<number>([1, pageCount, currentPage]);
  for (let page = currentPage - 1; page <= currentPage + 1; page += 1) {
    if (page >= 1 && page <= pageCount) pages.add(page);
  }
  const sortedPages = [...pages].sort((left, right) => left - right);
  const items: Array<number | "gap"> = [];
  for (const page of sortedPages) {
    const previous = items[items.length - 1];
    if (typeof previous === "number" && page - previous > 1) {
      items.push("gap");
    }
    items.push(page);
  }
  return items;
}

function PaginationControls({
  currentPage,
  pageCount,
  onPageChange,
}: {
  currentPage: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  const items = getPaginationItems(currentPage, pageCount);

  return (
    <nav
      aria-label="Applications pagination"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4"
    >
      <p className="text-xs text-muted-foreground">
        Page {currentPage} of {pageCount}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          className="h-8 rounded-full px-2.5 text-xs"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          size="sm"
          type="button"
          variant="outline"
        >
          <ChevronLeft className="size-3.5" />
          Previous
        </Button>
        {items.map((item, index) => {
          if (item === "gap") {
            return (
              <span
                className="px-1 text-xs text-muted-foreground"
                key={`gap-${index}`}
              >
                ...
              </span>
            );
          }

          return (
            <span className="flex items-center gap-1.5" key={item}>
              <button
                aria-current={item === currentPage ? "page" : undefined}
                className={`h-8 min-w-8 rounded-full px-2 text-xs font-medium transition-colors ${
                  item === currentPage
                    ? "bg-primary text-primary-foreground"
                    : "border border-border/70 bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
                onClick={() => onPageChange(item)}
                type="button"
              >
                {item}
              </button>
            </span>
          );
        })}
        <Button
          className="h-8 rounded-full px-2.5 text-xs"
          disabled={currentPage >= pageCount}
          onClick={() => onPageChange(Math.min(pageCount, currentPage + 1))}
          size="sm"
          type="button"
          variant="outline"
        >
          Next
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </nav>
  );
}
