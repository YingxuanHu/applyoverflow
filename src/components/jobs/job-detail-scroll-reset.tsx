"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function JobDetailScrollReset({ jobId }: { jobId: string }) {
  const pathname = usePathname();

  useEffect(() => {
    const scrollRoot = document.querySelector<HTMLElement>(".app-scroll-root");
    const scrollToTop = () => {
      if (scrollRoot) {
        scrollRoot.scrollTo({ top: 0, left: 0, behavior: "auto" });
        return;
      }
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    };

    scrollToTop();
    const frame = window.requestAnimationFrame(scrollToTop);
    const timeout = window.setTimeout(scrollToTop, 80);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [jobId, pathname]);

  return null;
}
