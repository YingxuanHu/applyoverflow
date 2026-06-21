"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type ScrollPositionMemoryProps = {
  storageKeyPrefix: string;
  includeSearchParams?: boolean;
};

const RESTORE_ATTEMPTS = [0, 16, 80, 180, 360, 720, 1200];
const ANCHOR_KEY_SUFFIX = ":anchor";
const ANCHOR_MAX_AGE_MS = 10 * 60 * 1000;

type ScrollAnchorState = {
  anchorId: string;
  anchorOffset: number;
  scrollTop: number;
  savedAt: number;
};

export function ScrollPositionMemory({
  storageKeyPrefix,
  includeSearchParams = true,
}: ScrollPositionMemoryProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const storageKey = buildScrollMemoryStorageKey({
    storageKeyPrefix,
    pathname,
    search,
    includeSearchParams,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.history.scrollRestoration = "manual";
    const scrollTarget = getScrollTarget();
    const saved = Number(sessionStorage.getItem(storageKey) ?? "");
    const anchor = readScrollAnchor(storageKey);
    const shouldRestore = Number.isFinite(saved) && saved > 0;
    const timers: number[] = [];
    let anchorRestored = false;

    if (anchor || shouldRestore) {
      for (const delay of RESTORE_ATTEMPTS) {
        timers.push(
          window.setTimeout(() => {
            if (anchor && !anchorRestored && restoreScrollAnchor(scrollTarget, anchor)) {
              anchorRestored = true;
              sessionStorage.removeItem(`${storageKey}${ANCHOR_KEY_SUFFIX}`);
              return;
            }
            if (shouldRestore) setScrollTop(scrollTarget, saved);
          }, delay)
        );
      }
    }

    let ticking = false;
    const save = () => {
      sessionStorage.setItem(storageKey, String(Math.max(0, Math.round(getScrollTop(scrollTarget)))));
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        save();
      });
    };

    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    window.addEventListener("beforeunload", save);

    return () => {
      save();
      for (const timer of timers) window.clearTimeout(timer);
      scrollTarget.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("beforeunload", save);
    };
  }, [storageKey]);

  return null;
}

export function rememberScrollAnchorForHref(input: {
  storageKeyPrefix: string;
  href?: string | null;
  anchorId: string;
  includeSearchParams?: boolean;
}) {
  if (typeof window === "undefined" || !input.href || !input.anchorId) return;

  const parsed = parseRelativeHref(input.href);
  if (!parsed) return;

  const storageKey = buildScrollMemoryStorageKey({
    storageKeyPrefix: input.storageKeyPrefix,
    pathname: parsed.pathname,
    search: parsed.search,
    includeSearchParams: input.includeSearchParams ?? true,
  });
  const scrollTarget = getScrollTarget();
  const scrollTop = Math.max(0, Math.round(getScrollTop(scrollTarget)));
  const anchorOffset = Math.round(getAnchorOffset(scrollTarget, input.anchorId) ?? 0);
  const state: ScrollAnchorState = {
    anchorId: input.anchorId,
    anchorOffset,
    scrollTop,
    savedAt: Date.now(),
  };

  sessionStorage.setItem(storageKey, String(scrollTop));
  sessionStorage.setItem(`${storageKey}${ANCHOR_KEY_SUFFIX}`, JSON.stringify(state));
}

export function buildScrollMemoryStorageKey(input: {
  storageKeyPrefix: string;
  pathname: string;
  search?: string | null;
  includeSearchParams?: boolean;
}) {
  const search = input.search?.replace(/^\?/, "") ?? "";
  return input.includeSearchParams !== false && search
    ? `${input.storageKeyPrefix}:${input.pathname}?${search}`
    : `${input.storageKeyPrefix}:${input.pathname}`;
}

function getScrollTarget(): Window | HTMLElement {
  const appScrollRoot = document.querySelector<HTMLElement>(".app-scroll-root");
  if (!appScrollRoot) return window;

  const style = window.getComputedStyle(appScrollRoot);
  const canScroll =
    (style.overflowY === "auto" || style.overflowY === "scroll") &&
    appScrollRoot.scrollHeight > appScrollRoot.clientHeight + 1;

  return canScroll ? appScrollRoot : window;
}

function getScrollTop(target: Window | HTMLElement) {
  return isWindowScrollTarget(target) ? window.scrollY : target.scrollTop;
}

function setScrollTop(target: Window | HTMLElement, value: number) {
  if (isWindowScrollTarget(target)) {
    window.scrollTo({ top: value, left: 0, behavior: "auto" });
    return;
  }
  target.scrollTo({ top: value, left: 0, behavior: "auto" });
}

function isWindowScrollTarget(target: Window | HTMLElement): target is Window {
  return target === window;
}

function parseRelativeHref(href: string) {
  try {
    const parsed = new URL(href, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readScrollAnchor(storageKey: string): ScrollAnchorState | null {
  try {
    const raw = sessionStorage.getItem(`${storageKey}${ANCHOR_KEY_SUFFIX}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ScrollAnchorState>;
    if (
      typeof parsed.anchorId !== "string" ||
      typeof parsed.anchorOffset !== "number" ||
      typeof parsed.scrollTop !== "number" ||
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > ANCHOR_MAX_AGE_MS
    ) {
      sessionStorage.removeItem(`${storageKey}${ANCHOR_KEY_SUFFIX}`);
      return null;
    }

    return {
      anchorId: parsed.anchorId,
      anchorOffset: parsed.anchorOffset,
      scrollTop: parsed.scrollTop,
      savedAt: parsed.savedAt,
    };
  } catch {
    sessionStorage.removeItem(`${storageKey}${ANCHOR_KEY_SUFFIX}`);
    return null;
  }
}

function restoreScrollAnchor(target: Window | HTMLElement, anchor: ScrollAnchorState) {
  const offset = getAnchorOffset(target, anchor.anchorId);
  if (offset == null) return false;

  const currentTop = getScrollTop(target);
  const targetTop = Math.max(0, Math.round(currentTop + offset - anchor.anchorOffset));
  setScrollTop(target, targetTop);
  return true;
}

function getAnchorOffset(target: Window | HTMLElement, anchorId: string) {
  const element = findJobCardAnchor(anchorId);
  if (!element) return null;

  const elementTop = element.getBoundingClientRect().top;
  if (isWindowScrollTarget(target)) return elementTop;

  return elementTop - target.getBoundingClientRect().top;
}

function findJobCardAnchor(anchorId: string) {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-job-card-id]")
  ).find((element) => element.dataset.jobCardId === anchorId) ?? null;
}
