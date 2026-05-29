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
  all: "Title, company, location, tag",
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
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Search
      </span>
      <input name="searchScope" type="hidden" value={scope} />
      {SEARCH_SCOPE_OPTIONS.filter((option) => option.value !== scope).map((option) => {
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

      <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-input/80 bg-background/70 transition focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 sm:flex-row">
        <label className="sr-only" htmlFor="applications-search-scope">
          Search within
        </label>
        <div className="relative border-b border-border/60 sm:w-36 sm:border-b-0 sm:border-r">
          <select
            className="h-9 w-full appearance-none bg-transparent py-2 pl-3 pr-8 text-sm font-medium text-foreground outline-none"
            id="applications-search-scope"
            onChange={(event) => setScope(event.target.value as VisibleTrackerSearchScope)}
            value={scope}
          >
            {SEARCH_SCOPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        </div>

        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 rounded-none border-0 bg-transparent pl-9 pr-3 text-sm focus-visible:border-transparent focus-visible:ring-0"
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
