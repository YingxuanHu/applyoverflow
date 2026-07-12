"use client";

import { useState } from "react";
import { ChevronDown, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeFilterValueList } from "@/lib/filter-values";
import type { JobSearchScope } from "@/lib/queries/jobs";

type HiddenField = {
  name: string;
  value: string;
};

type SearchValues = Record<JobSearchScope, string>;
type VisibleJobSearchScope = Exclude<JobSearchScope, "all">;

const DEFAULT_SEARCH_SCOPE: VisibleJobSearchScope = "title";

const SEARCH_SCOPE_OPTIONS: Array<{ label: string; value: VisibleJobSearchScope }> = [
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

const SEARCH_FIELD_PARAM_NAMES = new Set([
  "field",
  "q",
  "search",
  "searchScope",
  "titleSearch",
  "companySearch",
  "locationSearch",
]);

const PLACEHOLDER_BY_SCOPE: Record<JobSearchScope, string> = {
  all: "Search jobs",
  title: "Search job titles by keyword",
  company: "Search companies by keyword",
  location: "Search locations by keyword",
};

function normalizeSearchList(value: string) {
  return normalizeFilterValueList(value) ?? "";
}

function normalizeSubmittedSearchValue(scope: VisibleJobSearchScope, value: string) {
  const normalizedValue = value.trim();
  return scope === "location" ? normalizeSearchList(normalizedValue) : normalizedValue;
}

function getSubmittedValue(scope: VisibleJobSearchScope, values: SearchValues) {
  return normalizeSubmittedSearchValue(scope, values[scope]);
}

export function JobsSearchForm({
  filterFormId,
  hiddenFields,
  initialScope,
  initialValues,
}: {
  filterFormId?: string;
  hiddenFields: HiddenField[];
  initialScope: JobSearchScope;
  initialValues: SearchValues;
}) {
  const initialVisibleScope =
    initialScope === "all" ? DEFAULT_SEARCH_SCOPE : initialScope;
  const normalizedInitialValues = {
    all: "",
    title:
      initialValues.title ||
      (initialScope === "all" ? initialValues.all : ""),
    company: initialValues.company,
    location: initialValues.location,
  };
  const [scope, setScope] = useState<VisibleJobSearchScope>(initialVisibleScope);
  const [committedValues] = useState<SearchValues>(() => normalizedInitialValues);
  const [draftValue, setDraftValue] = useState(() => normalizedInitialValues[initialVisibleScope]);
  const submittedSearchValue = normalizeSubmittedSearchValue(scope, draftValue);

  function handleScopeChange(nextScope: VisibleJobSearchScope) {
    setScope(nextScope);
    setDraftValue((currentDraft) =>
      currentDraft.trim() ? currentDraft : committedValues[nextScope]
    );
  }

  const submittedHiddenFields = buildSubmittedSearchHiddenFields(
    scope,
    submittedSearchValue,
    committedValues
  );

  return (
    <form
      action="/jobs"
      className="flex min-w-0 flex-1 items-center gap-2"
      method="get"
    >
      {hiddenFields
        .filter((field) => !SEARCH_FIELD_PARAM_NAMES.has(field.name))
        .map((field) => (
          <input
            key={`${field.name}:${field.value}`}
            name={field.name}
            type="hidden"
            value={field.value}
          />
        ))}
      {submittedHiddenFields.map((field) => (
        <input
          key={`${field.name}:${field.value}`}
          name={field.name}
          type="hidden"
          value={field.value}
        />
      ))}
      {filterFormId
        ? submittedHiddenFields.map((field) => (
            <input
              form={filterFormId}
              key={`filter:${field.name}:${field.value}`}
              name={field.name}
              type="hidden"
              value={field.value}
            />
          ))
        : null}

      <div className="flex min-w-0 flex-1 overflow-hidden rounded-[14px] border border-input bg-card transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
        <label className="sr-only" htmlFor="jobs-search-scope">
          Search within
        </label>
        <div className="relative w-[5.85rem] shrink-0 border-r border-border/60 sm:w-32">
          <select
            className="h-10 w-full appearance-none bg-transparent pl-3 pr-7 text-left text-sm font-medium leading-10 text-foreground outline-none sm:pl-4 sm:pr-8"
            id="jobs-search-scope"
            onChange={(event) => handleScopeChange(event.target.value as VisibleJobSearchScope)}
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
            aria-label={PLACEHOLDER_BY_SCOPE[scope]}
            className="h-10 rounded-none border-0 bg-transparent pl-9 pr-2 text-sm focus-visible:border-transparent focus-visible:ring-0 sm:pr-3"
            onChange={(event) => setDraftValue(event.target.value)}
            placeholder={PLACEHOLDER_BY_SCOPE[scope]}
            value={draftValue}
          />
        </div>
      </div>

      <Button className="h-10 w-11 rounded-[14px] px-0 sm:w-auto sm:px-5" type="submit">
        <Search className="h-4 w-4 sm:hidden" />
        <span className="sr-only sm:not-sr-only">Search</span>
      </Button>
    </form>
  );
}

function buildSubmittedSearchHiddenFields(
  scope: VisibleJobSearchScope,
  submittedSearchValue: string,
  committedValues: SearchValues
): HiddenField[] {
  const fields: HiddenField[] = [];

  if (submittedSearchValue) {
    fields.push({ name: "searchScope", value: scope });
    fields.push({ name: SEARCH_PARAM_BY_SCOPE[scope], value: submittedSearchValue });
  }

  for (const option of SEARCH_SCOPE_OPTIONS) {
    if (option.value === scope) continue;
    const value = getSubmittedValue(option.value, committedValues);
    if (!value) continue;
    fields.push({ name: SEARCH_PARAM_BY_SCOPE[option.value], value });
  }

  return fields;
}
