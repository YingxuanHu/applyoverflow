"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type ScrollPositionMemoryProps = {
  storageKeyPrefix: string;
  includeSearchParams?: boolean;
};

const RESTORE_ATTEMPTS = [0, 16, 80, 180, 360];

export function ScrollPositionMemory({
  storageKeyPrefix,
  includeSearchParams = true,
}: ScrollPositionMemoryProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const storageKey = includeSearchParams && search
    ? `${storageKeyPrefix}:${pathname}?${search}`
    : `${storageKeyPrefix}:${pathname}`;

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.history.scrollRestoration = "manual";
    const scrollTarget = getScrollTarget();
    const saved = Number(sessionStorage.getItem(storageKey) ?? "");
    const shouldRestore = Number.isFinite(saved) && saved > 0;
    const timers: number[] = [];

    if (shouldRestore) {
      for (const delay of RESTORE_ATTEMPTS) {
        timers.push(window.setTimeout(() => setScrollTop(scrollTarget, saved), delay));
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
