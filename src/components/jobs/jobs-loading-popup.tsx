"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

type JobsLoadingPopupProps = {
  description?: string;
  label?: string;
};

export function JobsLoadingPopup({
  description = "Updating the job list with your latest search and filters.",
  label = "Loading jobs",
}: JobsLoadingPopupProps) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 250);
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;

  // Portal keeps centering independent of the sidebar and transformed route shells.
  return createPortal(
    <div
      aria-live="polite"
      aria-busy="true"
      className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4 sm:top-6"
      role="status"
    >
      <div className="flex max-w-full items-center justify-center gap-2 rounded-lg border border-border/70 bg-popover px-3 py-2 text-sm font-medium text-popover-foreground shadow-sm">
        <LoadingSpinner className="h-4 w-4 shrink-0 text-primary" />
        <span className="truncate">{label}</span>
        <span className="sr-only">{description}</span>
      </div>
    </div>, document.body
  );
}
