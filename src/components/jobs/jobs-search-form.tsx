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

type VisibleJobSearchScope = Exclude<JobSearchScope, "all">;
type SearchValues = Record<JobSearchScope, string>;

const SEARCH_SCOPE_OPTIONS: Array<{ label: string; value: VisibleJobSearchScope }> = [
  { label: "Title", value: "title" },
  { label: "Company", value: "company" },
  { label: "Location", value: "location" },
];

const SEARCH_PARAM_BY_SCOPE: Record<VisibleJobSearchScope, string> = {
  title: "titleSearch",
  company: "companySearch",
  location: "locationSearch",
};

const PLACEHOLDER_BY_SCOPE: Record<VisibleJobSearchScope, string> = {
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
  const initialVisibleScope = initialScope === "all" ? "title" : initialScope;
  const [scope, setScope] = useState<VisibleJobSearchScope>(initialVisibleScope);
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
        (option) => option.value !== scope
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

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-input bg-card transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25 sm:flex-row">
        <label className="sr-only" htmlFor="jobs-search-scope">
          Search within
        </label>
        <div className="relative border-b border-border/60 sm:w-32 sm:border-b-0 sm:border-r">
          <select
            className="h-10 w-full appearance-none bg-transparent pl-4 pr-8 text-left text-sm font-medium leading-10 text-foreground outline-none"
            id="jobs-search-scope"
            onChange={(event) => setScope(event.target.value as VisibleJobSearchScope)}
            style={{ textAlignLast: "left" }}
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

      <Button className="h-10 w-full px-5 sm:w-auto" type="submit">
        Search
      </Button>
    </form>
  );
}
