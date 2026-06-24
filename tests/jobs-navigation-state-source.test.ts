import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildJobDetailHref,
  buildJobsReturnAnchorHash,
  getJobsReturnLabel,
  getSafeJobsReturnHref,
} from "../src/lib/jobs/return-navigation";
import {
  buildScrollMemoryStorageKey,
} from "../src/components/navigation/scroll-position-memory";

function readRepoFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("job detail links preserve safe jobs and top-picks return state", () => {
  assert.equal(
    buildJobDetailHref("job_1", "/jobs/top-picks?page=3&workMode=REMOTE", "job_1"),
    "/jobs/job_1?from=%2Fjobs%2Ftop-picks%3Fpage%3D3%26workMode%3DREMOTE%23job-job_1"
  );
  assert.equal(
    buildJobDetailHref("job_1", "/jobs/top-picks?page=3&workMode=REMOTE"),
    "/jobs/job_1?from=%2Fjobs%2Ftop-picks%3Fpage%3D3%26workMode%3DREMOTE"
  );
  assert.equal(
    buildJobDetailHref("job_1", "/jobs?titleSearch=backend&page=4"),
    "/jobs/job_1?from=%2Fjobs%3FtitleSearch%3Dbackend%26page%3D4"
  );
  assert.equal(buildJobDetailHref("job_1", "https://bad.example/jobs"), "/jobs/job_1");
  assert.equal(getSafeJobsReturnHref("/jobs?titleSearch=backend#job-job_1"), "/jobs?titleSearch=backend#job-job_1");
  assert.equal(getSafeJobsReturnHref("/jobs?titleSearch=backend#bad/hash"), "/jobs?titleSearch=backend");
  assert.equal(getSafeJobsReturnHref("/jobs/not-a-feed"), null);
  assert.equal(getSafeJobsReturnHref("/applications"), null);
  assert.equal(getJobsReturnLabel("/jobs/top-picks?page=2"), "Top picks");
  assert.equal(buildJobsReturnAnchorHash("job/unsafe:id"), "#job-job_unsafe_id");
  assert.equal(
    buildScrollMemoryStorageKey({
      storageKeyPrefix: "autoapplication.jobs.scroll",
      pathname: "/jobs",
      search: "page=4&titleSearch=backend",
    }),
    "autoapplication.jobs.scroll:/jobs?page=4&titleSearch=backend"
  );
});

test("jobs and top picks lists pass source href through shared job cards", () => {
  const cardSource = readRepoFile("src/components/jobs/job-summary-card.tsx");
  const jobsFeedSource = readRepoFile("src/components/jobs/jobs-feed-list.tsx");
  const topPicksSource = readRepoFile("src/components/jobs/top-picks.tsx");
  const detailPageSource = readRepoFile("src/app/jobs/[id]/page.tsx");
  const detailScrollResetSource = readRepoFile("src/components/jobs/job-detail-scroll-reset.tsx");
  const topPicksPageSource = readRepoFile("src/app/jobs/top-picks/page.tsx");
  const topPicksErrorSource = readRepoFile("src/app/jobs/top-picks/error.tsx");
  const jobsErrorSource = readRepoFile("src/app/jobs/error.tsx");
  const paginationSource = readRepoFile("src/components/navigation/pagination-controls.tsx");

  assert.match(cardSource, /sourceHref\?: string/);
  assert.match(cardSource, /scrollMemoryKeyPrefix\?: string/);
  assert.match(cardSource, /data-job-card-id=\{job\.id\}/);
  assert.match(cardSource, /id=\{anchorId \|\| undefined\}/);
  assert.match(cardSource, /rememberScrollAnchorForHref/);
  assert.match(cardSource, /buildJobDetailHref\(job\.id, sourceHref, job\.id\)/);
  assert.match(jobsFeedSource, /usePathname/);
  assert.match(jobsFeedSource, /sourceHref=\{sourceHref\}/);
  assert.match(jobsFeedSource, /scrollMemoryKeyPrefix="autoapplication\.jobs\.scroll"/);
  assert.match(topPicksSource, /usePathname/);
  assert.match(topPicksSource, /sourceHref=\{sourceHref\}/);
  assert.match(topPicksSource, /scrollMemoryKeyPrefix="autoapplication\.top-picks\.scroll"/);
  assert.match(detailPageSource, /getSafeJobsReturnHref\(fromParam\) \?\? "\/jobs"/);
  assert.match(detailPageSource, /scroll=\{false\}/);
  assert.match(detailPageSource, /<JobDetailScrollReset jobId=\{job\.id\}/);
  assert.match(detailScrollResetSource, /\.app-scroll-root/);
  assert.match(detailScrollResetSource, /scrollTo\(\{ top: 0/);
  assert.match(topPicksPageSource, /ScrollPositionMemory/);
  assert.match(jobsFeedSource, /scrollMemoryKeyPrefix="autoapplication\.jobs\.scroll"/);
  assert.match(readRepoFile("src/app/jobs/page.tsx"), /restoreSavedPosition=\{false\}/);
  assert.match(readRepoFile("src/app/jobs/page.tsx"), /defaultScrollTop="top"/);
  assert.match(readRepoFile("src/app/jobs/top-picks/page.tsx"), /restoreSavedPosition=\{false\}/);
  assert.match(readRepoFile("src/app/jobs/top-picks/page.tsx"), /defaultScrollTop="top"/);
  assert.match(topPicksPageSource, /PaginationControls/);
  assert.match(topPicksPageSource, /basePath="\/jobs\/top-picks"/);
  assert.match(paginationSource, /name="page"/);
  assert.match(paginationSource, /max=\{totalPages \?\? undefined\}/);
  assert.match(paginationSource, /pageError\?: string \| null/);
  assert.doesNotMatch(paginationSource, /"use client"/);
  assert.doesNotMatch(paginationSource, /PageNumberLink/);
  assert.match(readRepoFile("src/components/navigation/scroll-position-memory.tsx"), /replaceCurrentHistoryAnchor/);
  assert.match(readRepoFile("src/components/navigation/scroll-position-memory.tsx"), /clearLocationHashAnchor/);
  assert.match(readRepoFile("src/components/navigation/scroll-position-memory.tsx"), /readLocationHashAnchor/);
  assert.match(readRepoFile("src/components/navigation/scroll-position-memory.tsx"), /USER_SCROLL_CANCEL_EVENTS/);
  assert.match(readRepoFile("src/components/navigation/scroll-position-memory.tsx"), /cancelPendingRestore/);
  assert.match(readRepoFile("src/components/navigation/scroll-position-memory.tsx"), /restoreSavedScroll/);
  assert.match(topPicksErrorSource, /Reconnecting to top picks/);
  assert.match(jobsErrorSource, /Reconnecting to jobs/);
  assert.match(jobsErrorSource, /error-recovery/);
  assert.doesNotMatch(jobsErrorSource, /temporary issue/i);
});
