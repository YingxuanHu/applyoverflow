"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { normalizeJobsStateQuery } from "@/lib/jobs/search-state";

type SearchParamMemoryProps = {
  basePath: string;
  cookieName?: string;
  normalizer?: "jobs";
  persistEndpoint?: string;
  stateParamKeys?: readonly string[];
  storageKey: string;
};

export function SearchParamMemory({
  basePath,
  cookieName,
  normalizer,
  persistEndpoint,
  stateParamKeys,
  storageKey,
}: SearchParamMemoryProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  useEffect(() => {
    if (pathname !== basePath) return;

    const reset = searchParams.get("reset");
    if (reset === "1") {
      sessionStorage.removeItem(storageKey);
      if (cookieName) expireCookie(cookieName);
      if (persistEndpoint) {
        void fetch(persistEndpoint, { method: "DELETE" }).catch(() => undefined);
      }
      router.replace(basePath);
      return;
    }

    const stateSearch = normalizeStateSearch(
      getStateSearch(searchParams, stateParamKeys),
      normalizer
    );
    if (stateSearch) {
      sessionStorage.setItem(storageKey, stateSearch);
      if (cookieName) setMemoryCookie(cookieName, stateSearch);
      if (persistEndpoint) {
        void fetch(persistEndpoint, {
          body: JSON.stringify({ query: stateSearch }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }).catch(() => undefined);
      }
      return;
    }

    const saved = normalizeStateSearch(sessionStorage.getItem(storageKey) ?? "", normalizer);
    if (saved) {
      router.replace(`${basePath}?${saved}`);
    }
  }, [
    basePath,
    cookieName,
    normalizer,
    pathname,
    persistEndpoint,
    router,
    search,
    searchParams,
    stateParamKeys,
    storageKey,
  ]);

  return null;
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
    return normalizeJobsStateQuery(search);
  }
  return search;
}

function setMemoryCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=2592000; Path=/; SameSite=Lax`;
}

function expireCookie(name: string) {
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
}
