import assert from "node:assert/strict";
import test from "node:test";

import { createWorkdayConnector } from "../src/lib/ingestion/connectors/workday";

function listingJob(index: number) {
  return {
    title: `Software Engineer ${index}`,
    externalPath: `/job/Toronto/Software-Engineer-${index}_REQ${index}`,
    locationsText: "Toronto, ON",
  };
}

test("Workday continues after a malformed row in a full listing page", async () => {
  const originalFetch = globalThis.fetch;
  const listingOffsets: number[] = [];
  const firstPage = Array.from({ length: 20 }, (_, index) => listingJob(index));
  firstPage[7] = { title: "Malformed listing" } as ReturnType<typeof listingJob>;
  const secondPage = Array.from({ length: 20 }, (_, index) => listingJob(index + 20));

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (init?.method === "POST" && url.endsWith("/wday/cxs/acme/jobs/jobs")) {
      const body = JSON.parse(String(init.body)) as { offset: number };
      listingOffsets.push(body.offset);
      return new Response(
        JSON.stringify({
          total: 40,
          jobPostings: body.offset === 0 ? firstPage : secondPage,
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }

    if (url === "https://example.wd1.myworkdayjobs.com/jobs") {
      return new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    const connector = createWorkdayConnector({
      sourceToken: "example.wd1.myworkdayjobs.com|acme|jobs",
      companyName: "Acme",
    });
    const result = await connector.fetchJobs({
      now: new Date("2026-07-14T00:00:00.000Z"),
      log: () => undefined,
    });

    assert.deepEqual(listingOffsets, [0, 20]);
    assert.equal(result.jobs.length, 39);
    assert.equal(result.exhausted, true);
    assert.equal(result.checkpoint, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
