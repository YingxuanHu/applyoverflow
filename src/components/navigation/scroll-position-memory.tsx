"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { buildJobsReturnAnchorHash } from "@/lib/jobs/return-navigation";

type ScrollPositionMemoryProps = {
  storageKeyPrefix: string;
  includeSearchParams?: boolean;
  restoreSavedPosition?: boolean;
  defaultScrollTop?: "preserve" | "top";
};

const RESTORE_ATTEMPTS = [0, 16, 80, 180, 360, 720, 1200];
const ANCHOR_KEY_SUFFIX = ":anchor";
const ANCHOR_MAX_AGE_MS = 10 * 60 * 1000;
const USER_SCROLL_CANCEL_EVENTS = [
  "wheel",
  "touchstart",
  "pointerdown",
  "keydown",
] as const;

type ScrollAnchorState = {
  anchorId: string;
  anchorOffset: number;
  scrollTop: number;
  savedAt: number;
};

export function ScrollPositionMemory({
  storageKeyPrefix,
  includeSearchParams = true,
  restoreSavedPosition = true,
  defaultScrollTop = "preserve",
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
    const anchor = readScrollAnchor(storageKey) ?? readLocationHashAnchor();
    const shouldRestore =
      Number.isFinite(saved) &&
      saved > 0 &&
      (restoreSavedPosition || Boolean(anchor));
    const timers = new Set<number>();
    let restoreCancelled = false;
    let restoreCompleted = false;

    const clearRestoreTimers = () => {
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
    };

    const cancelPendingRestore = () => {
      if (restoreCompleted) return;
      restoreCancelled = true;
      clearRestoreTimers();
    };

    if (anchor || shouldRestore) {
      const restoreAnchor = anchor;
      for (const [index, delay] of RESTORE_ATTEMPTS.entries()) {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          if (restoreCancelled || restoreCompleted) return;

          const restoredAnchor = restoreAnchor
            ? restoreScrollAnchor(scrollTarget, restoreAnchor)
            : false;
          if (restoredAnchor && restoreAnchor) {
            restoreCompleted = true;
            sessionStorage.removeItem(`${storageKey}${ANCHOR_KEY_SUFFIX}`);
            clearLocationHashAnchor(restoreAnchor.anchorId);
            clearRestoreTimers();
            return;
          }
          if (shouldRestore && restoreSavedScroll(scrollTarget, saved)) {
            restoreCompleted = true;
            clearRestoreTimers();
            return;
          }

          if (index === RESTORE_ATTEMPTS.length - 1) {
            sessionStorage.removeItem(`${storageKey}${ANCHOR_KEY_SUFFIX}`);
            if (restoreAnchor) {
              clearLocationHashAnchor(restoreAnchor.anchorId);
            }
          }
        }, delay);
        timers.add(timer);
      }
    } else if (defaultScrollTop === "top") {
      setScrollTop(scrollTarget, 0);
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
    for (const eventName of USER_SCROLL_CANCEL_EVENTS) {
      window.addEventListener(eventName, cancelPendingRestore, {
        capture: true,
        passive: true,
      });
    }
    window.addEventListener("pagehide", save);
    window.addEventListener("beforeunload", save);

    return () => {
      save();
      clearRestoreTimers();
      scrollTarget.removeEventListener("scroll", onScroll);
      for (const eventName of USER_SCROLL_CANCEL_EVENTS) {
        window.removeEventListener(eventName, cancelPendingRestore, {
          capture: true,
        });
      }
      window.removeEventListener("pagehide", save);
      window.removeEventListener("beforeunload", save);
    };
  }, [defaultScrollTop, restoreSavedPosition, storageKey]);

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
  replaceCurrentHistoryAnchor(parsed, input.anchorId);
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
    style.overflowY === "auto" || style.overflowY === "scroll";

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

function restoreSavedScroll(target: Window | HTMLElement, value: number) {
  if (!canReachScrollTop(target, value)) return false;

  setScrollTop(target, value);
  return Math.abs(getScrollTop(target) - value) <= 8;
}

function canReachScrollTop(target: Window | HTMLElement, value: number) {
  return getMaxScrollTop(target) + 8 >= value;
}

function getMaxScrollTop(target: Window | HTMLElement) {
  if (!isWindowScrollTarget(target)) {
    return Math.max(0, target.scrollHeight - target.clientHeight);
  }

  const scrollingElement = document.scrollingElement ?? document.documentElement;
  return Math.max(0, scrollingElement.scrollHeight - window.innerHeight);
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

function readLocationHashAnchor(): ScrollAnchorState | null {
  const anchorId = parseJobsReturnAnchorHash(window.location.hash);
  if (!anchorId) return null;

  return {
    anchorId,
    anchorOffset: 24,
    scrollTop: 0,
    savedAt: Date.now(),
  };
}

function parseJobsReturnAnchorHash(hash: string) {
  if (!hash.startsWith("#job-")) return null;
  const anchorId = hash.slice("#job-".length);
  return anchorId ? anchorId : null;
}

function restoreScrollAnchor(target: Window | HTMLElement, anchor: ScrollAnchorState) {
  const offset = getAnchorOffset(target, anchor.anchorId);
  if (offset == null) return false;

  const currentTop = getScrollTop(target);
  const targetTop = Math.max(0, Math.round(currentTop + offset - anchor.anchorOffset));
  setScrollTop(target, targetTop);
  return true;
}

function clearLocationHashAnchor(anchorId: string) {
  if (parseJobsReturnAnchorHash(window.location.hash) !== anchorId) return;

  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`
  );
}

function getAnchorOffset(target: Window | HTMLElement, anchorId: string) {
  const element = findJobCardAnchor(anchorId);
  if (!element) return null;

  const elementTop = element.getBoundingClientRect().top;
  if (isWindowScrollTarget(target)) return elementTop;

  return elementTop - target.getBoundingClientRect().top;
}

function findJobCardAnchor(anchorId: string) {
  const idMatch = document.getElementById(
    buildJobsReturnAnchorHash(anchorId).slice(1)
  );
  if (idMatch instanceof HTMLElement) return idMatch;

  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-job-card-id]")
  ).find((element) => element.dataset.jobCardId === anchorId) ?? null;
}

function replaceCurrentHistoryAnchor(parsed: URL, anchorId: string) {
  if (
    parsed.pathname !== window.location.pathname ||
    parsed.search !== window.location.search
  ) {
    return;
  }

  const hash = buildJobsReturnAnchorHash(anchorId);
  if (!hash) return;

  window.history.replaceState(
    window.history.state,
    "",
    `${parsed.pathname}${parsed.search}${hash}`
  );
}
