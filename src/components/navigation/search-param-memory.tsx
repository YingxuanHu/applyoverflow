"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { normalizeJobsStateQuery } from "@/lib/jobs/search-state";

type SearchParamMemoryProps = {
  basePath: string;
  normalizer?: "jobs";
  stateParamKeys?: readonly string[];
  storageKey: string;
};

const inAppSearchParamMemory = new Map<string, string>();

export function SearchParamMemory({
  basePath,
  normalizer,
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
      inAppSearchParamMemory.set(storageKey, stateSearch);
      return;
    }

    if (!firstRunForRouteInstance) {
      clearInAppSearchParamMemory(storageKey);
      return;
    }

    const saved = normalizeStateSearch(inAppSearchParamMemory.get(storageKey) ?? "", normalizer);
    if (saved) {
      router.replace(`${basePath}?${saved}`);
    }
  }, [
    basePath,
    normalizer,
    pathname,
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
    return;
  }

  inAppSearchParamMemory.clear();
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
    const hasState = stateParamKeys.some((key) => {
      const value = params.get(key);
      return value !== null && value.trim() !== "";
    });
    if (!hasState) return "";
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
