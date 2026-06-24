"use client";

import type { MouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { LoadingSpinner } from "@/components/ui/loading-spinner";

const NAVIGATION_PENDING_TIMEOUT_MS = 15_000;
const FEED_PATHS = new Set(["/jobs", "/jobs/top-picks"]);

type JobsNavigationPendingBoundaryProps = {
  children: ReactNode;
  description?: string;
  label?: string;
};

export function JobsNavigationPendingBoundary({
  children,
  description = "Updating the job list with your latest search and filters.",
  label = "Loading jobs",
}: JobsNavigationPendingBoundaryProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentUrl = useMemo(
    () => `${pathname}${searchParams.size > 0 ? `?${searchParams}` : ""}`,
    [pathname, searchParams]
  );
  const currentUrlRef = useRef(currentUrl);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const pending = pendingHref !== null && pendingHref !== currentUrl;

  useEffect(() => {
    currentUrlRef.current = currentUrl;
  }, [currentUrl]);

  useEffect(() => {
    if (!pending) return;
    const timeout = window.setTimeout(
      () => setPendingHref(null),
      NAVIGATION_PENDING_TIMEOUT_MS
    );
    return () => window.clearTimeout(timeout);
  }, [pending]);

  return (
    <div
      className="relative"
      onClickCapture={(event) => {
        if (event.defaultPrevented || hasModifierKey(event)) return;
        const link = (event.target as Element | null)?.closest("a[href]");
        if (!(link instanceof HTMLAnchorElement)) return;
        if (link.target || link.download) return;
        const nextHref = getPendingNavigationHref(link.href, currentUrlRef.current);
        if (nextHref) {
          link.closest("details")?.removeAttribute("open");
          setPendingHref(nextHref);
        }
      }}
      onSubmitCapture={(event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        const method = (form.method || "get").toLowerCase();
        const href = method === "get" ? buildGetFormHref(form) : null;
        const nextHref = href ? getPendingNavigationHref(href, currentUrlRef.current) : null;
        if (nextHref) {
          form.closest("details")?.removeAttribute("open");
          setPendingHref(nextHref);
        }
      }}
    >
      {children}
      {pending ? (
        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-0 z-30 flex min-h-[16rem] items-center justify-center bg-background/35 px-4 backdrop-blur-[1px]"
          role="status"
        >
          <div className="flex max-w-[22rem] items-center gap-3 rounded-2xl border border-border/70 bg-popover/95 px-4 py-3 text-left shadow-[0_18px_48px_rgba(0,0,0,0.22)]">
            <LoadingSpinner className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function hasModifierKey(event: MouseEvent) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function buildGetFormHref(form: HTMLFormElement) {
  try {
    const target = new URL(form.action || window.location.href, window.location.href);
    target.search = "";
    const params = new URLSearchParams();
    const data = new FormData(form);
    for (const [key, value] of data.entries()) {
      if (typeof value !== "string" || value === "") continue;
      params.append(key, value);
    }
    target.search = params.toString();
    return `${target.pathname}${target.search ? `?${target.search}` : ""}`;
  } catch {
    return null;
  }
}

function getPendingNavigationHref(rawHref: string, currentUrl: string) {
  if (typeof window === "undefined") return null;

  try {
    const next = new URL(rawHref, window.location.href);
    if (next.origin !== window.location.origin) return null;
    if (!FEED_PATHS.has(next.pathname)) return null;
    const nextHref = `${next.pathname}${next.search}`;
    return nextHref !== currentUrl ? nextHref : null;
  } catch {
    return null;
  }
}
