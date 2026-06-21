import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildJobDetailHref,
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
    buildJobDetailHref("job_1", "/jobs/top-picks?page=3&workMode=REMOTE"),
    "/jobs/job_1?from=%2Fjobs%2Ftop-picks%3Fpage%3D3%26workMode%3DREMOTE"
  );
  assert.equal(
    buildJobDetailHref("job_1", "/jobs?titleSearch=backend&page=4"),
    "/jobs/job_1?from=%2Fjobs%3FtitleSearch%3Dbackend%26page%3D4"
  );
  assert.equal(buildJobDetailHref("job_1", "https://bad.example/jobs"), "/jobs/job_1");
  assert.equal(getSafeJobsReturnHref("/jobs/not-a-feed"), null);
  assert.equal(getSafeJobsReturnHref("/applications"), null);
  assert.equal(getJobsReturnLabel("/jobs/top-picks?page=2"), "Top picks");
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
  const topPicksPageSource = readRepoFile("src/app/jobs/top-picks/page.tsx");
  const topPicksErrorSource = readRepoFile("src/app/jobs/top-picks/error.tsx");
  const jobsErrorSource = readRepoFile("src/app/jobs/error.tsx");

  assert.match(cardSource, /sourceHref\?: string/);
  assert.match(cardSource, /scrollMemoryKeyPrefix\?: string/);
  assert.match(cardSource, /data-job-card-id=\{job\.id\}/);
  assert.match(cardSource, /rememberScrollAnchorForHref/);
  assert.match(cardSource, /buildJobDetailHref\(job\.id, sourceHref\)/);
  assert.match(jobsFeedSource, /usePathname/);
  assert.match(jobsFeedSource, /sourceHref=\{sourceHref\}/);
  assert.match(jobsFeedSource, /scrollMemoryKeyPrefix="autoapplication\.jobs\.scroll"/);
  assert.match(topPicksSource, /usePathname/);
  assert.match(topPicksSource, /sourceHref=\{sourceHref\}/);
  assert.match(topPicksSource, /scrollMemoryKeyPrefix="autoapplication\.top-picks\.scroll"/);
  assert.match(detailPageSource, /getSafeJobsReturnHref\(fromParam\) \?\? "\/jobs"/);
  assert.match(detailPageSource, /scroll=\{false\}/);
  assert.match(topPicksPageSource, /ScrollPositionMemory/);
  assert.match(topPicksErrorSource, /Failed to load top picks/);
  assert.doesNotMatch(jobsErrorSource, /temporary issue/i);
});
