"use client";

import { useState } from "react";
import { ChevronDown, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { JobSearchScope } from "@/lib/queries/jobs";

type HiddenField = {
  name: string;
  value: string;
};

type SearchValues = Record<JobSearchScope, string>;

const SEARCH_SCOPE_OPTIONS: Array<{ label: string; value: JobSearchScope }> = [
  { label: "All", value: "all" },
  { label: "Title", value: "title" },
  { label: "Company", value: "company" },
  { label: "Location", value: "location" },
];

const SEARCH_PARAM_BY_SCOPE: Record<JobSearchScope, string> = {
  all: "search",
  title: "titleSearch",
  company: "companySearch",
  location: "locationSearch",
};

const PLACEHOLDER_BY_SCOPE: Record<JobSearchScope, string> = {
  all: "Search jobs, companies, or keywords",
  title: "Search job titles",
  company: "Search companies",
  location: "Search locations",
};

function normalizeSearchList(value: string) {
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

  return values.join(",");
}

export function JobsSearchForm({
  hiddenFields,
  initialScope,
  initialValues,
}: {
  hiddenFields: HiddenField[];
  initialScope: JobSearchScope;
  initialValues: SearchValues;
}) {
  const [scope, setScope] = useState<JobSearchScope>(initialScope);
  const [values, setValues] = useState<SearchValues>({
    ...initialValues,
    location: "",
  });
  const inputName = SEARCH_PARAM_BY_SCOPE[scope];
  const existingLocationSearch = initialValues.location.trim();
  const pendingLocationSearch = normalizeSearchList(
    [existingLocationSearch, values.location.trim()].filter(Boolean).join(",")
  );

  return (
    <form className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center" method="get">
      {hiddenFields.map((field) => (
        <input key={`${field.name}:${field.value}`} name={field.name} type="hidden" value={field.value} />
      ))}
      <input name="searchScope" type="hidden" value={scope} />
      {SEARCH_SCOPE_OPTIONS.filter(
        (option) => scope !== "all" && option.value !== "all" && option.value !== scope
      ).map((option) => {
        const value =
          option.value === "location"
            ? pendingLocationSearch
            : values[option.value].trim();
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
      {scope === "location" && pendingLocationSearch ? (
        <input name="locationSearch" type="hidden" value={pendingLocationSearch} />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-input/80 bg-background/70 transition focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 sm:flex-row">
        <label className="sr-only" htmlFor="jobs-search-scope">
          Search within
        </label>
        <div className="relative border-b border-border/60 sm:w-40 sm:border-b-0 sm:border-r">
          <select
            className="h-10 w-full appearance-none bg-transparent py-2 pl-3 pr-8 text-sm font-medium text-foreground outline-none"
            id="jobs-search-scope"
            onChange={(event) => setScope(event.target.value as JobSearchScope)}
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
            className="h-10 rounded-none border-0 bg-transparent pl-9 pr-3 text-sm focus-visible:border-transparent focus-visible:ring-0"
            name={scope === "location" ? undefined : inputName}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                [scope]: event.target.value,
              }))
            }
            placeholder={PLACEHOLDER_BY_SCOPE[scope]}
            value={values[scope]}
          />
        </div>
      </div>

      <Button className="h-10 w-full px-4 sm:w-auto" size="sm" type="submit">
        Search
      </Button>
    </form>
  );
}
