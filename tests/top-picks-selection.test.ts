import { describe, it } from "node:test";
import { deepStrictEqual, strictEqual, ok, rejects } from "node:assert";
import { collectCandidateChannels, mergeCandidateChannels, selectTopPicks } from "../src/lib/top-picks/selection";

const pick = (id: string, company = "Company A", score = 90, title = `Engineer ${id}`) => ({
  score, job: { id, company, title, location: "Toronto, ON", postedAt: new Date("2026-09-01") },
});

describe("top picks candidate selection", () => {
  it("starts channels lazily and preserves order without exhausting a small pool", async () => {
    let running = 0, peak = 0;
    const batches = await collectCandidateChannels(["role", "skills", "location"].map(channel => async () => {
      peak = Math.max(peak, ++running);
      await new Promise(resolve => setImmediate(resolve));
      running--;
      return { channel, ids: [channel] };
    }));
    strictEqual(peak, 1);
    deepStrictEqual(batches.map(batch => batch.channel), ["role", "skills", "location"]);
    deepStrictEqual(await collectCandidateChannels([]), []);
  });

  it("does not start queued searches after a failed channel", async () => {
    let laterStarted = false;
    await rejects(collectCandidateChannels([
      async () => { throw new Error("Database unavailable"); },
      async () => { laterStarted = true; return { channel: "later", ids: [] }; },
    ]), /Database unavailable/);
    strictEqual(laterStarted, false);
  });

  it("reserves capacity for every channel and retains overlapping provenance", () => {
    const result = mergeCandidateChannels([
      { channel: "role", ids: ["a", "b", "c", "d"] },
      { channel: "fresh", ids: ["a", "e", "f"] },
      { channel: "location", ids: ["g", "e"] },
    ], 4);
    deepStrictEqual(result.ids, ["a", "e", "g", "b"]);
    deepStrictEqual([...result.channelsById.get("a")!], ["role", "fresh"]);
    deepStrictEqual([...result.channelsById.get("e")!], ["fresh", "location"]);
  });

  it("handles empty and entirely overlapping channels without duplicates or loops", () => {
    deepStrictEqual(mergeCandidateChannels([], 10).ids, []);
    deepStrictEqual(mergeCandidateChannels([{ channel: "a", ids: ["x", "y"] }, { channel: "b", ids: ["x", "y"] }], 10).ids, ["x", "y"]);
    deepStrictEqual(mergeCandidateChannels([{ channel: "a", ids: ["x"] }], 0).ids, []);
  });

  it("diversifies the first results without promoting a weak match", () => {
    const sameCompany = Array.from({ length: 20 }, (_, index) => pick(String(index)));
    const result = selectTopPicks([...sameCompany, pick("b", "Company B", 89), pick("c", "Company C", 65)], 10);
    strictEqual(result[0].job.company, "Company A");
    strictEqual(result[1].job.company, "Company B");
    ok(!result.some((item) => item.job.id === "c"));
  });

  it("keeps distinct specialties while collapsing equivalent postings", () => {
    const result = selectTopPicks([
      pick("1", "Company A", 90, "Engineer (Payments)"),
      pick("2", "Company A", 90, "Engineer (Platform)"),
      pick("3", "company a", 89, "Engineer - Payments"),
    ], 10);
    deepStrictEqual(result.map((item) => item.job.id), ["1", "2"]);
  });

  it("has deterministic ordering regardless of database return order", () => {
    const values = [pick("b"), pick("a"), pick("c", "Company B")];
    deepStrictEqual(selectTopPicks(values, 3), selectTopPicks([...values].reverse(), 3));
  });

  it("selects 300 from 20,000 candidates within a two-second local regression budget", () => {
    const values = Array.from({ length: 20_000 }, (_, index) => pick(String(index), `Company ${index % 200}`, 90));
    const start = performance.now();
    const result = selectTopPicks(values, 300);
    const duration = performance.now() - start;
    strictEqual(result.length, 300);
    ok(duration < 2000, `Selection took ${duration.toFixed(0)}ms`);
    console.log(`Selection benchmark: 20,000 candidates -> 300 picks in ${duration.toFixed(0)}ms`);
  });
});
