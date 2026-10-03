"use client";

import { createContext, useContext, useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { PaginationControls } from "@/components/navigation/pagination-controls";
import { buildJobsSearchHref } from "@/lib/jobs/search-navigation";
import { PAGE_SIZE } from "@/lib/constants";

type CountState = { total: number | null; loading: boolean; retry: () => void };
const CountContext = createContext<CountState>({ total: null, loading: false, retry: () => {} });

export function JobsSearchCountProvider({ children, initialTotal, pending, query, page, pageSize }: {
  children: ReactNode;
  initialTotal: number | null;
  pending: boolean;
  query: string;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const [resolvedTotal, setTotal] = useState<number | null>(null);
  const total = initialTotal ?? resolvedTotal;
  const [loading, setLoading] = useState(pending);
  const [attempt, setAttempt] = useState(0);
  const params = new URLSearchParams(query);
  params.delete("page");
  params.delete("sortBy");
  params.delete("debugFilters");
  params.sort();
  const countQuery = params.toString();
  const needsCount = pending && total === null;

  useEffect(() => {
    if (!needsCount) return;
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 30_000);
    void fetch(`/api/jobs/count?${countQuery}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Matching total unavailable");
        const result = await response.json();
        if (!Number.isSafeInteger(result.total) || result.total < 0) throw new Error("Invalid matching total");
        if (active) setTotal(result.total);
      })
      .catch(() => { /* The list remains usable when optional count metadata fails. */ })
      .finally(() => {
        clearTimeout(timeout);
        if (active) setLoading(false);
      });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [needsCount, countQuery, attempt]);

  useEffect(() => {
    if (total === null) return;
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    if (page > lastPage) router.replace(buildJobsSearchHref(query, { page: lastPage > 1 ? String(lastPage) : undefined }), { scroll: false });
  }, [total, page, pageSize, query, router]);

  return <CountContext.Provider value={{ total, loading, retry: () => { setLoading(true); setAttempt((value) => value + 1); } }}>{children}</CountContext.Provider>;
}

export function JobsSearchCountHeadline({ scoped, liveJobCount }: { scoped: boolean; liveJobCount: number }) {
  const { total, loading, retry } = useContext(CountContext);
  const count = scoped ? total : liveJobCount;
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1" aria-live="polite" aria-atomic="true">
      {scoped ? <h2 className="text-base font-semibold text-foreground">Search results</h2> : null}
      <span className="inline-block whitespace-nowrap text-sm text-muted-foreground">
        {count === null ? (loading ? null : "Count unavailable") : <>
          <strong className="text-2xl font-semibold tabular-nums leading-tight text-foreground">{count.toLocaleString()}</strong>{" "}
          <span>{scoped ? (count === 1 ? "match" : "matches") : (count === 1 ? "live job" : "live jobs")}</span>
        </>}
      </span>
      {scoped && total === null && !loading ? (
            <button type="button" aria-label="Retry matching total" title="Retry matching total" onClick={retry} className="inline-flex size-6 items-center justify-center rounded hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
              <RefreshCw aria-hidden="true" className="size-3.5" />
            </button>
      ) : null}
    </div>
  );
}

export function JobsSearchPagination(props: Omit<ComponentProps<typeof PaginationControls>, "getPageHref" | "totalPages">) {
  const { total } = useContext(CountContext);
  return <PaginationControls {...props} totalPages={total === null ? null : Math.max(1, Math.ceil(total / PAGE_SIZE))} getPageHref={(page) => buildJobsSearchHref(props.searchParams, { page: page > 1 ? String(page) : undefined })} />;
}
