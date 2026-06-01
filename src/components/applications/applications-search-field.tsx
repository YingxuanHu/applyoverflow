"use client";

import { useState } from "react";
import { ChevronDown, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import type { TrackerSearchScope } from "@/lib/queries/tracker";

type VisibleTrackerSearchScope = Exclude<TrackerSearchScope, "reminder">;
type SearchValues = Record<TrackerSearchScope, string>;

const SEARCH_SCOPE_OPTIONS: Array<{ label: string; value: VisibleTrackerSearchScope }> = [
  { label: "All", value: "all" },
  { label: "Title", value: "title" },
  { label: "Company", value: "company" },
  { label: "Location", value: "location" },
  { label: "Tag", value: "tag" },
];

const SEARCH_PARAM_BY_SCOPE: Record<VisibleTrackerSearchScope, string> = {
  all: "search",
  title: "titleSearch",
  company: "companySearch",
  location: "locationSearch",
  tag: "tagSearch",
};

const PLACEHOLDER_BY_SCOPE: Record<VisibleTrackerSearchScope, string> = {
  all: "Search applications",
  title: "Search application titles",
  company: "Search companies",
  location: "Search locations",
  tag: "Search tags",
};

export function ApplicationsSearchField({
  initialScope,
  initialValues,
}: {
  initialScope: TrackerSearchScope;
  initialValues: SearchValues;
}) {
  const initialVisibleScope = initialScope === "reminder" ? "all" : initialScope;
  const [scope, setScope] = useState<VisibleTrackerSearchScope>(initialVisibleScope);
  const [values, setValues] = useState<SearchValues>(initialValues);
  const inputName = SEARCH_PARAM_BY_SCOPE[scope];

  return (
    <div className="grid min-w-0 gap-1.5 text-sm">
      <span className="control-label hidden sm:block">
        Search
      </span>
      <input name="searchScope" type="hidden" value={scope} />
      {SEARCH_SCOPE_OPTIONS.filter((option) => option.value !== scope && option.value !== "all").map((option) => {
        const value = values[option.value].trim();
        if (!value) return null;
        return (
          <input
            key={option.value}
            name={SEARCH_PARAM_BY_SCOPE[option.value]}
            type="hidden"
            value={value}
          />
        );
      })}

      <div className="flex min-w-0 overflow-hidden rounded-[14px] border border-input bg-card transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
        <label className="sr-only" htmlFor="applications-search-scope">
          Search within
        </label>
        <div className="relative w-[5.85rem] shrink-0 border-r border-border/60 sm:w-28">
          <select
            className="h-10 w-full appearance-none bg-transparent pl-3 pr-7 text-left text-sm font-medium leading-10 text-foreground outline-none sm:pl-4 sm:pr-8"
            id="applications-search-scope"
            onChange={(event) => setScope(event.target.value as VisibleTrackerSearchScope)}
            style={{ textAlignLast: "left" }}
            value={scope}
          >
            {SEARCH_SCOPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground sm:right-2.5" />
        </div>

        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-10 rounded-none border-0 bg-transparent pl-9 pr-3 text-sm focus-visible:border-transparent focus-visible:ring-0"
            name={inputName}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                [scope]: event.target.value,
              }))
            }
            placeholder={PLACEHOLDER_BY_SCOPE[scope]}
            type="search"
            value={values[scope]}
          />
        </div>
      </div>
    </div>
  );
}
