"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  hasJobsStateParams,
  normalizeJobsStateQuery,
} from "@/lib/jobs/search-state";

type SearchParamMemoryProps = {
  basePath: string;
  normalizer?: "jobs";
  persistence?: "memory" | "local";
  stateParamKeys?: readonly string[];
  storageKey: string;
};

const inAppSearchParamMemory = new Map<string, string>();
export const SEARCH_PARAM_MEMORY_UPDATED_EVENT = "autoapplication:search-param-memory-updated";

export function SearchParamMemory({
  basePath,
  normalizer,
  persistence = "memory",
  stateParamKeys,
  storageKey,
}: SearchParamMemoryProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const mountedRef = useRef(false);

  useEffect(() => {
    if (pathname !== basePath) return;

    const firstRunForRouteInstance = !mountedRef.current;
    mountedRef.current = true;

    const reset = searchParams.get("reset");
    if (reset === "1") {
      clearInAppSearchParamMemory(storageKey);
      router.replace(basePath);
      return;
    }

    const stateSearch = normalizeStateSearch(
      getStateSearch(searchParams, stateParamKeys),
      normalizer
    );
    if (stateSearch) {
      saveSearchParamMemory(storageKey, stateSearch, persistence);
      return;
    }

    // A direct keyword URL should win over a remembered structured filter set.
    // We only restore saved jobs filters when the route has no jobs state at all.
    if (normalizer === "jobs" && hasJobsStateParams(searchParams)) return;

    if (!firstRunForRouteInstance) {
      clearInAppSearchParamMemory(storageKey);
      return;
    }

    const saved = normalizeStateSearch(
      loadSearchParamMemory(storageKey, persistence),
      normalizer
    );
    if (saved) {
      router.replace(`${basePath}?${saved}`);
    }
  }, [
    basePath,
    normalizer,
    pathname,
    persistence,
    router,
    search,
    searchParams,
    stateParamKeys,
    storageKey,
  ]);

  return null;
}

export function clearInAppSearchParamMemory(storageKey?: string) {
  if (storageKey) {
    inAppSearchParamMemory.delete(storageKey);
    clearPersistedSearchParamMemory(storageKey);
    return;
  }

  inAppSearchParamMemory.clear();
}

function saveSearchParamMemory(
  storageKey: string,
  value: string,
  persistence: NonNullable<SearchParamMemoryProps["persistence"]>
) {
  inAppSearchParamMemory.set(storageKey, value);
  if (persistence !== "local" || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(storageKey, value);
    notifySearchParamMemoryUpdated(storageKey);
  } catch {
    // The in-memory copy still restores state while this tab stays open.
  }
}

function loadSearchParamMemory(
  storageKey: string,
  persistence: NonNullable<SearchParamMemoryProps["persistence"]>
) {
  const inMemory = inAppSearchParamMemory.get(storageKey);
  if (inMemory) return inMemory;
  if (persistence !== "local" || typeof window === "undefined") return "";

  try {
    return window.localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

function clearPersistedSearchParamMemory(storageKey: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey);
    notifySearchParamMemoryUpdated(storageKey);
  } catch {
    // Storage can be unavailable in restrictive browser contexts.
  }
}

function notifySearchParamMemoryUpdated(storageKey: string) {
  window.dispatchEvent(
    new CustomEvent(SEARCH_PARAM_MEMORY_UPDATED_EVENT, { detail: { storageKey } })
  );
}

function getStateSearch(
  searchParams: ReturnType<typeof useSearchParams>,
  stateParamKeys?: readonly string[]
) {
  const search = searchParams.toString();
  if (!search) return "";
  const params = new URLSearchParams(search);
  params.delete("reset");
  if (stateParamKeys?.length) {
    const stateParams = new URLSearchParams();
    for (const key of stateParamKeys) {
      const value = params.get(key);
      if (value !== null && value.trim() !== "") stateParams.set(key, value);
    }
    return stateParams.toString();
  }
  return params.toString();
}

function normalizeStateSearch(search: string, normalizer?: SearchParamMemoryProps["normalizer"]) {
  if (!search) return "";
  if (normalizer === "jobs") {
    return normalizeJobsStateQuery(search, { includePage: false });
  }
  return search;
}
