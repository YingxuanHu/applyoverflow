import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://unit:test@localhost:5432/unit";

test("publication rechecks occupation and geography independently of old classification", async () => {
  const { shouldExcludeFromFeedIndex } = await import("../src/lib/ingestion/search-index");
  const now = new Date();
  const valid = {
    title: "People Operations Manager", company: "Example Inc", location: "Toronto, ON, Canada", region: "CA" as const,
    description: "Lead people operations and employee development. Work with business teams to improve hiring, training, retention and employee experience. Responsibilities include developing HR policies, reporting and organizational planning. Requirements include experience in people operations and clear communication skills.",
    shortSummary: "Lead people operations and organizational planning", workMode: "HYBRID", status: "LIVE", availabilityScore: 100,
    applyUrl: "https://example.com/jobs/people-operations", sourceCount: 1, titleConfidence: 1, titleStatus: "verified",
    applyUrlValidationStatus: null, deadline: null, deadSignalAt: null, lastSourceSeenAt: now, lastConfirmedAliveAt: now, now,
  };
  assert.equal(shouldExcludeFromFeedIndex(valid), false);
  assert.equal(shouldExcludeFromFeedIndex({ ...valid, title: "Grocery Clerk Part Time Day" }), true);
  assert.equal(shouldExcludeFromFeedIndex({ ...valid, location: "Kediri, Jawa Timur, ID" }), true);
  assert.equal(shouldExcludeFromFeedIndex({ ...valid, title: "Healthcare Administration Director" }), false);
});
