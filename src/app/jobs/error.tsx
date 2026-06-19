"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function JobsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  const isTopPicks = pathname.startsWith("/jobs/top-picks");

  useEffect(() => {
    console.error(isTopPicks ? "Top picks error:" : "Jobs feed error:", error);
  }, [error, isTopPicks]);

  const title = isTopPicks ? "Failed to load top picks" : "Failed to load jobs";
  const message = isTopPicks
    ? "Top picks could not be loaded. Refresh recommendations or return to the job board."
    : "The job list could not be loaded.";
  const fallbackHref = isTopPicks ? "/jobs/top-picks" : "/jobs";
  const fallbackLabel = isTopPicks ? "Reset top picks" : "Clear filters";

  return (
    <div className="mx-auto flex max-w-7xl flex-col items-center px-4 py-24 text-center sm:px-6">
      <h2 className="text-lg font-semibold text-foreground">
        {title}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {message}
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Button onClick={reset} variant="outline" size="sm">
          Try again
        </Button>
        <Button variant="ghost" size="sm" render={<Link href={fallbackHref} />}>
          {fallbackLabel}
        </Button>
      </div>
    </div>
  );
}
