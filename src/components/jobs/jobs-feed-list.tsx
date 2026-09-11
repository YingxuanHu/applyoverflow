"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { JobFeedMasterDetail } from "@/components/jobs/job-feed-master-detail";
import type { JobCardData } from "@/types";

export function JobsFeedList({
  initialJobs,
  referenceNow,
}: {
  initialJobs: JobCardData[];
  referenceNow: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const sourceHref = search ? `${pathname}?${search}` : pathname;
  const [jobs, setJobs] = useState(initialJobs);

  useEffect(() => {
    setJobs(initialJobs);
  }, [initialJobs]);

  const handleSavedChange = useCallback((jobId: string, saved: boolean) => {
    setJobs((current) =>
      current.map((job) => (job.id === jobId ? { ...job, isSaved: saved } : job))
    );
  }, []);

  if (jobs.length === 0) {
    return (
      <div className="empty-state">
        <p className="text-sm font-medium text-foreground">No more jobs on this page</p>
        <Link
          className="mt-2 inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
          href="/applications?status=WISHLIST"
        >
          Open wishlist
        </Link>
      </div>
    );
  }

  return (
    <JobFeedMasterDetail
      entries={jobs.map((job) => ({ id: job.id, job }))}
      onSavedChange={handleSavedChange}
      referenceNow={referenceNow}
      sourceHref={sourceHref}
    />
  );
}
