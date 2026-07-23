"use client";

import type { MouseEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { JobsLoadingPopup } from "@/components/jobs/jobs-loading-popup";

const NAVIGATION_PENDING_TIMEOUT_MS = 15_000;
const FEED_PATHS = new Set(["/jobs", "/jobs/top-picks"]);
const JOBS_LOADING_START_EVENT = "autoapplication:jobs-loading-start";

type JobsNavigationPendingBoundaryProps = {
  children: ReactNode;
  description?: string;
  label?: string;
};

type PendingNavigation = {
  href: string;
  originHref: string;
};

export function JobsNavigationPendingBoundary({
  children,
  description,
  label,
}: JobsNavigationPendingBoundaryProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentUrl = useMemo(
    () => `${pathname}${searchParams.size > 0 ? `?${searchParams}` : ""}`,
    [pathname, searchParams]
  );
  const currentUrlRef = useRef(currentUrl);
  const [pendingNavigation, setPendingNavigation] =
    useState<PendingNavigation | null>(null);
  const pending = pendingNavigation?.originHref === currentUrl;
  const isTopPicksNavigation = pendingNavigation?.href.startsWith("/jobs/top-picks");
  const loadingLabel = label ?? (isTopPicksNavigation ? "Loading picks" : "Loading jobs");
  const loadingDescription =
    description ??
    (isTopPicksNavigation
      ? "Updating your ranked picks with the selected filters."
      : "Updating the job list with your latest search and filters.");

  useEffect(() => {
    const handleLoadingStart = (event: Event) => {
      const href = (event as CustomEvent<{ href?: string }>).detail?.href;
      if (!href) return;
      const nextHref = getPendingNavigationHref(href, currentUrlRef.current);
      if (nextHref) {
        setPendingNavigation({ href: nextHref, originHref: currentUrlRef.current });
      }
    };

    window.addEventListener(JOBS_LOADING_START_EVENT, handleLoadingStart);
    return () => window.removeEventListener(JOBS_LOADING_START_EVENT, handleLoadingStart);
  }, []);

  useEffect(() => {
    currentUrlRef.current = currentUrl;
  }, [currentUrl]);

  useEffect(() => {
    if (!pendingNavigation) return;
    const timeout = window.setTimeout(
      () => setPendingNavigation(null),
      NAVIGATION_PENDING_TIMEOUT_MS
    );
    return () => window.clearTimeout(timeout);
  }, [pendingNavigation]);

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
          setPendingNavigation({ href: nextHref, originHref: currentUrlRef.current });
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
          setPendingNavigation({ href: nextHref, originHref: currentUrlRef.current });
        }
      }}
    >
      {children}
      {pending ? (
        <JobsLoadingPopup
          description={loadingDescription}
          label={loadingLabel}
        />
      ) : null}
    </div>
  );
}

export function showJobsLoadingPopup(href: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(JOBS_LOADING_START_EVENT, { detail: { href } })
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
